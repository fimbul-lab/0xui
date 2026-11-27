import { describe, expect, it } from "vitest";
import {
  MAX_SQRT_RATIO,
  MAX_TICK,
  MIN_SQRT_RATIO,
  MIN_TICK,
  Q96,
  formatPrice,
  getAmountsForLiquidity,
  getDependentAmount,
  getDepositMode,
  getDepthCurve,
  getLiquidityBins,
  getLiquidityForAmounts,
  getMarketDepth,
  getRangeStatus,
  getSqrtRatioAtTick,
  isFullRange,
  nearestUsableTick,
  priceRangeToTicks,
  priceToTick,
  rangeAroundTick,
  tickToPrice,
  ticksFromPositions,
  usableTickBounds,
} from "./concentrated-liquidity";
import type { PoolState } from "./concentrated-liquidity";

describe("getSqrtRatioAtTick", () => {
  it("matches the contract at the bounds", () => {
    expect(getSqrtRatioAtTick(MIN_TICK)).toBe(MIN_SQRT_RATIO);
    expect(getSqrtRatioAtTick(MAX_TICK)).toBe(MAX_SQRT_RATIO);
    expect(getSqrtRatioAtTick(0)).toBe(Q96);
  });

  it("agrees with the float formula across the range", () => {
    for (const tick of [-500_000, -195_770, -60, -1, 1, 60, 12_345, 200_000, 500_000]) {
      const exact = Number(getSqrtRatioAtTick(tick)) / 2 ** 96;
      const float = Math.sqrt(Math.pow(1.0001, tick));
      expect(Math.abs(exact / float - 1)).toBeLessThan(1e-9);
    }
  });

  it("refuses ticks outside the range", () => {
    expect(() => getSqrtRatioAtTick(MAX_TICK + 1)).toThrow(RangeError);
    expect(() => getSqrtRatioAtTick(1.5)).toThrow(RangeError);
  });
});

describe("ticks and prices", () => {
  it("round-trips a price through its tick", () => {
    // ETH (18) priced in USDC (6).
    const tick = priceToTick(3150, 18, 6);
    expect(tickToPrice(tick, 18, 6)).toBeLessThanOrEqual(3150);
    expect(tickToPrice(tick + 1, 18, 6)).toBeGreaterThan(3150);
    expect(priceToTick(tickToPrice(tick, 18, 6), 18, 6)).toBe(tick);
  });

  it("snaps to the spacing inside the usable bounds", () => {
    expect(nearestUsableTick(-195_774, 10)).toBe(-195_770);
    expect(nearestUsableTick(MAX_TICK, 60)).toBe(887_220);
    expect(usableTickBounds(60)).toEqual({ min: -887_220, max: 887_220 });
    expect(isFullRange(-887_220, 887_220, 60)).toBe(true);
  });

  it("turns prices into ordered, snapped ticks", () => {
    const pool = { tickSpacing: 10, decimals0: 18, decimals1: 6 };
    const { tickLower, tickUpper } = priceRangeToTicks(3500, 2800, pool);
    expect(Math.abs(tickLower % 10)).toBe(0);
    expect(Math.abs(tickUpper % 10)).toBe(0);
    expect(tickToPrice(tickLower, 18, 6)).toBeCloseTo(2800, -1);
    expect(tickToPrice(tickUpper, 18, 6)).toBeCloseTo(3500, -1);
    expect(priceRangeToTicks(0, Infinity, pool)).toEqual({
      tickLower: -887_270,
      tickUpper: 887_270,
    });
    const same = priceRangeToTicks(3000, 3000, pool);
    expect(same.tickUpper - same.tickLower).toBe(10);
  });

  it("builds a range around the price", () => {
    const { tickLower, tickUpper } = rangeAroundTick(-195_775, 10, 10);
    expect(tickToPrice(tickUpper, 0, 0) / tickToPrice(-195_775, 0, 0)).toBeGreaterThanOrEqual(
      1.1 - 1e-6,
    );
    expect(tickToPrice(tickLower, 0, 0) / tickToPrice(-195_775, 0, 0)).toBeLessThanOrEqual(
      0.9 + 1e-6,
    );
    // Inverted, the same ±10% is symmetric in the displayed (1/p) price.
    const inv = rangeAroundTick(-195_775, 10, 10, { invert: true });
    const shown = (t: number) => 1 / tickToPrice(t, 0, 0);
    expect(shown(inv.tickLower) / shown(-195_775)).toBeGreaterThanOrEqual(1.1 - 1e-6);
    expect(shown(inv.tickLower) / shown(-195_775)).toBeLessThan(1.102);
    expect(shown(inv.tickUpper) / shown(-195_775)).toBeLessThanOrEqual(0.9 + 1e-6);
    expect(shown(inv.tickUpper) / shown(-195_775)).toBeGreaterThan(0.898);
    const tight = rangeAroundTick(5, 0.001, 10);
    expect(tight).toEqual({ tickLower: 0, tickUpper: 10 });
  });

  it("formats prices for labels", () => {
    expect(formatPrice(3150.4242, { locale: "en-US" })).toBe("3,150.42");
    expect(formatPrice(0)).toBe("0");
    expect(formatPrice(Infinity)).toBe("∞");
    expect(formatPrice(1e-12)).toBe("1.000e-12");
  });
});

