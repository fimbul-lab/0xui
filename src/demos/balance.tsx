import { Balance } from "@/components/balance";
import { demoAccounts } from "./wagmi-config";
import { demo } from "./demo";

export const Native = demo(() => <Balance address={demoAccounts[0]} chainId={1} />);

export const Erc20 = demo(() => (
  <Balance
    address={demoAccounts[0]}
    token="0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"
    chainId={1}
    price={1}
  />
));
