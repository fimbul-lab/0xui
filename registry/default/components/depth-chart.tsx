// Docs: https://0xui.io/components/depth-chart.md
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Skeleton, SkeletonBox } from "skullet/react";
import { SegmentedControl, SegmentedControlItem } from "@/components/primitives/segmented-control";
import { formatPrice, getDepthCurve } from "@/lib/concentrated-liquidity";
import type { LiquidityBin, PairToken } from "@/lib/concentrated-liquidity";
import {
  nextDepthReading,
  niceTicks,
  readDepth,
  sampleDepth,
  signedPercent as signed,
} from "@/lib/depth-chart-core";
import type { DepthReading } from "@/lib/depth-chart-core";
import { compactAmount, liquidityColors } from "@/lib/liquidity-chart-core";
import { cn } from "@/lib/utils";

export { readDepth, sampleDepth, type DepthReading };

const noBins: ReadonlyArray<LiquidityBin> = [];

/** Sample reading the stat tiles are measured from while loading. */
const standIn = (token: PairToken): DepthReading => ({
  percent: 2,
  price: 1,
  amount: 1234.5,
  symbol: token.symbol,
  value: 3_820_000,
});

const compact = (value: number, locale?: string) => compactAmount(value, locale, 1e4);

export type DepthChartProps = {
  /** Bins from `getLiquidityBins`. Pass enough of them to cover `window`. Leave out while loading: shows a skeleton. */
  bins?: ReadonlyArray<LiquidityBin>;
  /** Current price, token1 per token0. Leave out while loading. */
  currentPrice?: number;
  token0: PairToken;
  token1: PairToken;
  /** Quote in token0 instead. */
  invert?: boolean;
  /** Visible price move on each side, in percent. */
  window?: number;
  /** Window options shown as buttons. Pass `[]` to hide them. */
  windows?: Array<number>;
  /** Depth levels shown above the chart and marked on it. */
  level?: number;
  height?: number;
  locale?: string;
  className?: string;
};

/**
 * Market depth of a concentrated liquidity pool, like an order book: how
 * much of each token the pool gives up as the price moves, cumulative from
 * the current price out to both sides. Bids (quote token) on the left,
 * asks (base token) on the right, both valued in the quote token so they
 * share an axis. Headline figures show depth at ±`level`%.
 */
