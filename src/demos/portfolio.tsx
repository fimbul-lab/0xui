import { Portfolio } from "@/components/portfolio";
import { demoAccounts } from "./wagmi-config";
import { demoPrices } from "./prices";
import { useDemoTokens } from "./tokens";
import { demo } from "./demo";

export const Default = demo(function PortfolioDemo() {
  // Every Uniswap-listed token on Ethereum, read in one batch.
  const { tokens } = useDemoTokens();
  return (
    <Portfolio
      tokens={tokens}
      prices={demoPrices}
      address={demoAccounts[0]}
      chainId={1}
      title="vitalik.eth"
      className="w-full max-w-md"
    />
  );
});
