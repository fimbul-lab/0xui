// Docs: https://0xui.io/components/range-indicator.md
import { Skeleton } from "skullet/react";
import type { RangeStatus } from "@/lib/concentrated-liquidity";
import { getRangeBar, rangeStatusLabel } from "@/lib/range-indicator-core";
import type { RangePool } from "@/lib/range-indicator-core";
import { cn } from "@/lib/utils";

export { getRangeBar, rangeStatusLabel };

const statusDot: Record<RangeStatus, string> = {
  "in-range": "bg-emerald-500",
  "out-of-range": "bg-amber-500",
  closed: "bg-muted-foreground",
};

export type RangeIndicatorProps = {
  tickLower: number;
  tickUpper: number;
  /** Current tick, spacing and decimals of the pool. Leave out while it loads: shows a skeleton. */
  pool?: RangePool;
  /** Position liquidity. `0n` shows the position as closed. */
  liquidity?: bigint;
  token0: { symbol: string };
  token1: { symbol: string };
  /** Quote prices in token0. */
  invert?: boolean;
  /** Hide the min / current / max labels under the bar. */
  compact?: boolean;
  locale?: string;
  className?: string;
};

/**
 * Where a position's range sits against the current price: an In range /
 * Out of range / Closed badge, and a bar with the range and a marker at the
 * price on a log scale, so ±10% looks the same at any price. The status is
 * on `data-status` and is announced in text, not just color.
 */
export function RangeIndicator({ pool, ...props }: RangeIndicatorProps) {
  // Stand-in pool for the skeleton: the price in the middle of the range.
  const sample: RangePool = {
    tick: Math.round((props.tickLower + props.tickUpper) / 2),
    tickSpacing: 1,
    decimals0: 18,
    decimals1: 18,
  };
  return (
    <Skeleton data={pool} sample={sample} label="Loading position range" className="w-full">
      {(p) => <RangeIndicatorView {...props} pool={p} />}
    </Skeleton>
  );
}

function RangeIndicatorView({
  tickLower,
  tickUpper,
  pool,
  liquidity,
  token0,
  token1,
  invert = false,
  compact = false,
  locale,
  className,
}: RangeIndicatorProps & { pool: RangePool }) {
  const bar = getRangeBar({
    tickLower,
    tickUpper,
    pool,
    liquidity,
    token0,
    token1,
    invert,
    locale,
  });

  return (
    <div
      data-slot="range-indicator"
      data-status={bar.status}
      className={cn("flex w-full flex-col gap-2 text-sm", className)}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-xs font-medium">
          <span className={cn("size-2 rounded-full", statusDot[bar.status])} aria-hidden />
          {rangeStatusLabel[bar.status]}
        </span>
        {bar.full && <span className="text-xs text-muted-foreground">Full range</span>}
      </div>
      <div role="img" aria-label={bar.label} className="relative h-2 w-full rounded-full bg-muted">
        <span
          className={cn(
            "absolute inset-y-0 rounded-full",
            bar.status === "in-range" ? "bg-foreground" : "bg-muted-foreground/50",
          )}
          style={{ left: `${bar.left}%`, width: `${Math.max(1, bar.right - bar.left)}%` }}
        />
        <span
          className="absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-background bg-foreground"
          style={{ left: `${bar.marker}%` }}
        />
      </div>
      {!compact && (
        <dl className="grid grid-cols-3 gap-2 text-xs">
          <div>
            <dt className="text-muted-foreground">Min</dt>
            <dd className="font-medium tabular-nums">{bar.min}</dd>
          </div>
          <div className="text-center">
            <dt className="text-muted-foreground">Current</dt>
            <dd className="font-medium tabular-nums">{bar.current}</dd>
          </div>
          <div className="text-right">
            <dt className="text-muted-foreground">Max</dt>
            <dd className="font-medium tabular-nums">{bar.max}</dd>
          </div>
          <p className="col-span-3 -mt-1 text-[11px] text-muted-foreground">{bar.unit}</p>
        </dl>
      )}
    </div>
  );
}
