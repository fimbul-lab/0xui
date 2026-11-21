// Docs: https://0xui.io/components/price-range.md
import { MinusIcon, PlusIcon } from "lucide-react";
import { useEffect, useId, useState, type ReactNode } from "react";
import {
  LiquidityChart,
  type PairToken,
  type TickRange,
} from "@/components/liquidity-chart";
import {
  formatPrice,
  getDepositMode,
  isFullRange,
  priceToTick,
  rangeAroundTick,
  tickToPrice,
  usableTickBounds,
  type DepositMode,
  type LiquidityBin,
  type PoolState,
} from "@/lib/concentrated-liquidity";
import { cn } from "@/lib/utils";

/** A preset is a ± percent around the price, or the full range. */
export type RangePreset = { label: string; percent: number } | { label: string; full: true };

/**
 * Presets by tick spacing: tight ones for stable pairs (spacing 1),
 * wider ones for everything else. Matches what most DEX interfaces offer.
 */
export function defaultRangePresets(tickSpacing: number): RangePreset[] {
  if (tickSpacing <= 1) {
    return [
      { label: "±0.05%", percent: 0.05 },
      { label: "±0.1%", percent: 0.1 },
      { label: "±0.5%", percent: 0.5 },
      { label: "Full range", full: true },
    ];
  }
  if (tickSpacing <= 10) {
    return [
      { label: "±1%", percent: 1 },
      { label: "±5%", percent: 5 },
      { label: "±10%", percent: 10 },
      { label: "Full range", full: true },
    ];
  }
  return [
    { label: "±10%", percent: 10 },
    { label: "±20%", percent: 20 },
    { label: "±50%", percent: 50 },
    { label: "Full range", full: true },
  ];
}

/** Range edge as the user sees it: min and max of the displayed price. */
export type RangeEdge = "min" | "max";

/**
 * Range state for a new position. Works in ticks, so every value is one the
 * pool accepts, and maps the displayed min and max onto them, including
 * when the price is inverted (then min is `tickUpper`).
 */
export function usePriceRange({
  pool,
  value,
  defaultValue,
  onValueChange,
  invert = false,
}: {
  pool: Pick<PoolState, "tick" | "tickSpacing" | "decimals0" | "decimals1">;
  /** Controlled range. */
  value?: TickRange;
  /** Starting range. Defaults to ±10% (±0.1% for stable spacings). */
  defaultValue?: TickRange;
  onValueChange?: (range: TickRange) => void;
  invert?: boolean;
}) {
  const { tick, tickSpacing, decimals0, decimals1 } = pool;
  const [inner, setInner] = useState<TickRange>(
    () => defaultValue ?? rangeAroundTick(tick, tickSpacing <= 1 ? 0.1 : 10, tickSpacing)
  );
  const range = value ?? inner;
  const setRange = (next: TickRange) => {
    if (value === undefined) setInner(next);
    onValueChange?.(next);
  };
  const { min, max } = usableTickBounds(tickSpacing);
  const full = isFullRange(range.tickLower, range.tickUpper, tickSpacing);

  const display = (t: number) => {
    const p = tickToPrice(t, decimals0, decimals1);
    return invert ? 1 / p : p;
  };
  // Displayed min/max map to ticks; inverted, the min price is the upper tick.
  const edgeTick = (edge: RangeEdge) =>
    (edge === "min") !== invert ? "tickLower" : "tickUpper";

  const priceOf = (edge: RangeEdge) => {
    if (full) return edge === "min" ? 0 : Infinity;
    return display(range[edgeTick(edge)]);
  };

  const setTick = (key: "tickLower" | "tickUpper", t: number) => {
    const snapped = Math.max(min, Math.min(max, Math.round(t / tickSpacing) * tickSpacing));
    if (key === "tickLower") setRange({ tickLower: Math.min(snapped, range.tickUpper - tickSpacing), tickUpper: range.tickUpper });
    else setRange({ tickLower: range.tickLower, tickUpper: Math.max(snapped, range.tickLower + tickSpacing) });
  };

  return {
    range,
    setRange,
    isFullRange: full,
    depositMode: getDepositMode(tick, range.tickLower, range.tickUpper) as DepositMode,
    /** Displayed price at an edge: 0 / ∞ for full range. */
    priceOf,
    /** Set an edge from a typed price in the displayed direction. */
    setPrice: (edge: RangeEdge, price: number) => {
      if (!(price > 0) || !Number.isFinite(price)) return;
      const raw = invert ? 1 / price : price;
      setTick(edgeTick(edge), priceToTick(raw, decimals0, decimals1));
    },
    /** Move an edge one tick spacing up (+1) or down (−1) in displayed price. */
    step: (edge: RangeEdge, direction: 1 | -1) => {
      const key = edgeTick(edge);
      setTick(key, range[key] + direction * (invert ? -1 : 1) * tickSpacing);
    },
    applyPreset: (preset: RangePreset) =>
      setRange("full" in preset ? { tickLower: min, tickUpper: max } : rangeAroundTick(tick, preset.percent, tickSpacing)),
    isPreset: (preset: RangePreset) => {
      if ("full" in preset) return full;
      const r = rangeAroundTick(tick, preset.percent, tickSpacing);
      return r.tickLower === range.tickLower && r.tickUpper === range.tickUpper;
    },
  };
}

