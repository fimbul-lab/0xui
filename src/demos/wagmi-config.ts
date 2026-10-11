import { createConfig, createConnector, http } from "wagmi";
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

/**
 * wagmi's mock connector, renamed. Lets every docs demo connect, switch
 * chains and sign without a browser extension.
 */
function demoWallet() {
  return createConnector((config) => ({
    ...mock({ accounts: demoAccounts, features: { reconnect: true } })(config),
    id: "demo",
    name: "Demo Wallet",
  }));
}

export const demoConfig = createConfig({
  chains: [mainnet, sepolia, base, unichain, sonic, berachain, pulsechain, monad],
  connectors: [demoWallet(), injected()],
  transports: {
    [mainnet.id]: http(),
    [sepolia.id]: http(),
    [base.id]: http(),
    [unichain.id]: http(),
    [sonic.id]: http(),
    [berachain.id]: http(),
    [pulsechain.id]: http(),
    [monad.id]: http(),
  },
  ssr: true,
});
