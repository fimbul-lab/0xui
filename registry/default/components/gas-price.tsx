// Docs: https://0xui.io/components/gas-price.md
import { useQuery } from "@tanstack/react-query";
import { FuelIcon } from "lucide-react";
import type { ComponentType } from "react";
import { SkeletonBox } from "skullet/react";
import { useChainId, useConfig } from "wagmi";
import { MorphText } from "@/components/morph-text";
import { formatGasPrice, gasPriceQueryOptions, gasTone, type GasTone } from "@/lib/gas-price-core";
import { cn } from "@/lib/utils";

export { formatGasPrice, gasTone, type GasTone };

/** SkeletonBox is a block by default. This one sits in a line of text. */
const inlineBox = { display: "inline-block", verticalAlign: "middle" } as const;

export type GasPriceProps = {
  /** Chain to read. Defaults to the current chain. */
  chainId?: number;
  /** How often to refresh, in ms. Pass false to fetch once. */
  refreshInterval?: number | false;
  /**
   * Gwei cut-offs for coloring the price. Below `low` is low, above `high` is
   * high. Gas varies a lot between chains, so there is no default. Without
   * thresholds the price is shown without a tone.
   */
  thresholds?: { low: number; high: number };
  /** Custom icon. Pass false to hide. */
  icon?: ComponentType<{ className?: string }> | false;
  /** Locale for the number. Defaults to the browser's. */
  locale?: string;
  className?: string;
};

/** Current gas price, refreshed on an interval. */
export function useGasPriceInfo({
  chainId,
  refreshInterval = 12_000,
  thresholds,
}: Pick<GasPriceProps, "chainId" | "refreshInterval" | "thresholds"> = {}) {
  const config = useConfig();
  const currentChainId = useChainId();
  const { data, isError, isPending } = useQuery(
    gasPriceQueryOptions(config, { chainId: chainId ?? currentChainId, refreshInterval }),
  );
  return {
    gasPrice: data,
    tone: data !== undefined && thresholds ? gasTone(data, thresholds) : undefined,
    isError,
    isPending,
  };
}

const toneClass: Record<GasTone, string> = {
  low: "text-emerald-600 dark:text-emerald-400",
  medium: "text-amber-600 dark:text-amber-400",
  high: "text-destructive",
};

/** Current gas price in gwei, optionally colored low/medium/high. */
export function GasPrice({
  chainId,
  refreshInterval,
  thresholds,
  icon,
  locale,
  className,
}: GasPriceProps) {
  const { gasPrice, tone, isError } = useGasPriceInfo({
    chainId,
    refreshInterval,
    thresholds,
  });
  const Icon = icon === false ? null : (icon ?? FuelIcon);

  return (
    <span
      data-slot="gas-price"
      data-tone={tone}
      className={cn(
        "inline-flex items-center gap-1.5 text-sm tabular-nums text-muted-foreground",
        tone && toneClass[tone],
        className,
      )}
    >
      {Icon && <Icon aria-hidden className="size-3.5 shrink-0" />}
      {isError ? (
        <span>Gas unavailable</span>
      ) : gasPrice === undefined ? (
        <span>
          {/* About the width of "12.3 gwei". */}
          <SkeletonBox width="9ch" height="1em" style={inlineBox} />
          <span className="sr-only">Loading gas price</span>
        </span>
      ) : (
        <span>
          <span className="sr-only">Gas price </span>
          <MorphText>{`${formatGasPrice(gasPrice, locale)} gwei`}</MorphText>
          {tone && <span className="sr-only">, {tone}</span>}
        </span>
      )}
    </span>
  );
}
