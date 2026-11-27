export type FeeTierInfo = {
  /** Fee in hundredths of a bip: 500 is 0.05%. */
  fee: number;
  /** Tick spacing that goes with the fee. */
  tickSpacing: number;
  /** One line on when to pick it. */
  description?: string;
  /** Share of the pair's liquidity in this tier, 0–1. Shown as "62% select". */
  share?: number;
  /** False when the pool for this tier doesn't exist yet. */
  exists?: boolean;
};

/** Uniswap v3 tiers. Other DEXes use other fees; pass your own `tiers`. */
export const defaultFeeTiers: Array<FeeTierInfo> = [
  { fee: 100, tickSpacing: 1, description: "Best for very stable pairs" },
  { fee: 500, tickSpacing: 10, description: "Best for stable pairs" },
  { fee: 3000, tickSpacing: 60, description: "Best for most pairs" },
  { fee: 10_000, tickSpacing: 200, description: "Best for exotic pairs" },
];

/** "0.05%" from 500. */
export function formatFee(fee: number, locale?: string) {
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 4 }).format(fee / 10_000)}%`;
}

/** The tier picked when nothing is: the third (0.3% in the defaults), or the last of a shorter list. */
export function defaultFeeTier<T extends Pick<FeeTierInfo, "fee">>(tiers: ReadonlyArray<T>) {
  return tiers[Math.min(2, tiers.length - 1)];
}

/** The badge under a tier: "Not created", "62% select", or nothing without a share. */
export function feeTierBadge(tier: Pick<FeeTierInfo, "share" | "exists">, locale?: string) {
  if (tier.exists === false) {
    return "Not created";
  }
  if (tier.share === undefined) {
    return undefined;
  }
  const share = new Intl.NumberFormat(locale, {
    style: "percent",
    maximumFractionDigits: 0,
  }).format(tier.share);
  return `${share} select`;
}
