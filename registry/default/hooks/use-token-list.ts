import { useQueries } from "@tanstack/react-query";
import { useMemo } from "react";
import { useChainId, useChains } from "wagmi";
import {
  fetchTokenList,
  isNativeToken,
  mergeTokenLists,
  nativeToken,
  type TokenInfo,
  type TokenList,
} from "@/lib/token-list";

const NO_TOKENS: readonly TokenInfo[] = [];

export type UseTokenListOptions = {
  /** Only tokens on this chain. Defaults to the current chain. Pass null for every chain. */
  chainId?: number | null;
  /** Put the chain's native currency (e.g. ETH) first. Lists don't include it. */
  includeNative?: boolean;
  /** Extra tokens, e.g. ones the user imported. They come first and win over list entries. */
  extraTokens?: readonly TokenInfo[];
  /** IPFS gateway for `ipfs://` list URLs. */
  gateway?: string;
};

/**
 * Load one or more token lists (https://tokenlists.org format) and get
 * their tokens for a chain, merged and de-duplicated. Lists are cached for
 * the session.
 *
 *   const { tokens } = useTokenList(UNISWAP_DEFAULT_LIST);
 *   <TokenSelect tokens={tokens} … />
 */
export function useTokenList(
  urls: string | readonly string[],
  { chainId: chainIdOption, includeNative = true, extraTokens = NO_TOKENS, gateway }: UseTokenListOptions = {}
) {
  const currentChainId = useChainId();
  const chains = useChains();
  const chainId = chainIdOption === undefined ? currentChainId : chainIdOption;
  const list = typeof urls === "string" ? [urls] : urls;

  const queries = useQueries({
    queries: list.map((url) => ({
      queryKey: ["0xui", "token-list", url, gateway],
      queryFn: () => fetchTokenList(url, { gateway }),
      staleTime: 60 * 60_000,
      gcTime: Number.POSITIVE_INFINITY,
      retry: 1,
    })),
  });

  const lists = queries.map((q) => q.data).filter(Boolean) as TokenList[];
  const dataKey = queries.map((q) => q.dataUpdatedAt).join();

  const tokens = useMemo(() => {
    const merged = mergeTokenLists([{ tokens: [...extraTokens] }, ...lists]);
    const onChain = chainId === null ? merged : merged.filter((t) => t.chainId === chainId);
    const chain = chains.find((c) => c.id === chainId);
    if (!includeNative || !chain) return onChain;
    // Skip it if a list (or extraTokens) already has an entry for it.
    return onChain.some(isNativeToken) ? onChain : [nativeToken(chain), ...onChain];
    // `lists` is rebuilt every render; dataKey tracks its contents.
  }, [dataKey, chainId, chains, includeNative, extraTokens]);

  return {
    tokens,
    lists,
    isLoading: queries.some((q) => q.isLoading),
    /** First failing list's error. Tokens from the other lists are still returned. */
    error: queries.find((q) => q.error)?.error ?? null,
  };
}
