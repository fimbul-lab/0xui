// Docs: https://0xui.io/components/position-list.md
import { useQuery } from "@tanstack/react-query";
import { erc20Abi, maxUint128, zeroAddress, type Address } from "viem";
import { useChainId, useConnection, usePublicClient, useReadContract, useReadContracts } from "wagmi";
import type { PoolState, Position } from "@/lib/concentrated-liquidity";
import {
  positionManagerAbi,
  uniswapV3Deployments,
  v3FactoryAbi,
  v3PoolAbi,
} from "@/lib/v3-position-manager";
import type { TokenInfo } from "@/lib/token-list";

/** A position and the state of its pool, ready for `PositionCard`. */
export type V3PositionData = {
  position: Position<TokenInfo>;
  pool: PoolState & { address: Address };
};

export type V3PositionsPhase = "idle" | "loading" | "ready" | "error";

export type UseV3PositionsParameters = {
  /** Whose positions. Defaults to the connected account. */
  owner?: Address;
  /** Defaults to the current chain. */
  chainId?: number;
  /** NonfungiblePositionManager. Defaults to Uniswap's on chains in `uniswapV3Deployments`. */
  positionManager?: Address;
  /** Factory, to find each position's pool. Defaults to Uniswap's. */
  factory?: Address;
  /** Known tokens, to name addresses without reading them. Unknown ones are read on-chain. */
  tokens?: readonly TokenInfo[];
  /**
   * Show the wrapped native token as the native one (WETH as ETH), so
   * `v3Collect` / `v3Remove` unwrap it. Pass the native token, e.g. `nativeToken(mainnet)`.
   */
  native?: TokenInfo;
  /** Hide positions with no liquidity left. */
  hideClosed?: boolean;
  /** Most positions to read, newest first. */
  limit?: number;
  /** Refresh interval in ms. */
  refreshInterval?: number | false;
};

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/**
 * An owner's Uniswap v3 positions (and forks with the same position
 * manager), read on-chain: token ids from `balanceOf` and
 * `tokenOfOwnerByIndex`, each position from `positions(tokenId)`, its pool
 * from the factory with `slot0`, `liquidity` and `tickSpacing`, and real
 * uncollected fees by simulating `collect` from the owner (the stored
 * `tokensOwed` misses fees earned since the last touch).
 */
