import { Portfolio } from "@/components/portfolio";
import { demoAccounts } from "./wagmi-config";
import { demoPrices } from "./prices";
import { demoTokens } from "./tokens";
import { demo } from "./demo";

export const Default = demo(() => (
  <Portfolio
    tokens={demoTokens}
    prices={demoPrices}
    address={demoAccounts[0]}
    chainId={1}
    title="vitalik.eth"
    className="w-full max-w-md"
  />
));
