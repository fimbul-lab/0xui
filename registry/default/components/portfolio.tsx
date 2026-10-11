import { useMemo, type ReactNode } from "react";
import { formatUnits, type Address } from "viem";
import { useChainId, useConnection } from "wagmi";
import { TokenAmount } from "@/components/token-amount";
import { TokenIcon } from "@/components/token-icon";
import { useTokenBalances, type Token } from "@/components/token-select";
import { cn } from "@/lib/utils";

export type PortfolioRow = {
  token: Token;
  balance: bigint;
  /** Fiat value, when a price is known. */
  value: number | undefined;
};

/**
 * Holdings for a token list, valued with `prices` (keyed by symbol) and
 * sorted by value, then by amount for tokens without a price.
 */
export function usePortfolio({
  tokens,
  prices = {},
  address,
  chainId: chainIdProp,
  hideZero = true,
}: {
  tokens: readonly Token[];
  prices?: Record<string, number>;
  address?: Address;
  chainId?: number;
  hideZero?: boolean;
}) {
  const currentChainId = useChainId();
  const chainId = chainIdProp ?? currentChainId;
  const onChain = useMemo(() => tokens.filter((t) => t.chainId === chainId), [tokens, chainId]);
  const { balances, isLoading, isError } = useTokenBalances(onChain, { chainId, address });

  const rows = useMemo(() => {
    const list: PortfolioRow[] = onChain.map((token) => {
      const balance = balances.get(token.address.toLowerCase()) ?? 0n;
      const price = prices[token.symbol];
      return {
        token,
        balance,
        value: price === undefined ? undefined : Number(formatUnits(balance, token.decimals)) * price,
      };
    });
    return list
      .filter((row) => !hideZero || row.balance > 0n)
      .sort(
        (a, b) =>
          (b.value ?? -1) - (a.value ?? -1) ||
          Number(formatUnits(b.balance, b.token.decimals)) - Number(formatUnits(a.balance, a.token.decimals))
      );
  }, [onChain, balances, prices, hideZero]);

  const total = rows.reduce((sum, row) => sum + (row.value ?? 0), 0);
  const unpriced = rows.filter((row) => row.value === undefined).length;

  return { rows, total, unpriced, isLoading, isError };
}

export type PortfolioProps = {
  tokens: readonly Token[];
  /** Price per token symbol. Tokens without a price are listed without a value. */
  prices?: Record<string, number>;
  /** Whose holdings. Defaults to the connected account. */
  address?: Address;
  chainId?: number;
  /** Hide tokens with a zero balance. */
  hideZero?: boolean;
  currency?: string;
  title?: ReactNode;
  className?: string;
};

/**
 * Token holdings list: total value on top, then one row per token with
 * amount and value, largest first. Shows skeleton rows while loading and an
 * empty state when there's nothing to show.
 */
export function Portfolio({
  tokens,
  prices,
  address: addressProp,
  chainId,
  hideZero = true,
  currency = "USD",
  title = "Portfolio",
  className,
}: PortfolioProps) {
  const { address: connected } = useConnection();
  const address = addressProp ?? connected;
  const { rows, total, unpriced, isLoading, isError } = usePortfolio({
    tokens,
    prices,
    address,
    chainId,
    hideZero,
  });
  const money = new Intl.NumberFormat(undefined, { style: "currency", currency });
  const phase = !address ? "idle" : isLoading ? "loading" : isError ? "error" : rows.length ? "ready" : "empty";

  return (
    <section
      data-slot="portfolio"
      data-phase={phase}
      aria-label={typeof title === "string" ? title : "Portfolio"}
      className={cn("flex flex-col gap-3 rounded-2xl border p-4", className)}
    >
      <header className="flex items-baseline justify-between gap-2">
        {title && <h3 className="font-semibold">{title}</h3>}
        {phase === "ready" && (
          <span className="text-2xl font-semibold tabular-nums">
            {money.format(total)}
            {unpriced > 0 && <span className="sr-only">, plus {unpriced} tokens without a price</span>}
          </span>
        )}
      </header>

      {phase === "idle" && (
        <p className="py-6 text-center text-sm text-muted-foreground">Connect a wallet to see its tokens.</p>
      )}
      {phase === "error" && (
        <p role="alert" className="py-6 text-center text-sm text-destructive">
          Couldn't load balances. Check your connection and try again.
        </p>
      )}
      {phase === "empty" && (
        <p className="py-6 text-center text-sm text-muted-foreground">No tokens from this list in this wallet.</p>
      )}

      {phase === "loading" && (
        <ul aria-label="Loading tokens" className="flex flex-col gap-1">
          {[0, 1, 2].map((i) => (
            <li key={i} className="flex items-center gap-3 py-2">
              <span className="size-8 animate-pulse rounded-full bg-muted" />
              <span className="h-4 w-24 animate-pulse rounded bg-muted" />
              <span className="ml-auto h-4 w-16 animate-pulse rounded bg-muted" />
            </li>
          ))}
        </ul>
      )}

      {phase === "ready" && (
        <ul className="flex flex-col">
          {rows.map(({ token, balance, value }) => (
            <li key={`${token.chainId}-${token.address}`} className="flex items-center gap-3 py-2">
              <TokenIcon symbol={token.symbol} src={token.logoURI} size={32} />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm font-medium">{token.name}</span>
                <TokenAmount
                  value={balance}
                  decimals={token.decimals}
                  symbol={token.symbol}
                  className="text-xs text-muted-foreground"
                />
              </span>
              <span className="text-sm tabular-nums">
                {value === undefined ? <span className="text-muted-foreground">—</span> : money.format(value)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
