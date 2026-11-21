// Locale pinned so the server and the browser format numbers the same way.
import { RangeIndicator } from "@/components/range-indicator";
import { usableTickBounds } from "@/lib/concentrated-liquidity";
import { demoPool, demoToken0, demoToken1 } from "./lp-pool";
import { demo } from "./demo";
import { usePretendLoad } from "./use-pretend-load";

const { pool } = demoPool;
const t = pool.tick;
const full = usableTickBounds(pool.tickSpacing);

const Card = ({ children }: { children: React.ReactNode }) => (
  <div className="w-full max-w-sm rounded-xl border bg-card p-4">{children}</div>
);

export const Default = demo(() => {
  const loaded = usePretendLoad();
  return (
    <Card>
      <RangeIndicator locale="en-US"
        tickLower={t - 800}
        tickUpper={t + 1200}
        pool={loaded ? pool : undefined}
        token0={demoToken0}
        token1={demoToken1}
      />
    </Card>
  );
});

export const States = demo(() => (
  <div className="grid w-full max-w-3xl gap-3 sm:grid-cols-2">
    <Card>
      <RangeIndicator locale="en-US"
        tickLower={t + 400}
        tickUpper={t + 1500}
        pool={pool}
        token0={demoToken0}
        token1={demoToken1}
      />
    </Card>
    <Card>
      <RangeIndicator locale="en-US"
        tickLower={t - 800}
        tickUpper={t + 1200}
        liquidity={0n}
        pool={pool}
        token0={demoToken0}
        token1={demoToken1}
      />
    </Card>
    <Card>
      <RangeIndicator locale="en-US"
        tickLower={full.min}
        tickUpper={full.max}
        pool={pool}
        token0={demoToken0}
        token1={demoToken1}
      />
    </Card>
    <Card>
      <RangeIndicator locale="en-US"
        tickLower={t - 800}
        tickUpper={t + 1200}
        pool={pool}
        token0={demoToken0}
        token1={demoToken1}
        invert
      />
    </Card>
  </div>
));
