import { Account } from "@/components/account";
import { ConnectWallet } from "@/components/connect-wallet";
import { demo } from "./demo";

/** Account renders nothing while disconnected, so the demo offers a connect button. */
export const Default = demo(() => (
  <>
    <Account />
    <ConnectHint />
  </>
));

export const WithBalance = demo(() => (
  <>
    <Account showBalance />
    <ConnectHint />
  </>
));

function ConnectHint() {
  return <ConnectWallet variant="link">Connect the Demo Wallet to see it</ConnectWallet>;
}
