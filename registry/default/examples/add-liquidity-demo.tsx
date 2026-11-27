import { AddLiquidity, v3Mint } from "@/components/add-liquidity";
import {
  getLiquidityBins,
  getSqrtRatioAtTick,
  priceToTick,
  ticksFromPositions,
} from "@/lib/concentrated-liquidity";

// USDC/WETH 0.05% on Ethereum. USDC sorts first, so it's token0.
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

// Made-up liquidity. Read slot0, liquidity and ticks from the real pool instead.
// Position edges land on the 10-tick spacing.
const snap = (t: number) => Math.round(t / 10) * 10;
const tick = Math.round(priceToTick(1 / 3150, 6, 18) / 10) * 10 + 3;
const { ticks, liquidity } = ticksFromPositions(
  Array.from({ length: 200 }, (_, i) => {
    const center = tick + Math.round((Math.sin(i * 12.9898) * 1200) / 10) * 10;
    const half = 50 + (i % 9) * 60;
    return {
      tickLower: snap(center - half),
      tickUpper: snap(center + half),
      liquidity: 10n ** 16n * BigInt(1 + (i % 5)),
    };
  }),
  tick,
);
const pool = {
  tick,
  sqrtPriceX96: getSqrtRatioAtTick(tick),
  liquidity,
  tickSpacing: 10,
  decimals0: 6,
  decimals1: 18,
};

export default function AddLiquidityDemo() {
  return (
    <AddLiquidity
      token0={usdc}
      token1={eth}
      pool={pool}
      bins={getLiquidityBins(pool, ticks, { bins: 300 })}
      fee={500}
      getTransaction={v3Mint({ positionManager, weth })}
      spender={positionManager}
      defaultInvert
    />
  );
}
