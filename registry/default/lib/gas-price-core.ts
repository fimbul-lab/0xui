import { getChainId } from "@wagmi/core";
import type { Config } from "@wagmi/core";
import { getGasPriceQueryOptions, hashFn } from "@wagmi/core/query";
import { formatGwei } from "viem";

export type GasTone = "low" | "medium" | "high";

/**
 * TanStack Query options for the current gas price. `chainId` defaults to the
 * current chain; `refreshInterval` is in ms, false to fetch once.
 */
export function gasPriceQueryOptions(
  config: Config,
  {
    chainId,
    refreshInterval = 12_000,
  }: { chainId?: number; refreshInterval?: number | false } = {},
) {
  return {
    ...getGasPriceQueryOptions(config, { chainId: chainId ?? getChainId(config) }),
    refetchInterval: refreshInterval,
    queryKeyHashFn: hashFn,
  };
}

/** Format gwei with 3 significant digits, so 0.0123 and 42.1 both read well. */
export function formatGasPrice(wei: bigint, locale?: string) {
  const gwei = Number(formatGwei(wei));
  return new Intl.NumberFormat(locale, {
    maximumSignificantDigits: 3,
  }).format(gwei);
}

export function gasTone(wei: bigint, thresholds: { low: number; high: number }): GasTone {
  const gwei = Number(formatGwei(wei));
  if (gwei < thresholds.low) return "low";
  if (gwei > thresholds.high) return "high";
  return "medium";
}
