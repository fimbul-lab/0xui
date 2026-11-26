// Docs: https://0xui.io/components/shielded-balance.md
import { Loader2Icon } from "lucide-react";
import { useMemo } from "react";
import type { ReactNode } from "react";
import { SkeletonBox } from "skullet/react";
import type { Address } from "viem";
import { Button } from "@/components/primitives/button";
import { useShieldedEngine, useShieldedStore } from "@/components/shielded-provider";
import { TokenAmount } from "@/components/token-amount";
import type { TokenAmountProps } from "@/components/token-amount";
import type { FormatTokenAmountOptions } from "@/lib/0xui-utils";
import {
  createShieldedBalances,
  serverBalances,
  shieldedBalanceMeta,
  tokenAmounts,
  totalShielded,
} from "@/lib/shielded-balance-core";
import type { ShieldedBalancePhase, ShieldedRetryPhase } from "@/lib/shielded-balance-core";
import { SHIELDED_BALANCE_STATES } from "@/lib/shielded-engine";
import type { ShieldedBalanceState } from "@/lib/shielded-engine";
import { cn } from "@/lib/utils";

export { shieldedBalanceMeta, totalShielded, type ShieldedBalancePhase, type ShieldedRetryPhase };

/** SkeletonBox is a block by default. This one sits in a line of text. */
const inlineBox = { display: "inline-block", verticalAlign: "middle" } as const;

export type UseShieldedBalancesParameters = {
  /**
   * Chain to read. Required, and not taken from the connected wallet: the
   * private balance lives on one chain whatever network the wallet is on.
   */
  chainId: number;
};

/**
 * Every token in the private balance on a chain, each split by state, plus
 * the "retry proofs" action for incomplete funds. Balances come from the
 * engine as one snapshot, so the states of a token always add up. The logic
 * lives in `createShieldedBalances` (framework-free).
 */
export function useShieldedBalances({ chainId }: UseShieldedBalancesParameters) {
  const engine = useShieldedEngine();
  const balances = useMemo(() => createShieldedBalances(engine, chainId), [engine, chainId]);
  const server = useMemo(() => serverBalances(chainId), [chainId]);
  const state = useShieldedStore(balances, server);
  return { ...state, retryProofs: balances.retryProofs };
}

export type UseShieldedBalanceParameters = UseShieldedBalancesParameters & {
  /** ERC-20 contract. Native currency is held as its wrapped token. */
  token: Address;
};

/** One token's private balance, split by state. A token the account doesn't hold is all zeros. */
export function useShieldedBalance({ token, chainId }: UseShieldedBalanceParameters) {
  const { balances, ...rest } = useShieldedBalances({ chainId });
  const amounts = balances ? tokenAmounts(balances, token) : undefined;
  return {
    ...rest,
    /** Amount in each state. Undefined until the first scan finishes. */
    amounts,
    /** What can be spent right now. */
    spendable: amounts?.spendable,
    /** Everything held, spendable or not. */
    total: amounts && totalShielded(amounts),
  };
}

const stateDots: Record<ShieldedBalanceState, string> = {
  spendable: "bg-emerald-500",
  pending: "bg-muted-foreground/50",
  proving: "bg-muted-foreground/50",
  incomplete: "bg-amber-500",
  restricted: "bg-destructive",
};

/** What a component needs to format a token. Any token list entry fits. */
export type ShieldedToken = {
  address: Address;
  symbol: string;
  decimals: number;
};

export type ShieldedBalanceRowProps = FormatTokenAmountOptions & {
  state: ShieldedBalanceState;
  /** Amount in this state, in the token's smallest unit. */
  amount: bigint;
  token: Pick<ShieldedToken, "symbol" | "decimals">;
  /** Rendered under the explanation, e.g. a retry button. */
  children?: ReactNode;
  className?: string;
};

/** One state of a private balance: label, amount and what it means. */
export function ShieldedBalanceRow({
  state,
  amount,
  token,
  children,
  className,
  ...format
}: ShieldedBalanceRowProps) {
  const meta = shieldedBalanceMeta[state];
  return (
    <li data-state={state} className={cn("flex flex-col gap-1", className)}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="flex items-center gap-1.5 font-medium">
          <span aria-hidden className={cn("size-2 shrink-0 rounded-full", stateDots[state])} />
          {meta.label}
        </span>
        <TokenAmount value={amount} decimals={token.decimals} symbol={token.symbol} {...format} />
      </div>
      <p className="text-muted-foreground">{meta.description}</p>
      {children}
    </li>
  );
}

