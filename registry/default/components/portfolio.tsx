import { ChevronDownIcon } from "lucide-react";
import { useId, useMemo, useState, type ReactNode } from "react";
import { formatUnits, type Address } from "viem";
import { useChainId, useConnection } from "wagmi";
import { MorphText } from "@/components/morph-text";
import { TokenAmount } from "@/components/token-amount";
import { TokenIcon } from "@/components/token-icon";
import { useTokenBalances, type Token } from "@/components/token-select";
import { getTokenPrice, isNativeToken, looksLikeSpam, type TokenPrices } from "@/lib/token-list";
import { cn } from "@/lib/utils";

/** Why a holding is tucked under "Hidden tokens". */
export type HiddenReason = "spam" | "unpriced" | "dust";

export type PortfolioRow = {
  token: Token;
  balance: bigint;
  /** Fiat value, when a price is known. */
  value: number | undefined;
  /** Set when the row is hidden. */
  hidden?: HiddenReason;
};

export type PortfolioFilters = {
  /**
   * Flags scam tokens. Defaults to `looksLikeSpam`. Pass your own to add
   * verdicts from a scanning service or your indexer, e.g.
   * `(t) => looksLikeSpam(t) || flagged.has(t.address)`.
   */
  isSpam?: (token: Token) => boolean;
  /** Hide tokens without a price. Most airdropped spam has no market. */
  hideUnpriced?: boolean;
  /** Hide holdings worth less than this, in your currency. */
  minValue?: number;
};

/** Hidden reason for a holding, or undefined to show it. The native currency is always shown. */
export function hiddenReason(
  row: Omit<PortfolioRow, "hidden">,
  { isSpam = looksLikeSpam, hideUnpriced = true, minValue = 0.5 }: PortfolioFilters = {}
): HiddenReason | undefined {
  if (isNativeToken(row.token)) return undefined;
  if (isSpam(row.token)) return "spam";
  if (row.value === undefined) return hideUnpriced ? "unpriced" : undefined;
  if (row.value < minValue) return "dust";
  return undefined;
}

const byValue = (a: PortfolioRow, b: PortfolioRow) =>
  (b.value ?? -1) - (a.value ?? -1) ||
  Number(formatUnits(b.balance, b.token.decimals)) - Number(formatUnits(a.balance, a.token.decimals));

/**
 * Holdings for a token list, valued with `prices` and sorted by value, then
 * by amount for tokens without a price. Likely spam, unpriced tokens and
 * dust go to `hidden` rather than `rows`, so the total isn't inflated and
 * nothing is lost: show them on request.
 */
export function usePortfolio({
  tokens,
  prices = {},
  address,
  chainId: chainIdProp,
  hideZero = true,
  balances: balancesProp,
  isSpam,
  hideUnpriced,
  minValue,
}: {
  tokens: readonly Token[];
  prices?: TokenPrices;
  address?: Address;
  chainId?: number;
  hideZero?: boolean;
  /** Balances from your own source (e.g. an indexer), keyed by token address. Skips RPC reads. */
  balances?: ReadonlyMap<string, bigint> | Record<string, bigint>;
} & PortfolioFilters) {
  const currentChainId = useChainId();
  const chainId = chainIdProp ?? currentChainId;
  const onChain = useMemo(() => tokens.filter((t) => t.chainId === chainId), [tokens, chainId]);
  const rpc = useTokenBalances(onChain, { chainId, address, enabled: !balancesProp });
  const balances = useMemo(() => {
    if (!balancesProp) return rpc.balances;
    const entries = balancesProp instanceof Map ? [...balancesProp] : Object.entries(balancesProp);
    return new Map(entries.map(([key, value]) => [key.toLowerCase(), value]));
  }, [balancesProp, rpc.balances]);
  const isLoading = !balancesProp && rpc.isLoading;
  const isError = !balancesProp && rpc.isError;

  const { rows, hidden } = useMemo(() => {
    const all: PortfolioRow[] = onChain
      .map((token) => {
        const balance = balances.get(token.address.toLowerCase()) ?? 0n;
        const price = getTokenPrice(prices, token);
        const value = price === undefined ? undefined : Number(formatUnits(balance, token.decimals)) * price;
        return { token, balance, value };
      })
      .filter((row) => !hideZero || row.balance > 0n)
      .map((row) => ({ ...row, hidden: hiddenReason(row, { isSpam, hideUnpriced, minValue }) }))
      .sort(byValue);
    return { rows: all.filter((row) => !row.hidden), hidden: all.filter((row) => row.hidden) };
  }, [onChain, balances, prices, hideZero, isSpam, hideUnpriced, minValue]);

  const total = rows.reduce((sum, row) => sum + (row.value ?? 0), 0);
  const unpriced = rows.filter((row) => row.value === undefined).length;

  return { rows, hidden, total, unpriced, isLoading, isError };
}

