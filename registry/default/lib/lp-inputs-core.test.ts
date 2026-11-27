import { describe, expect, it } from "vitest";
import {
  getLiquidityBins,
  priceToTick,
  tickToPrice,
  ticksFromPositions,
} from "@/lib/concentrated-liquidity";
import {
  nextDepthReading,
  niceTicks,
  readDepth,
  sampleDepth,
  signedPercent,
} from "@/lib/depth-chart-core";
import { defaultFeeTier, defaultFeeTiers, feeTierBadge, formatFee } from "@/lib/fee-tier-core";
import { getRangeBar } from "@/lib/range-indicator-core";
import { formatSlippage, parseSlippageInput, slippageWarning } from "@/lib/slippage-core";

const ETH = { symbol: "ETH" };
const USDC = { symbol: "USDC" };

describe("fee-tier-core", () => {
  it("formats fees and badges", () => {
    expect(formatFee(500, "en-US")).toBe("0.05%");
    expect(defaultFeeTier(defaultFeeTiers)?.fee).toBe(3000);
    expect(defaultFeeTier([{ fee: 100 }])?.fee).toBe(100);
    expect(feeTierBadge({ share: 0.62 }, "en-US")).toBe("62% select");
    expect(feeTierBadge({ exists: false })).toBe("Not created");
    expect(feeTierBadge({})).toBeUndefined();
  });
});

describe("slippage-core", () => {
  it("warns at the edges and parses custom percents", () => {
    expect(formatSlippage(50, "en-US")).toBe("0.5%");
    expect(slippageWarning(1)).toBe("low");
    expect(slippageWarning(800)).toBe("high");
    expect(slippageWarning(50)).toBeUndefined();
    expect(parseSlippageInput("0,3")).toEqual({ text: "0.3", bps: 30 });
    expect(parseSlippageInput("abc")).toEqual({});
    expect(parseSlippageInput("")).toEqual({ text: "", bps: undefined });
    expect(parseSlippageInput("51").bps).toBe(undefined);
  });
});

describe("range-indicator-core", () => {
  const pool = { tick: 0, tickSpacing: 10, decimals0: 18, decimals1: 18 };
  it("places the range and the price on the bar", () => {
    const bar = getRangeBar({
      tickLower: -300,
      tickUpper: 300,
      pool,
      token0: ETH,
      token1: USDC,
      locale: "en-US",
    });
    expect(bar).toMatchObject({
      status: "in-range",
      full: false,
      marker: 50,
      unit: "USDC per ETH",
    });
    expect(bar.right - bar.left).toBeCloseTo(60);
    expect(bar.label).toMatch(/^In range\. Range .+ to .+ USDC per ETH, current price 1\.$/);
    const closed = getRangeBar({
      tickLower: 100,
      tickUpper: 300,
      pool,
      liquidity: 0n,
      token0: ETH,
      token1: USDC,
      invert: true,
    });
    expect(closed).toMatchObject({ status: "closed", unit: "ETH per USDC" });
  });
});

describe("depth-chart-core", () => {
  const tick = priceToTick(3000, 18, 6);
  const { ticks, liquidity } = ticksFromPositions(
    [{ tickLower: tick - 2000, tickUpper: tick + 2000, liquidity: 10n ** 17n }],
    tick,
  );
  const bins = getLiquidityBins(
    { tick, liquidity, tickSpacing: 10, decimals0: 18, decimals1: 6 },
    ticks,
    { bins: 200 },
  );
  const price = tickToPrice(tick, 18, 6);

  it("samples both sides out to the window", () => {
    const { asks, bids } = sampleDepth(bins, price, 10, { token0: ETH, token1: USDC }, 10);
    expect(asks).toHaveLength(11);
    expect(asks[10]!.percent).toBe(10);
    expect(bids[10]!.symbol).toBe("USDC");
    expect(asks[10]!.amount).toBeGreaterThan(asks[1]!.amount);
    expect(readDepth(bins, price, 2, { token0: ETH, token1: USDC, invert: true }).symbol).toBe(
      "USDC",
    );
  });

  it("reads with the keyboard and labels moves", () => {
    expect(nextDepthReading("ArrowRight", undefined, 10)).toBe(0.5);
    expect(nextDepthReading("Home", 3, 10)).toBe(-10);
    expect(nextDepthReading("x", 3, 10)).toBeUndefined();
    expect(signedPercent(-2)).toBe("−2%");
    expect(niceTicks(95)).toEqual([0, 50, 100]);
  });
});
