import { getMarketDepth } from "@/lib/concentrated-liquidity";
import type { LiquidityBin, PairToken } from "@/lib/concentrated-liquidity";

/** One side of the book at a price move, in the displayed direction. */
export type DepthReading = {
  /** Signed move from the current price, in percent. */
  percent: number;
  /** Price after the move, in the displayed direction. */
  price: number;
  /** Tokens the pool gives up before the price gets there. */
  amount: number;
  /** Symbol of `amount`. */
  symbol: string;
  /** `amount` valued in the quote token at the current price. */
  value: number;
};

export type DepthOptions = { invert?: boolean; token0: PairToken; token1: PairToken };

/**
 * Depth at a signed move of the displayed price. Up takes the base token
 * (asks), down takes the quote token (bids). Under `invert` the base is
 * token1, so the sides swap and amounts are revalued in token0.
 */
export function readDepth(
  bins: ReadonlyArray<LiquidityBin>,
  currentPrice: number,
  percent: number,
  { invert = false, token0, token1 }: DepthOptions,
): DepthReading {
  if (!invert) {
    const d = getMarketDepth(bins, currentPrice, Math.abs(percent));
    const price = currentPrice * (1 + percent / 100);
    return percent >= 0
      ? { percent, price, amount: d.amount0, symbol: token0.symbol, value: d.value0 }
      : { percent, price, amount: d.amount1, symbol: token1.symbol, value: d.value1 };
  }
  // Inverted price q = 1/p. q up by x% means p down by x/(1+x).
  const shown = 1 / currentPrice;
  const x = percent / 100;
  const raw = x >= 0 ? (x / (1 + x)) * 100 : (-x / (1 + x)) * 100;
  const d = getMarketDepth(bins, currentPrice, Math.min(raw, 99.99));
  return percent >= 0
    ? {
        percent,
        price: shown * (1 + x),
        amount: d.amount1,
        symbol: token1.symbol,
        value: d.amount1 / currentPrice,
      }
    : {
        percent,
        price: shown * (1 + x),
        amount: d.amount0,
        symbol: token0.symbol,
        value: d.amount0,
      };
}

/**
 * Both sides sampled on a fixed grid of price moves out to ±`span`%: exact
 * interpolation per sample, and the same x positions whatever the bins
 * look like.
 */
export function sampleDepth(
  bins: ReadonlyArray<LiquidityBin>,
  currentPrice: number,
  span: number,
  options: DepthOptions,
  samples = 60,
) {
  const asks: Array<DepthReading> = [];
  const bids: Array<DepthReading> = [];
  for (let i = 0; i <= samples; i++) {
    const p = (span * i) / samples;
    asks.push(readDepth(bins, currentPrice, p, options));
    bids.push(readDepth(bins, currentPrice, -p, options));
  }
  return { asks, bids };
}

/** 0 plus 3–4 round steps up to at least `max`. */
export function niceTicks(max: number) {
  const raw = max / 3;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  // Ten times `pow` is always at least `raw`.
  const step = [1, 2, 2.5, 5].map((m) => m * pow).find((s) => s >= raw) ?? 10 * pow;
  const ticks = [0];
  for (let tick = 0; tick < max;) {
    tick += step;
    ticks.push(tick);
  }
  return ticks;
}

/** "+2%", "−2%" or "±0%". */
export function signedPercent(percent: number) {
  return `${percent > 0 ? "+" : percent < 0 ? "−" : "±"}${Math.abs(percent)}%`;
}

/** The reading a key moves to, from `from`, or undefined for other keys. */
export function nextDepthReading(key: string, from: number | undefined, span: number) {
  const step = span / 20;
  const at = from ?? 0;
  const next = new Map([
    ["ArrowRight", at + step],
    ["ArrowLeft", at - step],
    ["Home", -span],
    ["End", span],
  ]).get(key);
  if (next === undefined) {
    return undefined;
  }
  return Math.max(-span, Math.min(span, Math.round(next * 100) / 100));
}
