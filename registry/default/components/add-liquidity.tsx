// Docs: https://0xui.io/blocks/add-liquidity.md
import { useQuery } from "@tanstack/react-query";
import { LockIcon } from "lucide-react";
import { useState, type ReactNode } from "react";
import type { Address, Hash, TransactionReceipt } from "viem";
import { Skeleton } from "skullet/react";
import { useConfig, useConnection } from "wagmi";
import { ApproveButton } from "@/components/approve-button";
import { useTokenBalance } from "@/components/balance";
import { FeeTierSelect, type FeeTier } from "@/components/fee-tier-select";
import { PriceRange, type RangePreset } from "@/components/price-range";
import { SlippageInput } from "@/components/slippage-input";
import { TokenInput } from "@/components/token-input";
import { isNativeToken, type Token, type TokenPrices } from "@/components/token-select";
import { TransactionButton } from "@/components/transaction-button";
import {
  addLiquidityBlocker,
  addLiquidityConfirmText,
  getDepositAmounts,
  isSideLocked,
  mintRequest,
  mintTransactionQueryOptions,
  shortToken,
  type DepositSide,
  type GetMintTransaction as GetMintTransactionFor,
  type MintTransaction,
} from "@/lib/add-liquidity-core";
import type { LiquidityBin, PoolState, TickRange } from "@/lib/concentrated-liquidity";
import { formatFee } from "@/lib/fee-tier-core";
import { defaultRange as startingRange } from "@/lib/price-range-core";
import { v3Mint, withSlippage, type MintRequest as V3MintRequest } from "@/lib/v3-position-manager";
import { cn } from "@/lib/utils";

/** Everything needed to mint a position. Amounts in each token's smallest unit. */
export type MintRequest = V3MintRequest<Token>;

/** Build the mint transaction. Sync or async, for a router API. */
export type GetMintTransaction = GetMintTransactionFor<Token>;

export type { DepositSide, MintTransaction };
export {
  addLiquidityBlocker,
  addLiquidityConfirmText,
  getDepositAmounts,
  mintRequest,
  mintTransactionQueryOptions,
  v3Mint,
  withSlippage,
};

/**
 * Linked deposit amounts for a range: typing one token fills the other at
 * the ratio the range needs, and a range outside the price locks the side
 * it doesn't take. Keeps the side the user typed and recomputes the other
 * whenever the range moves. The math is `getDepositAmounts` (framework-free).
 */
export function useDepositAmounts({
  pool,
  range,
  token0,
  token1,
}: {
  pool: Pick<PoolState, "tick" | "sqrtPriceX96">;
  range: TickRange;
  token0: Token;
  token1: Token;
}) {
  const [typed, setTyped] = useState<{ side: DepositSide; text: string }>({ side: "token0", text: "" });
  const deposit = getDepositAmounts({ pool, range, token0, token1, typed });
  return {
    ...deposit,
    /** True when the range takes only the other token, so this side is locked at 0. */
    isLocked: (side: DepositSide) => isSideLocked(deposit.mode, side),
    setText: (side: DepositSide, next: string) => setTyped({ side, text: next }),
    clear: () => setTyped((t) => ({ ...t, text: "" })),
  };
}

/** Stand-in pool the loading skeleton is measured from. */
const samplePool: PoolState = {
  tick: 0,
  sqrtPriceX96: 2n ** 96n,
  liquidity: 0n,
  tickSpacing: 10,
  decimals0: 18,
  decimals1: 18,
};

