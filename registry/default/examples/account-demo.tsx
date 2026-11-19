import { useConnection } from "wagmi";
import { Account } from "@/components/account";
import { ConnectWallet } from "@/components/connect-wallet";

export default function AccountDemo() {
  const { isConnected } = useConnection();
  if (!isConnected) return <ConnectWallet />;
  return (
    <div className="flex flex-col items-center gap-2">
      <Account />
      <Account showBalance />
    </div>
  );
}
