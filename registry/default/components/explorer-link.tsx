// Docs: https://0xui.io/components/explorer-link.md
import { ExternalLinkIcon } from "lucide-react";
import type { ComponentProps, ComponentType, ReactNode } from "react";
import { useChainId, useChains } from "wagmi";
import { getExplorerUrl } from "@/lib/0xui-utils";
import type { ExplorerTarget } from "@/lib/0xui-utils";
import { cn } from "@/lib/utils";

export type ExplorerLinkProps = Omit<ComponentProps<"a">, "href" | "children"> &
  ExplorerTarget & {
    /** Chain whose explorer to link to. Defaults to the current chain. */
    chainId?: number;
    /** Link text. Defaults to "View on <explorer name>". */
    children?: ReactNode;
    /** Custom external-link icon. Pass false to hide. */
    icon?: ComponentType<{ className?: string }> | false;
  };

/** Resolve the explorer URL and name for an address, transaction or block. */
export function useExplorerLink(target: ExplorerTarget, chainId?: number) {
  const currentChainId = useChainId();
  const chains = useChains();
  const chain = chains.find((c) => c.id === (chainId ?? currentChainId));
  return {
    href: getExplorerUrl(chain, target),
    explorerName: chain?.blockExplorers?.default.name,
  };
}

/**
 * Link to an address, transaction or block on the chain's block explorer.
 * Renders plain text when the chain has no explorer configured.
 */
export function ExplorerLink(linkProps: ExplorerLinkProps) {
  // The target props (`address`, `tx`, `block`) are read from `linkProps`, not passed to the <a>.
  const {
    address: _address,
    tx: _tx,
    block: _block,
    chainId,
    children,
    icon,
    className,
    ...props
  } = linkProps;
  const { href, explorerName } = useExplorerLink(linkProps, chainId);
  const Icon = icon === false ? null : (icon ?? ExternalLinkIcon);

  if (!href) {
    return <span className={className}>{children}</span>;
  }

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={cn("inline-flex items-center gap-1 underline-offset-4 hover:underline", className)}
      {...props}
    >
      {children ?? `View on ${explorerName ?? "explorer"}`}
      {Icon && <Icon aria-hidden className="size-3.5 shrink-0 opacity-70" />}
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}
