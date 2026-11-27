import { useState } from "react";
import { LiquidityChart } from "@/components/liquidity-chart";
import {
  getLiquidityBins,
  priceToTick,
  rangeAroundTick,
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

export default function LiquidityChartDemo() {
  const [range, setRange] = useState(() => rangeAroundTick(pool.tick, 8, pool.tickSpacing));
  return (
    <div className="w-full max-w-xl">
      <LiquidityChart
        bins={bins}
        pool={pool}
        token0={ETH}
        token1={USDC}
        range={range}
        onRangeChange={setRange}
      />
    </div>
  );
}