export function useV3Positions({
  owner: ownerProp,
  chainId: chainIdProp,
  positionManager: managerProp,
  factory: factoryProp,
  tokens = [],
  native,
  hideClosed = false,
  limit = 50,
  refreshInterval = 30_000,
}: UseV3PositionsParameters = {}) {
  const connection = useConnection();
  const currentChain = useChainId();
  const chainId = chainIdProp ?? currentChain;
  const owner = ownerProp ?? connection.address;
  const deployment = uniswapV3Deployments[chainId];
  const manager = managerProp ?? deployment?.positionManager;
  const factory = factoryProp ?? deployment?.factory;
  const weth = deployment?.weth;
  const client = usePublicClient({ chainId });
  const query = { refetchInterval: refreshInterval };

  // 1. How many, and which.
  const count = useReadContract({
    address: manager,
    abi: positionManagerAbi,
    functionName: "balanceOf",
    args: [owner ?? zeroAddress],
    chainId,
    query: { ...query, enabled: Boolean(owner && manager) },
  });
  const total = count.data === undefined ? 0 : Math.min(Number(count.data), limit);
  const balance = count.data === undefined ? 0 : Number(count.data);
  const ids = useReadContracts({
    allowFailure: false,
    contracts: Array.from({ length: total }, (_, i) => ({
      address: manager,
      abi: positionManagerAbi,
      functionName: "tokenOfOwnerByIndex",
      // Newest last in the enumeration: read from the end.
      args: [owner ?? zeroAddress, BigInt(balance - 1 - i)],
      chainId,
    })),
    query: { ...query, enabled: total > 0 },
  });
  const tokenIds = (ids.data ?? []) as unknown as bigint[];

  // 2. The positions.
  const raw = useReadContracts({
    allowFailure: false,
    contracts: tokenIds.map((tokenId) => ({
      address: manager,
      abi: positionManagerAbi,
      functionName: "positions",
      args: [tokenId],
      chainId,
    })),
    query: { ...query, enabled: tokenIds.length > 0 },
  });
  type Raw = readonly [bigint, Address, Address, Address, number, number, number, bigint, bigint, bigint, bigint, bigint];
  const positions = ((raw.data ?? []) as unknown as Raw[])
    .map((r, i) => ({
      tokenId: tokenIds[i],
      token0: r[2],
      token1: r[3],
      fee: r[4],
      tickLower: r[5],
      tickUpper: r[6],
      liquidity: r[7],
    }))
    .filter((p) => !hideClosed || p.liquidity > 0n);

  // 3. Their pools: one read per pair and fee.
  const poolKeys = [...new Map(positions.map((p) => [`${p.token0}:${p.token1}:${p.fee}`, p])).values()];
  const poolAddresses = useReadContracts({
    allowFailure: false,
    contracts: poolKeys.map((p) => ({
      address: factory,
      abi: v3FactoryAbi,
      functionName: "getPool",
      args: [p.token0, p.token1, p.fee],
      chainId,
    })),
    query: { enabled: poolKeys.length > 0 && Boolean(factory) },
  });
  const pools = (poolAddresses.data ?? []) as Address[];
  const poolState = useReadContracts({
    allowFailure: false,
    contracts: pools.flatMap((address) => [
      { address, abi: v3PoolAbi, functionName: "slot0", chainId },
      { address, abi: v3PoolAbi, functionName: "liquidity", chainId },
      { address, abi: v3PoolAbi, functionName: "tickSpacing", chainId },
    ]),
    query: { ...query, enabled: pools.length > 0 },
  });

  // 4. Names and decimals for tokens the list doesn't know.
  const isWrappedNative = (address: Address) => Boolean(native && weth && same(address, weth));
  const known = (address: Address) =>
    isWrappedNative(address) ? native : tokens.find((t) => t.chainId === chainId && same(t.address, address));
  const unknown = [...new Set(positions.flatMap((p) => [p.token0, p.token1]))].filter((a) => !known(a));
  const meta = useReadContracts({
    allowFailure: false,
    contracts: unknown.flatMap((address) => [
      { address, abi: erc20Abi, functionName: "symbol", chainId },
      { address, abi: erc20Abi, functionName: "name", chainId },
      { address, abi: erc20Abi, functionName: "decimals", chainId },
    ]),
    query: { enabled: unknown.length > 0 },
  });

  // 5. Uncollected fees: collect simulated from the owner. Not batched
  // through Multicall3, since collect checks msg.sender.
  const fees = useQuery({
    queryKey: ["0xui", "v3-fees", chainId, manager, owner, tokenIds.map(String)],
    queryFn: () =>
      Promise.all(
        tokenIds.map((tokenId) =>
          client!
            .simulateContract({
              address: manager!,
              abi: positionManagerAbi,
              functionName: "collect",
              args: [{ tokenId, recipient: owner!, amount0Max: maxUint128, amount1Max: maxUint128 }],
              account: owner!,
            })
            .then((r) => r.result as readonly [bigint, bigint])
            .catch(() => undefined)
        )
      ),
    enabled: Boolean(client && manager && owner) && tokenIds.length > 0,
    refetchInterval: refreshInterval,
  });

  const token = (address: Address): TokenInfo | undefined => {
    const found = known(address);
    if (found) return found;
    const i = unknown.findIndex((a) => same(a, address));
    const m = meta.data as unknown[] | undefined;
    if (i === -1 || !m) return undefined;
    return {
      chainId,
      address,
      symbol: m[i * 3] as string,
      name: m[i * 3 + 1] as string,
      decimals: Number(m[i * 3 + 2]),
    };
  };

  const state = poolState.data as unknown[] | undefined;
  const data: V3PositionData[] | undefined =
    !owner || !manager
      ? undefined
      : count.data === 0n
        ? []
        : !state || raw.data === undefined || (unknown.length > 0 && !meta.data)
          ? undefined
          : positions.flatMap((p) => {
              const k = poolKeys.findIndex((q) => q.token0 === p.token0 && q.token1 === p.token1 && q.fee === p.fee);
              const address = pools[k];
              const slot0 = state[k * 3] as readonly [bigint, number];
              const token0 = token(p.token0);
              const token1 = token(p.token1);
              if (!address || address === zeroAddress || !slot0 || !token0 || !token1) return [];
              const owed = fees.data?.[tokenIds.indexOf(p.tokenId)];
              return [
                {
                  position: { ...p, token0, token1, fees0: owed?.[0], fees1: owed?.[1] },
                  pool: {
                    address,
                    sqrtPriceX96: slot0[0],
                    tick: Number(slot0[1]),
                    liquidity: state[k * 3 + 1] as bigint,
                    tickSpacing: Number(state[k * 3 + 2]),
                    decimals0: token0.decimals,
                    decimals1: token1.decimals,
                  },
                },
              ];
            });

  const error = count.error ?? ids.error ?? raw.error ?? poolAddresses.error ?? poolState.error ?? meta.error;
  const phase: V3PositionsPhase = !owner ? "idle" : error ? "error" : data ? "ready" : "loading";

  return {
    /** Positions with their pools, or undefined while loading. Pass straight to `PositionList`. */
    positions: data,
    /** How many positions the owner has in total, including ones past `limit`. */
    total: count.data,
    phase,
    error,
    /** True while fees are still being simulated; positions show without them meanwhile. */
    isLoadingFees: fees.isLoading,
    refetch: () => {
      void count.refetch();
      void raw.refetch();
      void poolState.refetch();
      void fees.refetch();
    },
    unsupported: !manager || !factory,
  };
}