export type PortfolioProps = PortfolioFilters & {
  tokens: readonly Token[];
  /** Prices keyed by `chainId:address`, address or symbol. Tokens without one are hidden by default. */
  prices?: TokenPrices;
  /** Whose holdings. Defaults to the connected account. */
  address?: Address;
  chainId?: number;
  /** Hide tokens with a zero balance. */
  hideZero?: boolean;
  currency?: string;
  /** Balances from your own source, e.g. an indexer. See usePortfolio. */
  balances?: ReadonlyMap<string, bigint> | Record<string, bigint>;
  /** Rows per page, with "Show more" for the rest. */
  pageSize?: number;
  title?: ReactNode;
  className?: string;
};

function ShowMore({ remaining, onClick }: { remaining: number; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="self-center rounded-md px-3 py-1.5 text-sm font-medium hover:bg-muted"
    >
      Show more ({remaining})
    </button>
  );
}

function Holding({ row, money, note }: { row: PortfolioRow; money: Intl.NumberFormat; note?: string }) {
  const { token, balance, value } = row;
  return (
    <li data-hidden={row.hidden} className="flex items-center gap-3 py-2">
      {/* Spam logos can be offensive or link to scams: letters only. */}
      <TokenIcon symbol={token.symbol} src={row.hidden === "spam" ? undefined : token.logoURI} size={32} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-medium">{token.name}</span>
        <TokenAmount
          value={balance}
          decimals={token.decimals}
          symbol={token.symbol}
          className="truncate text-xs text-muted-foreground"
        />
      </span>
      <span className="flex shrink-0 flex-col items-end text-sm tabular-nums">
        {value === undefined ? <span className="text-muted-foreground">—</span> : money.format(value)}
        {note && <span className="text-xs text-muted-foreground">{note}</span>}
      </span>
    </li>
  );
}

/**
 * Token holdings list: total value on top, then one row per token with
 * amount and value, largest first. Likely spam, tokens without a price and
 * dust are collapsed under "Hidden tokens", out of the total. Shows skeleton
 * rows while loading and an empty state when there's nothing to show.
 */
export function Portfolio({
  tokens,
  prices,
  address: addressProp,
  chainId,
  hideZero = true,
  currency = "USD",
  balances,
  isSpam,
  hideUnpriced,
  minValue = 0.5,
  pageSize = 10,
  title = "Portfolio",
  className,
}: PortfolioProps) {
  const [visible, setVisible] = useState(pageSize);
  const [showHidden, setShowHidden] = useState(false);
  const [hiddenVisible, setHiddenVisible] = useState(pageSize);
  const hiddenId = useId();
  const { address: connected } = useConnection();
  const address = addressProp ?? connected;
  const { rows, hidden, total, unpriced, isLoading, isError } = usePortfolio({
    tokens,
    prices,
    address,
    chainId,
    hideZero,
    balances,
    isSpam,
    hideUnpriced,
    minValue,
  });
  const money = new Intl.NumberFormat(undefined, { style: "currency", currency });
  const notes: Record<HiddenReason, string> = {
    spam: "Likely spam",
    unpriced: "No price",
    dust: `Under ${money.format(minValue)}`,
  };
  const phase =
    !address && !balances
      ? "idle"
      : isLoading
        ? "loading"
        : isError
          ? "error"
          : rows.length || hidden.length
            ? "ready"
            : "empty";

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
            <MorphText>{money.format(total)}</MorphText>
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

      {phase === "ready" && rows.length === 0 && (
        <p className="py-4 text-center text-sm text-muted-foreground">Every token in this wallet is hidden.</p>
      )}
      {phase === "ready" && rows.length > 0 && (
        <ul className="flex flex-col">
          {rows.slice(0, visible).map((row) => (
            <Holding key={`${row.token.chainId}-${row.token.address}`} row={row} money={money} />
          ))}
        </ul>
      )}
      {phase === "ready" && rows.length > visible && (
        <ShowMore remaining={rows.length - visible} onClick={() => setVisible((v) => v + pageSize)} />
      )}

      {phase === "ready" && hidden.length > 0 && (
        <div className="flex flex-col border-t pt-2">
          <button
            type="button"
            aria-expanded={showHidden}
            aria-controls={hiddenId}
            onClick={() => setShowHidden((s) => !s)}
            className="flex items-center justify-between rounded-md py-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            Hidden tokens ({hidden.length})
            <ChevronDownIcon aria-hidden className={cn("size-4 transition-transform", showHidden && "rotate-180")} />
          </button>
          {showHidden && (
            <>
              <ul id={hiddenId} aria-label="Hidden tokens" className="flex flex-col opacity-80">
                {hidden.slice(0, hiddenVisible).map((row) => (
                  <Holding
                    key={`${row.token.chainId}-${row.token.address}`}
                    row={row}
                    money={money}
                    note={notes[row.hidden!]}
                  />
                ))}
              </ul>
              {hidden.length > hiddenVisible && (
                <ShowMore
                  remaining={hidden.length - hiddenVisible}
                  onClick={() => setHiddenVisible((v) => v + pageSize)}
                />
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}
