import {
  custom,
  decodeFunctionData,
  decodeFunctionResult,
  encodeFunctionResult,
  multicall3Abi,
  erc20Abi,
  http,
  keccak256,
  toHex,
} from "viem";
import type { Chain, Hex, TypedDataDefinition } from "viem";
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
const MINE_AFTER_MS = 3000;

/**
 * Signs for the demo wallet. It's a throwaway key, not the demo account's,
 * so demo signatures don't verify against the connected address.
 */
const demoSigner = privateKeyToAccount(keccak256(toHex("0xui demo signer")));

/** The shape of EIP-712 typed data: types, a primary type and a message. */
const isTypedData = (value: unknown): value is TypedDataDefinition =>
  typeof value === "object" &&
  value !== null &&
  "types" in value &&
  typeof value.types === "object" &&
  value.types !== null &&
  "primaryType" in value &&
  typeof value.primaryType === "string" &&
  "message" in value &&
  typeof value.message === "object" &&
  value.message !== null;

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

/** Encoded allowance for a direct `allowance()` call covered by a demo approve. */
function demoAllowanceResult(token: Hex, data: Hex) {
  try {
    const call = decodeFunctionData({ abi: erc20Abi, data });
    if (call.functionName !== "allowance") {
      return undefined;
    }
    const allowance = demoAllowance(token, call.args[0], call.args[1]);
    return allowance === undefined
      ? undefined
      : encodeFunctionResult({ abi: erc20Abi, functionName: "allowance", result: allowance });
  } catch {
    return undefined; // Not an ERC-20 call.
  }
}

/**
 * Reads are batched through Multicall3. Forward the batch to the real
 * chain, then overwrite allowance results that a demo approve changed.
 */
async function patchMulticall(data: Hex, forward: () => Promise<Hex>) {
  const result = await forward();
  let calls: ReadonlyArray<{ target: Hex; callData: Hex }>;
  try {
    const decoded = decodeFunctionData({ abi: multicall3Abi, data });
    if (decoded.functionName !== "aggregate3") {
      return result;
    }
    calls = decoded.args[0];
  } catch {
    return result;
  }
  const overrides = calls.map((c) => demoAllowanceResult(c.target, c.callData));
  if (!overrides.some(Boolean)) {
    return result;
  }
  const results = decodeFunctionResult({
    abi: multicall3Abi,
    functionName: "aggregate3",
    data: result,
  });
  return encodeFunctionResult({
    abi: multicall3Abi,
    functionName: "aggregate3",
    result: results.map((r, i) => (overrides[i] ? { success: true, returnData: overrides[i] } : r)),
  });
}

/** Demo call batches (EIP-5792) by id, each a list of demo transaction hashes. */
const demoBatches = new Map<Hex, Array<Hex>>();

/** Allowance set by a mined demo approve, so approval demos can complete. */
function demoAllowance(token: Hex, owner: Hex, spender: Hex) {
  let allowance: bigint | undefined;
  for (const tx of demoTxs.values()) {
    if (!isMined(tx) || tx.to.toLowerCase() !== token.toLowerCase()) {
      continue;
    }
    if (tx.from.toLowerCase() !== owner.toLowerCase()) {
      continue;
    }
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
        } catch {
          // Storage is blocked: the wallet just won't reconnect on the next page.
        }
        return result;
      },
      async disconnect() {
        try {
          localStorage.removeItem(CONNECTED_FLAG);
        } catch {
          // Storage is blocked, so there is no flag to clear.
        }
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
                config.chains.map((chain) => [
                  toHex(chain.id),
                  { atomic: { status: "supported" } },
                ]),
              );
            }
            if (args.method === "wallet_sendCalls") {
              const [{ from, calls }] = args.params as [
                { from: Hex; calls: Array<{ to: Hex; data?: Hex; value?: Hex }> },
              ];
              const hashes = calls.map((call) => sendDemoTransaction({ from, ...call }));
              const id = keccak256(toHex(hashes.join("")));
              demoBatches.set(id, hashes);
              return { id };
            }
            if (args.method === "wallet_getCallsStatus") {
              const [id] = args.params as [Hex];
              const txs = (demoBatches.get(id) ?? []).flatMap((hash) => demoTxs.get(hash) ?? []);
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
              const parsed: unknown = JSON.parse(typedData);
              if (!isTypedData(parsed)) {
                throw new Error("eth_signTypedData_v4 needs EIP-712 typed data.");
              }
              return demoSigner.signTypedData(parsed);
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
    async request({ method, params }: { method: string; params?: unknown }) {
      const hash = (params as [Hex] | undefined)?.[0];
      const tx = typeof hash === "string" ? demoTxs.get(hash) : undefined;

      if (method === "eth_estimateGas") {
        return "0x5208";
      }
      if (method === "eth_call") {
        const [{ to, data }] = params as [{ to: Hex; data: Hex }];
        const direct = demoAllowanceResult(to, data);
        if (direct) {
          return direct;
        }
        if (to.toLowerCase() === chain.contracts?.multicall3?.address.toLowerCase()) {
          return patchMulticall(data, () => rpc.request({ method, params } as never));
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
        if (!isMined(tx)) {
          return null;
        }
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
          status: tx.to.toLowerCase() === demoRevertAddress.toLowerCase() ? "0x0" : "0x1",
          type: "0x2",
        };
      }
      return rpc.request({ method, params } as never);
    },
  });
}

const chains = [mainnet, sepolia, base, unichain, sonic, berachain, pulsechain, monad] as const;

export const demoConfig = createConfig({
  chains,
  connectors: [demoWallet(), injected()],
  transports: Object.fromEntries(chains.map((chain) => [chain.id, demoTransport(chain)])) as Record<
    (typeof chains)[number]["id"],
    ReturnType<typeof demoTransport>
  >,
  ssr: true,
});
