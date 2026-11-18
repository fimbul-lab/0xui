import { ChevronDownIcon } from "lucide-react";
import { useId, useMemo, useState, type ReactNode } from "react";
import { Skeleton, SkeletonBox } from "skullet/react";
import { formatUnits, type Address } from "viem";
import { useChainId, useConnection } from "wagmi";
import { MorphText } from "@/components/morph-text";
import { TokenAmount } from "@/components/token-amount";
import { TokenIcon } from "@/components/token-icon";
import { useTokenBalances, type Token } from "@/components/token-select";
import { getTokenPrice, isNativeToken, looksLikeSpam, type TokenPrices } from "@/lib/token-list";
import { cn } from "@/lib/utils";

/** Why a holding is tucked under "Hidden tokens". */
export type HiddenReason = "spam" | "unlisted" | "unpriced" | "dust";

export type PortfolioRow = {
  token: Token;
  balance: bigint;
  /** Fiat value, when a price is known. */
  value: number | undefined;
  /** The token came from `holdings` and isn't on the token list. */
  unlisted?: boolean;
  /** Set when the row is hidden. */
  hidden?: HiddenReason;
};

/** A holding from your own source, with the token's metadata as that source reports it. */
export type PortfolioHolding = { token: Token; balance: bigint };

export type PortfolioFilters = {
  /**
   * Flags scam tokens. Defaults to `looksLikeSpam`. Pass your own to add
   * verdicts from a scanning service or your indexer, e.g.
   * `(t) => looksLikeSpam(t) || flagged.has(t.address)`.
   */
  isSpam?: (token: Token) => boolean;
  /**
   * Show `holdings` whose token isn't on the token list. Off by default: the
   * list is the allowlist, and an indexer returns every token an address
   * was ever sent.
   */
  showUnlisted?: boolean;
  /** Hide tokens without a price. Most airdropped spam has no market. */
  hideUnpriced?: boolean;
  /** Hide holdings worth less than this, in your currency. */
  minValue?: number;
};

