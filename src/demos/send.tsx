import { Send } from "@/components/send";
import { ConnectWallet } from "@/components/connect-wallet";
import { demoPrices } from "./prices";
import { demoEth, useDemoTokens } from "./tokens";
import { demo } from "./demo";

export const Default = demo(function SendDemo() {
  const { tokens } = useDemoTokens();
  return (
    <>
      <Send
        tokens={tokens.length ? tokens : [demoEth]}
        defaultToken={demoEth}
        popular={["ETH", "USDC", "USDT"]}
        prices={demoPrices}
      />
      <ConnectWallet variant="link" size="sm">
        Connect the Demo Wallet to use it
      </ConnectWallet>
    </>
  );
});
