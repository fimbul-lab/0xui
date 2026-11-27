// Docs: https://0xui.io/components/position-card.md
import type { ReactNode } from "react";
import type { Address, Hash, Hex, TransactionReceipt } from "viem";
import { Skeleton } from "skullet/react";
import { useConfig, useConnection } from "wagmi";
import { RangeIndicator } from "@/components/range-indicator";
import { TokenAmount } from "@/components/token-amount";
import { TokenIcon } from "@/components/token-icon";
import type { Token, TokenPrices } from "@/components/token-select";
import { TransactionButton } from "@/components/transaction-button";
import { getPositionAmounts, getRangeStatus } from "@/lib/concentrated-liquidity";
import type { PoolState, Position } from "@/lib/concentrated-liquidity";
import { formatFee } from "@/lib/fee-tier-core";
import { formatMoney, positionValue } from "@/lib/liquidity-utils";
import { collectConfirmText } from "@/lib/position-card-core";
import type { CollectRequest } from "@/lib/v3-position-manager";
import { cn } from "@/lib/utils";

export { collectConfirmText, positionValue };

export type CollectTransaction = { to: Address; data?: Hex; value?: bigint };

/** Build the collect-fees transaction. Use `v3Collect({ positionManager, weth })` for Uniswap v3. */
export type GetCollectTransaction = (request: CollectRequest<Token>) => CollectTransaction;

type CardPool = Pick<
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
const sample: { position: Position<Token>; pool: CardPool } = {
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

export type PositionCardProps = {
  /** The position. Leave out while it loads: the card shows a skeleton. */
  position?: Position<Token>;
  /** The position's pool: current tick and sqrt price. Leave out while it loads. */
  pool?: CardPool;
  /** Fiat values for the liquidity and fees. */
  prices?: TokenPrices;
  currency?: string;
  /** Quote the range in token0. */
  invert?: boolean;
  /** Adds a Collect fees button. */
  getCollectTransaction?: GetCollectTransaction;
  onCollected?: (receipt: TransactionReceipt) => void;
  onSubmitted?: (hash: Hash) => void;
  /** Extra actions in the footer, like Add and Remove buttons. */
  actions?: ReactNode;
  locale?: string;
  className?: string;
};

/**
 * One LP position: pair, fee tier and token id, an In range / Out of range
 * / Closed indicator with the range against the price, the tokens it holds
 * now and its uncollected fees (with fiat values when prices are given),
 * and a Collect fees button. Add your own Add / Remove actions in `actions`.
 */
export function PositionCard({ position, pool, className, ...props }: PositionCardProps) {
  return (
    <Skeleton
      data={position && pool ? { position, pool } : undefined}
      sample={sample}
      label="Loading position"
      className={cn("w-full", className)}
    >
      {(data) => <PositionCardView {...props} {...data} />}
    </Skeleton>
  );
}

function PositionCardView({
  position,
  pool,
  prices,
  currency = "USD",
  invert = false,
  getCollectTransaction,
  onCollected,
  onSubmitted,
  actions,
  locale,
  className,
}: PositionCardProps & { position: Position<Token>; pool: CardPool }) {
  const { address } = useConnection();
  const { chains } = useConfig();
  const { token0, token1 } = position;
  const amounts = getPositionAmounts(position, pool);
  const fees = { amount0: position.fees0 ?? 0n, amount1: position.fees1 ?? 0n };
  const hasFees = fees.amount0 > 0n || fees.amount1 > 0n;
  const status = getRangeStatus(
    pool.tick,
    position.tickLower,
    position.tickUpper,
    position.liquidity,
  );
  const money = (value: number | undefined) => formatMoney(value, currency, locale);
  const [base, quote] = invert ? [token1, token0] : [token0, token1];

  return (
    <article
      data-slot="position-card"
      data-status={status}
      className={cn(
        "flex w-full flex-col gap-4 rounded-xl border bg-card p-4 text-card-foreground",
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
          <h3 className="truncate font-semibold">
            {base.symbol} / {quote.symbol}
          </h3>
          <span className="text-xs text-muted-foreground tabular-nums">
            Position #{position.tokenId.toString()}
          </span>
        </div>
        {position.fee !== undefined && (
          <span className="rounded-sm bg-muted px-1.5 py-0.5 text-xs font-medium tabular-nums">
            {formatFee(position.fee, locale)}
          </span>
        )}
      </header>

      <RangeIndicator
        tickLower={position.tickLower}
        tickUpper={position.tickUpper}
        liquidity={position.liquidity}
        pool={pool}
        token0={token0}
        token1={token1}
        invert={invert}
        locale={locale}
      />

      <div className="grid gap-3 sm:grid-cols-2">
        <AmountsBlock
          label="Liquidity"
          total={money(positionValue(amounts, token0, token1, prices))}
          rows={[
            { token: token0, value: amounts.amount0 },
            { token: token1, value: amounts.amount1 },
          ]}
          locale={locale}
        />
        <AmountsBlock
          label="Unclaimed fees"
          total={money(positionValue(fees, token0, token1, prices))}
          rows={[
            { token: token0, value: fees.amount0 },
            { token: token1, value: fees.amount1 },
          ]}
          locale={locale}
        />
      </div>

      {(getCollectTransaction || actions) && (
        <footer className="flex flex-wrap items-start gap-2">
          {getCollectTransaction && (
            <TransactionButton
              chainId={token0.chainId}
              transaction={
                address && hasFees
                  ? getCollectTransaction({
                      tokenId: position.tokenId,
                      token0,
                      token1,
                      recipient: address,
                    })
                  : undefined
              }
              disabledReason={address && !hasFees ? "No fees to collect" : undefined}
              onSubmitted={onSubmitted}
              onSuccess={onCollected}
              agentConfirm={collectConfirmText({
                tokenId: position.tokenId,
                fees0: fees.amount0,
                fees1: fees.amount1,
                token0,
                token1,
                chainName: chains.find((c) => c.id === token0.chainId)?.name,
              })}
              variant="outline"
              className="flex-1"
            >
              Collect fees
            </TransactionButton>
          )}
          {actions}
        </footer>
      )}
    </article>
  );
}

function AmountsBlock({
  label,
  total,
  rows,
  locale,
}: {
  label: string;
  total?: string;
  rows: Array<{ token: Token; value: bigint }>;
  locale?: string;
}) {
  return (
    <section className="flex flex-col gap-1.5 rounded-lg bg-muted/40 p-3">
      <div className="flex items-baseline justify-between gap-2">
        <h4 className="text-xs text-muted-foreground">{label}</h4>
        {total && <span className="text-sm font-semibold tabular-nums">{total}</span>}
      </div>
      <dl className="flex flex-col gap-1 text-sm">
        {rows.map(({ token, value }) => (
          <div key={token.address} className="flex items-center justify-between gap-2">
            <dt className="inline-flex items-center gap-1.5 text-muted-foreground">
              <TokenIcon symbol={token.symbol} src={token.logoURI} size={16} />
              {token.symbol}
            </dt>
            <dd className="tabular-nums">
              <TokenAmount value={value} decimals={token.decimals} locale={locale} />
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
