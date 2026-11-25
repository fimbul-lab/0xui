// Docs: https://0xui.io/components/fee-tier-select.md
import { Radio, RadioGroup, RadioIndicator } from "@ui-sdk/react/radio";
import { CheckIcon } from "lucide-react";
import { useId, useState, type ReactNode } from "react";
import { SkeletonBox } from "skullet/react";
import { FieldLegend, FieldSet } from "@/components/primitives/field";
import {
  defaultFeeTier,
  defaultFeeTiers,
  feeTierBadge,
  formatFee,
  type FeeTierInfo,
} from "@/lib/fee-tier-core";
import { cn } from "@/lib/utils";

export { defaultFeeTiers, feeTierBadge, formatFee };

export type FeeTier = Omit<FeeTierInfo, "description"> & {
  /** One line on when to pick it. */
  description?: ReactNode;
};

export type FeeTierSelectProps = {
  /** Selected fee, in hundredths of a bip. Controlled. */
  value?: number;
  /** Starting fee when uncontrolled. Defaults to the third tier (0.3%). */
  defaultValue?: number;
  /** Called with the whole tier, so its tick spacing comes along. */
  onValueChange?: (tier: FeeTier) => void;
  /** Tiers to offer. Defaults to Uniswap v3's four. */
  tiers?: FeeTier[];
  /** Shares are loading: each tier shows a skeleton where its share goes. */
  loading?: boolean;
  /** Group label, read by screen readers and shown above the options. */
  label?: ReactNode;
  locale?: string;
  className?: string;
};

/**
 * Fee tier picker for a new position: one card per tier with the fee, when
 * to use it, and how much of the pair's liquidity already sits there.
 * Tiers without a pool are marked "Not created". A ui-sdk radio group, so
 * arrow keys move between tiers.
 */
export function FeeTierSelect({
  value,
  defaultValue,
  onValueChange,
  tiers = defaultFeeTiers,
  loading = false,
  label = "Fee tier",
  locale,
  className,
}: FeeTierSelectProps) {
  const [inner, setInner] = useState(defaultValue ?? defaultFeeTier(tiers)?.fee);
  const selected = value ?? inner;
  const id = useId();

  return (
    <FieldSet
      render={(props) => (
        <fieldset
          {...props}
          data-slot="fee-tier-select"
          data-loading={loading || undefined}
          aria-busy={loading || undefined}
        />
      )}
      className={cn("w-full gap-2", className)}
    >
      <FieldLegend id={`${id}-legend`} className="mb-2 text-sm">
        {label}
      </FieldLegend>
      <RadioGroup
        aria-labelledby={`${id}-legend`}
        value={selected === undefined ? null : String(selected)}
        onValueChange={(next) => {
          const tier = tiers.find((t) => String(t.fee) === next);
          if (!tier) return;
          if (value === undefined) setInner(tier.fee);
          onValueChange?.(tier);
        }}
        className="grid grid-cols-2 gap-2 sm:grid-cols-4"
      >
        {tiers.map((tier) => {
          const badge = feeTierBadge(tier, locale);
          return (
            <label
              key={tier.fee}
              className="relative flex min-h-11 cursor-pointer flex-col gap-1 rounded-lg border p-3 text-left transition-colors hover:bg-muted/40 has-data-checked:border-foreground has-data-checked:bg-muted/50 has-focus-visible:ring-2 has-focus-visible:ring-ring"
            >
              <span className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold tabular-nums">{formatFee(tier.fee, locale)}</span>
                <Radio value={String(tier.fee)} className="grid size-4 place-items-center outline-none">
                  <RadioIndicator>
                    <CheckIcon className="size-4" aria-hidden />
                  </RadioIndicator>
                </Radio>
              </span>
              {tier.description && <span className="text-xs text-muted-foreground">{tier.description}</span>}
              {loading && (
                <span className="mt-auto">
                  <SkeletonBox width="7ch" height={18} radius={4} />
                </span>
              )}
              {!loading && badge && (
                <span className="mt-auto w-fit rounded-sm bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground tabular-nums">
                  {badge}
                </span>
              )}
            </label>
          );
        })}
      </RadioGroup>
    </FieldSet>
  );
}
