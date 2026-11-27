// Docs: https://0xui.io/blocks/add-liquidity.md
//
// Transactions for Uniswap v3's NonfungiblePositionManager, and forks with
// the same ABI (PancakeSwap v3, Sushi v3). Each builder takes a plain request
// and returns `{ to, data, value }` for a TransactionButton.
//
// Native ETH: the manager only holds WETH. Deposits send ETH as value and
// add `refundETH`. Withdrawals collect to the manager itself, then
// `unwrapWETH9` the WETH side and `sweepToken` the other side to the user.
import { encodeFunctionData, isAddress, parseAbi, zeroAddress } from "viem";
import type { Address, Hex } from "viem";

/** Anything with an address and decimals: a token list `Token` fits. */
type TokenLike = { address: string; symbol: string };

export type PositionTransaction = { to: Address; data: Hex; value?: bigint };

export const NATIVE_ADDRESS = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
const isNative = (token: TokenLike) => token.address.toLowerCase() === NATIVE_ADDRESS.toLowerCase();
const MAX_UINT128 = 2n ** 128n - 1n;

/** A token's address, checked before it goes into calldata. */
function tokenAddress(token: TokenLike): Address {
  if (!isAddress(token.address, { strict: false })) {
    throw new Error(`${token.symbol} has an invalid address: ${token.address}`);
  }
  return token.address;
}

export const positionManagerAbi = parseAbi([
  "function mint((address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint256 amount0Desired, uint256 amount1Desired, uint256 amount0Min, uint256 amount1Min, address recipient, uint256 deadline) params) payable returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)",
  "function decreaseLiquidity((uint256 tokenId, uint128 liquidity, uint256 amount0Min, uint256 amount1Min, uint256 deadline) params) payable returns (uint256 amount0, uint256 amount1)",
  "function collect((uint256 tokenId, address recipient, uint128 amount0Max, uint128 amount1Max) params) payable returns (uint256 amount0, uint256 amount1)",
  "function positions(uint256 tokenId) view returns (uint96 nonce, address operator, address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint128 liquidity, uint256 feeGrowthInside0LastX128, uint256 feeGrowthInside1LastX128, uint128 tokensOwed0, uint128 tokensOwed1)",
  "function multicall(bytes[] data) payable returns (bytes[] results)",
  "function refundETH() payable",
  "function unwrapWETH9(uint256 amountMinimum, address recipient) payable",
  "function sweepToken(address token, uint256 amountMinimum, address recipient) payable",
]);

/** Subtract slippage in basis points, rounding down. 50 bps is 0.5%. */
export function withSlippage(amount: bigint, slippageBps: number) {
  return (amount * BigInt(10_000 - Math.round(slippageBps))) / 10_000n;
}

/** Unix seconds `seconds` from now, for deadlines. */
export function deadlineIn(seconds: number) {
  return BigInt(Math.floor(Date.now() / 1000) + seconds);
}

function poolAddress(token: TokenLike, weth: Address | undefined) {
  if (!isNative(token)) {
    return tokenAddress(token);
  }
  if (!weth) {
    throw new Error(`Pass \`weth\` to use native ${token.symbol}.`);
  }
  return weth;
}

function multicall(to: Address, calls: Array<Hex>, value?: bigint): PositionTransaction {
  const [only, ...rest] = calls;
  if (only !== undefined && rest.length === 0) {
    return value ? { to, data: only, value } : { to, data: only };
  }
  const data = encodeFunctionData({
    abi: positionManagerAbi,
    functionName: "multicall",
    args: [calls],
  });
  return value ? { to, data, value } : { to, data };
}

/**
 * Collect calls that pay `recipient`: straight to them, or, when a side is
 * native ETH, into the manager first and then unwrapped and swept out.
 */
function collectCalls({
  tokenId,
  token0,
  token1,
  recipient,
  amount0Min = 0n,
  amount1Min = 0n,
  weth,
}: {
  tokenId: bigint;
  token0: TokenLike;
  token1: TokenLike;
  recipient: Address;
  amount0Min?: bigint;
  amount1Min?: bigint;
  weth?: Address;
}): Array<Hex> {
  const native = isNative(token0) ? 0 : isNative(token1) ? 1 : undefined;
  const collect = encodeFunctionData({
    abi: positionManagerAbi,
    functionName: "collect",
    args: [
      {
        tokenId,
        recipient: native === undefined ? recipient : zeroAddress,
        amount0Max: MAX_UINT128,
        amount1Max: MAX_UINT128,
      },
    ],
  });
  if (native === undefined) {
    return [collect];
  }
  if (!weth) {
    throw new Error("Pass `weth` to withdraw native ETH.");
  }
  const [ethMin, other, otherMin] =
    native === 0 ? [amount0Min, token1, amount1Min] : [amount1Min, token0, amount0Min];
  return [
    collect,
    encodeFunctionData({
      abi: positionManagerAbi,
      functionName: "unwrapWETH9",
      args: [ethMin, recipient],
    }),
    encodeFunctionData({
      abi: positionManagerAbi,
      functionName: "sweepToken",
      args: [tokenAddress(other), otherMin, recipient],
    }),
  ];
}

