import { ChainBadge } from "@/components/chain-badge";

export default function ChainBadgeDemo() {
  return (
    <div className="flex flex-wrap items-center justify-center gap-2">
      <ChainBadge chainId={1} />
      <ChainBadge chainId={11_155_111} />
      <ChainBadge chainId={8453} name="Base" />
      <ChainBadge chainId={1} iconOnly />
    </div>
  );
}
