import { QueryClient } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import { custom } from "viem";
import { createConfig, type Config } from "wagmi";
import { connect } from "wagmi/actions";
import { mainnet, sepolia } from "wagmi/chains";
import { mock, type MockParameters } from "wagmi/connectors";
import { Web3Provider } from "@/components/web3-provider";

export const testAccounts = [
  "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
  "0x71C7656EC7ab88b098defB751B7401B5f6d8976F",
] as const;

/** Canned JSON-RPC responses by method name. A function receives the params. */
export type RpcResponses = Record<string, unknown | ((params: unknown) => unknown)>;

/**
 * wagmi config with only the mock connector and a fake RPC. Nothing touches
 * the network: methods missing from `rpc` fail like an unreachable node.
 *
 * Use `features` to make the "wallet" reject or fail, e.g.
 * `{ switchChainError: true }` for a user rejection.
 */
export function createTestConfig({
  features,
  rpc = {},
}: { features?: MockParameters["features"]; rpc?: RpcResponses } = {}) {
  const transport = custom(
    {
      async request({ method, params }) {
        if (!(method in rpc)) throw new Error(`RPC method not mocked: ${method}`);
        const response = rpc[method];
        return typeof response === "function" ? response(params) : response;
      },
    },
    { retryCount: 0 }
  );
  return createConfig({
    chains: [mainnet, sepolia],
    connectors: [mock({ accounts: testAccounts, features })],
    transports: { [mainnet.id]: transport, [sepolia.id]: transport },
  });
}

export function renderWithWagmi(
  ui: ReactElement,
  { config = createTestConfig() }: { config?: Config } = {}
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
      </Web3Provider>
    ),
  };
}

/** Connect the mock wallet, as if the user approved the connection. */
export function connectMock(config: Config) {
  return connect(config, { connector: config.connectors[0]! });
}
