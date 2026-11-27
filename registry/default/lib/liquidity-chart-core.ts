import { formatPrice, usableTickBounds } from "@/lib/concentrated-liquidity";
import type { LiquidityBin, PairToken, TickRange } from "@/lib/concentrated-liquidity";

export type { PairToken, TickRange };

/**
 * Colors for the two sides. Teal and violet pass the colorblind and
 * contrast checks on light and dark surfaces. Override with
 * `--lp-token0` / `--lp-token1` on any parent.
 */
export const liquidityColors = {
  token0: "var(--lp-token0, #0d9488)",
  token1: "var(--lp-token1, #8b5cf6)",
} as const;

/** How much one zoom step narrows the view. */
export const ZOOM_STEP = 1.6;

/** Ticks the chart spans when every bin is in view. */
export function chartExtent(
  bins: ReadonlyArray<LiquidityBin>,
  currentTick: number,
  tickSpacing: number,
) {
  if (!bins.length) {
    return { lower: currentTick - 100 * tickSpacing, upper: currentTick + 100 * tickSpacing };
  }
  return { lower: bins[0]!.tickLower, upper: bins.at(-1)!.tickUpper };
}

/**
 * Visible tick window at a zoom level. Zoom 1 shows every bin; deeper zoom
 * centers on the range (or the price when there's no range, or the range
 * is wider than the view) down to eight tick spacings.
 */
export function chartViewport({
  bins,
  currentTick,
  tickSpacing,
  range,
  zoom,
}: {
  bins: ReadonlyArray<LiquidityBin>;
  currentTick: number;
  tickSpacing: number;
  range?: TickRange;
  zoom: number;
}) {
  const extent = chartExtent(bins, currentTick, tickSpacing);
  const fullSpan = extent.upper - extent.lower;
  const minSpan = tickSpacing * 8;
  const maxZoom = Math.max(1, fullSpan / minSpan);
  const span = Math.max(minSpan, fullSpan / zoom);
  const { min, max } = usableTickBounds(tickSpacing);
  const full = range ? range.tickLower <= min && range.tickUpper >= max : false;
  const center =
    range && !full && range.tickUpper - range.tickLower < span
      ? (range.tickLower + range.tickUpper) / 2
      : currentTick;
  const [lower, upper] =
    zoom === 1 ? [extent.lower, extent.upper] : [center - span / 2, center + span / 2];
  return {
    lower,
    upper,
    canZoomIn: span > minSpan,
    canZoomOut: zoom > 1,
    zoomIn: (z: number) => Math.min(z * ZOOM_STEP, maxZoom),
    zoomOut: (z: number) => Math.max(1, z / ZOOM_STEP),
  };
}

export type Bar = {
  tickLower: number;
  tickUpper: number;
  liquidity: number;
  amount0: number;
  amount1: number;
  isCurrent: boolean;
};

/** Bins in the window, merged so every bar is at least `minWidth` px wide. */
export function toBars(
  bins: ReadonlyArray<LiquidityBin>,
  lower: number,
  upper: number,
  width: number,
  minWidth = 3,
): Array<Bar> {
  const visible = bins.filter((b) => b.tickUpper > lower && b.tickLower < upper);
  const perBar = Math.max(1, Math.ceil(visible.length / Math.max(1, Math.floor(width / minWidth))));
  const bars: Array<Bar> = [];
  for (let i = 0; i < visible.length; i += perBar) {
    const group = visible.slice(i, i + perBar);
    bars.push({
      tickLower: group[0]!.tickLower,
      tickUpper: group.at(-1)!.tickUpper,
      // Average, so merged bars stay on the same scale as single ones.
      liquidity: group.reduce((s, b) => s + Number(b.liquidity), 0) / group.length,
      amount0: group.reduce((s, b) => s + b.amount0, 0),
      amount1: group.reduce((s, b) => s + b.amount1, 0),
      isCurrent: group.some((b) => b.isCurrent),
    });
  }
  return bars;
}

