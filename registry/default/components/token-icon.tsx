// Docs: https://0xui.io/components/token-icon.md
import { TokenIcon as Web3TokenIcon } from "@web3icons/react/dynamic";
import { useEffect, useState, type ReactNode } from "react";
import { SkeletonBox } from "skullet/react";
import { ChainIcon } from "@/components/chain-badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { resolveUri } from "@/lib/0xui-utils";
import { cn } from "@/lib/utils";

export type TokenIconProps = {
  /** Token symbol, e.g. "USDC". Used for the built-in icon and the lettered fallback. */
  symbol: string;
  /** Logo URL, e.g. `logoURI` from a token list. `ipfs://` works. Takes priority over the built-in icon. */
  src?: string;
  /** IPFS gateway for `ipfs://` logos. */
  gateway?: string;
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
  gateway,
  chainId,
  size = 24,
  variant = "branded",
  className,
}: TokenIconProps) {
  const badge = Math.max(10, Math.round(size * 0.45));
  const builtIn = (
    <Web3TokenIcon
      symbol={symbol.toLowerCase()}
      variant={variant}
      className="size-full rounded-full"
      fallback={<Letters symbol={symbol} />}
    />
  );

  return (
    <span
      role="img"
      aria-label={symbol}
      className={cn("relative inline-flex shrink-0", className)}
      style={{ width: size, height: size }}
    >
      {src ? (
        <ListLogo key={src} src={resolveUri(src, gateway)} fallback={builtIn} />
      ) : (
        builtIn
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

/**
 * The symbol's first letters. web3icons shows this both while an icon loads
 * and when it has none, so it starts as a skeleton and settles on the letters
 * only if no icon has turned up.
 */
function Letters({ symbol }: { symbol: string }) {
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(true), 800);
    return () => clearTimeout(timer);
  }, []);

  return (
    <Avatar className="size-full">
      {settled ? (
        <AvatarFallback className="text-[0.6em] font-medium uppercase">{symbol.slice(0, 2)}</AvatarFallback>
      ) : (
        <SkeletonBox width="100%" height="100%" radius="9999px" />
      )}
    </Avatar>
  );
}

/**
 * A token-list logo. These go dead often, so on error show `fallback`. The
 * fallback only mounts after a failure: rendering it while the logo loads
 * would fetch a built-in icon for every row of a long list.
 */
function ListLogo({ src, fallback }: { src: string; fallback: ReactNode }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <>{fallback}</>;
  return (
    <Avatar className="size-full">
      <AvatarImage
        src={src}
        alt=""
        onLoadingStatusChange={(status) => status === "error" && setFailed(true)}
      />
      <AvatarFallback className="bg-transparent">
        <SkeletonBox width="100%" height="100%" radius="9999px" />
      </AvatarFallback>
    </Avatar>
  );
}