export function DepthChart({
  bins: binsProp,
  currentPrice: priceProp,
  token0,
  token1,
  invert = false,
  window: windowProp,
  windows = [2, 5, 10, 25],
  level = 2,
  height = 180,
  locale,
  className,
}: DepthChartProps) {
  const loading = !binsProp || priceProp === undefined;
  const bins = binsProp ?? noBins;
  const currentPrice = priceProp ?? 1;
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) {
      return;
    }
    setWidth(el.clientWidth);
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const [innerWindow, setInnerWindow] = useState(windowProp ?? 10);
  const span = windowProp ?? innerWindow;
  const [hover, setHover] = useState<number>();
  const id = useId();

  const opts = { invert, token0, token1 };
  const base = invert ? token1 : token0;
  const quote = invert ? token0 : token1;
  const shownPrice = invert ? 1 / currentPrice : currentPrice;

  const samples = useMemo(
    () => sampleDepth(bins, currentPrice, span, { invert, token0, token1 }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bins, currentPrice, span, invert, token0.symbol, token1.symbol],
  );

  // Without bins the curve stays flat; a short curve means the pool runs dry.
  const edge = useMemo(() => getDepthCurve(bins, currentPrice), [bins, currentPrice]);
  const maxValue = Math.max(1e-12, samples.asks.at(-1)!.value, samples.bids.at(-1)!.value);
  const yTicks = niceTicks(maxValue);
  const top = yTicks.at(-1)!;
  const padLeft = 44;
  const plotW = Math.max(0, width - padLeft);
  const x = (percent: number) => padLeft + ((percent + span) / (2 * span)) * plotW;
  const y = (value: number) => height - (value / top) * (height - 8);
  const path = (side: Array<DepthReading>) =>
    side.map((r, i) => `${i ? "L" : "M"}${x(r.percent)},${y(r.value)}`).join("");
  const area = (side: Array<DepthReading>) =>
    `${path(side)}L${x(side.at(-1)!.percent)},${height}L${x(0)},${height}Z`;

  const down = readDepth(bins, currentPrice, -level, opts);
  const up = readDepth(bins, currentPrice, level, opts);
  const reading = hover !== undefined ? readDepth(bins, currentPrice, hover, opts) : undefined;

  const pointer = (clientX: number, rect: DOMRect) => {
    const px = clientX - rect.left;
    if (px < padLeft) {
      return setHover(undefined);
    }
    const percent = ((px - padLeft) / plotW) * 2 * span - span;
    setHover(Math.round(percent * 10) / 10);
  };

  return (
    <div
      data-slot="depth-chart"
      data-loading={loading || undefined}
      className={cn("flex w-full flex-col gap-3 text-sm", className)}
      style={{
        // Bids hold the quote token, asks the base token; colors follow the token.
        ["--lp-bid" as string]: invert ? liquidityColors.token0 : liquidityColors.token1,
        ["--lp-ask" as string]: invert ? liquidityColors.token1 : liquidityColors.token0,
      }}
    >
      <Skeleton loading={loading} label="Loading market depth">
        <div className="grid grid-cols-2 gap-2">
          <DepthStat
            label={`Bids to ${signed(-level)}`}
            reading={loading ? standIn(quote) : down}
            quote={quote.symbol}
            color="var(--lp-bid)"
            locale={locale}
          />
          <DepthStat
            label={`Asks to ${signed(level)}`}
            reading={loading ? standIn(base) : up}
            quote={quote.symbol}
            color="var(--lp-ask)"
            locale={locale}
          />
        </div>
      </Skeleton>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <Key color="var(--lp-bid)" label={`Bids · ${quote.symbol}`} />
          <Key color="var(--lp-ask)" label={`Asks · ${base.symbol}`} />
        </div>
        {windows.length > 0 && windowProp === undefined && (
          <SegmentedControl
            aria-label="Price range shown"
            value={String(span)}
            onValueChange={(next) => next !== null && setInnerWindow(Number(next))}
          >
            {windows.map((w) => (
              <SegmentedControlItem key={w} value={String(w)}>
                ±{w}%
              </SegmentedControlItem>
            ))}
          </SegmentedControl>
        )}
      </div>

      <div ref={ref} className="relative w-full select-none" style={{ height: height + 20 }}>
        {(loading || width === 0) && <SkeletonBox width="100%" height={height} radius={8} />}
        {!loading && width > 0 && (
          <div
            role="group"
            tabIndex={0}
            aria-roledescription="chart"
            aria-label={`Market depth within ±${span}% of ${formatPrice(shownPrice, { locale })} ${quote.symbol} per ${base.symbol}. Use arrow keys to read depth at a price.`}
            aria-describedby={`${id}-readout`}
            className="absolute inset-0 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onPointerMove={(e) => pointer(e.clientX, e.currentTarget.getBoundingClientRect())}
            onPointerLeave={() => setHover(undefined)}
            onBlur={() => setHover(undefined)}
            onKeyDown={(e) => {
              const next = nextDepthReading(e.key, hover, span);
              if (next === undefined) {
                return;
              }
              e.preventDefault();
              setHover(next);
            }}
          >
            <svg width={width} height={height} className="block overflow-visible" aria-hidden>
              {yTicks.map((t) => (
                <g key={t}>
                  <line
                    x1={padLeft}
                    x2={width}
                    y1={y(t)}
                    y2={y(t)}
                    className="stroke-border"
                    strokeWidth={1}
                  />
                  <text
                    x={padLeft - 6}
                    y={y(t)}
                    dy="0.32em"
                    textAnchor="end"
                    className="fill-muted-foreground text-[10px] tabular-nums"
                  >
                    {compact(t, locale)}
                  </text>
                </g>
              ))}
              <path d={area(samples.bids)} fill="var(--lp-bid)" fillOpacity={0.12} />
              <path d={area(samples.asks)} fill="var(--lp-ask)" fillOpacity={0.12} />
              <path
                d={path(samples.bids)}
                fill="none"
                stroke="var(--lp-bid)"
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
              <path
                d={path(samples.asks)}
                fill="none"
                stroke="var(--lp-ask)"
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
              {level < span &&
                [-level, level].map((l) => (
                  <line
                    key={l}
                    x1={x(l)}
                    x2={x(l)}
                    y1={0}
                    y2={height}
                    className="stroke-muted-foreground/40"
                    strokeWidth={1}
                  />
                ))}
              <line
                x1={x(0)}
                x2={x(0)}
                y1={0}
                y2={height}
                className="stroke-foreground"
                strokeWidth={1}
              />
              {reading && (
                <>
                  <line
                    x1={x(reading.percent)}
                    x2={x(reading.percent)}
                    y1={0}
                    y2={height}
                    className="stroke-foreground/50"
                    strokeWidth={1}
                  />
                  <circle
                    cx={x(reading.percent)}
                    cy={y(reading.value)}
                    r={4}
                    fill={reading.percent >= 0 ? "var(--lp-ask)" : "var(--lp-bid)"}
                    className="stroke-background"
                    strokeWidth={2}
                  />
                </>
              )}
            </svg>

            {reading && (
              <div
                className="pointer-events-none absolute top-2 z-10 min-w-40 rounded-md border bg-popover px-2.5 py-2 text-xs text-popover-foreground shadow-md"
                style={{ left: Math.max(padLeft, Math.min(width - 170, x(reading.percent) + 12)) }}
              >
                <div className="font-medium tabular-nums">
                  {compact(reading.amount, locale)} {reading.symbol}
                </div>
                {reading.symbol !== quote.symbol && (
                  <div className="tabular-nums text-muted-foreground">
                    ≈ {compact(reading.value, locale)} {quote.symbol}
                  </div>
                )}
                <div className="mt-0.5 tabular-nums text-muted-foreground">
                  {signed(reading.percent)} · {formatPrice(reading.price, { locale })}{" "}
                  {quote.symbol}
                </div>
              </div>
            )}

            <div
              className="absolute inset-x-0 text-[11px] text-muted-foreground tabular-nums"
              style={{ top: height + 4 }}
              aria-hidden
            >
              {[-span, -span / 2, 0, span / 2, span].map((p) => (
                <span
                  key={p}
                  className={cn(
                    "absolute",
                    p === -span ? "" : p === span ? "-translate-x-full" : "-translate-x-1/2",
                  )}
                  style={{ left: x(p) }}
                >
                  {p === 0 ? formatPrice(shownPrice, { locale }) : signed(p)}
                </span>
              ))}
            </div>
          </div>
        )}
        <p id={`${id}-readout`} className="sr-only" aria-live="polite">
          {reading
            ? `${signed(reading.percent)}: ${compact(reading.amount, locale)} ${reading.symbol}, about ${compact(reading.value, locale)} ${quote.symbol}`
            : ""}
        </p>
        {/* Reachable without hover: the full curve as a table. */}
        {!loading && (
          <table className="sr-only">
            <caption>Cumulative depth by price move</caption>
            <thead>
              <tr>
                <th scope="col">Move</th>
                <th scope="col">Amount</th>
                <th scope="col">Value ({quote.symbol})</th>
              </tr>
            </thead>
            <tbody>
              {[-span, -level, level, span].map((p) => {
                const r = readDepth(bins, currentPrice, p, opts);
                return (
                  <tr key={p}>
                    <td>{signed(p)}</td>
                    <td>
                      {compact(r.amount, locale)} {r.symbol}
                    </td>
                    <td>{compact(r.value, locale)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      {!loading && edge.asks.length + edge.bids.length <= 2 && (
        <p className="text-xs text-muted-foreground">No liquidity around the current price.</p>
      )}
    </div>
  );
}

function DepthStat({
  label,
  reading,
  quote,
  color,
  locale,
}: {
  label: string;
  reading: DepthReading;
  quote: string;
  color: string;
  locale?: string;
}) {
  return (
    <div className="flex flex-col gap-0.5 rounded-lg border bg-background px-3 py-2">
      <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
        <span className="h-0.5 w-3 rounded-full" style={{ background: color }} aria-hidden />
        {label}
      </span>
      <span className="text-lg font-semibold">
        {compact(reading.amount, locale)}{" "}
        <span className="text-sm font-medium text-muted-foreground">{reading.symbol}</span>
      </span>
      {reading.symbol !== quote && (
        <span className="text-xs text-muted-foreground tabular-nums">
          ≈ {compact(reading.value, locale)} {quote}
        </span>
      )}
    </div>
  );
}

function Key({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="h-0.5 w-3 rounded-full" style={{ background: color }} aria-hidden />
      {label}
    </span>
  );
}
