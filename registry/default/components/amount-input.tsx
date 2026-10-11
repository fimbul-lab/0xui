import {
  useId,
  type ClipboardEvent,
  type ComponentProps,
  type ReactNode,
} from "react";
import { formatUnits } from "viem";
import { parseAmount } from "@/lib/0xui-utils";
import { cn } from "@/lib/utils";

/**
 * Clean up what the user typed into a decimal string the input can hold, or
 * return `undefined` to reject the keystroke. Accepts "," as the decimal
 * point, turns a leading "." into "0.", and refuses digits beyond `decimals`.
 */
export function sanitizeAmountInput(raw: string, decimals: number) {
  const text = raw.replace(/,/g, ".").replace(/\s/g, "");
  if (text === "") return "";
  if (!/^\d*\.?\d*$/.test(text)) return undefined;
  const [, fraction = ""] = text.split(".");
  if (fraction.length > decimals) return undefined;
  return text.startsWith(".") ? `0${text}` : text;
}

export type AmountState = {
  /** Raw amount, or undefined when the input is empty or just ".". */
  amount: bigint | undefined;
  /** True when `max` is set and the amount is above it. */
  exceedsMax: boolean;
};

/** Parse an amount input value against decimals and an optional maximum. */
export function getAmountState(
  value: string,
  decimals: number,
  max?: bigint
): AmountState {
  const amount = value ? parseAmount(value, decimals) : undefined;
  return {
    amount,
    exceedsMax: amount !== undefined && max !== undefined && amount > max,
  };
}

export type AmountInputProps = Omit<
  ComponentProps<"input">,
  "value" | "onChange" | "type" | "max"
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
  id,
  ...props
}: AmountInputProps) {
  const fallbackId = useId();
  const inputId = id ?? fallbackId;
  const hintId = `${inputId}-hint`;
  const state = getAmountState(value, decimals, max);

  const update = (next: string) =>
    onValueChange(next, getAmountState(next, decimals, max));

  const onPaste = (event: ClipboardEvent<HTMLInputElement>) => {
    const text = event.clipboardData.getData("text");
    // Let normal input handle anything the sanitizer already accepts.
    if (sanitizeAmountInput(text, decimals) !== undefined) return;
    const parsed = parseAmount(text, decimals);
    if (parsed === undefined) return;
    event.preventDefault();
    update(formatUnits(parsed, decimals));
  };

  return (
    <div
      data-slot="amount-input"
      data-exceeds-max={state.exceedsMax || undefined}
      className={cn("flex min-w-0 flex-col gap-1", className)}
    >
      <div className="flex items-center gap-2">
        <input
          id={inputId}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          placeholder="0"
          aria-label={label}
          aria-invalid={state.exceedsMax || undefined}
          aria-describedby={hint ? hintId : undefined}
          value={value}
          onChange={(event) => {
            const next = sanitizeAmountInput(event.target.value, decimals);
            if (next !== undefined) update(next);
          }}
          onPaste={onPaste}
          className={cn(
            "w-full min-w-0 bg-transparent text-3xl font-medium tabular-nums outline-none placeholder:text-muted-foreground/50",
            state.exceedsMax && "text-destructive"
          )}
          {...props}
        />
        {showMax && max !== undefined && (
          <button
            type="button"
            onClick={() => update(formatUnits(max, decimals))}
            className="shrink-0 rounded-md px-2 py-1 text-xs font-medium text-primary hover:bg-muted"
          >
            Max
          </button>
        )}
      </div>
      {hint && (
        <div id={hintId} className="text-sm text-muted-foreground tabular-nums">
          {hint}
        </div>
      )}
    </div>
  );
}
