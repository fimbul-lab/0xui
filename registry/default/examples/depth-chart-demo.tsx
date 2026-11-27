import { DepthChart } from "@/components/depth-chart";
import {
  getLiquidityBins,
  priceToTick,
  tickToPrice,
  ticksFromPositions,
} from "@/lib/concentrated-liquidity";

const ETH = { symbol: "ETH" };
const USDC = { symbol: "USDC" };

// A made-up ETH/USDC 0.05% pool. Read slot0, liquidity and ticks from yours.
const tick = priceToTick(3150, 18, 6);
const { ticks, liquidity } = ticksFromPositions(
  Array.from({ length: 200 }, (_, i) => {
    const center = tick + Math.round((Math.sin(i * 12.9898) * 1200) / 10) * 10;
    const half = 50 + (i % 9) * 60;
    return {
      tickLower: center - half,
      tickUpper: center + half,
      liquidity: 10n ** 16n * BigInt(1 + (i % 5)),
    };
  }),
  tick,
);
const pool = { tick, liquidity, tickSpacing: 10, decimals0: 18, decimals1: 6 };
const bins = getLiquidityBins(pool, ticks, { bins: 300 });

export default function DepthChartDemo() {
  return (
    <div className="w-full max-w-xl">
      <DepthChart
        bins={bins}
        currentPrice={tickToPrice(pool.tick, 18, 6)}
        token0={ETH}
        token1={USDC}
      />
    </div>
  );
}
