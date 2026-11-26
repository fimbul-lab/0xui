// Docs: https://0xui.io/components/amount-input.md
import { Input, InputGroup } from "@ui-sdk/react/input";
import type { ClipboardEvent, ComponentProps, ReactNode } from "react";
import { formatUnits } from "viem";
import { Button } from "@/components/primitives/button";
import { Field, FieldDescription } from "@/components/primitives/field";
import { getAmountState, pastedAmount, sanitizeAmountInput } from "@/lib/amount-input-core";
import type { AmountState } from "@/lib/amount-input-core";
import { cn } from "@/lib/utils";

export { getAmountState, sanitizeAmountInput, type AmountState };

export type AmountInputProps = Omit<
  ComponentProps<typeof Input>,
  "value" | "defaultValue" | "onChange" | "onValueChange" | "type" | "max"
> & {
  /** Decimal string, e.g. "1.5". Keep it in state; never store amounts as numbers. */
  value: string;
  /** Called with the new decimal string and its parsed state. */
  onValueChange: (value: string, state: AmountState) => void;
  /** Token decimals. Typing past them is refused. */
  decimals: number;
  /** Maximum allowed amount, e.g. the balance. Enables the Max button and the over-max state. */
  max?: bigint;
  /** Show a Max button when `max` is set. */
  showMax?: boolean;
  /** Line under the amount, e.g. the fiat value. */
  hint?: ReactNode;
  /** Accessible label. Defaults to "Amount". */
  label?: string;
};

/**
 * Large decimal amount input for token amounts. Keeps the value as a
 * string, so precision is never lost to floats. Refuses invalid keystrokes,
 * clamps to the token's decimals, and cleans up pasted amounts such as
 * "$1,000.50".
 */
export function AmountInput({
  value,
  onValueChange,
  decimals,
  max,
  showMax = true,
  hint,
  label = "Amount",
  className,
  onPaste,
  ...props
}: AmountInputProps) {
  const state = getAmountState(value, decimals, max);

  const update = (next: string) => onValueChange(next, getAmountState(next, decimals, max));

  const paste = (event: ClipboardEvent<HTMLInputElement>) => {
    onPaste?.(event);
    const next = pastedAmount(event.clipboardData.getData("text"), decimals);
    if (next === undefined) {
      return;
    }
    event.preventDefault();
    update(next);
  };

  return (
    <Field
      invalid={state.exceedsMax || undefined}
      render={(fieldProps) => (
        <div
          {...fieldProps}
          data-slot="amount-input"
          data-exceeds-max={state.exceedsMax || undefined}
        />
      )}
      className={cn("min-w-0 gap-1", className)}
    >
      <InputGroup className="flex items-center gap-2">
        <Input
          type="text"
          inputMode="decimal"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          placeholder="0"
          aria-label={label}
          value={value}
          onValueChange={(raw, details) => {
            const next = sanitizeAmountInput(raw, decimals);
            if (next === undefined) {
              details.cancel();
            } else {
              update(next);
            }
          }}
          onPaste={paste}
          className="w-full min-w-0 bg-transparent text-3xl font-medium tabular-nums outline-none placeholder:text-muted-foreground/50 data-invalid:text-destructive"
          {...props}
        />
        {showMax && max !== undefined && (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            onClick={() => update(formatUnits(max, decimals))}
            className="text-primary"
          >
            Max
          </Button>
        )}
      </InputGroup>
      {hint && (
        <FieldDescription render={<div />} className="tabular-nums">
          {hint}
        </FieldDescription>
      )}
    </Field>
  );
}
