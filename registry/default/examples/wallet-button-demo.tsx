import { WalletButton } from "@/components/wallet-button";

export default function WalletButtonDemo() {
  return <WalletButton connect={{ title: "Sign in" }} account={{ showBalance: true }} />;
}