export type ShieldedBalanceProps = UseShieldedBalancesParameters &
  Omit<TokenAmountProps, "value" | "decimals" | "symbol"> & {
    /**
     * Token to show. Symbol and decimals are passed in, not read from the
     * chain, so the RPC doesn't learn which tokens the account holds privately.
     */
    token: ShieldedToken;
    /**
     * "card" shows the spendable amount and a row for every other state that
     * holds funds. "inline" is the spendable amount alone, for running text.
     */
    variant?: "card" | "inline";
  };

/**
 * Private balance of one token. The headline is what can be spent now;
 * funds that are pending, proving, incomplete or restricted are listed
 * below with what each state means, and incomplete funds get a "Retry
 * proofs" button. Renders nothing until the private account is unlocked.
 */
export function ShieldedBalance({
  token,
  chainId,
  variant = "card",
  animate = true,
  className,
  maxDecimals,
  compact,
  locale,
  ...fiat
}: ShieldedBalanceProps) {
  const { phase, amounts, isUpdating, retryProofs, retryPhase, retryError } = useShieldedBalance({
    token: token.address,
    chainId,
  });
  const format = { maxDecimals, compact, locale };

  if (phase === "idle") {
    return null;
  }

  const headline =
    phase === "loading" ? (
      <span>
        {/* About the width of "0.1234 WETH" at the current font size. */}
        <SkeletonBox width="6em" height="1em" style={inlineBox} />
        <span className="sr-only">Loading private balance</span>
      </span>
    ) : phase === "error" ? (
      <span title="Couldn't load private balance" className="text-muted-foreground">
        —<span className="sr-only">Couldn't load private balance</span>
      </span>
    ) : (
      <TokenAmount
        value={amounts!.spendable}
        decimals={token.decimals}
        symbol={token.symbol}
        animate={animate}
        {...format}
        {...fiat}
      />
    );

  if (variant === "inline") {
    return (
      <span
        data-slot="shielded-balance"
        data-phase={phase}
        data-updating={isUpdating || undefined}
        className={cn("inline-flex align-middle", className)}
      >
        {headline}
      </span>
    );
  }

  const others = amounts
    ? SHIELDED_BALANCE_STATES.filter((state) => state !== "spendable" && amounts[state] > 0n)
    : [];

  return (
    <div
      data-slot="shielded-balance"
      data-phase={phase}
      data-updating={isUpdating || undefined}
      className={cn("flex w-full flex-col gap-3 rounded-xl border p-4 text-sm", className)}
    >
      <div className="flex flex-col gap-1">
        <p className="flex items-center gap-1.5 text-muted-foreground">
          {shieldedBalanceMeta.spendable.label}
          {isUpdating && (
            <Loader2Icon
              role="img"
              aria-label="Updating"
              className="size-3 animate-spin motion-reduce:animate-none"
            />
          )}
        </p>
        <div className="text-2xl font-medium">{headline}</div>
      </div>

      {others.length > 0 && (
        <ul className="flex flex-col gap-3 border-t pt-3">
          {others.map((state) => (
            <ShieldedBalanceRow
              key={state}
              state={state}
              amount={amounts![state]}
              token={token}
              {...format}
            >
              {state === "incomplete" && (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-1">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={retryProofs}
                    disabled={retryPhase === "retrying"}
                    aria-busy={retryPhase === "retrying" || undefined}
                  >
                    {retryPhase === "retrying" && (
                      <Loader2Icon
                        aria-hidden
                        className="animate-spin motion-reduce:animate-none"
                      />
                    )}
                    {retryPhase === "retrying" ? "Retrying proofs…" : "Retry proofs"}
                  </Button>
                  <span aria-live="polite" className="text-muted-foreground">
                    {retryPhase === "retried" && "Still incomplete. Try again in a few minutes."}
                  </span>
                  {retryPhase === "error" && (
                    <span role="alert" className="text-destructive">
                      {retryError?.message ?? "Couldn't retry the proofs."}
                    </span>
                  )}
                </div>
              )}
            </ShieldedBalanceRow>
          ))}
        </ul>
      )}
    </div>
  );
}
