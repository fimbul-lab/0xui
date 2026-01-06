import { useChains } from "wagmi";
import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ChainSelector } from "registry/default/chain-selector/chain-selector";

type ChainIconProps = {
  chainId: number;
  className?: string;
  variant?: "branded" | "mono" | "background";
};

export function LlamaoChainIcon({ chainId, className }: ChainIconProps) {
  const chains = useChains();
  const chain = chains.find((c) => c.id === chainId);

  if (!chain) return null;

  // Convert chain name to llamao.fi format (lowercase, replace spaces with nothing)
  const chainNameSlug = chain.name.toLowerCase().replace(/\s+/g, "");

  const abbreviation = chain.name
    .split(" ")
    .map((word) => word[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <Avatar key={chainId} className={cn("size-6", className)}>
      <AvatarImage
        src={`https://icons.llamao.fi/icons/chains/rsz_${chainNameSlug}.jpg`}
        alt={chain.name}
        className={cn("m-0!", className)}
      />
      <AvatarFallback>{abbreviation}</AvatarFallback>
    </Avatar>
  );
}

export function ChainSelectorWithCustomIcon() {
  return <ChainSelector chainIcon={LlamaoChainIcon} />;
}
