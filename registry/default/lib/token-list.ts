// Docs: https://0xui.io/getting-started/token-lists.md
import { getAddress, isAddress } from "viem";
import type { Address, Chain } from "viem";
import { resolveUri } from "@/lib/0xui-utils";

/**
 * A token, as defined by the token list standard (https://tokenlists.org),
 * the format of Uniswap's lists, CoinGecko's and most others.
 */
export type TokenInfo = {
  chainId: number;
  address: Address;
  name: string;
  symbol: string;
  decimals: number;
  /** Logo URL. May be `ipfs://`. Resolve with `resolveUri`. */
  logoURI?: string;
  /** Keys into the list's `tags`. */
  tags?: Array<string>;
  /** List-specific data, e.g. Uniswap's `bridgeInfo` (the same token on other chains). */
  // oxlint-disable-next-line quality/no-unsafe-dictionary-type -- the token list format allows any JSON here
  extensions?: {
    bridgeInfo?: Record<string, { tokenAddress: Address }>;
    [key: string]: unknown;
  };
};

/** A token list (https://tokenlists.org schema). */
export type TokenList = {
  name: string;
  timestamp: string;
  version: { major: number; minor: number; patch: number };
  tokens: Array<TokenInfo>;
  logoURI?: string;
  keywords?: Array<string>;
  tags?: Record<string, { name: string; description: string }>;
};

/** Uniswap Labs' default list: about 1,800 tokens across Ethereum, Base, Arbitrum, Optimism, Polygon and more. */
export const UNISWAP_DEFAULT_LIST = "https://tokens.uniswap.org";

/** Placeholder address lists and apps use for a chain's native currency. */
export const NATIVE_TOKEN_ADDRESS = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE" as const;

export function isNativeToken(token: Pick<TokenInfo, "address">) {
  return token.address.toLowerCase() === NATIVE_TOKEN_ADDRESS.toLowerCase();
}

/**
 * The chain's native currency as a token-list entry. Token lists don't
 * include it (Uniswap's has WETH, not ETH), so apps add it themselves.
 */
export function nativeToken(
  chain: Pick<Chain, "id" | "nativeCurrency">,
  logoURI?: string,
): TokenInfo {
  return {
    chainId: chain.id,
    address: NATIVE_TOKEN_ADDRESS,
    name: chain.nativeCurrency.name,
    symbol: chain.nativeCurrency.symbol,
    decimals: chain.nativeCurrency.decimals,
    logoURI,
  };
}

function isTokenInfo(value: unknown): value is TokenInfo {
  return (
    typeof value === "object" &&
    value !== null &&
    "chainId" in value &&
    Number.isInteger(value.chainId) &&
    "address" in value &&
    typeof value.address === "string" &&
    // Lists can include non-EVM chains (e.g. Solana). Keep EVM addresses only.
    isAddress(value.address, { strict: false }) &&
    "symbol" in value &&
    typeof value.symbol === "string" &&
    "name" in value &&
    typeof value.name === "string" &&
    "decimals" in value &&
    typeof value.decimals === "number" &&
    Number.isInteger(value.decimals) &&
    value.decimals >= 0 &&
    value.decimals <= 255
  );
}

/**
 * Check that `json` is a token list and clean its tokens: entries that
 * aren't valid EVM tokens are dropped and addresses are checksummed.
 * Throws when `json` isn't a token list at all.
 */
export function parseTokenList(json: unknown): TokenList {
  if (
    typeof json !== "object" ||
    json === null ||
    !("tokens" in json) ||
    !Array.isArray(json.tokens) ||
    !("name" in json) ||
    typeof json.name !== "string"
  ) {
    throw new Error("Not a token list: expected an object with `name` and `tokens`.");
  }
  const tokens: Array<unknown> = json.tokens;
  // Fields the type promises are checked; ones a list gets wrong are left out.
  return {
    ...json,
    name: json.name,
    timestamp: "timestamp" in json && typeof json.timestamp === "string" ? json.timestamp : "",
    version:
      "version" in json && isVersion(json.version)
        ? json.version
        : { major: 0, minor: 0, patch: 0 },
    tokens: tokens.flatMap((t) =>
      isTokenInfo(t) ? [{ ...t, address: getAddress(t.address) }] : [],
    ),
    logoURI: "logoURI" in json && typeof json.logoURI === "string" ? json.logoURI : undefined,
    keywords: "keywords" in json && isStringArray(json.keywords) ? json.keywords : undefined,
    tags: "tags" in json && isTags(json.tags) ? json.tags : undefined,
  };
}

function isVersion(value: unknown): value is TokenList["version"] {
  return (
    typeof value === "object" &&
    value !== null &&
    "major" in value &&
    typeof value.major === "number" &&
    "minor" in value &&
    typeof value.minor === "number" &&
    "patch" in value &&
    typeof value.patch === "number"
  );
}

const isStringArray = (value: unknown): value is Array<string> =>
  Array.isArray(value) && value.every((item) => typeof item === "string");

function isTags(value: unknown): value is NonNullable<TokenList["tags"]> {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const tags: Array<unknown> = Object.values(value);
  return tags.every(
    (tag) =>
      typeof tag === "object" &&
      tag !== null &&
      "name" in tag &&
      typeof tag.name === "string" &&
      "description" in tag &&
      typeof tag.description === "string",
  );
}

/** Download and parse a token list. `ipfs://` and `ar://` URLs go through a gateway. */
export async function fetchTokenList(url: string, { gateway }: { gateway?: string } = {}) {
  const response = await fetch(resolveUri(url, gateway));
  if (!response.ok) {
    throw new Error(`Couldn't load token list ${url} (${response.status})`);
  }
  return parseTokenList(await response.json());
}

