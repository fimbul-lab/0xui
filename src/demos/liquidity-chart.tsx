import { useState } from "react";
import { LiquidityChart, type TickRange } from "@/components/liquidity-chart";
import { rangeAroundTick } from "@/lib/concentrated-liquidity";
import { demoPool, demoToken0, demoToken1 } from "./lp-pool";
import { demo } from "./demo";

const { pool, bins } = demoPool;

export const Default = demo(() => (
  <div className="w-full max-w-xl">
    <LiquidityChart bins={bins} pool={pool} token0={demoToken0} token1={demoToken1} />
  </div>
));

export const WithRange = demo(() => {
  const [range, setRange] = useState<TickRange>(() => rangeAroundTick(pool.tick, 8, pool.tickSpacing));
  return (
    <div className="w-full max-w-xl">
      <LiquidityChart
        bins={bins}
        pool={pool}
        token0={demoToken0}
        token1={demoToken1}
        range={range}
        onRangeChange={setRange}
      />
    </div>
  );
});

export const Inverted = demo(() => (
  <div className="w-full max-w-xl">
    <LiquidityChart bins={bins} pool={pool} token0={demoToken0} token1={demoToken1} invert />
  </div>
));
