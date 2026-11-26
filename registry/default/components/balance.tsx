// Docs: https://0xui.io/components/balance.md
import { useQuery } from "@tanstack/react-query";
import { SkeletonBox } from "skullet/react";
import type { Address } from "viem";
import { useChainId, useConfig, useConnection } from "wagmi";
import { TokenAmount } from "@/components/token-amount";
import type { TokenAmountProps } from "@/components/token-amount";
import { balancePhase, tokenBalanceQueryOptions } from "@/lib/balance-core";
import type { BalancePhase } from "@/lib/balance-core";
import { cn } from "@/lib/utils";

export type { BalancePhase };

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
 * batched into one multicall. The read is `tokenBalanceQueryOptions`
 * (framework-free).
 */
export function useTokenBalance({
  address: addressProp,
  token,
  chainId,
  refreshInterval,
  enabled = true,
}: UseTokenBalanceParameters = {}) {
  const config = useConfig();
  const connection = useConnection();
  const currentChainId = useChainId();
  const address = enabled ? (addressProp ?? connection.address) : undefined;

  const query = useQuery(
    tokenBalanceQueryOptions(config, {
      address,
      token,
      chainId: chainId ?? currentChainId,
      refreshInterval,
    }),
  );
  const data = query.data;

  return {
    address,
    value: data?.value,
    decimals: data?.decimals,
    symbol: data?.symbol,
    phase: balancePhase({ address, isError: query.isError, hasData: Boolean(data) }),
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

  if (phase === "idle") {
    return null;
  }

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
    <span data-slot="balance" data-phase={phase} className={cn("inline-flex", className)}>
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