export type AddLiquidityProps = {
  /** Pool's token0 and token1, in pool order (sorted by address). Native ETH is fine with `v3Mint({ weth })`. */
  token0: Token;
  token1: Token;
  /** Current pool state. `sqrtPriceX96` makes the deposit ratio exact. Leave out while it loads: the block shows a skeleton. */
  pool?: PoolState;
  /** Liquidity bins for the range chart, from `getLiquidityBins`. Leave out while they load. */
  bins?: readonly LiquidityBin[];
  /** Show the liquidity chart. Turn off for a compact form. */
  showChart?: boolean;
  /** Build the mint transaction. Use `v3Mint({ positionManager })` for Uniswap v3 and forks. */
  getTransaction: GetMintTransaction;
  /** Contract to approve for both tokens: the position manager, or Permit2 for v4. */
  spender: Address;
  /** Selected fee tier, when the pair has several. Changing it should load that tier's pool. */
  fee?: number;
  /** Fee tiers to offer. Shows the fee picker when set with `onFeeChange`. */
  feeTiers?: FeeTier[];
  onFeeChange?: (tier: FeeTier) => void;
  /** Starting range. Defaults to ±10% (±0.1% for stable spacings). */
  defaultRange?: TickRange;
  presets?: RangePreset[];
  /** Quote prices in token0. Starts inverted when token0 is the stablecoin, like USDC/WETH. */
  defaultInvert?: boolean;
  /** Starting slippage tolerance in basis points. 50 is 0.5%. The user can change it. */
  slippageBps?: number;
  /** Seconds the mint stays valid after it's built. */
  deadlineSeconds?: number;
  prices?: TokenPrices;
  onSubmitted?: (hash: Hash) => void;
  onSuccess?: (receipt: TransactionReceipt) => void;
  title?: ReactNode;
  /** Number formatting locale. Pin it when you server-render, so the server and the browser agree. */
  locale?: string;
  className?: string;
};

/**
 * Add liquidity to a concentrated liquidity pool, the way Uniswap's new
 * position flow works: pick a fee tier, set a price range on the pool's
 * liquidity chart, then enter one amount and get the other at the ratio
 * the range needs. A range outside the price takes one token, and the
 * other side locks. Approvals for both tokens come before the mint, and
 * the button names whatever is missing. Bring the transaction via
 * `getTransaction`, or use `v3Mint`.
 */
export function AddLiquidity({ pool, className, ...props }: AddLiquidityProps) {
  return (
    <Skeleton data={pool} sample={samplePool} label="Loading pool" className={cn("w-full max-w-xl", className)}>
      {(p) => <AddLiquidityView key={p === samplePool ? "sample" : "pool"} {...props} pool={p} />}
    </Skeleton>
  );
}

