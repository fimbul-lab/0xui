import { formatUnits } from "viem";
import { parseAmount } from "@/lib/0xui-utils";

/**
 * Clean up what the user typed into a decimal string the input can hold, or
 * return `undefined` to reject the keystroke. Accepts "," as the decimal
 * point, turns a leading "." into "0.", and refuses digits beyond `decimals`.
 */
export function sanitizeAmountInput(raw: string, decimals: number) {
  const text = raw.replaceAll(",", ".").replaceAll(/\s/g, "");
  if (text === "") {
    return "";
  }
  if (!/^\d*\.?\d*$/.test(text)) {
    return undefined;
  }
  const [, fraction = ""] = text.split(".");
  if (fraction.length > decimals) {
    return undefined;
  }
  return text.startsWith(".") ? `0${text}` : text;
}

/**
 * A pasted amount the sanitizer would refuse, like "$1,000.50", as a decimal
 * string. Undefined when normal typing handles it, or when it isn't an amount.
 */
export function pastedAmount(text: string, decimals: number) {
  if (sanitizeAmountInput(text, decimals) !== undefined) {
    return undefined;
  }
  const parsed = parseAmount(text, decimals);
  return parsed === undefined ? undefined : formatUnits(parsed, decimals);
}

export type AmountState = {
  /** Raw amount, or undefined when the input is empty or just ".". */
  amount: bigint | undefined;
  /** True when `max` is set and the amount is above it. */
  exceedsMax: boolean;
};

/** Parse an amount input value against decimals and an optional maximum. */
export function getAmountState(value: string, decimals: number, max?: bigint): AmountState {
  const amount = value ? parseAmount(value, decimals) : undefined;
  return {
    amount,
    exceedsMax: amount !== undefined && max !== undefined && amount > max,
  };
}
