import { ConnectWallet } from "@/components/connect-wallet";

export default function ConnectWalletDemo() {
  return (
    <div className="flex items-center gap-2">
      <ConnectWallet />
      <ConnectWallet variant="outline" title="Sign in with your wallet">
        Sign in
      </ConnectWallet>
    </div>
  );
}
