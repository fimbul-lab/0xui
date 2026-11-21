// Docs: https://0xui.io/components/position-list.md
import { ChevronRightIcon } from "lucide-react";
import type { ReactNode } from "react";
import {
  PositionCard,
  positionValue,
  type GetCollectTransaction,
} from "@/components/position-card";
import type { Token, TokenPrices } from "@/components/token-select";
import {
  getPositionAmounts,
  getRangeStatus,
  type PoolState,
  type Position,
  type RangeStatus,
} from "@/lib/concentrated-liquidity";
import { cn } from "@/lib/utils";

export type PositionListItem = {
  position: Position<Token>;
  pool: Pick<PoolState, "tick" | "sqrtPriceX96" | "tickSpacing" | "decimals0" | "decimals1">;
};

const STABLES = new Set([
  "USDC", "USDT", "DAI", "USDC.E", "USDBC", "USDE", "FRAX", "LUSD", "PYUSD", "GHO", "CRVUSD", "USDS", "EURC",
]);

/**
 * Quote prices in the stablecoin: USDC/WETH reads as "USDC per ETH", not
 * "ETH per USDC". True when token0 is a stablecoin and token1 isn't.
 */
export function quoteInToken0(token0: { symbol: string }, token1: { symbol: string }) {
  return STABLES.has(token0.symbol.toUpperCase()) && !STABLES.has(token1.symbol.toUpperCase());
}

const statusOrder: Record<RangeStatus, number> = { "in-range": 0, "out-of-range": 1, closed: 2 };

/** In range first, then out of range, then closed; within each, largest first. */
export function sortPositions<T extends PositionListItem>(items: readonly T[], prices?: TokenPrices) {
  const status = (item: T) =>
    getRangeStatus(item.pool.tick, item.position.tickLower, item.position.tickUpper, item.position.liquidity);
  const value = (item: T) =>
    positionValue(getPositionAmounts(item.position, item.pool), item.position.token0, item.position.token1, prices) ?? 0;
  return [...items].sort(
    (a, b) =>
      statusOrder[status(a)] - statusOrder[status(b)] ||
      value(b) - value(a) ||
      Number(b.position.tokenId - a.position.tokenId)
  );
}

export type PositionListProps = {
  /** Positions with their pools, e.g. from `useV3Positions`. Leave out while loading: shows skeleton cards. */
  positions?: readonly PositionListItem[];
  prices?: TokenPrices;
  currency?: string;
  /** Quote each range in token0. `"auto"` quotes in the stablecoin when there is one. */
  invert?: boolean | "auto";
  /** Adds Collect fees to each card. */
  getCollectTransaction?: GetCollectTransaction;
  /** Extra buttons for a card, like Add and Remove. */
  actions?: (item: PositionListItem) => ReactNode;
  /** Shown when there are no positions. */
  empty?: ReactNode;
  /** Heading. */
  title?: ReactNode;
  /** Skeleton cards while loading. */
  skeletonCount?: number;
  locale?: string;
  className?: string;
};

/**
 * An owner's LP positions as cards: in range first, then out of range,
 * largest first, with closed positions folded away under "Closed
 * positions". The header counts each status. Skeleton cards while
 * loading, and an empty state with room for a "New position" button.
 */
export function PositionList({
  positions,
  prices,
  currency,
  invert = "auto",
  getCollectTransaction,
  actions,
  empty,
  title = "Your positions",
  skeletonCount = 2,
  locale,
  className,
}: PositionListProps) {
  const loading = positions === undefined;
  const sorted = loading ? [] : sortPositions(positions, prices);
  const statusOf = (item: PositionListItem) =>
    getRangeStatus(item.pool.tick, item.position.tickLower, item.position.tickUpper, item.position.liquidity);
  const open = sorted.filter((item) => statusOf(item) !== "closed");
  const closed = sorted.filter((item) => statusOf(item) === "closed");
  const counts = {
    inRange: open.filter((item) => statusOf(item) === "in-range").length,
    outOfRange: open.filter((item) => statusOf(item) === "out-of-range").length,
  };

  const card = (item: PositionListItem) => (
    <li key={item.position.tokenId.toString()}>
      <PositionCard
        position={item.position}
        pool={item.pool}
        prices={prices}
        currency={currency}
        invert={invert === "auto" ? quoteInToken0(item.position.token0, item.position.token1) : invert}
        getCollectTransaction={getCollectTransaction}
        actions={actions?.(item)}
        locale={locale}
      />
    </li>
  );

  return (
    <section
      data-slot="position-list"
      data-loading={loading || undefined}
      aria-busy={loading || undefined}
      className={cn("flex w-full flex-col gap-3", className)}
    >
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        {title && <h3 className="text-lg font-semibold">{title}</h3>}
        {!loading && sorted.length > 0 && (
          <p className="text-sm text-muted-foreground tabular-nums">
            {counts.inRange} in range
            {counts.outOfRange > 0 && ` · ${counts.outOfRange} out of range`}
            {closed.length > 0 && ` · ${closed.length} closed`}
          </p>
        )}
      </header>

      {loading ? (
        <ul className="flex flex-col gap-3" aria-label="Loading positions">
          {Array.from({ length: skeletonCount }, (_, i) => (
            <li key={i}>
              <PositionCard />
            </li>
          ))}
        </ul>
      ) : sorted.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed px-4 py-10 text-center">
          <p className="font-medium">No positions yet</p>
          <p className="max-w-xs text-sm text-muted-foreground">
            Positions you open show up here with their range, value and fees.
          </p>
          {empty}
        </div>
      ) : (
        <>
          {open.length > 0 && <ul className="flex flex-col gap-3">{open.map(card)}</ul>}
          {closed.length > 0 && (
            <details className="group rounded-xl border" open={open.length === 0 || undefined}>
              <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-4 text-sm font-medium outline-none select-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
                <ChevronRightIcon aria-hidden className="size-4 transition-transform group-open:rotate-90" />
                Closed positions
                <span className="text-muted-foreground tabular-nums">{closed.length}</span>
              </summary>
              <ul className="flex flex-col gap-3 px-3 pb-3">{closed.map(card)}</ul>
            </details>
          )}
        </>
      )}
    </section>
  );
}
