import { getAddress, isAddress, type Address, type Chain } from "viem";
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
  tags?: string[];
  /** List-specific data, e.g. Uniswap's `bridgeInfo` (the same token on other chains). */
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
  tokens: TokenInfo[];
  logoURI?: string;
  keywords?: string[];
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
export function nativeToken(chain: Pick<Chain, "id" | "nativeCurrency">, logoURI?: string): TokenInfo {
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
  const t = value as Record<string, unknown>;
  return (
    typeof t === "object" &&
    t !== null &&
    Number.isInteger(t.chainId) &&
    typeof t.address === "string" &&
    // Lists can include non-EVM chains (e.g. Solana). Keep EVM addresses only.
    isAddress(t.address, { strict: false }) &&
    typeof t.symbol === "string" &&
    typeof t.name === "string" &&
    Number.isInteger(t.decimals) &&
    (t.decimals as number) >= 0 &&
    (t.decimals as number) <= 255
  );
}

/**
 * Check that `json` is a token list and clean its tokens: entries that
 * aren't valid EVM tokens are dropped and addresses are checksummed.
 * Throws when `json` isn't a token list at all.
 */
export function parseTokenList(json: unknown): TokenList {
  const list = json as Partial<TokenList> | null;
  if (!list || typeof list !== "object" || !Array.isArray(list.tokens) || typeof list.name !== "string") {
    throw new Error("Not a token list: expected an object with `name` and `tokens`.");
  }
  return {
    ...(list as TokenList),
    tokens: list.tokens.filter(isTokenInfo).map((t) => ({ ...t, address: getAddress(t.address) })),
  };
}

/** Download and parse a token list. `ipfs://` and `ar://` URLs go through a gateway. */
export async function fetchTokenList(url: string, { gateway }: { gateway?: string } = {}) {
  const response = await fetch(resolveUri(url, gateway));
  if (!response.ok) throw new Error(`Couldn't load token list ${url} (${response.status})`);
  return parseTokenList(await response.json());
}

/**
 * Tokens from several lists, merged. The first list wins when two lists
 * share a token (same chain and address).
 */
export function mergeTokenLists(lists: readonly Pick<TokenList, "tokens">[]) {
  const seen = new Set<string>();
  const tokens: TokenInfo[] = [];
  for (const list of lists) {
    for (const token of list.tokens) {
      const key = `${token.chainId}:${token.address.toLowerCase()}`;
      if (seen.has(key)) continue;
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
  allowlist?: readonly string[];
  /** Never these tokens (a blacklist), e.g. known scams. Same format as `allowlist`. */
  blocklist?: readonly string[];
};

function matcher(entries: readonly string[]) {
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
  tokens: readonly T[],
  { allowlist, blocklist }: TokenFilters
): T[] {
  const allowed = allowlist ? matcher(allowlist) : () => true;
  const blocked = blocklist ? matcher(blocklist) : () => false;
  return tokens.filter((t) => allowed(t) && !blocked(t));
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
  token: Pick<TokenInfo, "chainId" | "address" | "symbol">
) {
  if (!prices) return undefined;
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
const SPAM_TEXT = /https?:\/\/|www\.|t\.me\/|\b(claim|claimable|visit|airdrop|rewards?|voucher|bonus)\b/i;
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
