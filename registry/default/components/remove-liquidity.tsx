// Docs: https://0xui.io/blocks/remove-liquidity.md
import { Slider } from "@base-ui/react/slider";
import { useEffect, useState, type ReactNode } from "react";
import { formatUnits, type Address, type Hash, type Hex, type TransactionReceipt } from "viem";
import { useConnection } from "wagmi";
import { formatFee } from "@/components/fee-tier-select";
import { RangeIndicator } from "@/components/range-indicator";
import { SlippageInput } from "@/components/slippage-input";
import { TokenAmount } from "@/components/token-amount";
import { TokenIcon } from "@/components/token-icon";
import { getTokenPrice, type Token, type TokenPrices } from "@/components/token-select";
import { TransactionButton } from "@/components/transaction-button";
import { getPositionAmounts, type PoolState, type Position } from "@/lib/concentrated-liquidity";
import { withSlippage, type RemoveRequest } from "@/lib/v3-position-manager";
import { cn } from "@/lib/utils";

export type RemoveTransaction = { to: Address; data?: Hex; value?: bigint };

/** Build the remove transaction. Use `v3Remove({ positionManager, weth })` for Uniswap v3. */
export type GetRemoveTransaction = (request: RemoveRequest<Token>) => RemoveTransaction;

/** Re-render every `ms`, so deadlines built in render stay fresh. */
function useNow(ms: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(timer);
  }, [ms]);
  return now;
}

/**
 * What removing `percent` of a position returns: the share of liquidity,
 * the principal it holds at the current price, the slippage floor, and the
 * uncollected fees that come with it (all of them, at any percent).
 */
export function getRemoveAmounts(
  position: Position,
  pool: Pick<PoolState, "tick" | "sqrtPriceX96">,
  percent: number,
  slippageBps: number
) {
  const liquidity = (position.liquidity * BigInt(Math.round(percent * 100))) / 10_000n;
  const principal = getPositionAmounts(position, pool, { liquidity });
  return {
    liquidity,
    amount0: principal.amount0,
    amount1: principal.amount1,
    amount0Min: withSlippage(principal.amount0, slippageBps),
    amount1Min: withSlippage(principal.amount1, slippageBps),
    fees0: position.fees0 ?? 0n,
    fees1: position.fees1 ?? 0n,
  };
}

export type RemoveLiquidityProps = {
  position: Position<Token>;
  pool: Pick<PoolState, "tick" | "sqrtPriceX96" | "tickSpacing" | "decimals0" | "decimals1">;
  /** Build the transaction. `v3Remove({ positionManager, weth })` for Uniswap v3 and forks. */
  getTransaction: GetRemoveTransaction;
  /** Starting percent. */
  defaultPercent?: number;
  /** Starting slippage in basis points. */
  slippageBps?: number;
  deadlineSeconds?: number;
  prices?: TokenPrices;
  currency?: string;
  invert?: boolean;
  onSubmitted?: (hash: Hash) => void;
  onSuccess?: (receipt: TransactionReceipt) => void;
  title?: ReactNode;
  locale?: string;
  className?: string;
};

const presets = [25, 50, 75, 100];

/**
 * Remove liquidity from a position: pick a share with the slider or the
 * 25 / 50 / 75 / Max buttons, see the tokens you get back (principal at the
 * current price plus all uncollected fees), set slippage, and withdraw in
 * one transaction. Native ETH comes back unwrapped with `v3Remove({ weth })`.
 */
