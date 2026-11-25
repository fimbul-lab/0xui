import {
  displayPrice,
  getDepositMode,
  isFullRange,
  moveRangeEdge,
  priceToTick,
  rangeAroundTick,
  usableTickBounds,
  type PoolState,
  type TickRange,
} from "@/lib/concentrated-liquidity";

export type RangePool = Pick<PoolState, "tick" | "tickSpacing" | "decimals0" | "decimals1">;

/** A preset is a ± percent around the price, or the full range. */
export type RangePreset = { label: string; percent: number } | { label: string; full: true };

/** Range edge as the user sees it: min and max of the displayed price. */
export type RangeEdge = "min" | "max";

/**
 * Presets by tick spacing: tight ones for stable pairs (spacing 1),
 * wider ones for everything else. Matches what most DEX interfaces offer.
 */
export function defaultRangePresets(tickSpacing: number): RangePreset[] {
  if (tickSpacing <= 1) {
    return [
      { label: "±0.05%", percent: 0.05 },
      { label: "±0.1%", percent: 0.1 },
      { label: "±0.5%", percent: 0.5 },
      { label: "Full range", full: true },
    ];
  }
  if (tickSpacing <= 10) {
    return [
      { label: "±1%", percent: 1 },
      { label: "±5%", percent: 5 },
      { label: "±10%", percent: 10 },
      { label: "Full range", full: true },
    ];
  }
  return [
    { label: "±10%", percent: 10 },
    { label: "±20%", percent: 20 },
    { label: "±50%", percent: 50 },
    { label: "Full range", full: true },
  ];
}

/** The range a new position starts with: ±10%, or ±0.1% for stable spacings. */
export function defaultRange(pool: Pick<PoolState, "tick" | "tickSpacing">, invert = false): TickRange {
  return rangeAroundTick(pool.tick, pool.tickSpacing <= 1 ? 0.1 : 10, pool.tickSpacing, { invert });
}

/** The tick behind a displayed edge. Inverted, the min price is `tickUpper`. */
export function edgeTick(edge: RangeEdge, invert = false): "tickLower" | "tickUpper" {
  return (edge === "min") !== invert ? "tickLower" : "tickUpper";
}

/** Displayed price at an edge: 0 and ∞ for a full range. */
export function rangeEdgePrice(range: TickRange, edge: RangeEdge, pool: RangePool, invert = false) {
  if (isFullRange(range.tickLower, range.tickUpper, pool.tickSpacing)) return edge === "min" ? 0 : Infinity;
  return displayPrice(range[edgeTick(edge, invert)], pool, invert);
}

/** The range with an edge set from a typed price, or undefined for a price that isn't one. */
export function rangeWithPrice(range: TickRange, edge: RangeEdge, price: number, pool: RangePool, invert = false) {
  if (!(price > 0) || !Number.isFinite(price)) return undefined;
  const raw = invert ? 1 / price : price;
  return moveRangeEdge(range, edgeTick(edge, invert), priceToTick(raw, pool.decimals0, pool.decimals1), pool.tickSpacing);
}

/** The range with an edge one tick spacing up (+1) or down (−1) in displayed price. */
export function stepRangeEdge(range: TickRange, edge: RangeEdge, direction: 1 | -1, pool: RangePool, invert = false) {
  const key = edgeTick(edge, invert);
  return moveRangeEdge(range, key, range[key] + direction * (invert ? -1 : 1) * pool.tickSpacing, pool.tickSpacing);
}

/** The range a preset stands for at the current price. */
export function presetRange(preset: RangePreset, pool: Pick<PoolState, "tick" | "tickSpacing">, invert = false): TickRange {
  if ("full" in preset) {
    const { min, max } = usableTickBounds(pool.tickSpacing);
    return { tickLower: min, tickUpper: max };
  }
  return rangeAroundTick(pool.tick, preset.percent, pool.tickSpacing, { invert });
}

/** The preset that matches the range exactly, if any. */
export function activePreset(
  presets: readonly RangePreset[],
  range: TickRange,
  pool: Pick<PoolState, "tick" | "tickSpacing">,
  invert = false,
) {
  return presets.find((preset) => {
    const r = presetRange(preset, pool, invert);
    return "full" in preset
      ? isFullRange(range.tickLower, range.tickUpper, pool.tickSpacing)
      : r.tickLower === range.tickLower && r.tickUpper === range.tickUpper;
  });
}

/** Everything the panel shows about a range. */
export function getPriceRangeState(range: TickRange, pool: RangePool, invert = false) {
  return {
    isFullRange: isFullRange(range.tickLower, range.tickUpper, pool.tickSpacing),
    depositMode: getDepositMode(pool.tick, range.tickLower, range.tickUpper),
    currentPrice: displayPrice(pool.tick, pool, invert),
    min: rangeEdgePrice(range, "min", pool, invert),
    max: rangeEdgePrice(range, "max", pool, invert),
  };
}

/** Decimal text the user typed, or undefined. Accepts "1,234.5" and "1234,5". */
export function parsePriceInput(text: string) {
  const clean = text.replace(/\s/g, "");
  const decimalComma = /,\d{1,2}$/.test(clean) || (/,/.test(clean) && !/\./.test(clean) && !/,\d{3}$/.test(clean));
  const normalized = decimalComma ? clean.replace(/\./g, "").replace(",", ".") : clean.replace(/,/g, "");
  const n = Number(normalized);
  return normalized && Number.isFinite(n) && n > 0 ? n : undefined;
}

/** "+4.88%" / "−3.10%" from a price against the current one, or undefined for 0, ∞ and huge moves. */
export function formatEdgeChange(price: number, current: number) {
  if (!Number.isFinite(price) || price <= 0) return undefined;
  const change = (price / current - 1) * 100;
  if (Math.abs(change) >= 10000) return undefined;
  return `${change >= 0 ? "+" : "−"}${Math.abs(change).toFixed(Math.abs(change) < 10 ? 2 : 1)}%`;
}
