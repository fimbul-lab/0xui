import { useState } from "react";
import { PriceRange } from "@/components/price-range";
import type { TickRange } from "@/components/liquidity-chart";
import { RangeIndicator } from "@/components/range-indicator";
import { demoPool, demoToken0, demoToken1 } from "./lp-pool";
import { demo } from "./demo";

const { pool, bins } = demoPool;

export const Default = demo(() => {
  const [range, setRange] = useState<TickRange>();
  return (
    <div className="flex w-full max-w-xl flex-col gap-3">
      <PriceRange
        pool={pool}
        bins={bins}
        token0={demoToken0}
        token1={demoToken1}
        onValueChange={setRange}
      />
      {range && (
        <p className="text-xs text-muted-foreground tabular-nums">
          tickLower {range.tickLower} · tickUpper {range.tickUpper}
        </p>
      )}
    </div>
  );
});

export const WithoutChart = demo(() => (
  <div className="w-full max-w-xl">
    <PriceRange pool={pool} token0={demoToken0} token1={demoToken1} defaultInvert />
  </div>
));

export const Preview = demo(() => {
  const [range, setRange] = useState<TickRange>({ tickLower: pool.tick - 600, tickUpper: pool.tick + 900 });
  return (
    <div className="flex w-full max-w-xl flex-col gap-4">
      <PriceRange pool={pool} bins={bins} token0={demoToken0} token1={demoToken1} value={range} onValueChange={setRange} />
      <RangeIndicator {...range} pool={pool} token0={demoToken0} token1={demoToken1} />
    </div>
  );
});