export type PriceRangeProps = {
  pool: Pick<PoolState, "tick" | "tickSpacing" | "decimals0" | "decimals1">;
  /** Liquidity bins for the chart, from `getLiquidityBins`. Omit to hide the chart. */
  bins?: readonly LiquidityBin[];
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
  /** Preset buttons. Defaults depend on the tick spacing. Pass `[]` to hide. */
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
export function PriceRange({
  pool,
  bins,
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
}: PriceRangeProps) {
  const [innerInvert, setInnerInvert] = useState(defaultInvert);
  const invert = invertProp ?? innerInvert;
  const setInvert = (next: boolean) => {
    if (invertProp === undefined) setInnerInvert(next);
    onInvertChange?.(next);
  };
  const state = usePriceRange({ pool, value, defaultValue, onValueChange, invert });
  const base = invert ? token1 : token0;
  const quote = invert ? token0 : token1;
  const unit = `${quote.symbol} per ${base.symbol}`;
  const current = invert ? 1 / tickToPrice(pool.tick, pool.decimals0, pool.decimals1) : tickToPrice(pool.tick, pool.decimals0, pool.decimals1);
  const single = state.depositMode === "both" ? undefined : state.depositMode === "token0" ? token0 : token1;

  return (
    <section
      data-slot="price-range"
      data-deposit-mode={state.depositMode}
      data-full-range={state.isFullRange || undefined}
      className={cn("flex w-full flex-col gap-4 rounded-xl border bg-card p-4 text-card-foreground", className)}
    >
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-semibold">{title}</h3>
        <div role="group" aria-label="Quote prices in" className="inline-flex rounded-lg bg-muted p-0.5 text-xs font-medium">
          {[token0, token1].map((token, i) => {
            const pressed = (i === 1) === invert;
            return (
              <button
                key={token.symbol + i}
                type="button"
                aria-pressed={pressed}
                onClick={() => setInvert(i === 1)}
                className={cn(
                  "min-h-7 rounded-md px-2.5 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  pressed ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                )}
              >
                {token.symbol}
              </button>
            );
          })}
        </div>
      </header>

      <p className="-mt-2 text-sm text-muted-foreground">
        Current price:{" "}
        <span className="font-medium text-foreground tabular-nums">{formatPrice(current, { locale })}</span> {unit}
      </p>

      {bins && (
        <LiquidityChart
          bins={bins}
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
        <div role="group" aria-label="Range presets" className="flex flex-wrap gap-1.5">
          {presets.map((preset) => {
            const pressed = state.isPreset(preset);
            return (
              <button
                key={preset.label}
                type="button"
                aria-pressed={pressed}
                onClick={() => state.applyPreset(preset)}
                className={cn(
                  "min-h-8 rounded-full border px-3 text-xs font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  pressed ? "border-foreground bg-foreground text-background" : "hover:bg-muted"
                )}
              >
                {preset.label}
              </button>
            );
          })}
        </div>
      )}

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {(["min", "max"] as const).map((edge) => (
          <PriceField
            key={edge}
            label={edge === "min" ? "Min price" : "Max price"}
            price={state.priceOf(edge)}
            current={current}
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

/** Decimal text the user typed, or undefined. Accepts "1,234.5" and "1234,5". */
function parsePriceInput(text: string) {
  const clean = text.replace(/\s/g, "");
  const normalized = /,\d{1,2}$/.test(clean) || (/,/.test(clean) && !/\./.test(clean) && !/,\d{3}$/.test(clean))
    ? clean.replace(/\./g, "").replace(",", ".")
    : clean.replace(/,/g, "");
  const n = Number(normalized);
  return normalized && Number.isFinite(n) && n > 0 ? n : undefined;
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
  const id = useId();
  const formatted = formatPrice(price, { locale });
  const [text, setText] = useState(formatted);
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (!editing) setText(formatted);
  }, [formatted, editing]);

  const commit = () => {
    setEditing(false);
    const parsed = parsePriceInput(text);
    if (parsed !== undefined) onCommit(parsed);
    else setText(formatted);
  };
  const change = Number.isFinite(price) && price > 0 ? (price / current - 1) * 100 : undefined;

  return (
    <div className={cn("flex items-center gap-2 rounded-lg border bg-background p-2", disabled && "opacity-60")}>
      <Stepper label={`Decrease ${label.toLowerCase()}`} disabled={disabled} onClick={() => onStep(-1)}>
        <MinusIcon className="size-4" />
      </Stepper>
      <div className="flex min-w-0 flex-1 flex-col items-center gap-0.5 text-center">
        <label htmlFor={id} className="text-xs text-muted-foreground">{label}</label>
        <input
          id={id}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          disabled={disabled}
          value={text}
          onFocus={(e) => {
            setEditing(true);
            e.currentTarget.select();
          }}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") {
              setText(formatted);
              setEditing(false);
              e.currentTarget.blur();
            }
          }}
          className="w-full min-w-0 bg-transparent text-center text-lg font-semibold tabular-nums outline-none focus-visible:underline"
        />
        <span className="text-[11px] text-muted-foreground">
          {unit}
          {change !== undefined && Math.abs(change) < 10000 && (
            <span className="tabular-nums">
              {" · "}
              {change >= 0 ? "+" : "−"}
              {Math.abs(change).toFixed(Math.abs(change) < 10 ? 2 : 1)}%
            </span>
          )}
        </span>
      </div>
      <Stepper label={`Increase ${label.toLowerCase()}`} disabled={disabled} onClick={() => onStep(1)}>
        <PlusIcon className="size-4" />
      </Stepper>
    </div>
  );
}

function Stepper({ label, disabled, onClick, children }: { label: string; disabled: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="grid size-11 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none"
    >
      {children}
    </button>
  );
}
