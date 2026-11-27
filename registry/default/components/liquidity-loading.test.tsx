import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { getSqrtRatioAtTick, priceToTick } from "@/lib/concentrated-liquidity";
import { v3Mint, v3Remove } from "@/lib/v3-position-manager";
import { createTestConfig, renderWithWagmi } from "../../../test/wagmi";
import { AddLiquidity } from "./add-liquidity";
import { DepthChart } from "./depth-chart";
import { FeeTierSelect } from "./fee-tier-select";
import { LiquidityChart } from "./liquidity-chart";
import { PositionCard } from "./position-card";
import { PriceRange } from "./price-range";
import { RangeIndicator } from "./range-indicator";
import { RemoveLiquidity } from "./remove-liquidity";

const ETH = { symbol: "ETH" };
const USDC = { symbol: "USDC" };
const usdc = {
  chainId: 1,
  address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  name: "USD Coin",
  symbol: "USDC",
  decimals: 6,
} as const;
const eth = {
  chainId: 1,
  address: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
  name: "Ether",
  symbol: "ETH",
  decimals: 18,
} as const;
const positionManager = "0xC36442b4a4522E871399CD717aBDD847Ab11FE88";
const weth = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
const tick = priceToTick(3000, 18, 6);
const pool = {
  tick,
  sqrtPriceX96: getSqrtRatioAtTick(tick),
  liquidity: 0n,
  tickSpacing: 10,
  decimals0: 18,
  decimals1: 6,
};

describe("loading skeletons", () => {
  it("charts show a skeleton until bins arrive", () => {
    render(<LiquidityChart pool={pool} token0={ETH} token1={USDC} />);
    expect(screen.getByText("Loading liquidity")).toBeInTheDocument();
    expect(document.querySelector("[data-slot=liquidity-chart]")).toHaveAttribute("data-loading");
    expect(screen.getByRole("button", { name: "Zoom in" })).toBeDisabled();

    render(<DepthChart token0={ETH} token1={USDC} />);
    expect(screen.getByText("Loading market depth")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("data components show a skeleton until the pool or position arrives", () => {
    render(<RangeIndicator tickLower={-60} tickUpper={60} token0={ETH} token1={USDC} />);
    expect(screen.getByText("Loading position range")).toBeInTheDocument();

    render(<PriceRange token0={ETH} token1={USDC} />);
    expect(screen.getByText("Loading pool")).toBeInTheDocument();

    render(<FeeTierSelect loading />);
    expect(document.querySelector("[data-slot=fee-tier-select]")).toHaveAttribute(
      "aria-busy",
      "true",
    );
  });

  it("blocks show a skeleton until their data arrives", () => {
    const config = createTestConfig();
    renderWithWagmi(
      <>
        <PositionCard />
        <AddLiquidity
          token0={usdc}
          token1={eth}
          getTransaction={v3Mint({ positionManager, weth })}
          spender={positionManager}
          fee={500}
        />
        <RemoveLiquidity getTransaction={v3Remove({ positionManager, weth })} />
      </>,
      { config },
    );
    expect(screen.getAllByText("Loading position")).toHaveLength(2);
    expect(screen.getByText("Loading pool")).toBeInTheDocument();
  });
});
