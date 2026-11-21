// Docs: https://0xui.io/components/slippage-input.md
import { useEffect, useId, useState } from "react";
import { cn } from "@/lib/utils";

/** Below this the transaction will likely revert on normal price moves. */
export const LOW_SLIPPAGE_BPS = 5;
/** Above this a bot can sandwich the transaction for a lot of what you allow. */
export const HIGH_SLIPPAGE_BPS = 500;
/** Anything above this is refused. */
export const MAX_SLIPPAGE_BPS = 5000;

/** "0.5%" from 50. */
export function formatSlippage(bps: number, locale?: string) {
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(bps / 100)}%`;
}

/** Warning for a slippage setting, if any. */
export function slippageWarning(bps: number): "low" | "high" | undefined {
  if (bps < LOW_SLIPPAGE_BPS) return "low";
  if (bps > HIGH_SLIPPAGE_BPS) return "high";
  return undefined;
}

export type SlippageInputProps = {
  /** Slippage in basis points: 50 is 0.5%. */
  value: number;
  onValueChange: (bps: number) => void;
  /** Preset buttons in basis points. */
  presets?: number[];
  label?: string;
  locale?: string;
  className?: string;
};

/**
 * Slippage tolerance: preset buttons and a custom percent field. Warns when
 * the setting is low enough to revert or high enough to be sandwiched, and
 * refuses anything above 50%. Value in basis points.
 */
export function SlippageInput({
  value,
  onValueChange,
  presets = [10, 50, 100],
  label = "Slippage tolerance",
  locale,
  className,
}: SlippageInputProps) {
  const id = useId();
  const isPreset = presets.includes(value);
  const [text, setText] = useState(isPreset ? "" : String(value / 100));
  useEffect(() => {
    if (presets.includes(value)) setText("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  const warning = slippageWarning(value);

  return (
    <div data-slot="slippage-input" data-warning={warning} className={cn("flex flex-col gap-1.5 text-sm", className)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label htmlFor={id} className="text-muted-foreground">{label}</label>
        <div className="flex items-center gap-1">
          <div role="group" aria-label={label} className="inline-flex rounded-lg bg-muted p-0.5 text-xs font-medium">
            {presets.map((bps) => (
              <button
                key={bps}
                type="button"
                aria-pressed={value === bps}
                onClick={() => onValueChange(bps)}
                className={cn(
                  "min-h-7 rounded-md px-2 tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  value === bps ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                )}
              >
                {formatSlippage(bps, locale)}
              </button>
            ))}
          </div>
          <div className={cn("flex h-8 items-center rounded-lg border px-2 focus-within:ring-2 focus-within:ring-ring", !isPreset && "border-foreground")}>
            <input
              id={id}
              type="text"
              inputMode="decimal"
              autoComplete="off"
              placeholder="Custom"
              aria-label={`Custom ${label.toLowerCase()} in percent`}
              value={text}
              onChange={(e) => {
                const next = e.target.value.replace(",", ".");
                if (!/^\d{0,2}(\.\d{0,2})?$/.test(next)) return;
                setText(next);
                const bps = Math.round(Number(next) * 100);
                if (next && Number.isFinite(bps) && bps > 0 && bps <= MAX_SLIPPAGE_BPS) onValueChange(bps);
              }}
              className="w-14 bg-transparent text-right text-xs tabular-nums outline-none"
            />
            <span className="text-xs text-muted-foreground">%</span>
          </div>
        </div>
      </div>
      {warning && (
        <p role="status" className="text-xs text-amber-600 dark:text-amber-400">
          {warning === "low"
            ? "Your transaction may fail if the price moves."
            : "High slippage: a bot could trade ahead of you and take the difference."}
        </p>
      )}
    </div>
  );
}
