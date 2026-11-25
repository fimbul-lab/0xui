import { formatUnits } from "viem";
import { getTokenPrice, type TokenInfo, type TokenPrices } from "@/lib/token-list";

/** Value of two token amounts in fiat, or undefined without both prices. */
export function positionValue(
  amounts: { amount0: bigint; amount1: bigint },
  token0: Pick<TokenInfo, "chainId" | "address" | "symbol" | "decimals">,
  token1: Pick<TokenInfo, "chainId" | "address" | "symbol" | "decimals">,
  prices?: TokenPrices,
) {
  const p0 = getTokenPrice(prices, token0);
  const p1 = getTokenPrice(prices, token1);
  if (p0 === undefined || p1 === undefined) return undefined;
  return (
    Number(formatUnits(amounts.amount0, token0.decimals)) * p0 +
    Number(formatUnits(amounts.amount1, token1.decimals)) * p1
  );
}

/** "$1,234.56" for a fiat value, or undefined without one. */
export function formatMoney(value: number | undefined, currency = "USD", locale?: string) {
  return value === undefined ? undefined : new Intl.NumberFormat(locale, { style: "currency", currency }).format(value);
}

/** "1.5 ETH and 300 USDC", leaving out a side that is zero. */
export function formatPair(
  amount0: bigint,
  amount1: bigint,
  token0: Pick<TokenInfo, "symbol" | "decimals">,
  token1: Pick<TokenInfo, "symbol" | "decimals">,
) {
  const parts = [
    amount0 > 0n && `${formatUnits(amount0, token0.decimals)} ${token0.symbol}`,
    amount1 > 0n && `${formatUnits(amount1, token1.decimals)} ${token1.symbol}`,
  ].filter(Boolean);
  return parts.length ? parts.join(" and ") : "nothing";
}