/** SVG path for a bar with rounded top corners, square at the baseline. */
export function barPath(x: number, y: number, w: number, h: number, r: number) {
  const radius = Math.max(0, Math.min(r, w / 2, h));
  if (radius === 0) {
    return `M${x},${y + h}V${y}H${x + w}V${y + h}Z`;
  }
  return `M${x},${y + h}V${y + radius}Q${x},${y} ${x + radius},${y}H${x + w - radius}Q${x + w},${y} ${x + w},${y + radius}V${y + h}Z`;
}

/** Short amount: "1,234" or "1.2M". */
export function compactAmount(value: number, locale?: string, from = 1e5) {
  return new Intl.NumberFormat(locale, {
    notation: value >= from ? "compact" : "standard",
    maximumSignificantDigits: 4,
  }).format(value);
}

/** Tooltip lines for a bar: the tokens locked in it and its price range. */
export function describeBar(
  bar: Bar,
  {
    price,
    token0,
    token1,
    unit,
    locale,
  }: {
    price: (tick: number) => number;
    token0: PairToken;
    token1: PairToken;
    unit: string;
    locale?: string;
  },
) {
  const [a, b] = [price(bar.tickLower), price(bar.tickUpper)].sort((m, n) => m - n);
  const amounts = [
    bar.amount0 > 0 && `${compactAmount(bar.amount0, locale)} ${token0.symbol}`,
    bar.amount1 > 0 && `${compactAmount(bar.amount1, locale)} ${token1.symbol}`,
  ].filter((line): line is string => Boolean(line));
  return {
    amounts: amounts.length ? amounts : ["No liquidity"],
    range: `${formatPrice(a!, { locale })} – ${formatPrice(b!, { locale })} ${unit}`,
  };
}

/**
 * The bar a key moves the reading to, or undefined for other keys.
 * Left and right follow the screen, so they flip with an inverted axis.
 */
export function nextBar(
  key: string,
  bars: ReadonlyArray<Bar>,
  active: number | undefined,
  invert = false,
) {
  if (!bars.length) {
    return undefined;
  }
  const current = bars.findIndex((b) => b.isCurrent);
  const from = active ?? (current === -1 ? 0 : current);
  const dir = invert ? -1 : 1;
  const next: Record<string, number> = {
    ArrowRight: from + dir,
    ArrowLeft: from - dir,
    Home: invert ? bars.length - 1 : 0,
    End: invert ? 0 : bars.length - 1,
  };
  if (!(key in next)) {
    return undefined;
  }
  return Math.max(0, Math.min(bars.length - 1, next[key]!));
}

/** "+4.88%", "−100%" or "∞" from the price at an edge against the current one. */
export function formatPriceChange(price: number, current: number) {
  const change = (price / current - 1) * 100;
  if (!Number.isFinite(change) || Math.abs(change) > 9999) {
    return change > 0 ? "∞" : "−100%";
  }
  const sign = change > 0 ? "+" : change < 0 ? "−" : "";
  return `${sign}${Math.abs(change).toFixed(Math.abs(change) < 10 ? 2 : 1)}%`;
}

/**
 * The range handles as a two-thumb slider over the visible window, left to
 * right on screen. Inverted, the axis runs from high ticks to low ones, so
 * slider values are negated ticks. `min` and `max` snap inward to the
 * spacing, and a thumb outside the window sits on its edge.
 */
export function rangeSlider(
  range: TickRange,
  lower: number,
  upper: number,
  tickSpacing: number,
  invert = false,
) {
  const lo = Math.ceil(lower / tickSpacing) * tickSpacing;
  const hi = Math.floor(upper / tickSpacing) * tickSpacing;
  const [min, max] = invert ? [0 - hi, 0 - lo] : [lo, hi];
  const toValue = (tick: number) => (invert ? 0 - tick : tick);
  const [left, right] = invert
    ? [range.tickUpper, range.tickLower]
    : [range.tickLower, range.tickUpper];
  const clamp = (v: number) => Math.max(min, Math.min(max, v));
  return {
    min,
    max,
    value: [clamp(toValue(left)), clamp(toValue(right))] as [number, number],
    /** The tick a slider value stands for. */
    tickOf: toValue,
    /** Whether each thumb's real tick is outside the window. */
    offscreen: [
      toValue(left) !== clamp(toValue(left)),
      toValue(right) !== clamp(toValue(right)),
    ] as const,
  };
}
