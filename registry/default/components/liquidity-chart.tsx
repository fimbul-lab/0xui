// Docs: https://0xui.io/components/liquidity-chart.md
import { MinusIcon, PlusIcon, RotateCcwIcon } from "lucide-react";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { SkeletonBox } from "skullet/react";
import { Button } from "@/components/ui/button";
import {
  formatPrice,
  tickToPrice,
  usableTickBounds,
  type LiquidityBin,
  type PoolState,
} from "@/lib/concentrated-liquidity";
import { cn } from "@/lib/utils";

/** A position's range in ticks. `tickLower` < `tickUpper`, both multiples of the spacing. */
export type TickRange = { tickLower: number; tickUpper: number };

/** Symbol is all the chart needs; any `Token` fits. */
export type PairToken = { symbol: string };

/**
 * Colors for the two sides. Teal and violet pass the colorblind and
 * contrast checks on light and dark surfaces. Override with
 * `--lp-token0` / `--lp-token1` on any parent.
 */
export const liquidityColors = {
  token0: "var(--lp-token0, #0d9488)",
  token1: "var(--lp-token1, #8b5cf6)",
} as const;

/* ------------------------------------------------------------------------ */
/* Viewport                                                                  */
/* ------------------------------------------------------------------------ */

function useElementWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

/**
 * Visible tick window with zoom. Starts on the bins' extent (or the range,
 * when one is set and narrower) and zooms around the range's center, or the
 * price when there's no range.
 */
export function useChartViewport({
  bins,
  currentTick,
  tickSpacing,
  range,
}: {
  bins: readonly LiquidityBin[];
  currentTick: number;
  tickSpacing: number;
  range?: TickRange;
}) {
  const extent = useMemo(() => {
    if (!bins.length) return { lower: currentTick - 100 * tickSpacing, upper: currentTick + 100 * tickSpacing };
    return { lower: bins[0].tickLower, upper: bins[bins.length - 1].tickUpper };
  }, [bins, currentTick, tickSpacing]);
  const fullSpan = extent.upper - extent.lower;
  const minSpan = tickSpacing * 8;
  const [zoom, setZoom] = useState(1);
  const span = Math.max(minSpan, fullSpan / zoom);

  const rangeCenter = range ? (range.tickLower + range.tickUpper) / 2 : undefined;
  const { min, max } = usableTickBounds(tickSpacing);
  const isFull = range ? range.tickLower <= min && range.tickUpper >= max : false;
  // Center on the range unless it's wider than the view (full range).
  const center =
    rangeCenter !== undefined && !isFull && range!.tickUpper - range!.tickLower < span
      ? rangeCenter
      : currentTick;
  let lower = center - span / 2;
  let upper = center + span / 2;
  if (zoom === 1) {
    lower = extent.lower;
    upper = extent.upper;
  }
  return {
    lower,
    upper,
    zoom,
    canZoomIn: span > minSpan,
    canZoomOut: zoom > 1,
    zoomIn: () => setZoom((z) => Math.min(z * 1.6, fullSpan / minSpan)),
    zoomOut: () => setZoom((z) => Math.max(1, z / 1.6)),
    reset: () => setZoom(1),
  };
}

type Bar = {
  tickLower: number;
  tickUpper: number;
  liquidity: number;
  amount0: number;
  amount1: number;
  isCurrent: boolean;
};

const noBins: readonly LiquidityBin[] = [];

/** Merge neighboring bins so every bar is at least `minWidth` px wide. */
function toBars(bins: readonly LiquidityBin[], lower: number, upper: number, width: number, minWidth = 3): Bar[] {
  const visible = bins.filter((b) => b.tickUpper > lower && b.tickLower < upper);
  const perBar = Math.max(1, Math.ceil(visible.length / Math.max(1, Math.floor(width / minWidth))));
  const bars: Bar[] = [];
  for (let i = 0; i < visible.length; i += perBar) {
    const group = visible.slice(i, i + perBar);
    bars.push({
      tickLower: group[0].tickLower,
      tickUpper: group[group.length - 1].tickUpper,
      // Average, so merged bars stay on the same scale as single ones.
      liquidity: group.reduce((s, b) => s + Number(b.liquidity), 0) / group.length,
      amount0: group.reduce((s, b) => s + b.amount0, 0),
      amount1: group.reduce((s, b) => s + b.amount1, 0),
      isCurrent: group.some((b) => b.isCurrent),
    });
  }
  return bars;
}

