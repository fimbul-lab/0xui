// Docs: https://0xui.io/blocks/swap.md
import { useQuery } from "@tanstack/react-query";
import { ArrowDownUpIcon } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { formatUnits, type Hash, type TransactionReceipt } from "viem";
import { useConfig, useConnection } from "wagmi";
import { ApproveButton } from "@/components/approve-button";
import { MorphText } from "@/components/morph-text";
import { Button } from "@/components/primitives/button";
import { TokenInput, type TokenInputState } from "@/components/token-input";
import type { Token, TokenPrices } from "@/components/token-select";
import { TransactionButton } from "@/components/transaction-button";
import {
  formatRate,
  isSameToken,
  priceImpactLevel,
  swapBlocker,
  swapConfirmText,
  swapNeedsApproval,
  swapQuoteQueryOptions,
  type GetQuote,
} from "@/lib/swap-core";
import { cn } from "@/lib/utils";

export {
  formatRate,
  swapBlocker,
  swapConfirmText,
  swapQuoteQueryOptions,
  type GetQuote,
  type SwapQuote,
} from "@/lib/swap-core";

function useDebounced<T>(value: T, delay: number) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
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
  const query = useQuery(
    swapQuoteQueryOptions({
      getQuote,
      sellToken,
      buyToken,
      sellAmount: debounced,
      taker: address,
      refreshInterval,
    }),
  );
  return {
    quote: query.data,
    isLoading: query.isFetching && !query.data,
    isStale: debounced !== sellAmount,
    error: query.error,
  };
}

export type SwapProps = {
  /** Tokens for both pickers. */
  tokens: ReadonlyArray<Token>;
  /** Fetch a quote. Call your aggregator or router here. */
  getQuote: GetQuote;
  defaultSellToken?: Token;
  defaultBuyToken?: Token;
  popular?: ReadonlyArray<string>;
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
  const { chains } = useConfig();

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
    if (isSameToken(other, token)) return flip();
    if (side === "sell") {
      setSellToken(token);
      setSellText("");
      setSell(undefined);
    } else {
      setBuyToken(token);
    }
  };

  const blocker = swapBlocker({
    sellToken,
    buyToken,
    sellAmount,
    insufficient: sell?.insufficient ?? false,
    error,
    quoting: isLoading || isStale,
    quote,
  });

  const buyText =
    quote && buyToken && !isStale ? formatUnits(quote.buyAmount, buyToken.decimals) : "";
  const rate =
    quote && sellToken && buyToken && sellAmount && !isStale
      ? formatRate(
          { token: sellToken, amount: sellAmount },
          { token: buyToken, amount: quote.buyAmount },
          { invert: invertRate },
        )
      : undefined;
  const impact = quote?.priceImpact;
  // What a person confirms before an agent's press reaches the wallet.
  const agentConfirm =
    !blocker && quote && sellToken && buyToken && sellAmount
      ? swapConfirmText({
          sell: { token: sellToken, amount: sellAmount },
          buy: { token: buyToken, amount: quote.buyAmount },
          priceImpact: impact,
          chainName: chains.find((c) => c.id === sellToken.chainId)?.name,
        })
      : undefined;

  const swapButton = (
    <TransactionButton
      chainId={sellToken?.chainId}
      transaction={!blocker ? quote?.transaction : undefined}
      disabledReason={blocker}
      agentConfirm={agentConfirm}
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

  const needsApproval = !blocker && sellToken && sellAmount && swapNeedsApproval(sellToken, quote);

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
        <Button
          variant="ghost"
          aria-label="Switch tokens"
          onClick={flip}
          // Sits on the seam between the panels. Keeps its centering while pressed.
          className="absolute top-1/2 left-1/2 z-10 h-auto -translate-x-1/2 -translate-y-1/2 rounded-xl border-4 border-background bg-muted p-2 hover:bg-accent dark:hover:bg-accent active:not-aria-[haspopup]:-translate-y-1/2"
        >
          <ArrowDownUpIcon aria-hidden className="size-4" />
        </Button>
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

      <div
        className="flex min-h-5 items-center justify-between gap-2 text-sm text-muted-foreground"
        aria-live="polite"
      >
        {error ? (
          <span role="alert" className="text-destructive">
            {(error as { shortMessage?: string }).shortMessage ?? error.message}
          </span>
        ) : rate ? (
          <Button
            variant="link"
            aria-label={`Invert rate: ${rate}`}
            onClick={() => setInvertRate((v) => !v)}
            // Reads as the rate line itself, not as a button.
            className="h-auto border-0 p-0 font-normal whitespace-normal text-inherit no-underline hover:text-foreground hover:no-underline active:not-aria-[haspopup]:translate-y-0"
          >
            <MorphText>{rate}</MorphText>
          </Button>
        ) : sellAmount && (isLoading || isStale) ? (
          <span>Fetching quote…</span>
        ) : (
          <span />
        )}
        {impact !== undefined && rate && (
          <span
            className={cn(
              priceImpactLevel(impact) === "danger" && "text-destructive",
              priceImpactLevel(impact) === "warn" && "text-amber-600 dark:text-amber-400",
            )}
          >
            <MorphText>{`Price impact ${impact.toFixed(2)}%`}</MorphText>
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
