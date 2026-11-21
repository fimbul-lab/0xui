// Locale pinned so the server and the browser format numbers the same way.
import { useState } from "react";
import { PriceRange } from "@/components/price-range";
import type { TickRange } from "@/components/liquidity-chart";
import { RangeIndicator } from "@/components/range-indicator";
import { demoPool, demoToken0, demoToken1 } from "./lp-pool";
import { demo } from "./demo";
import { usePretendLoad } from "./use-pretend-load";

const { pool, bins } = demoPool;

export const Default = demo(() => {
  const [range, setRange] = useState<TickRange>();
  const loaded = usePretendLoad();
  return (
    <div className="flex w-full max-w-xl flex-col gap-3">
      <PriceRange locale="en-US"
        pool={loaded ? pool : undefined}
        bins={loaded ? bins : undefined}
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
    <PriceRange locale="en-US"
      pool={pool}
      showChart={false}
      token0={demoToken0}
      token1={demoToken1}
      defaultInvert
    />
  </div>
));

export const Preview = demo(() => {
  const [range, setRange] = useState<TickRange>({
    tickLower: pool.tick - 600,
    tickUpper: pool.tick + 900,
  });
  return (
    <div className="flex w-full max-w-xl flex-col gap-4">
      <PriceRange locale="en-US"
        pool={pool}
        bins={bins}
        token0={demoToken0}
        token1={demoToken1}
        value={range}
        onValueChange={setRange}
      />
      <RangeIndicator locale="en-US" {...range} pool={pool} token0={demoToken0} token1={demoToken1} />
    </div>
  );
});
