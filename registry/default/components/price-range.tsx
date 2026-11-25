// Docs: https://0xui.io/components/price-range.md
import { Input } from "@ui-sdk/react/input";
import { MinusIcon, PlusIcon } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";
import { Skeleton } from "skullet/react";
import { LiquidityChart } from "@/components/liquidity-chart";
import { Button } from "@/components/primitives/button";
import { Field, FieldLabel } from "@/components/primitives/field";
import { SegmentedControl, SegmentedControlItem } from "@/components/primitives/segmented-control";
import {
  formatPrice,
  priceUnit,
  type LiquidityBin,
  type PairToken,
  type TickRange,
} from "@/lib/concentrated-liquidity";
import {
  activePreset,
  defaultRange,
  defaultRangePresets,
  formatEdgeChange,
  getPriceRangeState,
  parsePriceInput,
  presetRange,
  rangeEdgePrice,
  rangeWithPrice,
  stepRangeEdge,
  type RangeEdge,
  type RangePool,
  type RangePreset,
} from "@/lib/price-range-core";
import { cn } from "@/lib/utils";

export {
  activePreset,
  defaultRange,
  defaultRangePresets,
  parsePriceInput,
  presetRange,
  rangeWithPrice,
  stepRangeEdge,
  type RangeEdge,
  type RangePreset,
};

/**
 * Range state for a new position, controlled or not. Works in ticks, so
 * every value is one the pool accepts; the displayed min and max map onto
 * them through `price-range-core` (framework-free), including when the
 * price is inverted (then min is `tickUpper`).
 */
export function usePriceRange({
  pool,
  value,
  defaultValue,
  onValueChange,
  invert = false,
}: {
  pool: RangePool;
  /** Controlled range. */
  value?: TickRange;
  /** Starting range. Defaults to ±10% (±0.1% for stable spacings). */
  defaultValue?: TickRange;
  onValueChange?: (range: TickRange) => void;
  invert?: boolean;
}) {
  const [inner, setInner] = useState<TickRange>(() => defaultValue ?? defaultRange(pool, invert));
  const range = value ?? inner;
  const setRange = (next: TickRange | undefined) => {
    if (!next) return;
    if (value === undefined) setInner(next);
    onValueChange?.(next);
  };
  return {
    range,
    setRange,
    ...getPriceRangeState(range, pool, invert),
    /** Displayed price at an edge: 0 / ∞ for full range. */
    priceOf: (edge: RangeEdge) => rangeEdgePrice(range, edge, pool, invert),
    isPreset: (preset: RangePreset) => activePreset([preset], range, pool, invert) !== undefined,
    /** Set an edge from a typed price in the displayed direction. */
    setPrice: (edge: RangeEdge, price: number) => setRange(rangeWithPrice(range, edge, price, pool, invert)),
    /** Move an edge one tick spacing up (+1) or down (−1) in displayed price. */
    step: (edge: RangeEdge, direction: 1 | -1) => setRange(stepRangeEdge(range, edge, direction, pool, invert)),
    applyPreset: (preset: RangePreset) => setRange(presetRange(preset, pool, invert)),
  };
}

/** Stand-in pool the loading skeleton is measured from. */
const samplePool: RangePool = { tick: 0, tickSpacing: 10, decimals0: 18, decimals1: 18 };

export type PriceRangeProps = {
  /** Current tick, spacing and decimals. Leave out while it loads: the panel shows a skeleton. */
  pool?: RangePool;
  /** Liquidity bins for the chart, from `getLiquidityBins`. Leave out while they load: the chart shows a skeleton. */
  bins?: readonly LiquidityBin[];
  /** Show the liquidity chart. Turn off for a compact form. */
  showChart?: boolean;
  token0: PairToken;
  token1: PairToken;
  value?: TickRange;
  defaultValue?: TickRange;
  onValueChange?: (range: TickRange) => void;
  /** Quote prices in token0 (e.g. ETH per USDC). Controlled. */
  invert?: boolean;
  /** Starting direction when `invert` isn't controlled. */
  defaultInvert?: boolean;
  onInvertChange?: (invert: boolean) => void;
  /** Preset options. Defaults depend on the tick spacing. Pass `[]` to hide. */
  presets?: RangePreset[];
  title?: ReactNode;
  locale?: string;
  className?: string;
};

/**
 * "Set price range" panel for a new concentrated liquidity position:
 * the pool's liquidity chart with draggable handles, presets, min and max
 * price fields with tick steppers, a token toggle to flip the quote, and a
 * notice when the range sits outside the price and only takes one token.
 */
export function PriceRange({ pool, className, ...props }: PriceRangeProps) {
  return (
    <Skeleton data={pool} sample={samplePool} label="Loading pool" className={cn("w-full", className)}>
      {(p) => (
        // A new instance once the real pool lands, so the range starts from its price.
        <PriceRangeView key={p === samplePool ? "sample" : "pool"} {...props} pool={p} loadingPool={p === samplePool} />
      )}
    </Skeleton>
  );
}

