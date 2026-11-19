import type { ReactNode } from "react";
import { erc20Abi, maxUint256, type Address } from "viem";
import { useConnection, useReadContract } from "wagmi";
import {
  TransactionButton,
  type TransactionButtonProps,
} from "@/components/transaction-button";

export type UseAllowanceParameters = {
  /** ERC-20 contract. */
  token: Address;
  /** Contract that will spend the tokens, e.g. a router. */
  spender: Address;
  /** Owner. Defaults to the connected account. */
  owner?: Address;
  chainId?: number;
};

/** Current ERC-20 allowance of `spender` over the owner's tokens. */
export function useAllowance({ token, spender, owner, chainId }: UseAllowanceParameters) {
  const { address } = useConnection();
  const account = owner ?? address;
  return useReadContract({
    address: token,
    abi: erc20Abi,
    functionName: "allowance",
    args: [account!, spender],
    chainId,
    query: { enabled: Boolean(account) },
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

export type ApproveButtonProps = Omit<
  TransactionButtonProps,
  "contract" | "transaction" | "children" | "chainId"
> & {
  /** Token to approve. */
  token: { address: Address; symbol: string };
  /** Contract that will spend the tokens. */
  spender: Address;
  /** Amount the next action needs, in the token's smallest unit. */
  amount: bigint;
  /** Chain the token lives on. */
  chainId: number;
  /** Approve the maximum instead of `amount`. Saves future approvals, but the spender can then move all of the token. */
  unlimited?: boolean;
  /**
   * Set a non-zero allowance to 0 before raising it, as a first
   * transaction. Defaults to true for mainnet USDT, which reverts otherwise.
   */
  resetFirst?: boolean;
  /** Rendered once the allowance covers `amount`, usually the TransactionButton for the real action. */
  children: ReactNode;
};

/**
 * Approval gate for ERC-20 actions. Shows "Approve <token>" while the
 * allowance is too low, then renders `children` (your action) once it
 * covers `amount`. Skips straight to `children` when nothing needs
 * approving. For tokens like USDT it first shows "Reset <token> approval",
 * which sets a leftover allowance to 0.
 */
export function ApproveButton({
  token,
  spender,
  amount,
  chainId,
  unlimited = false,
  resetFirst,
  children,
  onSuccess,
  ...buttonProps
}: ApproveButtonProps) {
  const { status } = useConnection();
  const allowance = useAllowance({ token: token.address, spender, chainId });

  const approved = allowance.data !== undefined && allowance.data >= amount;
  if (amount === 0n || approved) return <>{children}</>;

  const checking = status === "connected" && allowance.isPending;
  const reset =
    (resetFirst ?? requiresAllowanceReset(chainId, token.address)) &&
    allowance.data !== undefined &&
    allowance.data > 0n;

  return (
    <TransactionButton
      // A fresh button for the approval that follows a reset.
      key={reset ? "reset" : "approve"}
      {...buttonProps}
      chainId={chainId}
      contract={{
        address: token.address,
        abi: erc20Abi,
        functionName: "approve",
        args: [spender, reset ? 0n : unlimited ? maxUint256 : amount],
      }}
      disabledReason={checking ? "Checking allowance…" : buttonProps.disabledReason}
      successLabel={reset ? "Approval reset" : "Approved"}
      resetAfter={false}
      onSuccess={async (receipt) => {
        await allowance.refetch();
        onSuccess?.(receipt);
      }}
    >
      {reset ? `Reset ${token.symbol} approval` : `Approve ${token.symbol}`}
    </TransactionButton>
  );
}
