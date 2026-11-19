import { ChainSelector } from "@/components/chain-selector";
import { NetworkGuard } from "@/components/network-guard";

export default function NetworkGuardDemo() {
  return (
    <div className="flex w-full max-w-md flex-col items-center gap-4">
      <ChainSelector />
      <NetworkGuard chainId={1} className="w-full">
        <p className="text-sm">Mainnet-only content. Switch networks above to see the guard.</p>
      </NetworkGuard>
    </div>
  );
}