/** Bar with rounded top corners, square at the baseline. */
function barPath(x: number, y: number, w: number, h: number, r: number) {
  const radius = Math.max(0, Math.min(r, w / 2, h));
  if (radius === 0) return `M${x},${y + h}V${y}H${x + w}V${y + h}Z`;
  return `M${x},${y + h}V${y + radius}Q${x},${y} ${x + radius},${y}H${x + w - radius}Q${x + w},${y} ${x + w},${y + radius}V${y + h}Z`;
}

const compact = (value: number, locale?: string) =>
  new Intl.NumberFormat(locale, { notation: value >= 1e5 ? "compact" : "standard", maximumSignificantDigits: 4 }).format(value);

/* ------------------------------------------------------------------------ */
/* Chart                                                                     */
/* ------------------------------------------------------------------------ */

export type LiquidityChartProps = {
  /** Bins from `getLiquidityBins(pool, ticks)`. Leave out while they load: the plot shows a skeleton. */
  bins?: readonly LiquidityBin[];
  /** Current tick, spacing and decimals. */
  pool: Pick<PoolState, "tick" | "tickSpacing" | "decimals0" | "decimals1">;
  token0: PairToken;
  token1: PairToken;
  /** Show prices as token0 per token1 and flip the axis. */
  invert?: boolean;
  /** Range to highlight. Bars outside it fade. */
  range?: TickRange;
  /** Makes the range handles draggable. Ticks arrive snapped to the spacing. */
  onRangeChange?: (range: TickRange) => void;
  /** Plot height in px, axis excluded. */
  height?: number;
  /** Show the legend and zoom buttons. */
  showControls?: boolean;
  locale?: string;
  className?: string;
};

/**
 * Liquidity distribution of a concentrated liquidity pool: one bar per tick
 * range, token0 above the price and token1 below it in their own colors,
 * a line at the current price, and a tooltip with the tokens locked in each
 * bar. Pass `range` to highlight a position and `onRangeChange` to make it
 * draggable with pointer or keyboard.
 */
