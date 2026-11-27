import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  getLiquidityBins,
  priceToTick,
  rangeAroundTick,
  ticksFromPositions,
  tickToPrice,
  usableTickBounds,
} from "@/lib/concentrated-liquidity";
import { DepthChart, readDepth } from "./depth-chart";
import { FeeTierSelect } from "./fee-tier-select";
import { LiquidityChart } from "./liquidity-chart";
import { PriceRange } from "./price-range";
import { RangeIndicator } from "./range-indicator";

// The charts measure their container; jsdom has no layout.
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, "clientWidth", {
    configurable: true,
    get: () => 600,
  });
});

const ETH = { symbol: "ETH" };
const USDC = { symbol: "USDC" };
const tick = priceToTick(3000, 18, 6) + 5;
const { ticks, liquidity } = ticksFromPositions(
  [
    { tickLower: tick - 2005, tickUpper: tick + 1995, liquidity: 10n ** 17n },
    { tickLower: tick - 405, tickUpper: tick + 395, liquidity: 10n ** 17n },
  ].map((p) => ({
    ...p,
    tickLower: Math.round(p.tickLower / 10) * 10,
    tickUpper: Math.round(p.tickUpper / 10) * 10,
  })),
  tick,
);
const pool = { tick, liquidity, tickSpacing: 10, decimals0: 18, decimals1: 6 };
const bins = getLiquidityBins(pool, ticks, { bins: 300 });
const price = tickToPrice(tick, 18, 6);

const fields = () => screen.getAllByRole<HTMLInputElement>("textbox");

describe("LiquidityChart", () => {
  it("moves a range handle with the keyboard, snapped to the spacing", async () => {
    const onRangeChange = vi.fn();
    const range = rangeAroundTick(tick, 10, 10);
    render(
      <LiquidityChart
        bins={bins}
        pool={pool}
        token0={ETH}
        token1={USDC}
        range={range}
        onRangeChange={onRangeChange}
      />,
    );

    const min = screen.getByRole("slider", { name: "Min price" });
    expect(min).toHaveValue(String(range.tickLower));
    expect(min).toHaveAttribute("aria-valuetext", expect.stringMatching(/USDC per ETH$/));
    min.focus();
    await userEvent.keyboard("{ArrowLeft}");
    expect(onRangeChange).toHaveBeenLastCalledWith({
      tickLower: range.tickLower - 10,
      tickUpper: range.tickUpper,
    });
    await userEvent.keyboard("{PageUp}");
    expect(onRangeChange).toHaveBeenLastCalledWith({
      tickLower: range.tickLower + 100,
      tickUpper: range.tickUpper,
    });
  });

  it("never lets the lower handle cross the upper one", async () => {
    const onRangeChange = vi.fn();
    const lower = Math.round(tick / 10) * 10 - 20;
    const range = { tickLower: lower, tickUpper: lower + 30 };
    render(
      <LiquidityChart
        bins={bins}
        pool={pool}
        token0={ETH}
        token1={USDC}
        range={range}
        onRangeChange={onRangeChange}
      />,
    );
    screen.getByRole("slider", { name: "Min price" }).focus();
    await userEvent.keyboard("{PageUp}");
    expect(onRangeChange).toHaveBeenLastCalledWith({
      tickLower: range.tickUpper - 10,
      tickUpper: range.tickUpper,
    });
  });

  it("moves tickUpper with the min handle when inverted", async () => {
    const onRangeChange = vi.fn();
    const range = rangeAroundTick(tick, 10, 10);
    render(
      <LiquidityChart
        bins={bins}
        pool={pool}
        token0={ETH}
        token1={USDC}
        invert
        range={range}
        onRangeChange={onRangeChange}
      />,
    );
    const min = screen.getByRole("slider", { name: "Min price" });
    expect(min).toHaveAttribute("aria-valuetext", expect.stringMatching(/ETH per USDC$/));
    min.focus();
    // Right raises the displayed (inverted) price, which lowers the tick.
    await userEvent.keyboard("{ArrowRight}");
    expect(onRangeChange).toHaveBeenLastCalledWith({
      tickLower: range.tickLower,
      tickUpper: range.tickUpper - 10,
    });
  });

  it("reads bars out with arrow keys", async () => {
    render(<LiquidityChart bins={bins} pool={pool} token0={ETH} token1={USDC} />);
    screen.getByRole("group", { name: /Liquidity by price/ }).focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(document.querySelector("[aria-live]")!.textContent).toMatch(/ETH, .* USDC per ETH/);
  });
});

