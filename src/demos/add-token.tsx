import { AddToken } from "@/components/add-token";
import { ConnectWallet } from "@/components/connect-wallet";
import { demoUsdc } from "./tokens";
import { demo } from "./demo";

export const Default = demo(() => (
  <>
    <AddToken token={demoUsdc} />
    <ConnectWallet variant="link">Connect the Demo Wallet to see it</ConnectWallet>
  </>
));
