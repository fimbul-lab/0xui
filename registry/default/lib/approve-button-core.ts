import type { Config } from "@wagmi/core";
import { readContractQueryOptions } from "@wagmi/core/query";
import { erc20Abi, maxUint256 } from "viem";
import type { Address } from "viem";

export type AllowanceParameters = {
  /** ERC-20 contract. */
  token: Address;
  /** Contract that will spend the tokens, e.g. a router. */
  spender: Address;
  /** Owner. Without one the query waits. */
  owner?: Address;
  chainId?: number;
};

/** TanStack query options for the ERC-20 allowance of `spender` over `owner`'s tokens. */
export function allowanceQueryOptions(
  config: Config,
  { token, spender, owner, chainId }: AllowanceParameters,
) {
  return readContractQueryOptions(config, {
    address: token,
    abi: erc20Abi,
    functionName: "allowance",
    args: owner ? [owner, spender] : undefined,
    chainId,
    query: { enabled: Boolean(owner) },
  });
}

/**
 * Tokens that revert when a non-zero allowance is changed to another
 * non-zero value, as `chainId:address` in lower case. Mainnet USDT is the
 * well-known one.
 */
const RESET_FIRST = new Set(["1:0xdac17f958d2ee523a2206206994597c13d831ec7"]);

/** True for a token whose leftover allowance must be set to 0 before it can be raised. */
export function requiresAllowanceReset(chainId: number, token: Address) {
  return RESET_FIRST.has(`${chainId}:${token.toLowerCase()}`);
}

export type ApprovalStep =
  | { kind: "none" }
  | { kind: "reset"; value: 0n }
  | { kind: "approve"; value: bigint };

/**
 * The approval `amount` needs next, given the current allowance: nothing,
 * a reset to 0 for tokens like USDT, or an approve. Undefined `allowance`
 * means it isn't known yet.
 */
export function nextApproval({
  allowance,
  amount,
  chainId,
  token,
  unlimited = false,
  resetFirst,
}: {
  allowance: bigint | undefined;
  amount: bigint;
  chainId: number;
  token: Address;
  unlimited?: boolean;
  resetFirst?: boolean;
}): ApprovalStep {
  if (amount === 0n || (allowance !== undefined && allowance >= amount)) {
    return { kind: "none" };
  }
  const reset =
    (resetFirst ?? requiresAllowanceReset(chainId, token)) &&
    allowance !== undefined &&
    allowance > 0n;
  if (reset) {
    return { kind: "reset", value: 0n };
  }
  return { kind: "approve", value: unlimited ? maxUint256 : amount };
}
