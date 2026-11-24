import type { Config } from "@wagmi/core";
import { getBalanceQueryOptions, readContractsQueryOptions } from "@wagmi/core/query";
import { erc20Abi, type Address } from "viem";

export type BalancePhase = "idle" | "loading" | "ready" | "error";

export type TokenBalance = { value: bigint; decimals: number; symbol: string };

export type TokenBalanceParameters = {
  /** Whose balance. Nothing is read without one. */
  address?: Address;
  /** ERC-20 contract. Omit for the chain's native currency. */
  token?: Address;
  /** Chain to read. */
  chainId?: number;
  /** Refetch interval in ms. Pass false to fetch once. */
  refreshInterval?: number | false;
  /** Set to false to skip reading, e.g. until a token is chosen. */
  enabled?: boolean;
};

/** TanStack query options whose data is a `TokenBalance`, whichever read backs them. */
export type TokenBalanceQueryOptions = {
  queryKey: readonly unknown[];
  queryFn: (context: any) => unknown;
  select: (data: any) => TokenBalance;
  enabled: boolean;
  refetchInterval: number | false;
};

/**
 * Query options for a native or ERC-20 balance with its decimals and symbol.
 * ERC-20 reads are batched into one multicall. Pass them to TanStack's
 * `useQuery` (or Vue/Svelte's).
 */
export function tokenBalanceQueryOptions(
  config: Config,
  { address, token, chainId, refreshInterval = 15_000, enabled = true }: TokenBalanceParameters,
): TokenBalanceQueryOptions {
  const on = enabled && Boolean(address);
  if (!token) {
    return {
      ...getBalanceQueryOptions(config, { address, chainId }),
      enabled: on,
      refetchInterval: refreshInterval,
      select: ({ value, decimals, symbol }) => ({ value, decimals, symbol }),
    };
  }
  return {
    ...readContractsQueryOptions(config, {
      allowFailure: false,
      contracts: [
        { address: token, abi: erc20Abi, functionName: "balanceOf", args: [address!], chainId },
        { address: token, abi: erc20Abi, functionName: "decimals", chainId },
        { address: token, abi: erc20Abi, functionName: "symbol", chainId },
      ],
    }),
    enabled: on,
    refetchInterval: refreshInterval,
    select: ([value, decimals, symbol]: [bigint, number, string]) => ({ value, decimals, symbol }),
  };
}

/** The balance's phase from its query. `idle` without an address. */
export function balancePhase({
  address,
  isError,
  hasData,
}: {
  address: Address | undefined;
  isError: boolean;
  hasData: boolean;
}): BalancePhase {
  return !address ? "idle" : isError ? "error" : hasData ? "ready" : "loading";
}
