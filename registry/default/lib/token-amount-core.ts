import { formatUnits } from "viem";
import { formatTokenAmount, type FormatTokenAmountOptions } from "@/lib/0xui-utils";

/** Fiat value of a token amount, formatted as currency. */
export function formatFiat(
  value: bigint,
  decimals: number,
  price: number,
  { currency = "USD", locale }: { currency?: string; locale?: string } = {},
) {
  const amount = Number(formatUnits(value, decimals)) * price;
  return new Intl.NumberFormat(locale, { style: "currency", currency }).format(amount);
}

/**
 * The strings a token amount shows: `formatted` (rounded down), `exact` (every
 * digit, with the symbol) and `fiat` when a price is given.
 */
export function tokenAmountDisplay(
  value: bigint,
  decimals: number,
  {
    symbol,
    price,
    currency,
    ...options
  }: FormatTokenAmountOptions & { symbol?: string; price?: number; currency?: string } = {},
) {
  return {
    formatted: formatTokenAmount(value, decimals, options),
    exact: `${formatUnits(value, decimals)}${symbol ? ` ${symbol}` : ""}`,
    fiat:
      price === undefined
        ? undefined
        : formatFiat(value, decimals, price, { currency, locale: options.locale }),
  };
}