/* ------------------------------------------------------------------------ */

export type MintRequest<T extends TokenLike = TokenLike> = {
  token0: T;
  token1: T;
  /** Fee tier in hundredths of a bip. */
  fee?: number;
  tickLower: number;
  tickUpper: number;
  amount0Desired: bigint;
  amount1Desired: bigint;
  /** `amount0Desired` less slippage. The mint reverts below it. */
  amount0Min: bigint;
  amount1Min: bigint;
  /** Who gets the position NFT. */
  recipient: Address;
  /** Unix seconds. */
  deadline: bigint;
};

/**
 * `mint` a new position. A native ETH side is sent as value and wrapped by
 * the manager, with `refundETH` so whatever the mint doesn't use comes back.
 */
export function v3Mint({ positionManager, weth }: { positionManager: Address; weth?: Address }) {
  return (r: MintRequest): PositionTransaction => {
    const token0 = poolAddress(r.token0, weth);
    const token1 = poolAddress(r.token1, weth);
    if (BigInt(token0) >= BigInt(token1)) {
      throw new Error("token0 must sort below token1. Pass the tokens in pool order.");
    }
    if (r.fee === undefined) {
      throw new Error("v3 pools need a fee tier.");
    }
    const mint = encodeFunctionData({
      abi: positionManagerAbi,
      functionName: "mint",
      args: [
        {
          token0,
          token1,
          fee: r.fee,
          tickLower: r.tickLower,
          tickUpper: r.tickUpper,
          amount0Desired: r.amount0Desired,
          amount1Desired: r.amount1Desired,
          amount0Min: r.amount0Min,
          amount1Min: r.amount1Min,
          recipient: r.recipient,
          deadline: r.deadline,
        },
      ],
    });
    const value = isNative(r.token0)
      ? r.amount0Desired
      : isNative(r.token1)
        ? r.amount1Desired
        : 0n;
    if (value === 0n) {
      return { to: positionManager, data: mint };
    }
    return multicall(
      positionManager,
      [mint, encodeFunctionData({ abi: positionManagerAbi, functionName: "refundETH" })],
      value,
    );
  };
}

export type RemoveRequest<T extends TokenLike = TokenLike> = {
  tokenId: bigint;
  token0: T;
  token1: T;
  /** Liquidity to remove: a share of the position's. */
  liquidity: bigint;
  /** Principal expected back, less slippage. Fees come on top. */
  amount0Min: bigint;
  amount1Min: bigint;
  /** Who receives the tokens. */
  recipient: Address;
  deadline: bigint;
};

/**
 * Remove liquidity and collect it in one transaction:
 * `decreaseLiquidity` then `collect` (which also pays out all uncollected
 * fees). Native ETH is unwrapped on the way out.
 */
export function v3Remove({ positionManager, weth }: { positionManager: Address; weth?: Address }) {
  return (r: RemoveRequest): PositionTransaction => {
    const decrease = encodeFunctionData({
      abi: positionManagerAbi,
      functionName: "decreaseLiquidity",
      args: [
        {
          tokenId: r.tokenId,
          liquidity: r.liquidity,
          amount0Min: r.amount0Min,
          amount1Min: r.amount1Min,
          deadline: r.deadline,
        },
      ],
    });
    return multicall(positionManager, [decrease, ...collectCalls({ ...r, weth })]);
  };
}

export type CollectRequest<T extends TokenLike = TokenLike> = {
  tokenId: bigint;
  token0: T;
  token1: T;
  recipient: Address;
};

/** Collect a position's uncollected fees. Native ETH is unwrapped. */
export function v3Collect({ positionManager, weth }: { positionManager: Address; weth?: Address }) {
  return (r: CollectRequest): PositionTransaction =>
    multicall(positionManager, collectCalls({ ...r, weth }));
}
