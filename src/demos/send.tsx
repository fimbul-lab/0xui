import { Send } from "@/components/send";
import { ConnectWallet } from "@/components/connect-wallet";
import { demoPrices } from "./prices";
import { demoTokens } from "./tokens";
import { demo } from "./demo";

export const Default = demo(() => (
  <>
    <Send
      tokens={demoTokens.filter((t) => t.chainId === 1)}
      popular={["ETH", "USDC", "USDT"]}
      prices={demoPrices}
    />
    <ConnectWallet variant="link" size="sm">
      Connect the Demo Wallet to use it
    </ConnectWallet>
  </>
));
