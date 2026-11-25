// Docs: https://0xui.io/components/slippage-input.md
import { Input, InputGroup } from "@ui-sdk/react/input";
import { useId, useState } from "react";
import { SegmentedControl, SegmentedControlItem } from "@/components/primitives/segmented-control";
import {
  formatSlippage,
  parseSlippageInput,
  slippageWarning,
  slippageWarningText,
} from "@/lib/slippage-core";
import { cn } from "@/lib/utils";

export {
  HIGH_SLIPPAGE_BPS,
  LOW_SLIPPAGE_BPS,
  MAX_SLIPPAGE_BPS,
  formatSlippage,
  parseSlippageInput,
  slippageWarning,
  type SlippageWarning,
} from "@/lib/slippage-core";

export type SlippageInputProps = {
  /** Slippage in basis points: 50 is 0.5%. */
  value: number;
  onValueChange: (bps: number) => void;
  /** Preset options in basis points. */
  presets?: number[];
  label?: string;
  locale?: string;
  className?: string;
};

/**
 * Slippage tolerance: a segmented control of presets and a custom percent
 * field. Warns when the setting is low enough to revert or high enough to
 * be sandwiched, and refuses anything above 50%. Value in basis points.
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
  // Picking a preset, here or from outside, empties the custom field.
  const [shown, setShown] = useState(value);
  if (shown !== value) {
    setShown(value);
    if (isPreset) setText("");
  }
  const warning = slippageWarning(value);

  return (
    <div data-slot="slippage-input" data-warning={warning} className={cn("flex flex-col gap-1.5 text-sm", className)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span id={`${id}-label`} className="text-muted-foreground">
          {label}
        </span>
        <div className="flex items-center gap-1">
          <SegmentedControl
            aria-labelledby={`${id}-label`}
            value={isPreset ? String(value) : null}
            onValueChange={(next) => next !== null && onValueChange(Number(next))}
          >
            {presets.map((bps) => (
              <SegmentedControlItem key={bps} value={String(bps)}>
                {formatSlippage(bps, locale)}
              </SegmentedControlItem>
            ))}
          </SegmentedControl>
          <InputGroup
            className={cn(
              "flex h-8 items-center rounded-lg border px-2 focus-within:ring-2 focus-within:ring-ring/50",
              !isPreset && "border-foreground",
            )}
          >
            <Input
              type="text"
              inputMode="decimal"
              autoComplete="off"
              placeholder="Custom"
              aria-label={`Custom ${label.toLowerCase()} in percent`}
              value={text}
              onValueChange={(raw, details) => {
                const next = parseSlippageInput(raw);
                if (next.text === undefined) return details.cancel();
                setText(next.text);
                if (next.bps !== undefined) onValueChange(next.bps);
              }}
              className="w-14 bg-transparent text-right text-xs tabular-nums outline-none"
            />
            <span className="text-xs text-muted-foreground">%</span>
          </InputGroup>
        </div>
      </div>
      {warning && (
        <p role="status" className="text-xs text-amber-600 dark:text-amber-400">
          {slippageWarningText[warning]}
        </p>
      )}
    </div>
  );
}
