// Docs: https://0xui.io/blocks/add-liquidity.md
import { useQuery } from "@tanstack/react-query";
import { LockIcon } from "lucide-react";
import { useState, type ReactNode } from "react";
import {
  formatUnits,
  type Address,
  type Hash,
  type Hex,
  type TransactionReceipt,
} from "viem";
import { useConnection } from "wagmi";
import { ApproveButton } from "@/components/approve-button";
import { useTokenBalance } from "@/components/balance";
import { FeeTierSelect, formatFee, type FeeTier } from "@/components/fee-tier-select";
import type { TickRange } from "@/components/liquidity-chart";
import { PriceRange, type RangePreset } from "@/components/price-range";
import { SlippageInput } from "@/components/slippage-input";
import { TokenInput } from "@/components/token-input";
import { isNativeToken, type Token, type TokenPrices } from "@/components/token-select";
import { TransactionButton } from "@/components/transaction-button";
import {
  getDependentAmount,
  getDepositMode,
  getSqrtRatioAtTick,
  rangeAroundTick,
  type DepositMode,
  type LiquidityBin,
  type PoolState,
} from "@/lib/concentrated-liquidity";
import { parseAmount } from "@/lib/0xui-utils";
import { v3Mint, withSlippage, type MintRequest as V3MintRequest } from "@/lib/v3-position-manager";
import { cn } from "@/lib/utils";

/** Everything needed to mint a position. Amounts in each token's smallest unit. */
export type MintRequest = V3MintRequest<Token>;

export type MintTransaction = { to: Address; data?: Hex; value?: bigint };

/** Build the mint transaction. Sync or async, for a router API. */
export type GetMintTransaction = (request: MintRequest) => MintTransaction | Promise<MintTransaction>;

export { v3Mint, withSlippage };

/**
 * Linked deposit amounts for a range: typing one token fills the other at
 * the ratio the range needs, and a range outside the price locks the side
 * it doesn't take. Keeps the side the user typed and recomputes the other
 * whenever the range moves.
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
  const [typed, setTyped] = useState<{ side: "token0" | "token1"; text: string }>({ side: "token0", text: "" });
  const mode = getDepositMode(pool.tick, range.tickLower, range.tickUpper);
  const sqrtPriceX96 = pool.sqrtPriceX96 ?? getSqrtRatioAtTick(pool.tick);
  const tokens = { token0, token1 };
  const other = typed.side === "token0" ? "token1" : "token0";

  // The typed side may be one the range no longer takes: then nothing is typed.
  const typedLocked = (mode === "token0" && typed.side === "token1") || (mode === "token1" && typed.side === "token0");
  const typedText = typedLocked ? "" : typed.text;
  const typedAmount = typedText ? parseAmount(typedText, tokens[typed.side].decimals) : undefined;
  const dependent =
    typedAmount !== undefined && typedAmount > 0n
      ? getDependentAmount({ sqrtPriceX96, ...range, amount: typedAmount, token: typed.side })
      : undefined;
  const otherText = dependent ? formatUnits(dependent, tokens[other].decimals) : "";

  const text = { [typed.side]: typedText, [other]: otherText } as Record<"token0" | "token1", string>;
  const amount = {
    [typed.side]: typedAmount ?? 0n,
    [other]: dependent ?? 0n,
  } as Record<"token0" | "token1", bigint>;

  return {
    mode: mode as DepositMode,
    text,
    amount0: amount.token0,
    amount1: amount.token1,
    /** True when the range takes only the other token, so this side is locked at 0. */
    isLocked: (side: "token0" | "token1") => (mode === "token0" && side === "token1") || (mode === "token1" && side === "token0"),
    setText: (side: "token0" | "token1", next: string) => setTyped({ side, text: next }),
    clear: () => setTyped((t) => ({ ...t, text: "" })),
  };
}

