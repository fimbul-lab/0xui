import { NetworkIcon } from "@web3icons/react/dynamic";
import type { ComponentProps, ComponentType } from "react";
import { useChains } from "wagmi";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

export type ChainIconVariant = "background" | "branded" | "mono";

export type ChainIconProps = {
  chainId: number;
  className?: string;
  /** Icon style. */
  variant?: ChainIconVariant;
  /** Icon color. Only applies when variant is "mono". */
  monoColor?: string;
};

/** Chain logo from web3icons, with a "?" placeholder for unknown chains. */
export function ChainIcon({
  chainId,
  className,
  variant = "background",
  monoColor,
}: ChainIconProps) {
  return (
    <NetworkIcon
      key={chainId}
      chainId={chainId}
      variant={variant}
      color={variant === "mono" ? monoColor : undefined}
      className={cn("size-6 rounded-full", className)}
      fallback={<ChainIconFallback className={className} />}
    />
  );
}

function ChainIconFallback({ className }: { className?: string }) {
  return (
    <Avatar className={cn("size-6", className)}>
      <AvatarFallback className="text-xs">?</AvatarFallback>
    </Avatar>
  );
}

export type ChainBadgeProps = Omit<ComponentProps<"span">, "children"> & {
  chainId: number;
  /** Display name. Defaults to the chain's name in the wagmi config, or "Chain <id>". */
  name?: string;
  /** Hide the name visually. It stays available to screen readers and as a tooltip. */
  iconOnly?: boolean;
  /** Icon style. */
  variant?: ChainIconVariant;
  /** Custom chain icon. Pass false to hide. */
  chainIcon?: ComponentType<ChainIconProps> | false;
};

/** Static chain chip: icon and name. For switching chains, use ChainSelector. */
export function ChainBadge({
  chainId,
  name,
  iconOnly = false,
  variant = "background",
  chainIcon,
  className,
  ...props
}: ChainBadgeProps) {
  const chains = useChains();
  const label =
    name ?? chains.find((c) => c.id === chainId)?.name ?? `Chain ${chainId}`;
  const Icon = chainIcon === false ? null : (chainIcon ?? ChainIcon);

  return (
    <span
      title={iconOnly ? label : undefined}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border py-0.5 pr-2.5 pl-0.5 text-sm",
        iconOnly && "p-0.5",
        !Icon && "pl-2.5",
        className
      )}
      {...props}
    >
      {Icon && <Icon chainId={chainId} variant={variant} className="size-5" />}
      <span className={cn(iconOnly && "sr-only")}>{label}</span>
    </span>
  );
}
