import { formatUnits } from "viem";
import type { Address, Hex } from "viem";
import { isNativeToken } from "@/lib/token-list";
import type { TokenInfo } from "@/lib/token-list";

export type SwapQuote = {
  /** Output amount, in the buy token's smallest unit. */
  buyAmount: bigint;
  /** Transaction that performs the swap. */
  transaction: { to: Address; data?: Hex; value?: bigint };
  /** Contract that must be approved to spend the sell token, if it's an ERC-20. */
  spender?: Address;
  /** Price impact in percent, e.g. 0.3. Shown, and warned about above 5%. */
  priceImpact?: number;
};

export type GetQuote = (request: {
  sellToken: TokenInfo;
  buyToken: TokenInfo;
  sellAmount: bigint;
  /** Connected account, for quotes that need a taker. */
  taker: Address | undefined;
}) => Promise<SwapQuote>;

/** "1 ETH = 3,150.42 USDC" from a quote. */
export function formatRate(
  sell: { token: TokenInfo; amount: bigint },
  buy: { token: TokenInfo; amount: bigint },
  { invert = false, locale }: { invert?: boolean; locale?: string } = {},
) {
  const sellUnits = Number(formatUnits(sell.amount, sell.token.decimals));
  const buyUnits = Number(formatUnits(buy.amount, buy.token.decimals));
  if (!sellUnits || !buyUnits) return undefined;
  const [from, to, rate] = invert
    ? [buy.token, sell.token, sellUnits / buyUnits]
    : [sell.token, buy.token, buyUnits / sellUnits];
  const formatted = new Intl.NumberFormat(locale, { maximumSignificantDigits: 6 }).format(rate);
  return `1 ${from.symbol} = ${formatted} ${to.symbol}`;
}

export type SwapQuoteParameters = {
  getQuote: GetQuote;
  sellToken: TokenInfo | undefined;
  buyToken: TokenInfo | undefined;
  /** The amount to quote. Debounce typing before it reaches here. */
  sellAmount: bigint | undefined;
  taker: Address | undefined;
  /** Refetch the quote this often, in ms. `false` to quote once. */
  refreshInterval?: number | false;
};

/** TanStack query options for a swap quote. Any TanStack adapter takes them. */
export function swapQuoteQueryOptions({
  getQuote,
  sellToken,
  buyToken,
  sellAmount,
  taker,
  refreshInterval = 15_000,
}: SwapQuoteParameters) {
  return {
    queryKey: [
      "0xui",
      "swap-quote",
      sellToken?.chainId,
      sellToken?.address,
      buyToken?.address,
      sellAmount?.toString(),
      taker,
    ] as const,
    queryFn: () =>
      getQuote({ sellToken: sellToken!, buyToken: buyToken!, sellAmount: sellAmount!, taker }),
    enabled: Boolean(sellToken && buyToken && sellAmount && sellAmount > 0n),
    refetchInterval: refreshInterval,
    retry: false,
  };
}

/** Same token on the same chain. */
export function isSameToken(a: TokenInfo | undefined, b: TokenInfo | undefined) {
  return Boolean(a && b && a.address === b.address && a.chainId === b.chainId);
}

/**
 * Why the swap can't go yet, as button text, or undefined when it's ready.
 * Order matches how people fill in the form.
 */
export function swapBlocker({
  sellToken,
  buyToken,
  sellAmount,
  insufficient,
  error,
  quoting,
  quote,
}: {
  sellToken: TokenInfo | undefined;
  buyToken: TokenInfo | undefined;
  sellAmount: bigint | undefined;
  insufficient: boolean;
  error: unknown;
  /** A quote is loading, or the shown one is for an older amount. */
  quoting: boolean;
  quote: SwapQuote | undefined;
}) {
  if (!sellToken || !buyToken) return "Select a token";
  if (!sellAmount) return "Enter an amount";
  if (insufficient) return `Insufficient ${sellToken.symbol} balance`;
  if (error) return "No route found";
  if (quoting || !quote) return "Fetching quote…";
  return undefined;
}

/** The sell token is an ERC-20 the quote's spender has to be approved for. */
export function swapNeedsApproval(sellToken: TokenInfo | undefined, quote: SwapQuote | undefined) {
  return Boolean(sellToken && !isNativeToken(sellToken) && quote?.spender);
}

/** How loud to be about a price impact, in percent. */
export function priceImpactLevel(impact: number): "ok" | "warn" | "danger" {
  return impact > 15 ? "danger" : impact > 5 ? "warn" : "ok";
}

/**
 * What a person confirms before an agent's Swap goes to the wallet: what
 * leaves, about what arrives, the network and the price impact. Set as the
 * button's `data-agent-confirm`.
 */
export function swapConfirmText({
  sell,
  buy,
  priceImpact,
  chainName,
}: {
  sell: { token: Pick<TokenInfo, "symbol" | "decimals">; amount: bigint };
  buy: { token: Pick<TokenInfo, "symbol" | "decimals">; amount: bigint };
  /** Percent, e.g. 0.12. */
  priceImpact?: number;
  chainName?: string;
}) {
  const on = chainName ? ` on ${chainName}` : "";
  const impact = priceImpact === undefined ? "" : ` (price impact ${priceImpact.toFixed(2)}%)`;
  return (
    `Swaps ${formatUnits(sell.amount, sell.token.decimals)} ${sell.token.symbol} from your wallet ` +
    `for about ${formatUnits(buy.amount, buy.token.decimals)} ${buy.token.symbol}${on}${impact}`
  );
}