function AddLiquidityView({
  token0,
  token1,
  pool,
  bins,
  showChart,
  getTransaction,
  spender,
  fee,
  feeTiers,
  onFeeChange,
  defaultRange,
  presets,
  defaultInvert = false,
  slippageBps: defaultSlippageBps = 50,
  deadlineSeconds = 20 * 60,
  prices,
  onSubmitted,
  onSuccess,
  title = "Add liquidity",
  locale,
  className,
}: AddLiquidityProps & { pool: PoolState }) {
  const { address } = useConnection();
  const { chains } = useConfig();
  const [range, setRange] = useState<TickRange>(() => defaultRange ?? startingRange(pool, defaultInvert));
  const [invert, setInvert] = useState(defaultInvert);
  // A new fee tier means a new pool and spacing: start its range over.
  const [spacing, setSpacing] = useState(pool.tickSpacing);
  if (spacing !== pool.tickSpacing) {
    setSpacing(pool.tickSpacing);
    setRange(startingRange(pool, invert));
  }
  const [slippageBps, setSlippageBps] = useState(defaultSlippageBps);
  const deposit = useDepositAmounts({ pool, range, token0, token1 });
  const { amount0, amount1 } = deposit;

  // Balances for both sides: the typed side and the computed one.
  const erc20 = (token: Token) => (isNativeToken(token) ? undefined : token.address);
  const balance0 = useTokenBalance({ token: erc20(token0), chainId: token0.chainId }).value;
  const balance1 = useTokenBalance({ token: erc20(token1), chainId: token1.chainId }).value;
  const short = shortToken([token0, amount0, balance0], [token1, amount1, balance1]);

  const request = mintRequest({ token0, token1, fee, range, amount0, amount1, slippageBps, recipient: address });
  const tx = useQuery(mintTransactionQueryOptions({ getTransaction, request, deadlineSeconds }));

  const blocker = addLiquidityBlocker({
    connected: Boolean(address),
    amount0,
    amount1,
    short,
    failed: Boolean(tx.error),
    ready: Boolean(tx.data),
  });
  // What a person confirms before an agent's press reaches the wallet.
  const agentConfirm = addLiquidityConfirmText({
    amount0,
    amount1,
    token0,
    token1,
    range,
    pool,
    invert,
    chainName: chains.find((c) => c.id === token0.chainId)?.name,
    locale,
  });

  const mintButton = (
    <TransactionButton
      chainId={token0.chainId}
      transaction={!blocker ? tx.data : undefined}
      disabledReason={blocker}
      onSubmitted={onSubmitted}
      onSuccess={(receipt) => {
        deposit.clear();
        onSuccess?.(receipt);
      }}
      agentConfirm={agentConfirm}
      className="w-full [&>button]:h-11 [&>button]:w-full"
    >
      Add liquidity
    </TransactionButton>
  );

  const approve = (token: Token, amount: bigint, children: ReactNode) =>
    !blocker && address && !isNativeToken(token) && amount > 0n ? (
      <ApproveButton
        token={{ address: token.address as Address, symbol: token.symbol, decimals: token.decimals }}
        spender={spender}
        amount={amount}
        chainId={token.chainId}
        className="w-full [&>button]:h-11 [&>button]:w-full"
      >
        {children}
      </ApproveButton>
    ) : (
      children
    );

  const sides: DepositSide[] = invert ? ["token1", "token0"] : ["token0", "token1"];
  const tokenOf = { token0, token1 };
  const other = (side: DepositSide) => tokenOf[side === "token0" ? "token1" : "token0"];

  return (
    <div
      data-slot="add-liquidity"
      data-deposit-mode={deposit.mode}
      className={cn("flex w-full max-w-xl flex-col gap-4", className)}
    >
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        {title && <h3 className="text-lg font-semibold">{title}</h3>}
        <span className="text-sm text-muted-foreground">
          {token0.symbol} / {token1.symbol}
          {fee !== undefined && <span className="ml-2 rounded-sm bg-muted px-1.5 py-0.5 text-xs font-medium tabular-nums">{formatFee(fee, locale)}</span>}
        </span>
      </header>

      {feeTiers && onFeeChange && (
        <FeeTierSelect tiers={feeTiers} value={fee} onValueChange={onFeeChange} locale={locale} />
      )}

      <PriceRange
        pool={pool}
        bins={pool === samplePool ? undefined : bins}
        showChart={showChart}
        token0={token0}
        token1={token1}
        value={range}
        onValueChange={setRange}
        invert={invert}
        onInvertChange={setInvert}
        presets={presets}
        locale={locale}
      />

      <section className="flex flex-col gap-2" aria-label="Deposit amounts">
        <h4 className="text-sm font-medium">Deposit amounts</h4>
        {sides.map((side) =>
          deposit.isLocked(side) ? (
            <div
              key={side}
              data-locked
              className="flex items-center gap-3 rounded-2xl border border-dashed p-4 text-sm text-muted-foreground"
            >
              <LockIcon className="size-4 shrink-0" aria-hidden />
              <span>
                No {tokenOf[side].symbol} needed. The price is outside your range, so it only takes {other(side).symbol}.
              </span>
            </div>
          ) : (
            <TokenInput
              key={side}
              label={tokenOf[side].symbol}
              value={deposit.text[side]}
              onValueChange={(next) => deposit.setText(side, next)}
              token={tokenOf[side]}
              prices={prices}
            />
          )
        )}
        <SlippageInput value={slippageBps} onValueChange={setSlippageBps} locale={locale} className="mt-1" />
      </section>

      {tx.error && (
        <p role="alert" className="text-sm text-destructive">
          {(tx.error as { shortMessage?: string }).shortMessage ?? tx.error.message}
        </p>
      )}

      {approve(token0, amount0, approve(token1, amount1, mintButton))}
    </div>
  );
}
