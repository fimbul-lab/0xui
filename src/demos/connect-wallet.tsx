import { ConnectWallet } from "@/components/connect-wallet";
import { demo } from "./demo";

export const Default = demo(() => <ConnectWallet />);

export const CustomTrigger = demo(() => (
  <ConnectWallet variant="outline" title="Sign in with your wallet">
    Sign in
  </ConnectWallet>
));
