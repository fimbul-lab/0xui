// Docs: https://0xui.io/blocks/remove-liquidity.md
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Skeleton } from "skullet/react";
import type { Address, Hash, Hex, TransactionReceipt } from "viem";
import { useConfig, useConnection } from "wagmi";
import { Button } from "@/components/primitives/button";
import {
  Slider,
  SliderControl,
  SliderIndicator,
  SliderThumb,
  SliderTrack,
  SliderValue,
} from "@/components/primitives/slider";
import { RangeIndicator } from "@/components/range-indicator";
import { SlippageInput } from "@/components/slippage-input";
import { TokenAmount } from "@/components/token-amount";
import { TokenIcon } from "@/components/token-icon";
import type { Token, TokenPrices } from "@/components/token-select";
import { TransactionButton } from "@/components/transaction-button";
import type { PoolState, Position } from "@/lib/concentrated-liquidity";
import { formatFee } from "@/lib/fee-tier-core";
import { formatMoney, positionValue } from "@/lib/liquidity-utils";
import {
  getRemoveAmounts,
  removeBlocker,
  removeConfirmText,
  removePresets,
  removeRequest,
} from "@/lib/remove-liquidity-core";
import type { RemoveRequest } from "@/lib/v3-position-manager";
import { cn } from "@/lib/utils";

export { getRemoveAmounts, removeBlocker, removeConfirmText, removeRequest };

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

type RemovePool = Pick<
  PoolState,
  "tick" | "sqrtPriceX96" | "tickSpacing" | "decimals0" | "decimals1"
>;

/** Stand-ins the loading skeleton is measured from. */
const sampleToken = (symbol: string, n: number): Token => ({
  chainId: 1,
  address: `0x${n.toString(16).padStart(40, "0")}`,
  name: symbol,
  symbol,
  decimals: 18,
});
/** What the block draws: the position and its pool. */
type Loaded = { position: Position<Token>; pool: RemovePool };

const sample: Loaded = {
  position: {
    tokenId: 100_000n,
    token0: sampleToken("ETH", 1),
    token1: sampleToken("USDC", 2),
    fee: 500,
    tickLower: -600,
    tickUpper: 600,
    liquidity: 10n ** 18n,
    fees0: 10n ** 16n,
    fees1: 10n ** 16n,
  },
  pool: { tick: 0, tickSpacing: 10, decimals0: 18, decimals1: 18 },
};

export type RemoveLiquidityProps = {
  /** The position. Leave out while it loads: the block shows a skeleton. */
  position?: Position<Token>;
  /** The position's pool. Leave out while it loads. */
  pool?: RemovePool;
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

/**
 * Remove liquidity from a position: pick a share with the slider or the
 * 25 / 50 / 75 / Max buttons, see the tokens you get back (principal at the
 * current price plus all uncollected fees), set slippage, and withdraw in
 * one transaction. Native ETH comes back unwrapped with `v3Remove({ weth })`.
 */
export function RemoveLiquidity({ position, pool, className, ...props }: RemoveLiquidityProps) {
  return (
    <Skeleton
      data={position && pool ? { position, pool } : undefined}
      sample={sample}
      label="Loading position"
      className={cn("w-full max-w-md", className)}
    >
      {(data) => <RemoveLiquidityView {...props} {...data} />}
    </Skeleton>
  );
}

function RemoveLiquidityView({
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
}: RemoveLiquidityProps & { position: Position<Token>; pool: RemovePool }) {
  const { address } = useConnection();
  const { chains } = useConfig();
  const [percent, setPercent] = useState(defaultPercent);
  const [slippageBps, setSlippageBps] = useState(defaultSlippageBps);
  const now = useNow(60_000);
  const { token0, token1 } = position;
  const out = getRemoveAmounts(position, pool, percent, slippageBps);

  const blocker = removeBlocker(position, percent);
  const transaction =
    address && !blocker
      ? getTransaction(
          removeRequest({
            position,
            amounts: out,
            recipient: address,
            deadline: BigInt(Math.floor(now / 1000) + deadlineSeconds),
          }),
        )
      : undefined;
  const total = formatMoney(
    positionValue(
      { amount0: out.amount0 + out.fees0, amount1: out.amount1 + out.fees1 },
      token0,
      token1,
      prices,
    ),
    currency,
    locale,
  );
  const [base, quote] = invert ? [token1, token0] : [token0, token1];

  return (
    <div
      data-slot="remove-liquidity"
      className={cn(
        "flex w-full max-w-md flex-col gap-4 rounded-xl border bg-card p-4 text-card-foreground",
        className,
      )}
    >
      <header className="flex items-center gap-3">
        <span className="flex shrink-0 -space-x-2" aria-hidden>
          <TokenIcon
            symbol={base.symbol}
            src={base.logoURI}
            size={28}
            className="rounded-full ring-2 ring-card"
          />
          <TokenIcon
            symbol={quote.symbol}
            src={quote.logoURI}
            size={28}
            className="rounded-full ring-2 ring-card"
          />
        </span>
        <div className="flex min-w-0 flex-1 flex-col">
          <h3 className="truncate font-semibold">{title}</h3>
          <span className="text-xs text-muted-foreground tabular-nums">
            {base.symbol} / {quote.symbol}
            {position.fee !== undefined && ` · ${formatFee(position.fee, locale)}`} · #
            {position.tokenId.toString()}
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
        <Slider
          value={percent}
          onValueChange={(value) =>
            setPercent(Array.isArray(value) ? (value[0] ?? percent) : value)
          }
          min={0}
          max={100}
          step={1}
          format={{ style: "unit", unit: "percent" }}
          disabled={position.liquidity === 0n}
        >
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-sm text-muted-foreground">Amount</span>
            <SliderValue className="text-3xl font-semibold" />
          </div>
          <SliderControl>
            <SliderTrack>
              <SliderIndicator />
              <SliderThumb aria-label="Share of the position to remove" />
            </SliderTrack>
          </SliderControl>
        </Slider>
        <div role="group" aria-label="Amount presets" className="grid grid-cols-4 gap-1.5">
          {removePresets.map((p) => (
            <Button
              key={p}
              variant={percent === p ? "default" : "outline"}
              size="sm"
              aria-pressed={percent === p}
              disabled={position.liquidity === 0n}
              onClick={() => setPercent(p)}
              className="tabular-nums"
            >
              {p === 100 ? "Max" : `${p}%`}
            </Button>
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
                    incl. <TokenAmount value={fees} decimals={token.decimals} locale={locale} />{" "}
                    fees
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
        agentConfirm={removeConfirmText({
          tokenId: position.tokenId,
          percent,
          amounts: out,
          token0,
          token1,
          chainName: chains.find((c) => c.id === token0.chainId)?.name,
        })}
        className="w-full [&>button]:h-11 [&>button]:w-full"
      >
        {percent === 100 ? "Remove all liquidity" : "Remove liquidity"}
      </TransactionButton>
    </div>
  );
}