export function LiquidityChart({
  bins: binsProp,
  pool,
  token0,
  token1,
  invert = false,
  range,
  onRangeChange,
  height = 160,
  showControls = true,
  locale,
  className,
}: LiquidityChartProps) {
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const loading = !binsProp;
  const bins = binsProp ?? noBins;
  const viewport = useChartViewport({ bins, currentTick: pool.tick, tickSpacing: pool.tickSpacing, range });
  const { lower, upper } = viewport;
  const bars = useMemo(() => toBars(bins, lower, upper, width), [bins, lower, upper, width]);
  const maxLiquidity = Math.max(1, ...bars.map((b) => b.liquidity));
  const [active, setActive] = useState<number>();
  const id = useId();

  const base = invert ? token1 : token0;
  const quote = invert ? token0 : token1;
  const unit = `${quote.symbol} per ${base.symbol}`;
  const price = useCallback(
    (tick: number) => {
      const p = tickToPrice(tick, pool.decimals0, pool.decimals1);
      return invert ? 1 / p : p;
    },
    [invert, pool.decimals0, pool.decimals1]
  );
  const span = upper - lower;
  const x = useCallback(
    (tick: number) => ((invert ? upper - tick : tick - lower) / span) * width,
    [invert, lower, upper, span, width]
  );
  const tickAt = useCallback(
    (px: number) => (invert ? upper - (px / width) * span : lower + (px / width) * span),
    [invert, lower, upper, span, width]
  );
  const y = (liquidity: number) => height - (liquidity / maxLiquidity) * (height - 8);

  const activeBar = active !== undefined ? bars[active] : undefined;
  const barAt = (px: number) => {
    const tick = tickAt(px);
    const i = bars.findIndex((b) => tick >= b.tickLower && tick < b.tickUpper);
    return i === -1 ? undefined : i;
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (!bars.length) return;
    const current = bars.findIndex((b) => b.isCurrent);
    const from = active ?? (current === -1 ? 0 : current);
    // Left/right follow the screen, so they flip with the axis.
    const dir = invert ? -1 : 1;
    const next: Record<string, number> = {
      ArrowRight: from + dir,
      ArrowLeft: from - dir,
      Home: invert ? bars.length - 1 : 0,
      End: invert ? 0 : bars.length - 1,
    };
    if (!(event.key in next)) return;
    event.preventDefault();
    setActive(Math.max(0, Math.min(bars.length - 1, next[event.key])));
  };

  const describe = (bar: Bar) => {
    const [a, b] = [price(bar.tickLower), price(bar.tickUpper)].sort((m, n) => m - n);
    const amounts = [
      bar.amount0 > 0 && `${compact(bar.amount0, locale)} ${token0.symbol}`,
      bar.amount1 > 0 && `${compact(bar.amount1, locale)} ${token1.symbol}`,
    ].filter((line): line is string => Boolean(line));
    return {
      amounts: amounts.length ? amounts : ["No liquidity"],
      range: `${formatPrice(a, { locale })} – ${formatPrice(b, { locale })} ${unit}`,
    };
  };

  const gap = width / Math.max(1, bars.length) >= 6 ? 2 : width / Math.max(1, bars.length) >= 3 ? 1 : 0;
  const axisTicks = width > 0 ? [0.1, 0.3, 0.5, 0.7, 0.9].map((f) => f * width) : [];
  const currentX = x(pool.tick);
  const inView = currentX >= 0 && currentX <= width;
  const tooltip = activeBar ? describe(activeBar) : undefined;
  const tooltipX = activeBar ? (x(activeBar.tickLower) + x(activeBar.tickUpper)) / 2 : 0;

  return (
    <div
      data-slot="liquidity-chart"
      data-loading={loading || undefined}
      className={cn("flex w-full flex-col gap-2 text-sm", className)}
    >
      {showControls && (
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <LegendKey color={liquidityColors.token0} label={token0.symbol} />
            <LegendKey color={liquidityColors.token1} label={token1.symbol} />
          </div>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon-sm" aria-label="Zoom in" disabled={loading || !viewport.canZoomIn} onClick={viewport.zoomIn}>
              <PlusIcon />
            </Button>
            <Button variant="ghost" size="icon-sm" aria-label="Zoom out" disabled={!viewport.canZoomOut} onClick={viewport.zoomOut}>
              <MinusIcon />
            </Button>
            <Button variant="ghost" size="icon-sm" aria-label="Reset zoom" disabled={!viewport.canZoomOut} onClick={viewport.reset}>
              <RotateCcwIcon />
            </Button>
          </div>
        </div>
      )}

      <div ref={ref} className="relative w-full select-none" style={{ height: height + 20 }}>
        {(loading || width === 0) && (
          // Before the data, and on the server before the width is known.
          <>
            <SkeletonBox width="100%" height={height} radius={8} />
            <span className="sr-only">Loading liquidity</span>
          </>
        )}
        {!loading && width > 0 && (
          <>
            <div
              role="group"
              tabIndex={0}
              aria-roledescription="chart"
              aria-label={`Liquidity by price, ${unit}. Current price ${formatPrice(price(pool.tick), { locale })}. Use arrow keys to read each bar.`}
              aria-describedby={`${id}-readout`}
              className="absolute inset-x-0 top-0 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
              style={{ height }}
              onKeyDown={onKeyDown}
              onBlur={() => setActive(undefined)}
              onPointerMove={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                setActive(barAt(e.clientX - rect.left));
              }}
              onPointerLeave={() => setActive(undefined)}
            >
              <svg width={width} height={height} className="block overflow-visible" aria-hidden>
                {range && (
                  <rect
                    x={Math.max(0, Math.min(x(range.tickLower), x(range.tickUpper)))}
                    width={Math.max(0, Math.min(width, Math.max(x(range.tickLower), x(range.tickUpper))) - Math.max(0, Math.min(x(range.tickLower), x(range.tickUpper))))}
                    y={0}
                    height={height}
                    className="fill-foreground/[0.04]"
                  />
                )}
                <line x1={0} x2={width} y1={height} y2={height} className="stroke-border" strokeWidth={1} />
                {bars.map((bar, i) => {
                  const x0 = Math.min(x(bar.tickLower), x(bar.tickUpper));
                  const w = Math.max(0.5, Math.abs(x(bar.tickUpper) - x(bar.tickLower)) - gap);
                  const top = y(bar.liquidity);
                  const outside = range && (bar.tickUpper <= range.tickLower || bar.tickLower >= range.tickUpper);
                  // The current bar holds both tokens: split it at the price.
                  if (bar.isCurrent && bar.amount0 > 0 && bar.amount1 > 0) {
                    const split = Math.max(x0, Math.min(x0 + w, currentX));
                    const [left, right] = invert ? [liquidityColors.token0, liquidityColors.token1] : [liquidityColors.token1, liquidityColors.token0];
                    return (
                      <g key={bar.tickLower} opacity={active === i ? 0.8 : outside ? 0.3 : 1}>
                        <path d={barPath(x0, top, split - x0, height - top, 0)} fill={left} />
                        <path d={barPath(split, top, x0 + w - split, height - top, 0)} fill={right} />
                      </g>
                    );
                  }
                  const fill = bar.amount0 > 0 ? liquidityColors.token0 : liquidityColors.token1;
                  return (
                    <path
                      key={bar.tickLower}
                      d={barPath(x0, top, w, height - top, w >= 8 ? 4 : w >= 4 ? 1 : 0)}
                      fill={fill}
                      opacity={active === i ? 0.8 : outside ? 0.3 : 1}
                    />
                  );
                })}
                {inView && (
                  <line x1={currentX} x2={currentX} y1={0} y2={height} className="stroke-foreground" strokeWidth={1} />
                )}
              </svg>
              {inView && (
                <span
                  className="pointer-events-none absolute top-0 -translate-x-1/2 rounded-sm bg-foreground px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-background"
                  style={{ left: Math.max(36, Math.min(width - 36, currentX)) }}
                >
                  {formatPrice(price(pool.tick), { locale })}
                </span>
              )}
            </div>

            {range && onRangeChange && (
              <RangeHandles
                range={range}
                onRangeChange={onRangeChange}
                tickSpacing={pool.tickSpacing}
                currentTick={pool.tick}
                x={x}
                tickAt={tickAt}
                width={width}
                height={height}
                invert={invert}
                price={price}
                unit={unit}
                locale={locale}
              />
            )}

            {tooltip && (
              <div
                className="pointer-events-none absolute z-10 min-w-36 rounded-md border bg-popover px-2.5 py-2 text-xs text-popover-foreground shadow-md"
                style={{
                  top: 24,
                  left: Math.max(0, Math.min(width - 160, tooltipX + 12)),
                }}
              >
                {tooltip.amounts.map((line) => (
                  <div key={line} className="font-medium tabular-nums">{line}</div>
                ))}
                <div className="mt-0.5 text-muted-foreground tabular-nums">{tooltip.range}</div>
              </div>
            )}

            <div className="absolute inset-x-0 text-[11px] text-muted-foreground tabular-nums" style={{ top: height + 4 }} aria-hidden>
              {axisTicks.map((px) => (
                <span key={px} className="absolute -translate-x-1/2" style={{ left: px }}>
                  {formatPrice(price(tickAt(px)), { locale })}
                </span>
              ))}
            </div>
          </>
        )}
        <p id={`${id}-readout`} className="sr-only" aria-live="polite">
          {tooltip ? `${tooltip.amounts.join(", ")}, ${tooltip.range}` : ""}
        </p>
      </div>
    </div>
  );
}