export type AddLiquidityProps = {
  /** Pool's token0 and token1, in pool order (sorted by address). Native ETH is fine with `v3Mint({ weth })`. */
  token0: Token;
  token1: Token;
  /** Current pool state. `sqrtPriceX96` makes the deposit ratio exact. */
  pool: PoolState;
  /** Liquidity bins for the range chart, from `getLiquidityBins`. */
  bins?: readonly LiquidityBin[];
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
export function AddLiquidity({
  token0,
  token1,
  pool,
  bins,
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
  className,
}: AddLiquidityProps) {
  const { address } = useConnection();
  const startRange = (invert: boolean) =>
    rangeAroundTick(pool.tick, pool.tickSpacing <= 1 ? 0.1 : 10, pool.tickSpacing, { invert });
  const [range, setRange] = useState<TickRange>(() => defaultRange ?? startRange(defaultInvert));
  // A new fee tier means a new pool and spacing: start its range over.
  const [invert, setInvert] = useState(defaultInvert);
  const [spacing, setSpacing] = useState(pool.tickSpacing);
  if (spacing !== pool.tickSpacing) {
    setSpacing(pool.tickSpacing);
    setRange(startRange(invert));
  }
  const [slippageBps, setSlippageBps] = useState(defaultSlippageBps);
  const deposit = useDepositAmounts({ pool, range, token0, token1 });
  const { amount0, amount1 } = deposit;

  // Balances for both sides: the typed side and the computed one.
  const erc20 = (token: Token) => (isNativeToken(token) ? undefined : (token.address as Address));
  const balance0 = useTokenBalance({ token: erc20(token0), chainId: token0.chainId }).value;
  const balance1 = useTokenBalance({ token: erc20(token1), chainId: token1.chainId }).value;
  const short =
    balance0 !== undefined && amount0 > balance0
      ? token0
      : balance1 !== undefined && amount1 > balance1
        ? token1
        : undefined;

  const request: MintRequest | undefined =
    address && (amount0 > 0n || amount1 > 0n)
      ? {
          token0,
          token1,
          fee,
          ...range,
          amount0Desired: amount0,
          amount1Desired: amount1,
          amount0Min: withSlippage(amount0, slippageBps),
          amount1Min: withSlippage(amount1, slippageBps),
          recipient: address,
          // Filled in when the transaction is built, so it isn't stale.
          deadline: 0n,
        }
      : undefined;

  const tx = useQuery({
    queryKey: [
      "0xui",
      "mint-transaction",
      token0.chainId,
      token0.address,
      token1.address,
      fee,
      range.tickLower,
      range.tickUpper,
      amount0.toString(),
      amount1.toString(),
      slippageBps,
      address,
    ],
    queryFn: () =>
      getTransaction({ ...request!, deadline: BigInt(Math.floor(Date.now() / 1000) + deadlineSeconds) }),
    enabled: Boolean(request),
    // The deadline ages; rebuild before it gets close.
    staleTime: (deadlineSeconds * 1000) / 2,
    refetchInterval: (deadlineSeconds * 1000) / 2,
    retry: false,
  });

  const blocker = !address
    ? undefined // TransactionButton opens the wallet picker.
    : amount0 === 0n && amount1 === 0n
      ? "Enter an amount"
      : short
        ? `Insufficient ${short.symbol} balance`
        : tx.error
          ? "Can't build transaction"
          : !tx.data
            ? "Preparing…"
            : undefined;

  const mintButton = (
    <TransactionButton
      chainId={token0.chainId}
      transaction={!blocker ? tx.data : undefined}
      disabledReason={address ? blocker : undefined}
      onSubmitted={onSubmitted}
      onSuccess={(receipt) => {
        deposit.clear();
        onSuccess?.(receipt);
      }}
      agentConfirm={`Add ${formatUnits(amount0, token0.decimals)} ${token0.symbol} and ${formatUnits(amount1, token1.decimals)} ${token1.symbol} as liquidity. This sends a transaction.`}
      className="w-full [&>button]:h-11 [&>button]:w-full"
    >
      Add liquidity
    </TransactionButton>
  );

  const approve = (token: Token, amount: bigint, children: ReactNode) =>
    !blocker && address && !isNativeToken(token) && amount > 0n ? (
      <ApproveButton
        token={{ address: token.address as Address, symbol: token.symbol }}
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

  const sides = (invert ? ["token1", "token0"] : ["token0", "token1"]) as Array<"token0" | "token1">;
  const tokenOf = { token0, token1 };
  const other = (side: "token0" | "token1") => tokenOf[side === "token0" ? "token1" : "token0"];

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
          {fee !== undefined && <span className="ml-2 rounded-sm bg-muted px-1.5 py-0.5 text-xs font-medium tabular-nums">{formatFee(fee)}</span>}
        </span>
      </header>

      {feeTiers && onFeeChange && (
        <FeeTierSelect tiers={feeTiers} value={fee} onValueChange={onFeeChange} />
      )}

      <PriceRange
        pool={pool}
        bins={bins}
        token0={token0}
        token1={token1}
        value={range}
        onValueChange={setRange}
        invert={invert}
        onInvertChange={setInvert}
        presets={presets}
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
        <SlippageInput value={slippageBps} onValueChange={setSlippageBps} className="mt-1" />
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