export function RemoveLiquidity({
  position,
  pool,
  getTransaction,
  defaultPercent = 50,
  slippageBps: defaultSlippageBps = 50,
  deadlineSeconds = 20 * 60,
  prices,
  currency = "USD",
  invert = false,
  onSubmitted,
  onSuccess,
  title = "Remove liquidity",
  locale,
  className,
}: RemoveLiquidityProps) {
  const { address } = useConnection();
  const [percent, setPercent] = useState(defaultPercent);
  const [slippageBps, setSlippageBps] = useState(defaultSlippageBps);
  const now = useNow(60_000);
  const { token0, token1 } = position;
  const out = getRemoveAmounts(position, pool, percent, slippageBps);

  const blocker =
    position.liquidity === 0n ? "Position is closed" : percent === 0 ? "Select an amount" : undefined;
  const transaction =
    address && !blocker
      ? getTransaction({
          tokenId: position.tokenId,
          token0,
          token1,
          liquidity: out.liquidity,
          amount0Min: out.amount0Min,
          amount1Min: out.amount1Min,
          recipient: address,
          deadline: BigInt(Math.floor(now / 1000) + deadlineSeconds),
        })
      : undefined;

  const total = (() => {
    const p0 = getTokenPrice(prices, token0);
    const p1 = getTokenPrice(prices, token1);
    if (p0 === undefined || p1 === undefined) return undefined;
    const value =
      Number(formatUnits(out.amount0 + out.fees0, token0.decimals)) * p0 +
      Number(formatUnits(out.amount1 + out.fees1, token1.decimals)) * p1;
    return new Intl.NumberFormat(locale, { style: "currency", currency }).format(value);
  })();
  const [base, quote] = invert ? [token1, token0] : [token0, token1];

  return (
    <div data-slot="remove-liquidity" className={cn("flex w-full max-w-md flex-col gap-4 rounded-xl border bg-card p-4 text-card-foreground", className)}>
      <header className="flex items-center gap-3">
        <span className="flex shrink-0 -space-x-2" aria-hidden>
          <TokenIcon symbol={base.symbol} src={base.logoURI} size={28} className="rounded-full ring-2 ring-card" />
          <TokenIcon symbol={quote.symbol} src={quote.logoURI} size={28} className="rounded-full ring-2 ring-card" />
        </span>
        <div className="flex min-w-0 flex-1 flex-col">
          <h3 className="truncate font-semibold">{title}</h3>
          <span className="text-xs text-muted-foreground tabular-nums">
            {base.symbol} / {quote.symbol}
            {position.fee !== undefined && ` · ${formatFee(position.fee, locale)}`} · #{position.tokenId.toString()}
          </span>
        </div>
      </header>

      <RangeIndicator
        tickLower={position.tickLower}
        tickUpper={position.tickUpper}
        liquidity={position.liquidity}
        pool={pool}
        token0={token0}
        token1={token1}
        invert={invert}
        compact
        locale={locale}
      />

      <section className="flex flex-col gap-3 rounded-lg bg-muted/40 p-3">
        <Slider.Root
          value={percent}
          onValueChange={(value) => setPercent(Array.isArray(value) ? value[0] : value)}
          min={0}
          max={100}
          step={1}
          disabled={position.liquidity === 0n}
          className="flex flex-col gap-3"
        >
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-sm text-muted-foreground">Amount</span>
            <Slider.Value className="text-3xl font-semibold tabular-nums">{() => `${percent}%`}</Slider.Value>
          </div>
          <Slider.Control className="flex w-full touch-none items-center py-2 select-none">
            <Slider.Track className="h-1.5 w-full rounded-full bg-muted select-none">
              <Slider.Indicator className="rounded-full bg-foreground select-none" />
              <Slider.Thumb
                aria-label="Share of the position to remove"
                getAriaValueText={(_, value) => `${value}%`}
                className="size-5 rounded-full border-2 border-background bg-foreground shadow select-none has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring"
              />
            </Slider.Track>
          </Slider.Control>
        </Slider.Root>
        <div role="group" aria-label="Amount presets" className="grid grid-cols-4 gap-1.5">
          {presets.map((p) => (
            <button
              key={p}
              type="button"
              aria-pressed={percent === p}
              disabled={position.liquidity === 0n}
              onClick={() => setPercent(p)}
              className={cn(
                "min-h-8 rounded-md border text-xs font-medium tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50",
                percent === p ? "border-foreground bg-foreground text-background" : "hover:bg-muted"
              )}
            >
              {p === 100 ? "Max" : `${p}%`}
            </button>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-2" aria-live="polite">
        <div className="flex items-baseline justify-between gap-2">
          <h4 className="text-sm font-medium">You receive</h4>
          {total && <span className="text-sm font-semibold tabular-nums">{total}</span>}
        </div>
        <dl className="flex flex-col gap-1.5 text-sm">
          {[
            { token: token0, principal: out.amount0, fees: out.fees0 },
            { token: token1, principal: out.amount1, fees: out.fees1 },
          ].map(({ token, principal, fees }) => (
            <div key={token.address} className="flex items-center justify-between gap-2">
              <dt className="inline-flex items-center gap-1.5 text-muted-foreground">
                <TokenIcon symbol={token.symbol} src={token.logoURI} size={16} />
                {token.symbol}
              </dt>
              <dd className="flex flex-col items-end tabular-nums">
                <TokenAmount value={principal + fees} decimals={token.decimals} locale={locale} />
                {fees > 0n && (
                  <span className="text-xs text-muted-foreground">
                    incl. <TokenAmount value={fees} decimals={token.decimals} locale={locale} /> fees
                  </span>
                )}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <SlippageInput value={slippageBps} onValueChange={setSlippageBps} locale={locale} />

      <TransactionButton
        chainId={token0.chainId}
        transaction={transaction}
        disabledReason={address ? blocker : undefined}
        onSubmitted={onSubmitted}
        onSuccess={onSuccess}
        agentConfirm={`Remove ${percent}% of position #${position.tokenId} and collect its fees. This sends a transaction.`}
        className="w-full [&>button]:h-11 [&>button]:w-full"
      >
        {percent === 100 ? "Remove all liquidity" : "Remove liquidity"}
      </TransactionButton>
    </div>
  );
}
