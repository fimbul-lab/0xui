import { describe, expect, it } from "vitest";
import { moveRangeEdge, shiftRange, usableTickBounds } from "@/lib/concentrated-liquidity";
import {
  chartViewport,
  formatPriceChange,
  nextBar,
  rangeSlider,
  toBars,
} from "@/lib/liquidity-chart-core";
import type { Bar } from "@/lib/liquidity-chart-core";

const bins = Array.from({ length: 100 }, (_, i) => ({
  tickLower: i * 10,
  tickUpper: i * 10 + 10,
  liquidity: 1n,
  amount0: 1,
  amount1: 0,
  isCurrent: i === 50,
  priceLower: 1,
  priceUpper: 1,
}));

describe("chartViewport", () => {
  it("shows every bin at zoom 1 and centers on the range when zoomed", () => {
    expect(chartViewport({ bins, currentTick: 500, tickSpacing: 10, zoom: 1 })).toMatchObject({
      lower: 0,
      upper: 1000,
      canZoomOut: false,
    });
    const zoomed = chartViewport({
      bins,
      currentTick: 500,
      tickSpacing: 10,
      zoom: 4,
      range: { tickLower: 200, tickUpper: 300 },
    });
    expect((zoomed.lower + zoomed.upper) / 2).toBe(250);
    expect(zoomed.upper - zoomed.lower).toBe(250);
    expect(zoomed.zoomIn(4)).toBeCloseTo(6.4);
    expect(zoomed.zoomOut(1.2)).toBe(1);
  });
});

describe("toBars", () => {
  it("merges bins so bars stay a few pixels wide", () => {
    expect(toBars(bins, 0, 1000, 300)).toHaveLength(100);
    const bars = toBars(bins, 0, 1000, 60);
    expect(bars).toHaveLength(20);
    expect(bars[0]).toMatchObject({ tickLower: 0, tickUpper: 50, amount0: 5, liquidity: 1 });
  });
});

describe("nextBar", () => {
  const bars = [{}, { isCurrent: true }, {}] as Array<Bar>;
  it("starts at the current bar and flips with the axis", () => {
    expect(nextBar("ArrowRight", bars, undefined)).toBe(2);
    expect(nextBar("ArrowRight", bars, undefined, true)).toBe(0);
    expect(nextBar("End", bars, 0, true)).toBe(0);
    expect(nextBar("Enter", bars, 0)).toBeUndefined();
  });
});

describe("range handles", () => {
  it("maps the range onto a slider over the window, negated when inverted", () => {
    const range = { tickLower: 100, tickUpper: 400 };
    expect(rangeSlider(range, 3, 997, 10)).toMatchObject({
      min: 10,
      max: 990,
      value: [100, 400],
      offscreen: [false, false],
    });
    const inverted = rangeSlider(range, 0, 1000, 10, true);
    expect(inverted).toMatchObject({ min: -1000, max: 0, value: [-400, -100] });
    expect(inverted.tickOf(-400)).toBe(400);
  });

  it("parks a handle outside the window on its edge", () => {
    const { min, max } = usableTickBounds(10);
    const slider = rangeSlider({ tickLower: min, tickUpper: max }, 0, 1000, 10);
    expect(slider.value).toEqual([0, 1000]);
    expect(slider.offscreen).toEqual([true, true]);
  });

  it("snaps an edge and keeps the edges a spacing apart", () => {
    const range = { tickLower: 100, tickUpper: 200 };
    expect(moveRangeEdge(range, "tickLower", 143, 10)).toEqual({ tickLower: 140, tickUpper: 200 });
    expect(moveRangeEdge(range, "tickLower", 500, 10)).toEqual({ tickLower: 190, tickUpper: 200 });
    expect(moveRangeEdge(range, "tickUpper", -1e9, 10)).toEqual({ tickLower: 100, tickUpper: 110 });
  });

  it("slides the band inside the usable ticks", () => {
    expect(shiftRange({ tickLower: 100, tickUpper: 200 }, 33, 10)).toEqual({
      tickLower: 130,
      tickUpper: 230,
    });
    expect(
      shiftRange({ tickLower: 100, tickUpper: usableTickBounds(10).max }, 10, 10),
    ).toBeUndefined();
  });

  it("labels a handle by its move from the price", () => {
    expect(formatPriceChange(1.05, 1)).toBe("+5.00%");
    expect(formatPriceChange(0.5, 1)).toBe("−50.0%");
    expect(formatPriceChange(Infinity, 1)).toBe("∞");
  });
});
