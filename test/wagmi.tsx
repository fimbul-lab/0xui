import { QueryClient } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import {
  custom,
  decodeFunctionData,
  encodeAbiParameters,
  encodeFunctionResult,
  erc20Abi,
  hexToBytes,
  parseAbi,
  toHex,
  zeroAddress,
  type Address,
  type Chain,
  type Hex,
} from "viem";
import { vi } from "vitest";
import { createConfig, createConnector, type Config } from "wagmi";
import { connect } from "wagmi/actions";
import { mainnet, sepolia } from "wagmi/chains";
import { mock, type MockParameters } from "wagmi/connectors";
import { Web3Provider } from "@/components/web3-provider";

export const testAccounts = [
  "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
  "0x71C7656EC7ab88b098defB751B7401B5f6d8976F",
] as const;

/**
 * Canned JSON-RPC responses by method name. A function receives the params.
 * Throw `{ code, message }` from a function to return a JSON-RPC error, e.g.
 * `{ code: 4001 }` for a user rejection.
 */
export type RpcResponses = Record<string, unknown | ((params: any) => unknown)>;

async function respond(rpc: RpcResponses, method: string, params: unknown) {
  if (!(method in rpc)) throw new Error(`RPC method not mocked: ${method}`);
  const response = rpc[method];
  return typeof response === "function" ? response(params) : response;
}

/**
 * The mock connector forwards wallet methods it doesn't handle (e.g.
 * eth_sendTransaction) to the chain's RPC URL with fetch. Answer those from
 * the same map, as a JSON-RPC server would.
 */
function stubWalletRpc(rpc: RpcResponses) {
  const realFetch = globalThis.fetch;
  vi.stubGlobal("fetch", async (url: string, init?: { body?: string }) => {
    // Not JSON-RPC (e.g. NFT metadata, data: URIs): use the real fetch.
    if (typeof init?.body !== "string") return realFetch(url, init as RequestInit);
    const { id, method, params } = JSON.parse(init.body);
    try {
      const result = await respond(rpc, method, params);
      return Response.json({ jsonrpc: "2.0", id, result });
    } catch (error) {
      const { code = -32603, message = String(error) } = error as {
        code?: number;
        message?: string;
      };
      return Response.json({ jsonrpc: "2.0", id, error: { code, message } });
    }
  });
}

/**
 * wagmi config with only the mock connector and a fake RPC. Nothing touches
 * the network: methods missing from `rpc` fail like an unreachable node.
 * Stubs `fetch` for the test (restored in test/setup.ts).
 *
 * Use `features` to make the "wallet" reject or fail, e.g.
 * `{ switchChainError: true }` for a user rejection.
 */
/**
 * The mock wallet, reporting the given EIP-5792 capabilities per chain id,
 * e.g. `{ 1: { atomic: { status: "supported" } } }`.
 */
function withCapabilities(
  wallet: ReturnType<typeof mock>,
  capabilities: Record<number, unknown>,
): ReturnType<typeof mock> {
  return createConnector((config) => {
    const connector = wallet(config);
    return {
      ...connector,
      async getProvider(params) {
        const provider = await connector.getProvider(params);
        return {
          ...provider,
          request: (args: { method: string; params?: unknown }) =>
            args.method === "wallet_getCapabilities"
              ? Promise.resolve(
                  Object.fromEntries(
                    Object.entries(capabilities).map(([id, value]) => [toHex(Number(id)), value]),
                  ),
                )
              : provider.request(args as never),
        } as typeof provider;
      },
    };
  });
}

export function createTestConfig({
  features,
  rpc = {},
  accounts = testAccounts,
  wallets = [accounts],
  capabilities,
}: {
  features?: MockParameters["features"];
  rpc?: RpcResponses;
  /** Accounts the mock wallet exposes. The first one is used. */
  accounts?: readonly [Address, ...Array<Address>];
  /** One mock wallet per entry, each with its own accounts. Defaults to a single wallet with `accounts`. */
  wallets?: ReadonlyArray<readonly [Address, ...Array<Address>]>;
  /** EIP-5792 capabilities the wallet reports, by chain id. Without it the wallet can't batch. */
  capabilities?: Record<number, unknown>;
} = {}) {
  stubWalletRpc(rpc);
  const transport = custom(
    { request: ({ method, params }) => respond(rpc, method, params) },
    { retryCount: 0 },
  );
  return createConfig({
    chains: [withoutMulticall(mainnet), withoutMulticall(sepolia)],
    connectors: wallets.map((walletAccounts) => {
      const wallet = mock({ accounts: walletAccounts, features });
      return capabilities ? withCapabilities(wallet, capabilities) : wallet;
    }),
    transports: { [mainnet.id]: transport, [sepolia.id]: transport },
    // Fast block/receipt polling so tests don't wait 4s per poll.
    pollingInterval: 20,
    // No persistence: wagmi would otherwise carry the current chain and
    // recent wallet from one test to the next through localStorage.
    storage: null,
  });
}

export const fakeTxHash = `0x${"ab".repeat(32)}` as const;

/**
 * A minimal chain that starts at block 100, advances one block per
 * eth_blockNumber call, and accepts transactions. A sent transaction is
 * mined in block 100 with `status`. Spread it into `rpc` and override
 * methods as needed, e.g. `eth_sendTransaction` to reject.
 */
