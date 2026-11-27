import { describe, expect, it } from "vitest";
import {
  priceToTick,
  rangeAroundTick,
  tickToPrice,
  usableTickBounds,
} from "@/lib/concentrated-liquidity";
import {
  activePreset,
  defaultRange,
  defaultRangePresets,
  edgeTick,
  formatEdgeChange,
  getPriceRangeState,
  parsePriceInput,
  presetRange,
  rangeWithPrice,
  stepRangeEdge,
} from "@/lib/price-range-core";

const tick = priceToTick(3000, 18, 6);
const pool = { tick, tickSpacing: 10, decimals0: 18, decimals1: 6 };

describe("price-range-core", () => {
  it("starts at ±10%, or ±0.1% for stable spacings", () => {
    expect(defaultRange(pool)).toEqual(rangeAroundTick(tick, 10, 10));
    expect(defaultRange({ tick: 0, tickSpacing: 1 })).toEqual(rangeAroundTick(0, 0.1, 1));
    expect(defaultRangePresets(1)[0]!.label).toBe("±0.05%");
  });

  it("maps the displayed min to tickUpper when inverted", () => {
    expect(edgeTick("min")).toBe("tickLower");
    expect(edgeTick("min", true)).toBe("tickUpper");
    const range = rangeAroundTick(tick, 10, 10);
    expect(stepRangeEdge(range, "min", 1, pool, true)).toEqual({
      ...range,
      tickUpper: range.tickUpper - 10,
    });
  });

  it("sets an edge from a typed price, snapped", () => {
    const range = rangeAroundTick(tick, 10, 10);
    const next = rangeWithPrice(range, "max", 3600, pool)!;
    expect(Math.abs(next.tickUpper % 10)).toBe(0);
    expect(tickToPrice(next.tickUpper, 18, 6)).toBeCloseTo(3600, -1);
    expect(rangeWithPrice(range, "max", 0, pool)).toBeUndefined();
  });

  it("finds the preset a range matches", () => {
    const presets = defaultRangePresets(10);
    expect(activePreset(presets, presetRange(presets[1]!, pool), pool)?.label).toBe("±5%");
    const { min, max } = usableTickBounds(10);
    expect(activePreset(presets, { tickLower: min, tickUpper: max }, pool)?.label).toBe(
      "Full range",
    );
    expect(
      activePreset(presets, { tickLower: tick - 30, tickUpper: tick + 70 }, pool),
    ).toBeUndefined();
  });

  it("reads a full range as 0 to ∞", () => {
    const { min, max } = usableTickBounds(10);
    expect(getPriceRangeState({ tickLower: min, tickUpper: max }, pool)).toMatchObject({
      isFullRange: true,
      min: 0,
      max: Infinity,
    });
  });

  it("parses typed prices in either decimal style", () => {
    expect(parsePriceInput("3,600")).toBe(3600);
    expect(parsePriceInput("3600,5")).toBe(3600.5);
    expect(parsePriceInput("1.234,56")).toBe(1234.56);
    expect(parsePriceInput("abc")).toBeUndefined();
    expect(parsePriceInput("0")).toBeUndefined();
  });

  it("shows the move from the price, and nothing for 0 or ∞", () => {
    expect(formatEdgeChange(3300, 3000)).toBe("+10.0%");
    expect(formatEdgeChange(0, 3000)).toBeUndefined();
    expect(formatEdgeChange(Infinity, 3000)).toBeUndefined();
  });
});
