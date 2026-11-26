import type { Config } from "@wagmi/core";
import { getBalanceQueryOptions, hashFn, readContractsQueryOptions } from "@wagmi/core/query";
import { erc20Abi, formatUnits } from "viem";
import type { Address } from "viem";
import { NATIVE_TOKEN_ADDRESS, getTokenPrice, isNativeToken } from "@/lib/token-list";
import type { TokenInfo, TokenPrices } from "@/lib/token-list";

/** A token's identity in lists, balances and recents: its lowercase address. */
export const tokenKey = (token: Pick<TokenInfo, "address">) => token.address.toLowerCase();

/**
 * Search tokens by symbol, name or exact address. Symbol prefix matches
 * rank first, then other symbol matches, then name matches.
 */
export function filterTokens(tokens: ReadonlyArray<TokenInfo>, query: string) {
  const q = query.trim().toLowerCase();
  if (!q) {
    return [...tokens];
  }
  if (/^0x[0-9a-f]{40}$/.test(q)) {
    return tokens.filter((t) => tokenKey(t) === q);
  }
  const rank = (t: TokenInfo) => {
    const symbol = t.symbol.toLowerCase();
    if (symbol === q) {
      return 0;
    }
    if (symbol.startsWith(q)) {
      return 1;
    }
    if (symbol.includes(q)) {
      return 2;
    }
    if (t.name.toLowerCase().includes(q)) {
      return 3;
    }
    return -1;
  };
  return tokens
    .map((token) => ({ token, rank: rank(token) }))
    .filter((t) => t.rank >= 0)
    .sort((a, b) => a.rank - b.rank)
    .map((t) => t.token);
}

/**
 * Tokens the user holds first: priced holdings by value, then other
 * holdings in list order, then everything else in list order. Raw amounts
 * aren't compared: a billion airdropped tokens shouldn't outrank 2 ETH.
 */
export function sortByHoldings(
  tokens: ReadonlyArray<TokenInfo>,
  balances: ReadonlyMap<string, bigint>,
  prices: TokenPrices = {},
) {
  return tokens
    .map((token, index) => {
      const balance = balances.get(tokenKey(token)) ?? 0n;
      const price = getTokenPrice(prices, token);
      const value =
        balance > 0n && price !== undefined
          ? Number(formatUnits(balance, token.decimals)) * price
          : undefined;
      const group = value !== undefined ? 0 : balance > 0n ? 1 : 2;
      return { token, index, value: value ?? 0, group };
    })
    .sort((a, b) => a.group - b.group || b.value - a.value || a.index - b.index)
    .map((t) => t.token);
}

/** Caller-supplied balances, keyed by lowercase address. */
export function toBalanceMap(balances: ReadonlyMap<string, bigint> | Record<string, bigint>) {
  const entries = balances instanceof Map ? [...balances] : Object.entries(balances);
  return new Map(entries.map(([address, value]) => [address.toLowerCase(), value]));
}

/**
 * TanStack Query options for an account's balances of `tokens` on one
 * chain: the native balance, and every ERC-20 balance in one multicall.
 * Combine the results with `mergeTokenBalances`.
 */
export function tokenBalancesQueryOptions(
  config: Config,
  tokens: ReadonlyArray<TokenInfo>,
  { chainId, address, enabled = true }: { chainId?: number; address?: Address; enabled?: boolean },
) {
  const erc20 = tokens.filter((t) => !isNativeToken(t));
  const hasNative = tokens.some(isNativeToken);
  return {
    native: {
      ...getBalanceQueryOptions(config, {
        address,
        chainId,
        query: { enabled: enabled && hasNative },
      }),
      queryKeyHashFn: hashFn,
    },
    erc20: {
      ...readContractsQueryOptions(config, {
        contracts: erc20.map((token) => ({
          address: token.address,
          abi: erc20Abi,
          functionName: "balanceOf" as const,
          args: [address!] as const,
          chainId,
        })),
        query: { enabled: enabled && Boolean(address) && erc20.length > 0 },
      }),
      queryKeyHashFn: hashFn,
    },
  };
}

/** One map of lowercase token address to balance, from the two balance queries. Failed reads are left out. */
export function mergeTokenBalances(
  tokens: ReadonlyArray<TokenInfo>,
  native: { value: bigint } | null | undefined,
  erc20: ReadonlyArray<{ status: "success" | "failure"; result?: unknown }> | undefined,
) {
  const map = new Map<string, bigint>();
  if (native) {
    map.set(tokenKey({ address: NATIVE_TOKEN_ADDRESS }), native.value);
  }
  const contracts = tokens.filter((t) => !isNativeToken(t));
  erc20?.forEach((result, i) => {
    const token = contracts[i];
    if (token && result.status === "success") {
      map.set(tokenKey(token), result.result as bigint);
    }
  });
  return map;
}

/**
 * Up to six quick picks: recent tokens first, then `popular` ones (symbols or
 * addresses), each found among `tokens` and listed once.
 */
export function quickPickTokens(
  tokens: ReadonlyArray<TokenInfo>,
  recent: ReadonlyArray<string>,
  popular: ReadonlyArray<string>,
) {
  const wanted = [...recent, ...popular.map((p) => p.toLowerCase())];
  const picked: Array<TokenInfo> = [];
  for (const w of wanted) {
    const token = tokens.find((t) => tokenKey(t) === w || t.symbol.toLowerCase() === w);
    if (token && !picked.includes(token)) {
      picked.push(token);
    }
  }
  return picked.slice(0, 6);
}

const RECENT_LIMIT = 4;
const recentKey = (chainId: number) => `0xui:recent-tokens:${chainId}`;

/** Addresses of the tokens last picked on a chain, newest first. */
export function readRecentTokens(chainId: number): Array<string> {
  try {
    return JSON.parse(localStorage.getItem(recentKey(chainId)) ?? "[]");
  } catch {
    return [];
  }
}

/** Remember a picked token for the quick picks. */
export function saveRecentToken(chainId: number, token: Pick<TokenInfo, "address">) {
  try {
    const key = tokenKey(token);
    const next = [key, ...readRecentTokens(chainId).filter((a) => a !== key)];
    localStorage.setItem(recentKey(chainId), JSON.stringify(next.slice(0, RECENT_LIMIT)));
  } catch {
    // Storage blocked: recents are a convenience.
  }
}