function PriceRangeView({
  pool,
  loadingPool,
  bins,
  showChart = true,
  token0,
  token1,
  value,
  defaultValue,
  onValueChange,
  invert: invertProp,
  defaultInvert = false,
  onInvertChange,
  presets = defaultRangePresets(pool.tickSpacing),
  title = "Set price range",
  locale,
  className,
}: PriceRangeProps & { pool: RangePool; loadingPool: boolean }) {
  const [innerInvert, setInnerInvert] = useState(defaultInvert);
  const invert = invertProp ?? innerInvert;
  const setInvert = (next: boolean) => {
    if (invertProp === undefined) setInnerInvert(next);
    onInvertChange?.(next);
  };
  const state = usePriceRange({ pool, value, defaultValue, onValueChange, invert });
  const unit = priceUnit(token0, token1, invert);
  const single = state.depositMode === "both" ? undefined : state.depositMode === "token0" ? token0 : token1;
  const preset = activePreset(presets, state.range, pool, invert);

  return (
    <section
      data-slot="price-range"
      data-deposit-mode={state.depositMode}
      data-full-range={state.isFullRange || undefined}
      className={cn("flex w-full flex-col gap-4 rounded-xl border bg-card p-4 text-card-foreground", className)}
    >
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-semibold">{title}</h3>
        <SegmentedControl
          aria-label="Quote prices in"
          value={invert ? "token1" : "token0"}
          onValueChange={(next) => next !== null && setInvert(next === "token1")}
        >
          <SegmentedControlItem value="token0">{token0.symbol}</SegmentedControlItem>
          <SegmentedControlItem value="token1">{token1.symbol}</SegmentedControlItem>
        </SegmentedControl>
      </header>

      <p className="-mt-2 text-sm text-muted-foreground">
        Current price:{" "}
        <span className="font-medium text-foreground tabular-nums">{formatPrice(state.currentPrice, { locale })}</span> {unit}
      </p>

      {showChart && (
        <LiquidityChart
          bins={loadingPool ? undefined : bins}
          pool={pool}
          token0={token0}
          token1={token1}
          invert={invert}
          range={state.range}
          onRangeChange={state.setRange}
          locale={locale}
        />
      )}

      {presets.length > 0 && (
        <SegmentedControl
          aria-label="Range presets"
          value={preset?.label ?? null}
          onValueChange={(label) => {
            const next = presets.find((p) => p.label === label);
            if (next) state.applyPreset(next);
          }}
          className="flex w-full flex-wrap"
        >
          {presets.map((p) => (
            <SegmentedControlItem key={p.label} value={p.label} className="flex-1">
              {p.label}
            </SegmentedControlItem>
          ))}
        </SegmentedControl>
      )}

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {(["min", "max"] as const).map((edge) => (
          <PriceField
            key={edge}
            label={edge === "min" ? "Min price" : "Max price"}
            price={state[edge]}
            current={state.currentPrice}
            unit={unit}
            disabled={state.isFullRange}
            onCommit={(p) => state.setPrice(edge, p)}
            onStep={(d) => state.step(edge, d)}
            locale={locale}
          />
        ))}
      </div>

      {single && (
        <p role="status" className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
          The price is outside this range, so the position takes only{" "}
          <span className="font-medium text-foreground">{single.symbol}</span> and earns no fees until the price moves into it.
        </p>
      )}
      {state.isFullRange && (
        <p role="status" className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
          Full range positions are always in range but earn the least fees per dollar.
        </p>
      )}
    </section>
  );
}

function PriceField({
  label,
  price,
  current,
  unit,
  disabled,
  onCommit,
  onStep,
  locale,
}: {
  label: string;
  price: number;
  current: number;
  unit: string;
  disabled: boolean;
  onCommit: (price: number) => void;
  onStep: (direction: 1 | -1) => void;
  locale?: string;
}) {
  const formatted = formatPrice(price, { locale });
  const [draft, setDraft] = useState<string>();
  const cancelled = useRef(false);
  const text = draft ?? formatted;

  const commit = () => {
    if (draft === undefined || cancelled.current) {
      cancelled.current = false;
      return setDraft(undefined);
    }
    const parsed = parsePriceInput(draft);
    setDraft(undefined);
    if (parsed !== undefined) onCommit(parsed);
  };
  const change = formatEdgeChange(price, current);

  return (
    <Field
      disabled={disabled}
      className="flex-row items-center gap-2 rounded-lg border bg-background p-2 data-disabled:opacity-60"
    >
      <Button
        variant="ghost"
        aria-label={`Decrease ${label.toLowerCase()}`}
        disabled={disabled}
        onClick={() => onStep(-1)}
        className="size-11 shrink-0 text-muted-foreground"
      >
        <MinusIcon />
      </Button>
      <div className="flex min-w-0 flex-1 flex-col items-center gap-0.5 text-center">
        <FieldLabel className="text-xs font-normal text-muted-foreground">{label}</FieldLabel>
        <Input
          type="text"
          inputMode="decimal"
          autoComplete="off"
          value={text}
          onFocus={(e) => {
            setDraft(formatted);
            e.currentTarget.select();
          }}
          onValueChange={(next) => setDraft(next)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") {
              cancelled.current = true;
              e.currentTarget.blur();
            }
          }}
          className="w-full min-w-0 bg-transparent text-center text-lg font-semibold tabular-nums outline-none focus-visible:underline"
        />
        <span className="text-[11px] text-muted-foreground">
          {unit}
          {change && <span className="tabular-nums"> · {change}</span>}
        </span>
      </div>
      <Button
        variant="ghost"
        aria-label={`Increase ${label.toLowerCase()}`}
        disabled={disabled}
        onClick={() => onStep(1)}
        className="size-11 shrink-0 text-muted-foreground"
      >
        <PlusIcon />
      </Button>
    </Field>
  );
}
