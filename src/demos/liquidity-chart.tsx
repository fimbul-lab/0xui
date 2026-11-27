// Locale pinned so the server and the browser format numbers the same way.
import { useState } from "react";
import { LiquidityChart } from "@/components/liquidity-chart";
import type { TickRange } from "@/components/liquidity-chart";
import { rangeAroundTick } from "@/lib/concentrated-liquidity";
import { demoPool, demoToken0, demoToken1 } from "./lp-pool";
import { demo } from "./demo";
import { usePretendLoad } from "./use-pretend-load";

const { pool, bins } = demoPool;

export const Default = demo(() => {
  const loaded = usePretendLoad();
  return (
    <div className="w-full max-w-xl">
      <LiquidityChart
        locale="en-US"
        bins={loaded ? bins : undefined}
        pool={pool}
        token0={demoToken0}
        token1={demoToken1}
      />
    </div>
  );
});

export const WithRange = demo(() => {
  const [range, setRange] = useState<TickRange>(() =>
    rangeAroundTick(pool.tick, 8, pool.tickSpacing),
  );
  return (
    <div className="w-full max-w-xl">
      <LiquidityChart
        locale="en-US"
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
    <LiquidityChart
      locale="en-US"
      bins={bins}
      pool={pool}
      token0={demoToken0}
      token1={demoToken1}
      invert
    />
  </div>
));
