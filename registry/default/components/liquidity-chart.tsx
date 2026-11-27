// Docs: https://0xui.io/components/liquidity-chart.md
import { Slider, SliderControl, SliderThumb, SliderTrack } from "@ui-sdk/react/slider";
import { MinusIcon, PlusIcon, RotateCcwIcon } from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { SkeletonBox } from "skullet/react";
import { Button } from "@/components/primitives/button";
import {
  displayPrice,
  formatPrice,
  moveRangeEdge,
  priceUnit,
  shiftRange,
} from "@/lib/concentrated-liquidity";
import type { LiquidityBin, PairToken, PoolState, TickRange } from "@/lib/concentrated-liquidity";
import {
  barPath,
  chartViewport,
  describeBar,
  formatPriceChange,
  liquidityColors,
  nextBar,
  rangeSlider,
  toBars,
} from "@/lib/liquidity-chart-core";
import { cn } from "@/lib/utils";

export { liquidityColors, type PairToken, type TickRange };

function useElementWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) {
      return;
    }
    setWidth(el.clientWidth);
    const observer = new ResizeObserver(([entry]) => {
      if (entry) {
        setWidth(entry.contentRect.width);
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

/**
 * Visible tick window with zoom. Starts on the bins' extent and zooms
 * around the range's center, or the price when there's no range. The math
 * is `chartViewport` (framework-free).
 */
export function useChartViewport({
  bins,
  currentTick,
  tickSpacing,
  range,
}: {
  bins: ReadonlyArray<LiquidityBin>;
  currentTick: number;
  tickSpacing: number;
  range?: TickRange;
}) {
  const [zoom, setZoom] = useState(1);
  const view = chartViewport({ bins, currentTick, tickSpacing, range, zoom });
  return {
    lower: view.lower,
    upper: view.upper,
    zoom,
    canZoomIn: view.canZoomIn,
    canZoomOut: view.canZoomOut,
    zoomIn: () => setZoom(view.zoomIn),
    zoomOut: () => setZoom(view.zoomOut),
    reset: () => setZoom(1),
  };
}

const noBins: ReadonlyArray<LiquidityBin> = [];

export type LiquidityChartProps = {
  /** Bins from `getLiquidityBins(pool, ticks)`. Leave out while they load: the plot shows a skeleton. */
  bins?: ReadonlyArray<LiquidityBin>;
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
 * draggable: the handles are a ui-sdk range slider over the visible window.
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
  const viewport = useChartViewport({
    bins,
    currentTick: pool.tick,
    tickSpacing: pool.tickSpacing,
    range,
  });
  const { lower, upper } = viewport;
  const bars = useMemo(() => toBars(bins, lower, upper, width), [bins, lower, upper, width]);
  const maxLiquidity = Math.max(1, ...bars.map((b) => b.liquidity));
  const [active, setActive] = useState<number>();
  const id = useId();

  const unit = priceUnit(token0, token1, invert);
  const price = useCallback((tick: number) => displayPrice(tick, pool, invert), [invert, pool]);
  const span = upper - lower;
  const x = useCallback(
    (tick: number) => ((invert ? upper - tick : tick - lower) / span) * width,
    [invert, lower, upper, span, width],
  );
  const tickAt = useCallback(
    (px: number) => (invert ? upper - (px / width) * span : lower + (px / width) * span),
    [invert, lower, upper, span, width],
  );
  const y = (liquidity: number) => height - (liquidity / maxLiquidity) * (height - 8);

  const activeBar = active !== undefined ? bars[active] : undefined;
  const barAt = (px: number) => {
    const tick = tickAt(px);
    const i = bars.findIndex((b) => tick >= b.tickLower && tick < b.tickUpper);
    return i === -1 ? undefined : i;
  };

  const gap =
    width / Math.max(1, bars.length) >= 6 ? 2 : width / Math.max(1, bars.length) >= 3 ? 1 : 0;
  const axisTicks = width > 0 ? [0.1, 0.3, 0.5, 0.7, 0.9].map((f) => f * width) : [];
  const currentX = x(pool.tick);
  const inView = currentX >= 0 && currentX <= width;
  const tooltip = activeBar
    ? describeBar(activeBar, { price, token0, token1, unit, locale })
    : undefined;
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
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Zoom in"
              disabled={loading || !viewport.canZoomIn}
              onClick={viewport.zoomIn}
            >
              <PlusIcon />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Zoom out"
              disabled={!viewport.canZoomOut}
              onClick={viewport.zoomOut}
            >
              <MinusIcon />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Reset zoom"
              disabled={!viewport.canZoomOut}
              onClick={viewport.reset}
            >
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
            {/* A chart, not a widget: focus it and arrow keys read each bar into the live region. */}
            {/* oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- keys only read bars aloud, so `group` stays its honest role */}
            <div
              role="group"
              // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- focus is how arrow keys reach the bars
              tabIndex={0}
              aria-roledescription="chart"
              aria-label={`Liquidity by price, ${unit}. Current price ${formatPrice(price(pool.tick), { locale })}. Use arrow keys to read each bar.`}
              aria-describedby={`${id}-readout`}
              className="absolute inset-x-0 top-0 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
              style={{ height }}
              onKeyDown={(event) => {
                const next = nextBar(event.key, bars, active, invert);
                if (next === undefined) {
                  return;
                }
                event.preventDefault();
                setActive(next);
              }}
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
                    width={Math.max(
                      0,
                      Math.min(width, Math.max(x(range.tickLower), x(range.tickUpper))) -
                        Math.max(0, Math.min(x(range.tickLower), x(range.tickUpper))),
                    )}
                    y={0}
                    height={height}
                    className="fill-foreground/[0.04]"
                  />
                )}
                <line
                  x1={0}
                  x2={width}
                  y1={height}
                  y2={height}
                  className="stroke-border"
                  strokeWidth={1}
                />
                {bars.map((bar, i) => {
                  const x0 = Math.min(x(bar.tickLower), x(bar.tickUpper));
                  const w = Math.max(0.5, Math.abs(x(bar.tickUpper) - x(bar.tickLower)) - gap);
                  const top = y(bar.liquidity);
                  const outside =
                    range && (bar.tickUpper <= range.tickLower || bar.tickLower >= range.tickUpper);
                  // The current bar holds both tokens: split it at the price.
                  if (bar.isCurrent && bar.amount0 > 0 && bar.amount1 > 0) {
                    const split = Math.max(x0, Math.min(x0 + w, currentX));
                    const [left, right] = invert
                      ? [liquidityColors.token0, liquidityColors.token1]
                      : [liquidityColors.token1, liquidityColors.token0];
                    return (
                      <g key={bar.tickLower} opacity={active === i ? 0.8 : outside ? 0.3 : 1}>
                        <path d={barPath(x0, top, split - x0, height - top, 0)} fill={left} />
                        <path
                          d={barPath(split, top, x0 + w - split, height - top, 0)}
                          fill={right}
                        />
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
                  <line
                    x1={currentX}
                    x2={currentX}
                    y1={0}
                    y2={height}
                    className="stroke-foreground"
                    strokeWidth={1}
                  />
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
                lower={lower}
                upper={upper}
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
                  <div key={line} className="font-medium tabular-nums">
                    {line}
                  </div>
                ))}
                <div className="mt-0.5 text-muted-foreground tabular-nums">{tooltip.range}</div>
              </div>
            )}

            <div
              className="absolute inset-x-0 text-[11px] text-muted-foreground tabular-nums"
              style={{ top: height + 4 }}
              aria-hidden
            >
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

type HandleProps = {
  range: TickRange;
  onRangeChange: (range: TickRange) => void;
  tickSpacing: number;
  currentTick: number;
  lower: number;
  upper: number;
  x: (tick: number) => number;
  tickAt: (px: number) => number;
  width: number;
  height: number;
  invert: boolean;
  price: (tick: number) => number;
  unit: string;
  locale?: string;
};

/** Pointer x relative to the plot the dragged band sits in. */
function localX(event: ReactPointerEvent<HTMLElement>) {
  const plot = event.currentTarget.parentElement;
  if (!plot) {
    throw new Error("The range band must be rendered inside the chart.");
  }
  return event.clientX - plot.getBoundingClientRect().left;
}

/**
 * The range's two handles as a ui-sdk range slider laid over the plot, plus
 * a draggable band between them. Arrows move one tick spacing, Page Up/Down
 * ten. The left handle is always the min displayed price, so under `invert`
 * it moves `tickUpper`. A handle outside the window waits on the edge.
 */
function RangeHandles({
  range,
  onRangeChange,
  tickSpacing,
  currentTick,
  lower,
  upper,
  x,
  tickAt,
  width,
  height,
  invert,
  price,
  unit,
  locale,
}: HandleProps) {
  const slider = rangeSlider(range, lower, upper, tickSpacing, invert);
  const edges = invert
    ? (["tickUpper", "tickLower"] as const)
    : (["tickLower", "tickUpper"] as const);
  const band = useRef<{ startTick: number; range: TickRange } | null>(null);

  const bandLeft = Math.max(0, Math.min(x(range.tickLower), x(range.tickUpper)));
  const bandRight = Math.min(width, Math.max(x(range.tickLower), x(range.tickUpper)));

  return (
    <>
      <div
        aria-hidden
        className="absolute top-0 cursor-grab touch-none active:cursor-grabbing"
        style={{ left: bandLeft + 12, width: Math.max(0, bandRight - bandLeft - 24), height }}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          band.current = { startTick: tickAt(localX(event)), range };
        }}
        onPointerMove={(event) => {
          const drag = band.current;
          if (!drag) {
            return;
          }
          const next = shiftRange(drag.range, tickAt(localX(event)) - drag.startTick, tickSpacing);
          if (next) {
            onRangeChange(next);
          }
        }}
        onPointerUp={() => (band.current = null)}
        onPointerCancel={() => (band.current = null)}
      />
      <Slider
        aria-label="Price range"
        value={slider.value}
        min={slider.min}
        max={slider.max}
        step={tickSpacing}
        largeStep={tickSpacing * 10}
        minStepsBetweenThumbs={1}
        format={(value) => `${formatPrice(price(slider.tickOf(value)), { locale })} ${unit}`}
        onValueChange={(value, details) => {
          const thumb = details.thumb === 1 ? 1 : 0;
          onRangeChange(
            moveRangeEdge(range, edges[thumb], slider.tickOf(value[thumb]), tickSpacing),
          );
        }}
        className="pointer-events-none absolute inset-x-0 top-0"
        style={{ height }}
      >
        <SliderControl className="pointer-events-none h-full">
          <SliderTrack className="h-full w-full">
            {edges.map((edge, index) => {
              const offscreen = slider.offscreen[index];
              const px = Math.max(0, Math.min(width, x(range[edge])));
              return (
                <SliderThumb
                  key={edge}
                  index={index}
                  aria-label={index === 0 ? "Min price" : "Max price"}
                  data-edge={edge === "tickLower" ? "lower" : "upper"}
                  data-offscreen={offscreen || undefined}
                  className="group pointer-events-auto flex h-full w-6 cursor-ew-resize touch-none justify-center outline-none"
                >
                  <span className={cn("h-full w-0.5 bg-foreground", offscreen && "opacity-40")} />
                  <span className="absolute top-1/2 h-6 w-3 -translate-y-1/2 rounded-sm border-2 border-background bg-foreground group-has-[:focus-visible]:ring-2 group-has-[:focus-visible]:ring-ring group-has-[:focus-visible]:ring-offset-1" />
                  <span
                    aria-hidden
                    className={cn(
                      "pointer-events-none absolute bottom-1 whitespace-nowrap rounded-sm bg-background/90 px-1 text-[11px] font-medium tabular-nums",
                      px > width / 2 ? "right-full mr-0.5" : "left-full ml-0.5",
                    )}
                  >
                    {formatPriceChange(price(range[edge]), price(currentTick))}
                  </span>
                </SliderThumb>
              );
            })}
          </SliderTrack>
        </SliderControl>
      </Slider>
    </>
  );
}