/** Hidden reason for a holding, or undefined to show it. The native currency is always shown. */
export function hiddenReason(
  row: Omit<PortfolioRow, "hidden">,
  { isSpam = looksLikeSpam, showUnlisted = false, hideUnpriced = true, minValue = 0.5 }: PortfolioFilters = {}
): HiddenReason | undefined {
  if (isNativeToken(row.token)) return undefined;
  if (isSpam(row.token)) return "spam";
  if (row.unlisted && !showUnlisted) return "unlisted";
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
 *
 * Pass `holdings` when your indexer returns tokens with their own metadata.
 * Tokens on the list keep the list's metadata. The rest are hidden as
 * `unlisted` unless `showUnlisted` is set.
 */
export function usePortfolio({
  tokens = noTokens,
  prices = {},
  address,
  chainId: chainIdProp,
  hideZero = true,
  balances: balancesProp,
  holdings,
  isSpam,
  showUnlisted,
  hideUnpriced,
  minValue,
}: {
  tokens?: readonly Token[];
  prices?: TokenPrices;
  address?: Address;
  chainId?: number;
  hideZero?: boolean;
  /** Balances from your own source (e.g. an indexer), keyed by token address. Skips RPC reads. */
  balances?: ReadonlyMap<string, bigint> | Record<string, bigint>;
  /** Holdings from your own source, each with its token's metadata. Skips RPC reads and wins over `balances`. */
  holdings?: readonly PortfolioHolding[];
} & PortfolioFilters) {
  const currentChainId = useChainId();
  const chainId = chainIdProp ?? currentChainId;
  const onChain = useMemo(() => tokens.filter((t) => t.chainId === chainId), [tokens, chainId]);
  const external = Boolean(balancesProp || holdings);
  const rpc = useTokenBalances(onChain, { chainId, address, enabled: !external });
  const balances = useMemo(() => {
    if (!balancesProp) return rpc.balances;
    const entries = balancesProp instanceof Map ? [...balancesProp] : Object.entries(balancesProp);
    return new Map(entries.map(([key, value]) => [key.toLowerCase(), value]));
  }, [balancesProp, rpc.balances]);
  const isLoading = !external && rpc.isLoading;
  const isError = !external && rpc.isError;

  const { rows, hidden } = useMemo(() => {
    const listed = new Map(onChain.map((token) => [token.address.toLowerCase(), token]));
    const held = holdings
      ? holdings
          .filter((holding) => holding.token.chainId === chainId)
          .map(({ token, balance }) => {
            // The list's name and logo are the trusted ones.
            const known = listed.get(token.address.toLowerCase());
            return { token: known ?? token, balance, unlisted: !known };
          })
      : onChain.map((token) => ({
          token,
          balance: balances.get(token.address.toLowerCase()) ?? 0n,
          unlisted: false,
        }));
    const all: PortfolioRow[] = held
      .map((row) => {
        const price = getTokenPrice(prices, row.token);
        const value =
          price === undefined ? undefined : Number(formatUnits(row.balance, row.token.decimals)) * price;
        return { ...row, value };
      })
      .filter((row) => !hideZero || row.balance > 0n)
      .map((row) => ({
        ...row,
        hidden: hiddenReason(row, { isSpam, showUnlisted, hideUnpriced, minValue }),
      }))
      .sort(byValue);
    return { rows: all.filter((row) => !row.hidden), hidden: all.filter((row) => row.hidden) };
  }, [onChain, chainId, balances, holdings, prices, hideZero, isSpam, showUnlisted, hideUnpriced, minValue]);

  const total = rows.reduce((sum, row) => sum + (row.value ?? 0), 0);
  const unpriced = rows.filter((row) => row.value === undefined).length;

  return { rows, hidden, total, unpriced, isLoading, isError };
}

const noTokens: readonly Token[] = [];
const noHoldings: readonly PortfolioHolding[] = [];

export type PortfolioProps = PortfolioFilters & {
  /** Tokens to show. With `holdings`, the allowlist: holdings off it are hidden unless `showUnlisted`. */
  tokens?: readonly Token[];
  /** Prices keyed by `chainId:address`, address or symbol. Tokens without one are hidden by default. */
  prices?: TokenPrices;
  /** Whose holdings. Defaults to the connected account. */
  address?: Address;
  chainId?: number;
  /** Hide tokens with a zero balance. */
  hideZero?: boolean;
  currency?: string;
  /** BCP 47 locale for amounts and values. Defaults to the runtime locale; set it when rendering on a server. */
  locale?: string;
  /** Balances from your own source, e.g. an indexer. See usePortfolio. */
  balances?: ReadonlyMap<string, bigint> | Record<string, bigint>;
  /** Holdings from your own source, each with its token's metadata. See usePortfolio. */
  holdings?: readonly PortfolioHolding[];
  /**
   * Your own `balances` or `holdings` are still loading, e.g. `query.isLoading`.
   * Shows the skeleton and skips RPC reads. Set over data you already have
   * (a refetch), the skeleton takes that data's exact shape.
   */
  isLoading?: boolean;
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

/** SkeletonBox is a block by default. This one sits in a line of text. */
const inlineBox = { display: "inline-block", verticalAlign: "middle" } as const;

/** Stand-in rows the loading skeleton is measured from. Never shown as text. */
const sampleRow = (index: number, name: string, balance: bigint, value: number): PortfolioRow => ({
  token: {
    chainId: 0,
    address: `0x${String(index).padStart(40, "0")}`,
    name,
    symbol: "TKN",
    decimals: 18,
  },
  balance,
  value,
});
const sampleRows = [
  sampleRow(1, "Sample token", 1_234_500_000_000_000_000n, 3210.55),
  sampleRow(2, "Another token", 250_000_000_000_000_000_000n, 250.1),
  sampleRow(3, "Third one", 4_200_000_000_000_000_000n, 42.07),
];

function Holding({
  row,
  money,
  locale,
  note,
}: {
  row: PortfolioRow;
  money: Intl.NumberFormat;
  locale?: string;
  note?: string;
}) {
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
          locale={locale}
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
 * dust are collapsed under "Hidden tokens", out of the total. Shows a skeleton
 * measured from sample rows while loading and an empty state when there's nothing to show.
 */
export function Portfolio({
  tokens,
  prices,
  address: addressProp,
  chainId,
  hideZero = true,
  currency = "USD",
  locale,
  balances,
  holdings,
  isLoading: isLoadingProp = false,
  isSpam,
  showUnlisted,
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
    // Your own data is on its way: don't fall back to RPC reads meanwhile.
    holdings: holdings ?? (isLoadingProp && !balances ? noHoldings : undefined),
    isSpam,
    showUnlisted,
    hideUnpriced,
    minValue,
  });
  const money = new Intl.NumberFormat(locale, { style: "currency", currency });
  const notes: Record<HiddenReason, string> = {
    spam: "Likely spam",
    unlisted: "Not on the token list",
    unpriced: "No price",
    dust: `Under ${money.format(minValue)}`,
  };
  const phase = isLoadingProp
    ? "loading"
    : !address && !balances && !holdings
      ? "idle"
      : isLoading
        ? "loading"
        : isError
          ? "error"
          : rows.length || hidden.length
            ? "ready"
            : "empty";
  // The skeleton is measured from what will be shown: the real rows when they
  // are already known (your own data, a refetch), sample rows otherwise.
  const known = rows.length > 0 || hidden.length > 0;
  const listRows = phase === "loading" && !known ? sampleRows : rows.slice(0, visible);

  return (
    <section
      data-slot="portfolio"
      data-phase={phase}
      aria-label={typeof title === "string" ? title : "Portfolio"}
      className={cn("flex flex-col gap-3 rounded-2xl border p-4", className)}
    >
      <header className="flex items-baseline justify-between gap-2">
        {title && <h3 className="font-semibold">{title}</h3>}
        {phase === "loading" && (
          <span className="text-2xl font-semibold">
            {/* About the width of "$1,234.56". */}
            <SkeletonBox width="9ch" height="1em" style={inlineBox} />
          </span>
        )}
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

      {/* One tree for loading and ready: while loading it is measured into a
          skeleton, so the content arrives exactly where its skeleton was. */}
      {(phase === "loading" || phase === "ready") && (
        <Skeleton loading={phase === "loading"} label="Loading tokens">
          <div className="flex flex-col gap-3">
            {phase === "ready" && rows.length === 0 && (
              <p className="py-4 text-center text-sm text-muted-foreground">Every token in this wallet is hidden.</p>
            )}
            {listRows.length > 0 && (
              <ul className="flex flex-col">
                {listRows.map((row) => (
                  <Holding
                    key={`${row.token.chainId}-${row.token.address}`}
                    row={row}
                    money={money}
                    locale={locale}
                  />
                ))}
              </ul>
            )}
            {rows.length > visible && (
              <ShowMore remaining={rows.length - visible} onClick={() => setVisible((v) => v + pageSize)} />
            )}

            {hidden.length > 0 && (
              <div className="flex flex-col border-t pt-2">
                <button
                  type="button"
                  aria-expanded={showHidden}
                  aria-controls={hiddenId}
                  onClick={() => setShowHidden((s) => !s)}
                  className="flex items-center justify-between rounded-md py-1.5 text-sm text-muted-foreground hover:text-foreground"
                >
                  Hidden tokens ({hidden.length})
                  <ChevronDownIcon
                    aria-hidden
                    className={cn("size-4 transition-transform", showHidden && "rotate-180")}
                  />
                </button>
                {showHidden && (
                  <>
                    <ul id={hiddenId} aria-label="Hidden tokens" className="flex flex-col opacity-80">
                      {hidden.slice(0, hiddenVisible).map((row) => (
                        <Holding
                          key={`${row.token.chainId}-${row.token.address}`}
                          row={row}
                          money={money}
                          locale={locale}
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
          </div>
        </Skeleton>
      )}
    </section>
  );
}
