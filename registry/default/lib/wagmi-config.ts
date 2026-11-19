// Docs: https://0xui.io/getting-started/installation.md
import { createConfig, http } from "wagmi";
import { mainnet, sepolia } from "wagmi/chains";
import { injected } from "wagmi/connectors";

export const config = createConfig({
  chains: [mainnet, sepolia],
  connectors: [
    // Browser extension wallets (MetaMask, Rabby, ...). Extensions that
    // support EIP-6963 are also discovered automatically.
    injected(),

    // More connectors live in `wagmi/connectors`. Each needs its SDK installed:
    // walletConnect({ projectId: "<id from cloud.reown.com>" }), // npm i @walletconnect/ethereum-provider
    // baseAccount({ appName: "My App" }),                        // npm i @base-org/account
  ],
  transports: {
    // `http()` with no URL uses the chain's public RPC, which is rate limited.
    // Pass your own RPC URL in production.
    [mainnet.id]: http(),
    [sepolia.id]: http(),
  },
  // Set to true when rendering on a server (Next.js, Remix, Astro islands).
  ssr: true,
});