function LegendKey({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="size-2.5 rounded-[3px]" style={{ background: color }} aria-hidden />
      {label}
    </span>
  );
}

/* ------------------------------------------------------------------------ */
/* Range handles                                                             */
/* ------------------------------------------------------------------------ */

type HandleProps = {
  range: TickRange;
  onRangeChange: (range: TickRange) => void;
  tickSpacing: number;
  currentTick: number;
  x: (tick: number) => number;
  tickAt: (px: number) => number;
  width: number;
  height: number;
  invert: boolean;
  price: (tick: number) => number;
  unit: string;
  locale?: string;
};

/**
 * Two draggable handles and a draggable band between them. Each handle is a
 * slider: arrows move one tick spacing, Page Up/Down ten. Under `invert` the
 * left handle is the upper tick, so arrows still match the screen.
 */
function RangeHandles({
  range,
  onRangeChange,
  tickSpacing,
  currentTick,
  x,
  tickAt,
  width,
  height,
  invert,
  price,
  unit,
  locale,
}: HandleProps) {
  const { min, max } = usableTickBounds(tickSpacing);
  const drag = useRef<{ edge: "lower" | "upper" | "band"; startTick: number; range: TickRange } | null>(null);
  const snap = (tick: number) => Math.round(tick / tickSpacing) * tickSpacing;

  const set = useCallback(
    (edge: "lower" | "upper", tick: number) => {
      const t = Math.max(min, Math.min(max, snap(tick)));
      if (edge === "lower") onRangeChange({ tickLower: Math.min(t, range.tickUpper - tickSpacing), tickUpper: range.tickUpper });
      else onRangeChange({ tickLower: range.tickLower, tickUpper: Math.max(t, range.tickLower + tickSpacing) });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [min, max, onRangeChange, range.tickLower, range.tickUpper, tickSpacing]
  );

  const localX = (event: ReactPointerEvent) => {
    const parent = (event.currentTarget as HTMLElement).parentElement!.getBoundingClientRect();
    return event.clientX - parent.left;
  };
  const start = (edge: "lower" | "upper" | "band") => (event: ReactPointerEvent<HTMLElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { edge, startTick: tickAt(localX(event)), range };
  };
  const move = (event: ReactPointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d) return;
    const tick = tickAt(localX(event));
    if (d.edge === "band") {
      const shift = snap(tick - d.startTick);
      const lo = d.range.tickLower + shift;
      const hi = d.range.tickUpper + shift;
      if (lo >= min && hi <= max) onRangeChange({ tickLower: lo, tickUpper: hi });
    } else set(d.edge, tick);
  };
  const end = () => (drag.current = null);

  const keys = (edge: "lower" | "upper") => (event: KeyboardEvent) => {
    const value = edge === "lower" ? range.tickLower : range.tickUpper;
    // Right on screen is a higher tick, or a lower one when inverted.
    const dir = invert ? -1 : 1;
    const steps: Record<string, number> = {
      ArrowRight: dir,
      ArrowUp: dir,
      ArrowLeft: -dir,
      ArrowDown: -dir,
      PageUp: 10 * dir,
      PageDown: -10 * dir,
    };
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      set(edge, (event.key === "Home") !== invert ? min : max);
      return;
    }
    if (!(event.key in steps)) return;
    event.preventDefault();
    set(edge, value + steps[event.key] * tickSpacing);
  };

  const clampX = (px: number) => Math.max(0, Math.min(width, px));
  const xs = { lower: x(range.tickLower), upper: x(range.tickUpper) };
  const bandLeft = clampX(Math.min(xs.lower, xs.upper));
  const bandRight = clampX(Math.max(xs.lower, xs.upper));
  const percent = (tick: number) => {
    const change = (price(tick) / price(currentTick) - 1) * 100;
    if (!Number.isFinite(change) || Math.abs(change) > 9999) return change > 0 ? "∞" : "−100%";
    return `${change > 0 ? "+" : change < 0 ? "−" : ""}${Math.abs(change).toFixed(Math.abs(change) < 10 ? 2 : 1)}%`;
  };

  return (
    <>
      <div
        aria-hidden
        className="absolute top-0 cursor-grab active:cursor-grabbing"
        style={{ left: bandLeft + 12, width: Math.max(0, bandRight - bandLeft - 24), height }}
        onPointerDown={start("band")}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
      />
      {(["lower", "upper"] as const).map((edge) => {
        const tick = edge === "lower" ? range.tickLower : range.tickUpper;
        const px = xs[edge];
        const offscreen = px < 0 || px > width;
        // Price at this tick, in the displayed direction.
        const value = price(tick);
        const isMinLabel = (edge === "lower") !== invert;
        return (
          <div
            key={edge}
            role="slider"
            tabIndex={0}
            aria-label={isMinLabel ? "Min price" : "Max price"}
            aria-orientation="horizontal"
            aria-valuemin={min}
            aria-valuemax={max}
            aria-valuenow={tick}
            aria-valuetext={`${formatPrice(value, { locale })} ${unit}`}
            data-edge={edge}
            data-offscreen={offscreen || undefined}
            className="group absolute top-0 flex w-6 -translate-x-1/2 cursor-ew-resize touch-none justify-center outline-none"
            style={{ left: clampX(px), height }}
            onPointerDown={start(edge)}
            onPointerMove={move}
            onPointerUp={end}
            onPointerCancel={end}
            onKeyDown={keys(edge)}
          >
            <span className={cn("h-full w-0.5 bg-foreground", offscreen && "opacity-40")} />
            <span className="absolute top-1/2 h-6 w-3 -translate-y-1/2 rounded-sm border-2 border-background bg-foreground group-focus-visible:ring-2 group-focus-visible:ring-ring group-focus-visible:ring-offset-1" />
            <span
              className={cn(
                "pointer-events-none absolute bottom-1 whitespace-nowrap rounded-sm bg-background/90 px-1 text-[11px] font-medium tabular-nums",
                px > width / 2 ? "right-full mr-0.5" : "left-full ml-0.5"
              )}
            >
              {percent(tick)}
            </span>
          </div>
        );
      })}
    </>
  );
}
