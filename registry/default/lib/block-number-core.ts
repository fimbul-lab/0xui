import { getChainId, watchBlockNumber } from "@wagmi/core";
import type { Config } from "@wagmi/core";
import { getBlockNumberQueryOptions, hashFn } from "@wagmi/core/query";

export type BlockNumberPhase = "loading" | "live" | "error";

/** TanStack Query options for the latest block number. `chainId` defaults to the current chain. */
export function blockNumberQueryOptions(config: Config, { chainId }: { chainId?: number } = {}) {
  return {
    ...getBlockNumberQueryOptions(config, { chainId: chainId ?? getChainId(config) }),
    queryKeyHashFn: hashFn,
  };
}

/**
 * Write each new block into the cache entry of `blockNumberQueryOptions`, so
 * the query stays live without polling. Returns the function that stops it.
 */
export function watchBlockNumberQuery(
  config: Config,
  queryClient: { setQueryData(queryKey: ReadonlyArray<unknown>, data: bigint): unknown },
  { chainId }: { chainId?: number } = {},
) {
  const id = chainId ?? getChainId(config);
  const { queryKey } = blockNumberQueryOptions(config, { chainId: id });
  return watchBlockNumber(config, {
    chainId: id,
    onBlockNumber: (blockNumber) => queryClient.setQueryData(queryKey, blockNumber),
  });
}

export function blockNumberPhase({
  isError,
  isPending,
}: {
  isError: boolean;
  isPending: boolean;
}): BlockNumberPhase {
  return isError ? "error" : isPending ? "loading" : "live";
}

export function formatBlockNumber(blockNumber: bigint, locale?: string) {
  return blockNumber.toLocaleString(locale);
}