describe("PriceRange", () => {
  it("applies presets and full range", async () => {
    const onValueChange = vi.fn();
    render(
      <PriceRange
        pool={pool}
        bins={bins}
        token0={ETH}
        token1={USDC}
        onValueChange={onValueChange}
      />,
    );
    await userEvent.click(screen.getByRole("radio", { name: "±5%" }));
    expect(onValueChange).toHaveBeenLastCalledWith(rangeAroundTick(tick, 5, 10));
    expect(screen.getByRole("radio", { name: "±5%" })).toBeChecked();

    await userEvent.click(screen.getByRole("radio", { name: "Full range" }));
    const { min, max } = usableTickBounds(10);
    expect(onValueChange).toHaveBeenLastCalledWith({ tickLower: min, tickUpper: max });
    expect(fields().map((f) => f.value)).toEqual(["0", "∞"]);
    expect(fields()[0]).toBeDisabled();
    expect(screen.getByRole("radio", { name: "Full range" })).toBeChecked();
  });

  it("flips the quote with the token toggle", async () => {
    const onInvertChange = vi.fn();
    render(<PriceRange pool={pool} token0={ETH} token1={USDC} onInvertChange={onInvertChange} />);
    const quote = screen.getByRole("radiogroup", { name: "Quote prices in" });
    expect(within(quote).getByRole("radio", { name: "ETH" })).toBeChecked();
    await userEvent.click(within(quote).getByRole("radio", { name: "USDC" }));
    expect(onInvertChange).toHaveBeenLastCalledWith(true);
    expect(screen.getByText(/ETH per USDC/, { selector: "p" })).toBeInTheDocument();
  });

  it("drops a typed price on Escape", async () => {
    const onValueChange = vi.fn();
    render(
      <PriceRange
        pool={pool}
        token0={ETH}
        token1={USDC}
        onValueChange={onValueChange}
        locale="en-US"
      />,
    );
    const min = screen.getByLabelText<HTMLInputElement>("Min price");
    const before = min.value;
    await userEvent.clear(min);
    await userEvent.type(min, "1{Escape}");
    expect(onValueChange).not.toHaveBeenCalled();
    expect(min).toHaveValue(before);
  });

  it("snaps a typed price to a usable tick", async () => {
    const onValueChange = vi.fn();
    render(
      <PriceRange
        pool={pool}
        token0={ETH}
        token1={USDC}
        onValueChange={onValueChange}
        locale="en-US"
      />,
    );
    const max = screen.getByLabelText("Max price");
    await userEvent.clear(max);
    await userEvent.type(max, "3,600{Enter}");
    const { tickUpper } = onValueChange.mock.lastCall![0];
    expect(Math.abs(tickUpper % 10)).toBe(0);
    expect(tickToPrice(tickUpper, 18, 6)).toBeCloseTo(3600, -1);
    expect(max).not.toHaveValue("3,600");
  });

  it("steps the displayed min price the right way when inverted", async () => {
    const onValueChange = vi.fn();
    const range = rangeAroundTick(tick, 10, 10);
    render(
      <PriceRange
        pool={pool}
        token0={ETH}
        token1={USDC}
        defaultValue={range}
        defaultInvert
        onValueChange={onValueChange}
      />,
    );
    // Inverted, the min price (USDC→ETH) comes from tickUpper; raising it lowers the tick.
    await userEvent.click(screen.getByRole("button", { name: "Increase min price" }));
    expect(onValueChange).toHaveBeenLastCalledWith({
      tickLower: range.tickLower,
      tickUpper: range.tickUpper - 10,
    });
    expect(screen.getByText(/ETH per USDC/, { selector: "p" })).toBeInTheDocument();
  });

  it("warns when the range only takes one token", () => {
    render(
      <PriceRange
        pool={pool}
        token0={ETH}
        token1={USDC}
        defaultValue={{ tickLower: tick + 100, tickUpper: tick + 500 }}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("takes only ETH");
    expect(document.querySelector("[data-deposit-mode]")).toHaveAttribute(
      "data-deposit-mode",
      "token0",
    );
  });
});

describe("DepthChart", () => {
  it("shows ±2% depth on both sides", () => {
    render(<DepthChart bins={bins} currentPrice={price} token0={ETH} token1={USDC} />);
    expect(screen.getByText("Bids to −2%")).toBeInTheDocument();
    expect(screen.getByText("Asks to +2%")).toBeInTheDocument();
    const table = screen.getByRole("table");
    expect(within(table).getAllByRole("row")).toHaveLength(5);
  });

  it("swaps sides when inverted", () => {
    const up = readDepth(bins, price, 2, { token0: ETH, token1: USDC });
    const invertedDown = readDepth(bins, price, -2, { token0: ETH, token1: USDC, invert: true });
    expect(up.symbol).toBe("ETH");
    expect(invertedDown.symbol).toBe("ETH");
    // −2% in ETH per USDC is +2.04% in USDC per ETH.
    expect(invertedDown.amount).toBeGreaterThan(up.amount);
    expect(readDepth(bins, price, 2, { token0: ETH, token1: USDC, invert: true }).symbol).toBe(
      "USDC",
    );
  });
});

describe("RangeIndicator", () => {
  it("names the status", () => {
    const { rerender } = render(
      <RangeIndicator
        tickLower={tick - 100}
        tickUpper={tick + 100}
        pool={pool}
        token0={ETH}
        token1={USDC}
      />,
    );
    expect(screen.getByText("In range")).toBeInTheDocument();
    rerender(
      <RangeIndicator
        tickLower={tick + 100}
        tickUpper={tick + 200}
        pool={pool}
        token0={ETH}
        token1={USDC}
      />,
    );
    expect(screen.getByText("Out of range")).toBeInTheDocument();
    rerender(
      <RangeIndicator
        tickLower={tick - 100}
        tickUpper={tick + 100}
        liquidity={0n}
        pool={pool}
        token0={ETH}
        token1={USDC}
      />,
    );
    expect(document.querySelector("[data-status]")).toHaveAttribute("data-status", "closed");
  });
});

describe("FeeTierSelect", () => {
  it("picks a tier with its tick spacing", async () => {
    const onValueChange = vi.fn();
    render(<FeeTierSelect onValueChange={onValueChange} />);
    expect(screen.getByRole("radio", { name: /0.3%/ })).toBeChecked();
    await userEvent.click(screen.getByRole("radio", { name: /0.05%/ }));
    expect(onValueChange).toHaveBeenCalledWith(
      expect.objectContaining({ fee: 500, tickSpacing: 10 }),
    );
    expect(screen.getByRole("radio", { name: /0.05%/ })).toBeChecked();
  });
});
