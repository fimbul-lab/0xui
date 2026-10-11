import {
  custom,
  decodeFunctionData,
  encodeFunctionResult,
  erc20Abi,
  http,
  keccak256,
  toHex,
  type Chain,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { createConfig, createConnector } from "wagmi";
import {
  base,
  berachain,
  mainnet,
  monad,
  pulsechain,
  sepolia,
  sonic,
  unichain,
} from "wagmi/chains";
import { injected, mock } from "wagmi/connectors";

/** Accounts exposed by the demo wallet. The first resolves to vitalik.eth so ENS demos have data. */
export const demoAccounts = [
  "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
  "0x71C7656EC7ab88b098defB751B7401B5f6d8976F",
] as const;

/** Demo transactions sent to this address are mined as reverted. */
export const demoRevertAddress = "0x000000000000000000000000000000000000dEaD";

const CONNECTED_FLAG = "0xui:demo-wallet-connected";

/** How long a demo transaction stays pending. */
const MINE_AFTER_MS = 3_000;

/**
 * Signs for the demo wallet. It's a throwaway key, not the demo account's,
 * so demo signatures don't verify against the connected address.
 */
const demoSigner = privateKeyToAccount(keccak256(toHex("0xui demo signer")));

type DemoTx = {
  hash: Hex;
  from: Hex;
  to: Hex;
  value: Hex;
  data: Hex;
  sentAt: number;
};
const demoTxs = new Map<Hex, DemoTx>();

const isMined = (tx: DemoTx) => Date.now() - tx.sentAt >= MINE_AFTER_MS;

function sendDemoTransaction(tx: { from: Hex; to: Hex; value?: Hex; data?: Hex }) {
  const hash = keccak256(toHex(`${tx.from}${tx.to}${Date.now()}${Math.random()}`));
  demoTxs.set(hash, {
    hash,
    from: tx.from,
    to: tx.to,
    value: tx.value ?? "0x0",
    data: tx.data ?? "0x",
    sentAt: Date.now(),
  });
  return hash;
}

/** Demo call batches (EIP-5792) by id, each a list of demo transaction hashes. */
const demoBatches = new Map<Hex, Hex[]>();

/** Allowance set by a mined demo approve, so approval demos can complete. */
function demoAllowance(token: Hex, owner: Hex, spender: Hex) {
  let allowance: bigint | undefined;
  for (const tx of demoTxs.values()) {
    if (!isMined(tx) || tx.to.toLowerCase() !== token.toLowerCase()) continue;
    if (tx.from.toLowerCase() !== owner.toLowerCase()) continue;
    try {
      const call = decodeFunctionData({ abi: erc20Abi, data: tx.data });
      if (call.functionName === "approve" && call.args[0].toLowerCase() === spender.toLowerCase()) {
        allowance = call.args[1];
      }
    } catch {
      // Not an ERC-20 call.
    }
  }
  return allowance;
}

/**
 * wagmi's mock connector, renamed, with simulated transactions. Lets every
 * docs demo connect, switch chains and "send" without a browser extension:
 * sent transactions get a fake hash and are mined a few seconds later.
 * Nothing is broadcast.
 */
function demoWallet() {
  return createConnector((config) => {
    const wallet = mock({
      accounts: demoAccounts,
      features: { reconnect: true },
    })(config);
    return {
      ...wallet,
      id: "demo",
      name: "Demo Wallet",
      // The mock only remembers its connection in memory. Persist it so the
      // Demo Wallet reconnects across docs pages, like a real wallet would.
      async connect(params) {
        const result = await wallet.connect(params);
        try {
          localStorage.setItem(CONNECTED_FLAG, "1");
        } catch {}
        return result;
      },
      async disconnect() {
        try {
          localStorage.removeItem(CONNECTED_FLAG);
        } catch {}
        return wallet.disconnect();
      },
      async isAuthorized() {
        try {
          return localStorage.getItem(CONNECTED_FLAG) === "1";
        } catch {
          return false;
        }
      },
      async getProvider(params) {
        const provider = await wallet.getProvider(params);
        return {
          ...provider,
          async request(args: { method: string; params?: unknown }) {
            if (args.method === "eth_sendTransaction") {
              const [tx] = args.params as [{ from: Hex; to: Hex; value?: Hex; data?: Hex }];
              return sendDemoTransaction(tx);
            }
            if (args.method === "wallet_getCapabilities") {
              // Atomic batching everywhere, like a smart account would offer.
              return Object.fromEntries(
                config.chains.map((chain) => [toHex(chain.id), { atomic: { status: "supported" } }])
              );
            }
            if (args.method === "wallet_sendCalls") {
              const [{ from, calls }] = args.params as [
                { from: Hex; calls: { to: Hex; data?: Hex; value?: Hex }[] },
              ];
              const hashes = calls.map((call) => sendDemoTransaction({ from, ...call }));
              const id = keccak256(toHex(hashes.join("")));
              demoBatches.set(id, hashes);
              return { id };
            }
            if (args.method === "wallet_getCallsStatus") {
              const [id] = args.params as [Hex];
              const txs = (demoBatches.get(id) ?? []).map((hash) => demoTxs.get(hash)!);
              const mined = txs.length > 0 && txs.every(isMined);
              return {
                version: "2.0.0",
                id,
                chainId: toHex(params?.chainId ?? 1),
                atomic: true,
                status: mined ? 200 : 100,
                receipts: mined
                  ? txs.map((tx) => ({
                      transactionHash: tx.hash,
                      blockHash: keccak256(toHex(`block-${tx.hash}`)),
                      blockNumber: "0x1",
                      gasUsed: "0x5208",
                      logs: [],
                      status: "0x1",
                    }))
                  : [],
              };
            }
            if (args.method === "personal_sign") {
              const [message] = args.params as [Hex];
              return demoSigner.signMessage({ message: { raw: message } });
            }
            if (args.method === "eth_signTypedData_v4") {
              const [, typedData] = args.params as [Hex, string];
              return demoSigner.signTypedData(JSON.parse(typedData));
            }
            return provider.request(args as never);
          },
        };
      },
    };
  });
}

/**
 * Real RPC for everything except demo transactions, whose lookups are
 * answered locally so they appear to be mined after a short delay.
 */
function demoTransport(chain: Chain) {
  const rpc = http()({ chain, retryCount: 1 });
  return custom({
    async request({ method, params }) {
      const hash = (params as [Hex] | undefined)?.[0];
      const tx = typeof hash === "string" ? demoTxs.get(hash) : undefined;

      if (method === "eth_estimateGas") return "0x5208";
      if (method === "eth_call") {
        const [{ to, data }] = params as [{ to: Hex; data: Hex }];
        try {
          const call = decodeFunctionData({ abi: erc20Abi, data });
          if (call.functionName === "allowance") {
            const allowance = demoAllowance(to, call.args[0], call.args[1]);
            if (allowance !== undefined) {
              return encodeFunctionResult({ abi: erc20Abi, functionName: "allowance", result: allowance });
            }
          }
        } catch {
          // Not an ERC-20 call: ask the real chain.
        }
      }
      if (tx && method === "eth_getTransactionByHash") {
        return {
          hash: tx.hash,
          from: tx.from,
          to: tx.to,
          value: tx.value,
          input: tx.data,
          nonce: "0x0",
          gas: "0x5208",
          maxFeePerGas: "0x3b9aca00",
          maxPriorityFeePerGas: "0x3b9aca00",
          type: "0x2",
          v: "0x0",
          r: `0x${"01".repeat(32)}`,
          s: `0x${"02".repeat(32)}`,
          blockHash: null,
          blockNumber: null,
          transactionIndex: null,
        };
      }
      if (tx && method === "eth_getTransactionReceipt") {
        if (!isMined(tx)) return null;
        const blockNumber = await rpc.request({ method: "eth_blockNumber" });
        return {
          transactionHash: tx.hash,
          blockHash: keccak256(toHex(`block-${tx.hash}`)),
          blockNumber,
          transactionIndex: "0x0",
          from: tx.from,
          to: tx.to,
          cumulativeGasUsed: "0x5208",
          gasUsed: "0x5208",
          effectiveGasPrice: "0x3b9aca00",
          contractAddress: null,
          logs: [],
          logsBloom: `0x${"00".repeat(256)}`,
          status:
            tx.to.toLowerCase() === demoRevertAddress.toLowerCase()
              ? "0x0"
              : "0x1",
          type: "0x2",
        };
      }
      return rpc.request({ method, params } as never);
    },
  });
}

const chains = [
  mainnet,
  sepolia,
  base,
  unichain,
  sonic,
  berachain,
  pulsechain,
  monad,
] as const;

export const demoConfig = createConfig({
  chains,
  connectors: [demoWallet(), injected()],
  // Plain eth_call reads instead of Multicall3, so the demo transport can
  // answer allowance reads after a demo approve.
  batch: { multicall: false },
  transports: Object.fromEntries(
    chains.map((chain) => [chain.id, demoTransport(chain)])
  ) as Record<(typeof chains)[number]["id"], ReturnType<typeof demoTransport>>,
  ssr: true,
});