describe("deposits", () => {
  const tickLower = -887_220;
  const tickUpper = 887_220;
  const sqrtPrice = getSqrtRatioAtTick(0);

  it("splits full range liquidity evenly at price 1", () => {
    const { amount0, amount1 } = getAmountsForLiquidity(
      sqrtPrice,
      getSqrtRatioAtTick(tickLower),
      getSqrtRatioAtTick(tickUpper),
      10n ** 18n,
    );
    expect(Number(amount0) / Number(amount1)).toBeCloseTo(1, 6);
  });

  it("gives the other side of a two-sided deposit", () => {
    const amount1 = getDependentAmount({
      sqrtPriceX96: sqrtPrice,
      tickLower,
      tickUpper,
      amount: 10n ** 18n,
      token: "token0",
    })!;
    expect(Number(amount1) / 1e18).toBeCloseTo(1, 6);
    // Round trip: the liquidity those amounts buy is the same either way.
    const l = getLiquidityForAmounts(
      sqrtPrice,
      getSqrtRatioAtTick(tickLower),
      getSqrtRatioAtTick(tickUpper),
      10n ** 18n,
      amount1,
    );
    expect(l).toBeGreaterThan(0n);
  });

  it("is single-sided outside the range", () => {
    const above = { sqrtPriceX96: sqrtPrice, tickLower: 60, tickUpper: 120 };
    expect(getDependentAmount({ ...above, amount: 5n, token: "token0" })).toBe(0n);
    expect(getDependentAmount({ ...above, amount: 5n, token: "token1" })).toBeUndefined();
    expect(getDepositMode(0, 60, 120)).toBe("token0");
    expect(getDepositMode(0, -120, -60)).toBe("token1");
    expect(getDepositMode(0, -60, 60)).toBe("both");
  });

  it("reports range status", () => {
    expect(getRangeStatus(0, -60, 60, 1n)).toBe("in-range");
    expect(getRangeStatus(60, -60, 60, 1n)).toBe("out-of-range");
    expect(getRangeStatus(0, -60, 60, 0n)).toBe("closed");
  });
});

describe("distribution and depth", () => {
  const L = 10n ** 18n;
  const { ticks, liquidity } = ticksFromPositions(
    [
      { tickLower: -100, tickUpper: 100, liquidity: L },
      { tickLower: 0, tickUpper: 50, liquidity: L },
    ],
    5,
  );
  const pool: PoolState = { tick: 5, liquidity, tickSpacing: 10, decimals0: 18, decimals1: 18 };

  it("rebuilds active liquidity from liquidityNet", () => {
    expect(liquidity).toBe(2n * L);
    const bins = getLiquidityBins(pool, ticks, { bins: 12 });
    const at = (tick: number) => bins.find((b) => b.tickLower === tick)!.liquidity;
    expect(at(0)).toBe(2n * L);
    expect(at(40)).toBe(2n * L);
    expect(at(50)).toBe(L);
    expect(at(-100)).toBe(L);
    expect(at(-110)).toBe(0n);
    expect(at(100)).toBe(0n);
    expect(bins.filter((b) => b.isCurrent)).toHaveLength(1);
  });

  it("puts token0 above the price and token1 below", () => {
    const bins = getLiquidityBins(pool, ticks, { bins: 12 });
    const above = bins.filter((b) => b.tickLower > 5);
    const below = bins.filter((b) => b.tickUpper <= 5);
    expect(above.length).toBeGreaterThan(0);
    expect(below.length).toBeGreaterThan(0);
    expect(above.map((b) => b.amount1)).toEqual(above.map(() => 0));
    expect(below.map((b) => b.amount0)).toEqual(below.map(() => 0));
    const total0 = bins.reduce((s, b) => s + b.amount0, 0);
    const exact =
      getAmountsForLiquidity(
        getSqrtRatioAtTick(5),
        getSqrtRatioAtTick(-100),
        getSqrtRatioAtTick(100),
        L,
      ).amount0 +
      getAmountsForLiquidity(
        getSqrtRatioAtTick(5),
        getSqrtRatioAtTick(0),
        getSqrtRatioAtTick(50),
        L,
      ).amount0;
    expect(total0 / (Number(exact) / 1e18)).toBeCloseTo(1, 4);
  });

  it("accumulates depth outward on both sides", () => {
    const bins = getLiquidityBins(pool, ticks, { bins: 12 });
    const price = tickToPrice(5, 18, 18);
    const { asks, bids } = getDepthCurve(bins, price);
    expect(asks.at(-1)!.price).toBeGreaterThan(price);
    expect(bids.at(-1)!.price).toBeLessThan(price);
    for (let i = 1; i < asks.length; i++) {
      expect(asks[i]!.amount0).toBeGreaterThan(asks[i - 1]!.amount0);
    }

    const half = getMarketDepth(bins, price, 0.25);
    const all = getMarketDepth(bins, price, 50);
    expect(half.amount0).toBeGreaterThan(0);
    expect(half.amount0).toBeLessThan(all.amount0);
    expect(all.amount0).toBeCloseTo(asks.at(-1)!.amount0, 6);
    expect(all.amount1).toBeCloseTo(bids.at(-1)!.amount1, 6);
  });
});
