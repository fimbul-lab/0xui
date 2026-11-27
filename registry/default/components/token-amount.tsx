// Docs: https://0xui.io/components/token-amount.md
import type { FormatTokenAmountOptions } from "@/lib/0xui-utils";
import { MorphText } from "@/components/morph-text";
import { formatFiat, tokenAmountDisplay } from "@/lib/token-amount-core";
import { cn } from "@/lib/utils";

export { formatFiat };

export type TokenAmountProps = FormatTokenAmountOptions & {
  /** Raw amount in the token's smallest unit. */
  value: bigint;
  /** Token decimals, e.g. 18 for ETH, 6 for USDC. */
  decimals: number;
  /** Shown after the amount. */
  symbol?: string;
  /** Price of one token in `currency`. When set, a fiat value is shown below. */
  price?: number;
  /** ISO 4217 currency for the fiat value. */
  currency?: string;
  /** Morph the amount and fiat value when they change. Leave off in long lists. */
  animate?: boolean;
  className?: string;
};

/**
 * Formatted token amount, e.g. `1,234.5678 USDC`. Never loses precision to
 * floats and never rounds up. The exact amount is available on hover.
 */
export function TokenAmount({
  value,
  decimals,
  symbol,
  price,
  currency,
  maxDecimals,
  compact,
  locale,
  animate = false,
  className,
}: TokenAmountProps) {
  const { formatted, exact, fiat } = tokenAmountDisplay(value, decimals, {
    symbol,
    price,
    currency,
    maxDecimals,
    compact,
    locale,
  });

  return (
    <span data-slot="token-amount" className={cn("inline-flex flex-col", className)}>
      <span title={exact} className="tabular-nums">
        {animate ? <MorphText>{formatted}</MorphText> : formatted}
        {/* A space for screen readers and agents ("2 ETH", not "2ETH"); the margin spaces it visually. */}
        {symbol && <span className="sr-only"> </span>}
        {symbol && <span className="ml-1 text-muted-foreground">{symbol}</span>}
      </span>
      {fiat !== undefined && (
        <span className="text-sm text-muted-foreground tabular-nums">
          {animate ? <MorphText>{fiat}</MorphText> : fiat}
        </span>
      )}
    </span>
  );
}
