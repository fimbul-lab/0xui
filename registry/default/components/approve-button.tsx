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
  /** Rendered once the allowance covers `amount`, usually the TransactionButton for the real action. */
  children: ReactNode;
};

/**
 * Approval gate for ERC-20 actions. Shows "Approve <token>" while the
 * allowance is too low, then renders `children` (your action) once it
 * covers `amount`. Skips straight to `children` when nothing needs
 * approving.
 */
export function ApproveButton({
  token,
  spender,
  amount,
  chainId,
  unlimited = false,
  children,
  onSuccess,
  ...buttonProps
}: ApproveButtonProps) {
  const { status } = useConnection();
  const allowance = useAllowance({ token: token.address, spender, chainId });

  const approved = allowance.data !== undefined && allowance.data >= amount;
  if (amount === 0n || approved) return <>{children}</>;

  const checking = status === "connected" && allowance.isPending;

  return (
    <TransactionButton
      {...buttonProps}
      chainId={chainId}
      contract={{
        address: token.address,
        abi: erc20Abi,
        functionName: "approve",
        args: [spender, unlimited ? maxUint256 : amount],
      }}
      disabledReason={checking ? "Checking allowance…" : buttonProps.disabledReason}
      successLabel="Approved"
      resetAfter={false}
      onSuccess={async (receipt) => {
        await allowance.refetch();
        onSuccess?.(receipt);
      }}
    >
      Approve {token.symbol}
    </TransactionButton>
  );
}
