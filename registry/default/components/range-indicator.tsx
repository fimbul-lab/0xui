// Docs: https://0xui.io/components/range-indicator.md
import {
  formatPrice,
  getRangeStatus,
  isFullRange,
  tickToPrice,
  type PoolState,
  type RangeStatus,
} from "@/lib/concentrated-liquidity";
import { cn } from "@/lib/utils";

const statusLabel: Record<RangeStatus, string> = {
  "in-range": "In range",
  "out-of-range": "Out of range",
  closed: "Closed",
};

const statusDot: Record<RangeStatus, string> = {
  "in-range": "bg-emerald-500",
  "out-of-range": "bg-amber-500",
  closed: "bg-muted-foreground",
};

export type RangeIndicatorProps = {
  tickLower: number;
  tickUpper: number;
  /** Current tick, spacing and decimals of the pool. */
  pool: Pick<PoolState, "tick" | "tickSpacing" | "decimals0" | "decimals1">;
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
export function RangeIndicator({
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
}: RangeIndicatorProps) {
  const status = getRangeStatus(pool.tick, tickLower, tickUpper, liquidity);
  const full = isFullRange(tickLower, tickUpper, pool.tickSpacing);
  const price = (t: number) => {
    const p = tickToPrice(t, pool.decimals0, pool.decimals1);
    return invert ? 1 / p : p;
  };
  const [minTick, maxTick] = invert ? [tickUpper, tickLower] : [tickLower, tickUpper];
  const unit = `${(invert ? token0 : token1).symbol} per ${(invert ? token1 : token0).symbol}`;

  // Ticks are log price, so the bar can use them directly. Pad the domain
  // by a third of the range on each side, and stretch it to include the price.
  const width = Math.max(tickUpper - tickLower, pool.tickSpacing);
  const lo = Math.min(tickLower, pool.tick) - width / 3;
  const hi = Math.max(tickUpper, pool.tick) + width / 3;
  const pos = (t: number) => {
    const f = (t - lo) / (hi - lo);
    return (invert ? 1 - f : f) * 100;
  };
  const [left, right] = full ? [0, 100] : [Math.min(pos(tickLower), pos(tickUpper)), Math.max(pos(tickLower), pos(tickUpper))];
  const marker = full ? 50 : pos(pool.tick);

  return (
    <div data-slot="range-indicator" data-status={status} className={cn("flex w-full flex-col gap-2 text-sm", className)}>
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-xs font-medium">
          <span className={cn("size-2 rounded-full", statusDot[status])} aria-hidden />
          {statusLabel[status]}
        </span>
        {full && <span className="text-xs text-muted-foreground">Full range</span>}
      </div>
      <div
        role="img"
        aria-label={`${statusLabel[status]}. Range ${full ? "full" : `${formatPrice(price(minTick), { locale })} to ${formatPrice(price(maxTick), { locale })}`} ${unit}, current price ${formatPrice(price(pool.tick), { locale })}.`}
        className="relative h-2 w-full rounded-full bg-muted"
      >
        <span
          className={cn("absolute inset-y-0 rounded-full", status === "in-range" ? "bg-foreground" : "bg-muted-foreground/50")}
          style={{ left: `${left}%`, width: `${Math.max(1, right - left)}%` }}
        />
        <span
          className="absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-background bg-foreground"
          style={{ left: `${Math.max(0, Math.min(100, marker))}%` }}
        />
      </div>
      {!compact && (
        <dl className="grid grid-cols-3 gap-2 text-xs">
          <div>
            <dt className="text-muted-foreground">Min</dt>
            <dd className="font-medium tabular-nums">{full ? "0" : formatPrice(price(minTick), { locale })}</dd>
          </div>
          <div className="text-center">
            <dt className="text-muted-foreground">Current</dt>
            <dd className="font-medium tabular-nums">{formatPrice(price(pool.tick), { locale })}</dd>
          </div>
          <div className="text-right">
            <dt className="text-muted-foreground">Max</dt>
            <dd className="font-medium tabular-nums">{full ? "∞" : formatPrice(price(maxTick), { locale })}</dd>
          </div>
          <p className="col-span-3 -mt-1 text-[11px] text-muted-foreground">{unit}</p>
        </dl>
      )}
    </div>
  );
}
