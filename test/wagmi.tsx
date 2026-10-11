import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import { createConfig, http, type Config } from "wagmi";
import { connect } from "wagmi/actions";
import { mainnet, sepolia } from "wagmi/chains";
import { mock, type MockParameters } from "wagmi/connectors";
import { Web3Provider } from "@/components/web3-provider";

export const testAccounts = [
  "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
  "0x71C7656EC7ab88b098defB751B7401B5f6d8976F",
] as const;

/**
 * wagmi config with only the mock connector. Use `features` to make the
 * "wallet" reject or fail, e.g. `{ switchChainError: true }` for a user
 * rejection or `{ switchChainError: new Error("…") }` for a failure.
 */
export function createTestConfig(features?: MockParameters["features"]) {
  return createConfig({
    chains: [mainnet, sepolia],
    connectors: [mock({ accounts: testAccounts, features })],
    transports: { [mainnet.id]: http(), [sepolia.id]: http() },
  });
}

export function renderWithWagmi(
  ui: ReactElement,
  { config = createTestConfig() }: { config?: Config } = {}
) {
  return { config, ...render(<Web3Provider config={config}>{ui}</Web3Provider>) };
}

/** Connect the mock wallet, as if the user approved the connection. */
export function connectMock(config: Config) {
  return connect(config, { connector: config.connectors[0]! });
}
