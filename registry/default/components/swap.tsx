import { useQuery } from "@tanstack/react-query";
import { ArrowDownUpIcon } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import {
  formatUnits,
  type Address,
  type Hash,
  type Hex,
  type TransactionReceipt,
} from "viem";
import { useConnection } from "wagmi";
import { ApproveButton } from "@/components/approve-button";
import { TokenInput, type TokenInputState } from "@/components/token-input";
import { isNativeToken, type Token, type TokenPrices } from "@/components/token-select";
import { TransactionButton } from "@/components/transaction-button";
import { cn } from "@/lib/utils";

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
  sellToken: Token;
  buyToken: Token;
  sellAmount: bigint;
  /** Connected account, for quotes that need a taker. */
  taker: Address | undefined;
}) => Promise<SwapQuote>;

function useDebounced<T>(value: T, delay: number) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

/** "1 ETH = 3,150.42 USDC" from a quote. */
export function formatRate(
  sell: { token: Token; amount: bigint },
  buy: { token: Token; amount: bigint },
  { invert = false, locale }: { invert?: boolean; locale?: string } = {}
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

/**
 * Debounced, auto-refreshing quote for the current swap. `isStale` is true
 * while the shown quote doesn't match what the user typed.
 */
export function useSwapQuote({
  getQuote,
  sellToken,
  buyToken,
  sellAmount,
  refreshInterval = 15_000,
}: {
  getQuote: GetQuote;
  sellToken: Token | undefined;
  buyToken: Token | undefined;
  sellAmount: bigint | undefined;
  refreshInterval?: number | false;
}) {
  const { address } = useConnection();
  const debounced = useDebounced(sellAmount, 400);
  const query = useQuery({
    queryKey: [
      "0xui",
      "swap-quote",
      sellToken?.chainId,
      sellToken?.address,
      buyToken?.address,
      debounced?.toString(),
      address,
    ],
    queryFn: () =>
      getQuote({ sellToken: sellToken!, buyToken: buyToken!, sellAmount: debounced!, taker: address }),
    enabled: Boolean(sellToken && buyToken && debounced && debounced > 0n),
    refetchInterval: refreshInterval,
    retry: false,
  });
  return {
    quote: query.data,
    isLoading: query.isFetching && !query.data,
    isStale: debounced !== sellAmount,
    error: query.error,
  };
}

export type SwapProps = {
  /** Tokens for both pickers. */
  tokens: readonly Token[];
  /** Fetch a quote. Call your aggregator or router here. */
  getQuote: GetQuote;
  defaultSellToken?: Token;
  defaultBuyToken?: Token;
  popular?: readonly string[];
  /** Prices keyed by `chainId:address`, address or symbol, for fiat lines. */
  prices?: TokenPrices;
  onSubmitted?: (hash: Hash) => void;
  onSuccess?: (receipt: TransactionReceipt) => void;
  title?: ReactNode;
  className?: string;
};

/**
 * Swap form: two token panels with a flip button, a live quote with rate
 * and price impact, an approval step when the sell token needs one, and a
 * swap button that names whatever is missing. Bring your own quotes via
 * `getQuote`.
 */
export function Swap({
  tokens,
  getQuote,
  defaultSellToken,
  defaultBuyToken,
  popular,
  prices,
  onSubmitted,
  onSuccess,
  title = "Swap",
  className,
}: SwapProps) {
  const [sellToken, setSellToken] = useState<Token | undefined>(defaultSellToken ?? tokens[0]);
  const [buyToken, setBuyToken] = useState<Token | undefined>(defaultBuyToken);
  const [sellText, setSellText] = useState("");
  const [sell, setSell] = useState<TokenInputState>();
  const [invertRate, setInvertRate] = useState(false);

  const sellAmount = sell?.amount;
  const { quote, isLoading, isStale, error } = useSwapQuote({
    getQuote,
    sellToken,
    buyToken,
    sellAmount,
  });

  const flip = () => {
    setSellToken(buyToken);
    setBuyToken(sellToken);
    setSellText("");
    setSell(undefined);
  };

  const pick = (side: "sell" | "buy") => (token: Token) => {
    const other = side === "sell" ? buyToken : sellToken;
    // Picking the other side's token swaps them.
    if (other && other.address === token.address && other.chainId === token.chainId) return flip();
    if (side === "sell") {
      setSellToken(token);
      setSellText("");
      setSell(undefined);
    } else {
      setBuyToken(token);
    }
  };

  const blocker = !sellToken || !buyToken
    ? "Select a token"
    : !sellAmount
      ? "Enter an amount"
      : sell?.insufficient
        ? `Insufficient ${sellToken.symbol} balance`
        : error
          ? "No route found"
          : isLoading || isStale || !quote
            ? "Fetching quote…"
            : undefined;

  const buyText =
    quote && buyToken && !isStale ? formatUnits(quote.buyAmount, buyToken.decimals) : "";
  const rate =
    quote && sellToken && buyToken && sellAmount && !isStale
      ? formatRate(
          { token: sellToken, amount: sellAmount },
          { token: buyToken, amount: quote.buyAmount },
          { invert: invertRate }
        )
      : undefined;
  const impact = quote?.priceImpact;

  const swapButton = (
    <TransactionButton
      chainId={sellToken?.chainId}
      transaction={!blocker ? quote?.transaction : undefined}
      disabledReason={blocker}
      onSubmitted={onSubmitted}
      onSuccess={(receipt) => {
        setSellText("");
        setSell(undefined);
        onSuccess?.(receipt);
      }}
      className="w-full [&>button]:h-11 [&>button]:w-full"
    >
      Swap
    </TransactionButton>
  );

  const needsApproval =
    !blocker && sellToken && !isNativeToken(sellToken) && quote?.spender && sellAmount;

  return (
    <div data-slot="swap" className={cn("flex w-full max-w-md flex-col gap-3", className)}>
      {title && <h3 className="text-lg font-semibold">{title}</h3>}
      <div className="relative flex flex-col gap-1">
        <TokenInput
          label="You pay"
          value={sellText}
          onValueChange={(next, state) => {
            setSellText(next);
            setSell(state);
          }}
          token={sellToken}
          onTokenChange={pick("sell")}
          tokens={tokens}
          popular={popular}
          prices={prices}
        />
        <button
          type="button"
          aria-label="Switch tokens"
          onClick={flip}
          className="absolute top-1/2 left-1/2 z-10 -translate-x-1/2 -translate-y-1/2 rounded-xl border-4 border-background bg-muted p-2 hover:bg-accent"
        >
          <ArrowDownUpIcon aria-hidden className="size-4" />
        </button>
        <TokenInput
          label="You receive"
          value={buyText}
          onValueChange={() => {}}
          token={buyToken}
          onTokenChange={pick("buy")}
          tokens={tokens}
          popular={popular}
          prices={prices}
          readOnly
          checkBalance={false}
        />
      </div>

      <div className="flex min-h-5 items-center justify-between gap-2 text-sm text-muted-foreground" aria-live="polite">
        {error ? (
          <span role="alert" className="text-destructive">
            {(error as { shortMessage?: string }).shortMessage ?? error.message}
          </span>
        ) : rate ? (
          <button type="button" onClick={() => setInvertRate((v) => !v)} className="hover:text-foreground">
            {rate}
          </button>
        ) : sellAmount && (isLoading || isStale) ? (
          <span>Fetching quote…</span>
        ) : (
          <span />
        )}
        {impact !== undefined && rate && (
          <span className={cn(impact > 15 ? "text-destructive" : impact > 5 && "text-amber-600 dark:text-amber-400")}>
            Price impact {impact.toFixed(2)}%
          </span>
        )}
      </div>

      {needsApproval ? (
        <ApproveButton
          token={sellToken}
          spender={quote!.spender!}
          amount={sellAmount}
          chainId={sellToken.chainId}
          className="w-full [&>button]:h-11 [&>button]:w-full"
        >
          {swapButton}
        </ApproveButton>
      ) : (
        swapButton
      )}
    </div>
  );
}
