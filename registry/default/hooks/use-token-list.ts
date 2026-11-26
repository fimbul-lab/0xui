// Docs: https://0xui.io/getting-started/token-lists.md
import { useQueries } from "@tanstack/react-query";
import { useMemo } from "react";
import { useChainId, useChains } from "wagmi";
import { selectTokens, tokenListQueryOptions } from "@/lib/token-list";
import type { TokenFilters, TokenInfo } from "@/lib/token-list";

const NO_TOKENS: ReadonlyArray<TokenInfo> = [];

export type UseTokenListOptions = TokenFilters & {
  /** Only tokens on this chain. Defaults to the current chain. Pass null for every chain. */
  chainId?: number | null;
  /** Put the chain's native currency (e.g. ETH) first. Lists don't include it. */
  includeNative?: boolean;
  /** Extra tokens, e.g. ones the user imported. They come first and win over list entries. */
  extraTokens?: ReadonlyArray<TokenInfo>;
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
  urls: string | ReadonlyArray<string>,
  {
    chainId: chainIdOption,
    includeNative = true,
    extraTokens = NO_TOKENS,
    gateway,
    allowlist,
    blocklist,
  }: UseTokenListOptions = {},
) {
  const currentChainId = useChainId();
  const chains = useChains();
  const chainId = chainIdOption === undefined ? currentChainId : chainIdOption;
  const list = typeof urls === "string" ? [urls] : urls;

  const queries = useQueries({
    queries: list.map((url) => tokenListQueryOptions(url, { gateway })),
  });

  const lists = queries.flatMap((q) => q.data ?? []);
  const dataKey = queries.map((q) => q.dataUpdatedAt).join();

  const tokens = useMemo(
    () =>
      selectTokens(lists, {
        chainId,
        nativeChain: includeNative ? chains.find((c) => c.id === chainId) : undefined,
        extraTokens,
        allowlist,
        blocklist,
      }),
    // `lists` is rebuilt every render; dataKey tracks its contents.
    // Filters are compared by content, so inline arrays don't recompute every render.
    [dataKey, chainId, chains, includeNative, extraTokens, allowlist?.join(), blocklist?.join()],
  );

  return {
    tokens,
    lists,
    isLoading: queries.some((q) => q.isLoading),
    /** First failing list's error. Tokens from the other lists are still returned. */
    error: queries.find((q) => q.error)?.error ?? null,
  };
}
