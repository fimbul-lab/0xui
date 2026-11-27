import { formatUnits } from "viem";
import { getTokenPrice, isNativeToken, looksLikeSpam } from "@/lib/token-list";
import type { TokenInfo, TokenPrices } from "@/lib/token-list";

/** Why a holding is tucked under "Hidden tokens". */
export type HiddenReason = "spam" | "unlisted" | "unpriced" | "dust";

export type PortfolioRow = {
  token: TokenInfo;
  balance: bigint;
  /** Fiat value, when a price is known. */
  value: number | undefined;
  /** The token came from `holdings` and isn't on the token list. */
  unlisted?: boolean;
  /** Set when the row is hidden. */
  hidden?: HiddenReason;
};

/** A holding from your own source, with the token's metadata as that source reports it. */
export type PortfolioHolding = { token: TokenInfo; balance: bigint };

export type PortfolioFilters = {
  /**
   * Flags scam tokens. Defaults to `looksLikeSpam`. Pass your own to add
   * verdicts from a scanning service or your indexer, e.g.
   * `(t) => looksLikeSpam(t) || flagged.has(t.address)`.
   */
  isSpam?: (token: TokenInfo) => boolean;
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
  {
    isSpam = looksLikeSpam,
    showUnlisted = false,
    hideUnpriced = true,
    minValue = 0.5,
  }: PortfolioFilters = {},
): HiddenReason | undefined {
  if (isNativeToken(row.token)) {
    return undefined;
  }
  if (isSpam(row.token)) {
    return "spam";
  }
  if (row.unlisted && !showUnlisted) {
    return "unlisted";
  }
  if (row.value === undefined) {
    return hideUnpriced ? "unpriced" : undefined;
  }
  if (row.value < minValue) {
    return "dust";
  }
  return undefined;
}

const byValue = (a: PortfolioRow, b: PortfolioRow) =>
  (b.value ?? -1) - (a.value ?? -1) ||
  Number(formatUnits(b.balance, b.token.decimals)) -
    Number(formatUnits(a.balance, a.token.decimals));

/** Balances from your own source, keyed by token address in any case. */
export type PortfolioBalances = ReadonlyMap<string, bigint> | Record<string, bigint>;

/** Balances keyed by lowercase address. */
export function normalizeBalances(balances: PortfolioBalances): Map<string, bigint> {
  // A map is iterable and a plain record is not, even across realms.
  const entries = Symbol.iterator in balances ? [...balances] : Object.entries(balances);
  return new Map(entries.map(([key, value]) => [key.toLowerCase(), value]));
}

export type PortfolioInput = {
  /** The token list, already narrowed to `chainId`. */
  tokens: ReadonlyArray<TokenInfo>;
  chainId: number;
  /** Balances by lowercase address, for `tokens`. Ignored when `holdings` is set. */
  balances: ReadonlyMap<string, bigint>;
  /** Holdings with their own metadata. Win over `balances`. */
  holdings?: ReadonlyArray<PortfolioHolding>;
  prices?: TokenPrices;
  hideZero?: boolean;
} & PortfolioFilters;

export type PortfolioSummary = {
  /** Shown holdings, by value then amount. */
  rows: Array<PortfolioRow>;
  /** Holdings tucked away, each with its reason. */
  hidden: Array<PortfolioRow>;
  /** Fiat total of the shown rows. */
  total: number;
  /** Shown rows without a price, left out of the total. */
  unpriced: number;
};

/**
 * Holdings for a token list, valued with `prices` and sorted by value, then
 * by amount for tokens without a price. Likely spam, unpriced tokens and
 * dust go to `hidden` rather than `rows`, so the total isn't inflated and
 * nothing is lost. Tokens on the list keep the list's metadata; holdings off
 * it are hidden as `unlisted` unless `showUnlisted` is set.
 */
export function summarizePortfolio({
  tokens,
  chainId,
  balances,
  holdings,
  prices = {},
  hideZero = true,
  ...filters
}: PortfolioInput): PortfolioSummary {
  const listed = new Map(tokens.map((token) => [token.address.toLowerCase(), token]));
  const held = holdings
    ? holdings
        .filter((holding) => holding.token.chainId === chainId)
        .map(({ token, balance }) => {
          // The list's name and logo are the trusted ones.
          const known = listed.get(token.address.toLowerCase());
          return { token: known ?? token, balance, unlisted: !known };
        })
    : tokens.map((token) => ({
        token,
        balance: balances.get(token.address.toLowerCase()) ?? 0n,
        unlisted: false,
      }));
  const all: Array<PortfolioRow> = held
    .map((row) => {
      const price = getTokenPrice(prices, row.token);
      const value =
        price === undefined
          ? undefined
          : Number(formatUnits(row.balance, row.token.decimals)) * price;
      return { ...row, value };
    })
    .filter((row) => !hideZero || row.balance > 0n)
    .map((row) => ({ ...row, hidden: hiddenReason(row, filters) }))
    .sort(byValue);
  const rows = all.filter((row) => !row.hidden);
  return {
    rows,
    hidden: all.filter((row) => row.hidden),
    total: rows.reduce((sum, row) => sum + (row.value ?? 0), 0),
    unpriced: rows.filter((row) => row.value === undefined).length,
  };
}

export type PortfolioPhase = "idle" | "loading" | "error" | "empty" | "ready";

export function portfolioPhase({
  loadingProp,
  hasSource,
  isLoading,
  isError,
  count,
}: {
  /** The caller says its own data is loading. */
  loadingProp: boolean;
  /** An account, `balances` or `holdings` to read from. */
  hasSource: boolean;
  isLoading: boolean;
  isError: boolean;
  /** Shown plus hidden rows. */
  count: number;
}): PortfolioPhase {
  if (loadingProp) {
    return "loading";
  }
  if (!hasSource) {
    return "idle";
  }
  if (isLoading) {
    return "loading";
  }
  if (isError) {
    return "error";
  }
  return count ? "ready" : "empty";
}