/** TanStack Query options that download a token list, cached for the session. */
export function tokenListQueryOptions(url: string, { gateway }: { gateway?: string } = {}) {
  return {
    queryKey: ["0xui", "token-list", url, gateway] as const,
    queryFn: () => fetchTokenList(url, { gateway }),
    staleTime: 60 * 60_000,
    gcTime: Number.POSITIVE_INFINITY,
    retry: 1,
  };
}

/**
 * Tokens from several lists, merged. The first list wins when two lists
 * share a token (same chain and address).
 */
export function mergeTokenLists(lists: ReadonlyArray<Pick<TokenList, "tokens">>) {
  const seen = new Set<string>();
  const tokens: Array<TokenInfo> = [];
  for (const list of lists) {
    for (const token of list.tokens) {
      const key = `${token.chainId}:${token.address.toLowerCase()}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      tokens.push(token);
    }
  }
  return tokens;
}

export type TokenFilters = {
  /**
   * Only these tokens (a whitelist). Entries are addresses, or
   * `chainId:address` to pin a chain. Symbols aren't accepted: spam tokens
   * copy the symbols of real ones.
   */
  allowlist?: ReadonlyArray<string>;
  /** Never these tokens (a blacklist), e.g. known scams. Same format as `allowlist`. */
  blocklist?: ReadonlyArray<string>;
};

function matcher(entries: ReadonlyArray<string>) {
  const set = new Set(entries.map((e) => e.toLowerCase()));
  return (token: Pick<TokenInfo, "chainId" | "address">) => {
    const address = token.address.toLowerCase();
    return set.has(address) || set.has(`${token.chainId}:${address}`);
  };
}

/**
 * Apply an allowlist and/or blocklist to tokens. The blocklist wins when a
 * token is on both.
 */
export function applyTokenFilters<T extends Pick<TokenInfo, "chainId" | "address">>(
  tokens: ReadonlyArray<T>,
  { allowlist, blocklist }: TokenFilters,
): Array<T> {
  const allowed = allowlist ? matcher(allowlist) : () => true;
  const blocked = blocklist ? matcher(blocklist) : () => false;
  return tokens.filter((t) => allowed(t) && !blocked(t));
}

export type SelectTokensOptions = TokenFilters & {
  /** Only tokens on this chain, or every chain with null. */
  chainId: number | null;
  /** The chain whose native currency goes first. Leave out to skip it. */
  nativeChain?: Pick<Chain, "id" | "nativeCurrency">;
  /** Extra tokens, e.g. ones the user imported. They come first and win over list entries. */
  extraTokens?: ReadonlyArray<TokenInfo>;
};

/** The tokens of loaded lists for one chain: merged, filtered, with the native currency first. */
export function selectTokens(
  lists: ReadonlyArray<Pick<TokenList, "tokens">>,
  { chainId, nativeChain, extraTokens = [], allowlist, blocklist }: SelectTokensOptions,
) {
  const merged = mergeTokenLists([{ tokens: [...extraTokens] }, ...lists]);
  const filtered = applyTokenFilters(merged, { allowlist, blocklist });
  const onChain = chainId === null ? filtered : filtered.filter((t) => t.chainId === chainId);
  // Filters don't apply to the native currency: it can't be spoofed. Skip it
  // if a list (or extraTokens) already has an entry for it.
  if (!nativeChain || onChain.some(isNativeToken)) {
    return onChain;
  }
  return [nativeToken(nativeChain), ...onChain];
}

/**
 * Prices in your currency, keyed by `chainId:address`, address or symbol.
 * Prefer address keys: spam tokens copy the symbols of real ones, and one
 * symbol can mean different tokens on different chains.
 */
export type TokenPrices = Readonly<Record<string, number>>;

/** A token's price from `prices`. Address keys win over the symbol. */
export function getTokenPrice(
  prices: TokenPrices | undefined,
  token: Pick<TokenInfo, "chainId" | "address" | "symbol">,
) {
  if (!prices) {
    return undefined;
  }
  const lower = token.address.toLowerCase();
  return (
    prices[`${token.chainId}:${lower}`] ??
    prices[`${token.chainId}:${token.address}`] ??
    prices[lower] ??
    prices[token.address] ??
    prices[token.symbol]
  );
}

// "Visit x.com to claim", links, and Telegram handles: phishing airdrops.
const SPAM_TEXT =
  /https?:\/\/|www\.|t\.me\/|\b(claim|claimable|visit|airdrop|rewards?|voucher|bonus)\b/i;
// A domain as the symbol, e.g. "ETHGIFT.COM". Names can be real projects (Ether.fi, io.net).
const DOMAIN_SYMBOL = /\.(com|io|org|net|xyz|app|site|top|gift|cc|vip|me|live|pro|club|fun)$/i;
const INVISIBLE = /[​-‏⁠﻿]/;
const LATIN = /\p{Script=Latin}/u;
const LOOKALIKE = /[\p{Script=Cyrillic}\p{Script=Greek}\p{Script=Armenian}\p{Script=Cherokee}]/u;

/**
 * Cheap checks for scam tokens: names that advertise a site or a claim,
 * invisible characters, and Latin text mixed with lookalike letters (a
 * Cyrillic "С" in "USDС"). Catches the common airdrop spam, not everything:
 * for verdicts on every token, use a scanning service from your server.
 */
export function looksLikeSpam(token: Pick<TokenInfo, "name" | "symbol">) {
  const text = `${token.name} ${token.symbol}`;
  return (
    SPAM_TEXT.test(text) ||
    DOMAIN_SYMBOL.test(token.symbol) ||
    INVISIBLE.test(text) ||
    [token.name, token.symbol].some((s) => LATIN.test(s) && LOOKALIKE.test(s))
  );
}