export function fakeChainRpc({
  status = "success",
  chainId = 1,
}: { status?: "success" | "reverted"; chainId?: number } = {}): RpcResponses {
  let sent: { from: string; to: string } | undefined;
  let block = 100;
  return {
    eth_chainId: `0x${chainId.toString(16)}`,
    eth_blockNumber: () => `0x${(block++).toString(16)}`,
    eth_getTransactionCount: "0x0",
    eth_estimateGas: "0x5208",
    eth_gasPrice: "0x3b9aca00",
    eth_maxPriorityFeePerGas: "0x3b9aca00",
    eth_getBlockByNumber: {
      number: "0x64",
      hash: `0x${"11".repeat(32)}`,
      timestamp: "0x0",
      baseFeePerGas: "0x3b9aca00",
      transactions: [],
    },
    eth_sendTransaction: ([tx]: [{ from: string; to: string }]) => {
      sent = tx;
      return fakeTxHash;
    },
    eth_getTransactionByHash: () =>
      sent && {
        hash: fakeTxHash,
        from: sent.from,
        to: sent.to,
        input: "0x",
        value: "0x0",
        nonce: "0x0",
        gas: "0x5208",
        maxFeePerGas: "0x3b9aca00",
        maxPriorityFeePerGas: "0x3b9aca00",
        type: "0x2",
        chainId: `0x${chainId.toString(16)}`,
        v: "0x0",
        r: `0x${"01".repeat(32)}`,
        s: `0x${"02".repeat(32)}`,
        blockHash: null,
        blockNumber: null,
        transactionIndex: null,
      },
    eth_getTransactionReceipt: () =>
      sent && {
        transactionHash: fakeTxHash,
        blockHash: `0x${"22".repeat(32)}`,
        blockNumber: "0x64",
        transactionIndex: "0x0",
        from: sent.from,
        to: sent.to,
        cumulativeGasUsed: "0x5208",
        gasUsed: "0x5208",
        effectiveGasPrice: "0x3b9aca00",
        contractAddress: null,
        logs: [],
        logsBloom: `0x${"00".repeat(256)}`,
        status: status === "success" ? "0x1" : "0x0",
        type: "0x2",
      },
  };
}

/**
 * wagmi batches reads through Multicall3 by default. Without it, reads become
 * plain RPC calls (eth_getBalance, eth_call) that are easy to fake.
 */
function withoutMulticall<chain extends Chain>(chain: chain): chain {
  const { multicall3: _, ...contracts } = chain.contracts ?? {};
  return { ...chain, contracts };
}

export function renderWithWagmi(
  ui: ReactElement,
  { config = createTestConfig() }: { config?: Config } = {},
) {
  // No retries: a failing RPC should fail the query immediately.
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return {
    config,
    ...render(
      <Web3Provider config={config} queryClient={queryClient}>
        {ui}
      </Web3Provider>,
    ),
  };
}

/** Connect a mock wallet (the first by default), as if the user approved the connection. */
export function connectMock(config: Config, wallet = 0) {
  return connect(config, { connector: config.connectors[wallet]! });
}

type EthCall = [{ to: Address; data: Hex }];

/**
 * eth_call handler for ERC-20 reads. Values can be functions so a test can
 * change them, e.g. raise the allowance after an approve is sent.
 */
export function erc20CallRpc({
  balance = 0n,
  allowance = 0n,
  decimals = 18,
  symbol = "TKN",
}: {
  balance?: bigint | (() => bigint);
  allowance?: bigint | (() => bigint);
  decimals?: number;
  symbol?: string;
} = {}) {
  const value = <T,>(v: T | (() => T)) => (typeof v === "function" ? (v as () => T)() : v);
  return ([{ data }]: EthCall) => {
    const { functionName } = decodeFunctionData({ abi: erc20Abi, data });
    const result =
      functionName === "balanceOf"
        ? value(balance)
        : functionName === "allowance"
          ? value(allowance)
          : functionName === "decimals"
            ? decimals
            : functionName === "symbol"
              ? symbol
              : undefined;
    if (result === undefined) throw new Error(`erc20 ${functionName} not mocked`);
    return encodeFunctionResult({ abi: erc20Abi, functionName, result } as never);
  };
}

const universalResolverAbi = parseAbi([
  "function resolveWithGateways(bytes name, bytes data, string[] gateways) view returns (bytes, address)",
]);

/** Decode a DNS wire-format name ("\x07vitalik\x03eth\x00") to "vitalik.eth". */
function decodeDnsName(data: Hex) {
  const bytes = hexToBytes(data);
  const labels: Array<string> = [];
  for (let i = 0; bytes[i]; i += bytes[i]! + 1) {
    labels.push(new TextDecoder().decode(bytes.slice(i + 1, i + 1 + bytes[i]!)));
  }
  return labels.join(".");
}

const resolverAbi = parseAbi([
  "function addr(bytes32 node) view returns (address)",
  "function text(bytes32 node, string key) view returns (string)",
]);

/**
 * eth_call handler for ENS forward resolution through the universal
 * resolver: `addr` from `names`, `text` records from `texts`. Names missing
 * from `names` resolve to no address.
 */
export function ensResolveRpc(
  names: Record<string, Address>,
  texts: Record<string, Record<string, string>> = {},
) {
  return ([{ data }]: EthCall) => {
    const { args } = decodeFunctionData({ abi: universalResolverAbi, data });
    const name = decodeDnsName(args[0]);
    const address = names[name] ?? zeroAddress;
    const call = decodeFunctionData({ abi: resolverAbi, data: args[1] });
    const inner =
      call.functionName === "text"
        ? encodeAbiParameters([{ type: "string" }], [texts[name]?.[call.args[1]] ?? ""])
        : encodeAbiParameters([{ type: "address" }], [address]);
    return encodeFunctionResult({
      abi: universalResolverAbi,
      functionName: "resolveWithGateways",
      result: [inner, address],
    });
  };
}
