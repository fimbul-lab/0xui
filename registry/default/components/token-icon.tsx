import { TokenIcon as Web3TokenIcon } from "@web3icons/react/dynamic";
import { ChainIcon } from "@/components/chain-badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

export type TokenIconProps = {
  /** Token symbol, e.g. "USDC". Used for the built-in icon and the lettered fallback. */
  symbol: string;
  /** Logo URL, e.g. `logoURI` from a token list. Takes priority over the built-in icon. */
  src?: string;
  /** Show this chain's icon as a small badge in the corner. */
  chainId?: number;
  /** Diameter in px. */
  size?: number;
  /** Icon style for the built-in icons. */
  variant?: "background" | "branded" | "mono";
  className?: string;
};

/**
 * Token logo. Uses `src` when given, otherwise the web3icons icon for
 * `symbol`, otherwise the symbol's first letters. Optionally shows the
 * token's chain as a corner badge.
 */
export function TokenIcon({
  symbol,
  src,
  chainId,
  size = 24,
  variant = "branded",
  className,
}: TokenIconProps) {
  const fallback = <TokenIconFallback symbol={symbol} />;
  const badge = Math.max(10, Math.round(size * 0.45));

  return (
    <span
      role="img"
      aria-label={symbol}
      className={cn("relative inline-flex shrink-0", className)}
      style={{ width: size, height: size }}
    >
      {src ? (
        <Avatar className="size-full">
          <AvatarImage src={src} alt="" />
          {fallback}
        </Avatar>
      ) : (
        <Web3TokenIcon
          symbol={symbol.toLowerCase()}
          variant={variant}
          className="size-full rounded-full"
          fallback={<Avatar className="size-full">{fallback}</Avatar>}
        />
      )}
      {chainId !== undefined && (
        <span
          className="absolute -right-0.5 -bottom-0.5 rounded-full bg-background p-px"
          style={{ width: badge, height: badge }}
        >
          <ChainIcon chainId={chainId} className="size-full" />
        </span>
      )}
    </span>
  );
}

function TokenIconFallback({ symbol }: { symbol: string }) {
  return (
    <AvatarFallback className="text-[0.6em] font-medium uppercase">
      {symbol.slice(0, 2)}
    </AvatarFallback>
  );
}
