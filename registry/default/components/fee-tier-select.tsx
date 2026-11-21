// Docs: https://0xui.io/components/fee-tier-select.md
import { CheckIcon } from "lucide-react";
import { useId, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export type FeeTier = {
  /** Fee in hundredths of a bip: 500 is 0.05%. */
  fee: number;
  /** Tick spacing that goes with the fee. */
  tickSpacing: number;
  /** One line on when to pick it. */
  description?: ReactNode;
  /** Share of the pair's liquidity in this tier, 0–1. Shown as "62% select". */
  share?: number;
  /** False when the pool for this tier doesn't exist yet. */
  exists?: boolean;
};

/** Uniswap v3 tiers. Other DEXes use other fees; pass your own `tiers`. */
export const defaultFeeTiers: FeeTier[] = [
  { fee: 100, tickSpacing: 1, description: "Best for very stable pairs" },
  { fee: 500, tickSpacing: 10, description: "Best for stable pairs" },
  { fee: 3000, tickSpacing: 60, description: "Best for most pairs" },
  { fee: 10000, tickSpacing: 200, description: "Best for exotic pairs" },
];

/** "0.05%" from 500. */
export function formatFee(fee: number, locale?: string) {
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 4 }).format(fee / 10_000)}%`;
}

export type FeeTierSelectProps = {
  value?: number;
  defaultValue?: number;
  onValueChange?: (tier: FeeTier) => void;
  tiers?: FeeTier[];
  /** Group label, read by screen readers and shown above the options. */
  label?: ReactNode;
  locale?: string;
  className?: string;
};

/**
 * Fee tier picker for a new position: one card per tier with the fee, when
 * to use it, and how much of the pair's liquidity already sits there.
 * Tiers without a pool are marked "Not created". A radio group, so arrow
 * keys move between tiers.
 */
export function FeeTierSelect({
  value,
  defaultValue,
  onValueChange,
  tiers = defaultFeeTiers,
  label = "Fee tier",
  locale,
  className,
}: FeeTierSelectProps) {
  const [inner, setInner] = useState(defaultValue ?? tiers[Math.min(2, tiers.length - 1)]?.fee);
  const selected = value ?? inner;
  const name = useId();

  return (
    <fieldset data-slot="fee-tier-select" className={cn("flex w-full flex-col gap-2", className)}>
      <legend className="mb-2 text-sm font-medium">{label}</legend>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {tiers.map((tier) => {
          const checked = tier.fee === selected;
          return (
            <label
              key={tier.fee}
              data-checked={checked || undefined}
              className={cn(
                "relative flex min-h-11 cursor-pointer flex-col gap-1 rounded-lg border p-3 text-left transition-colors has-focus-visible:ring-2 has-focus-visible:ring-ring",
                checked ? "border-foreground bg-muted/50" : "hover:bg-muted/40"
              )}
            >
              <input
                type="radio"
                name={name}
                value={tier.fee}
                checked={checked}
                onChange={() => {
                  if (value === undefined) setInner(tier.fee);
                  onValueChange?.(tier);
                }}
                className="sr-only"
              />
              <span className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold tabular-nums">{formatFee(tier.fee, locale)}</span>
                {checked && <CheckIcon className="size-4" aria-hidden />}
              </span>
              {tier.description && <span className="text-xs text-muted-foreground">{tier.description}</span>}
              {(tier.share !== undefined || tier.exists === false) && (
                <span className="mt-auto w-fit rounded-sm bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground tabular-nums">
                  {tier.exists === false
                    ? "Not created"
                    : `${new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 0 }).format(tier.share!)} select`}
                </span>
              )}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
