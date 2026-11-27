import {
  displayPrice,
  formatPrice,
  getRangeStatus,
  isFullRange,
  priceUnit,
} from "@/lib/concentrated-liquidity";
import type { PoolState, RangeStatus } from "@/lib/concentrated-liquidity";

export type RangePool = Pick<PoolState, "tick" | "tickSpacing" | "decimals0" | "decimals1">;

export const rangeStatusLabel: Record<RangeStatus, string> = {
  "in-range": "In range",
  "out-of-range": "Out of range",
  closed: "Closed",
};

/**
 * Where a range sits against the price, for a bar: status, the range's
 * left and right edges and the price marker in percent of the bar, and the
 * min and max prices in the displayed direction. Ticks are log price, so
 * the bar uses them directly, padded by a third of the range on each side
 * and stretched to include the price.
 */
export function getRangeBar({
  tickLower,
  tickUpper,
  pool,
  liquidity,
  token0,
  token1,
  invert = false,
  locale,
}: {
  tickLower: number;
  tickUpper: number;
  pool: RangePool;
  liquidity?: bigint;
  token0: { symbol: string };
  token1: { symbol: string };
  invert?: boolean;
  locale?: string;
}) {
  const status = getRangeStatus(pool.tick, tickLower, tickUpper, liquidity);
  const full = isFullRange(tickLower, tickUpper, pool.tickSpacing);
  const [minTick, maxTick] = invert ? [tickUpper, tickLower] : [tickLower, tickUpper];
  const unit = priceUnit(token0, token1, invert);

  const width = Math.max(tickUpper - tickLower, pool.tickSpacing);
  const lo = Math.min(tickLower, pool.tick) - width / 3;
  const hi = Math.max(tickUpper, pool.tick) + width / 3;
  const pos = (t: number) => {
    const f = (t - lo) / (hi - lo);
    return (invert ? 1 - f : f) * 100;
  };
  const [left, right] = full
    ? [0, 100]
    : [Math.min(pos(tickLower), pos(tickUpper)), Math.max(pos(tickLower), pos(tickUpper))];
  const marker = Math.max(0, Math.min(100, full ? 50 : pos(pool.tick)));

  const price = (t: number) => formatPrice(displayPrice(t, pool, invert), { locale });
  const min = full ? "0" : price(minTick);
  const max = full ? "∞" : price(maxTick);
  const current = price(pool.tick);
  const label = `${rangeStatusLabel[status]}. Range ${full ? "full" : `${min} to ${max}`} ${unit}, current price ${current}.`;

  return { status, full, left, right, marker, min, max, current, unit, label };
}
