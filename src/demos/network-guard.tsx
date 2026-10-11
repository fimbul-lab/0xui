import { NetworkGuard } from "@/components/network-guard";
import { ConnectWallet } from "@/components/connect-wallet";
import { ChainSelector } from "@/components/chain-selector";
import { demo } from "./demo";

export const Default = demo(() => (
  <div className="flex w-full max-w-md flex-col items-center gap-4">
    <div className="flex gap-2">
      <ConnectWallet variant="outline" size="sm" />
      <ChainSelector />
    </div>
    <NetworkGuard chainId={8453} className="w-full">
      <p className="text-sm">Base-only content. Switch your network above to see the guard.</p>
    </NetworkGuard>
  </div>
));
