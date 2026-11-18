import { SkeletonBox } from "skullet/react";
import { erc20Abi, type Address } from "viem";
import { useBalance, useConnection, useReadContracts } from "wagmi";
import { TokenAmount, type TokenAmountProps } from "@/components/token-amount";
import { cn } from "@/lib/utils";

export type BalancePhase = "idle" | "loading" | "ready" | "error";

/** SkeletonBox is a block by default. This one sits in a line of text. */
const inlineBox = { display: "inline-block", verticalAlign: "middle" } as const;

export type UseTokenBalanceParameters = {
  /** Whose balance. Defaults to the connected account. */
  address?: Address;
  /** ERC-20 contract. Omit for the chain's native currency. */
  token?: Address;
  /** Chain to read. Defaults to the current chain. */
  chainId?: number;
  /** Refetch interval in ms. Pass false to fetch once. */
  refreshInterval?: number | false;
  /** Set to false to skip reading, e.g. until a token is chosen. */
  enabled?: boolean;
};

/**
 * Native or ERC-20 balance with its decimals and symbol. ERC-20 reads are
 * batched into one multicall.
 */
export function useTokenBalance({
  address: addressProp,
  token,
  chainId,
  refreshInterval = 15_000,
  enabled: enabledProp = true,
}: UseTokenBalanceParameters = {}) {
  const connection = useConnection();
  const address = enabledProp ? (addressProp ?? connection.address) : undefined;

  const native = useBalance({
    address,
    chainId,
    query: { enabled: Boolean(address) && !token, refetchInterval: refreshInterval },
  });

  const erc20 = useReadContracts({
    allowFailure: false,
    contracts: [
      { address: token, abi: erc20Abi, functionName: "balanceOf", args: [address!], chainId },
      { address: token, abi: erc20Abi, functionName: "decimals", chainId },
      { address: token, abi: erc20Abi, functionName: "symbol", chainId },
    ],
    query: {
      enabled: Boolean(address) && Boolean(token),
      refetchInterval: refreshInterval,
    },
  });

  const query = token ? erc20 : native;
  const data = token
    ? erc20.data && {
        value: erc20.data[0],
        decimals: erc20.data[1],
        symbol: erc20.data[2],
      }
    : native.data;

  const phase: BalancePhase = !address
    ? "idle"
    : query.isError
      ? "error"
      : data
        ? "ready"
        : "loading";

  return {
    address,
    value: data?.value,
    decimals: data?.decimals,
    symbol: data?.symbol,
    phase,
    error: query.error,
    refetch: query.refetch,
  };
}

export type BalanceProps = UseTokenBalanceParameters &
  Omit<TokenAmountProps, "value" | "decimals" | "symbol"> & {
    /** Override the symbol read from the chain or contract. */
    symbol?: string;
  };

/**
 * Balance of the connected account (or any address), native or ERC-20,
 * formatted with TokenAmount. Renders nothing when there is no address.
 */
export function Balance({
  address,
  token,
  chainId,
  refreshInterval,
  symbol: symbolProp,
  animate = true,
  className,
  ...format
}: BalanceProps) {
  const { value, decimals, symbol, phase } = useTokenBalance({
    address,
    token,
    chainId,
    refreshInterval,
  });

  if (phase === "idle") return null;

  if (phase === "loading") {
    return (
      <span
        data-slot="balance"
        data-phase={phase}
        className={cn("inline-block align-middle", className)}
      >
        {/* About the width of "0.1234 ETH" at the current font size. */}
        <SkeletonBox width="5.5em" height="1em" style={inlineBox} />
        <span className="sr-only">Loading balance</span>
      </span>
    );
  }

  if (phase === "error") {
    return (
      <span
        data-slot="balance"
        data-phase={phase}
        title="Couldn't load balance"
        className={cn("text-muted-foreground", className)}
      >
        —<span className="sr-only">Couldn't load balance</span>
      </span>
    );
  }

  return (
    <span
      data-slot="balance"
      data-phase={phase}
      className={cn("inline-flex", className)}
    >
      <TokenAmount
        value={value!}
        decimals={decimals!}
        symbol={symbolProp ?? symbol}
        animate={animate}
        {...format}
      />
    </span>
  );
}
