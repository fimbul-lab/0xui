import { custom, http, keccak256, toHex, type Chain, type Hex } from "viem";
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

/** How long a demo transaction stays pending. */
const MINE_AFTER_MS = 3_000;

type DemoTx = { hash: Hex; from: Hex; to: Hex; value: Hex; sentAt: number };
const demoTxs = new Map<Hex, DemoTx>();

function sendDemoTransaction(tx: { from: Hex; to: Hex; value?: Hex }) {
  const hash = keccak256(toHex(`${tx.from}${tx.to}${Date.now()}${Math.random()}`));
  demoTxs.set(hash, {
    hash,
    from: tx.from,
    to: tx.to,
    value: tx.value ?? "0x0",
    sentAt: Date.now(),
  });
  return hash;
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
      async getProvider(params) {
        const provider = await wallet.getProvider(params);
        return {
          ...provider,
          async request(args: { method: string; params?: unknown }) {
            if (args.method === "eth_sendTransaction") {
              const [tx] = args.params as [{ from: Hex; to: Hex; value?: Hex }];
              return sendDemoTransaction(tx);
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
      if (tx && method === "eth_getTransactionByHash") {
        return {
          hash: tx.hash,
          from: tx.from,
          to: tx.to,
          value: tx.value,
          input: "0x",
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
        if (Date.now() - tx.sentAt < MINE_AFTER_MS) return null;
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
  transports: Object.fromEntries(
    chains.map((chain) => [chain.id, demoTransport(chain)])
  ) as Record<(typeof chains)[number]["id"], ReturnType<typeof demoTransport>>,
  ssr: true,
});
