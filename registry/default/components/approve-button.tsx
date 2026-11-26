// Docs: https://0xui.io/components/approve-button.md
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { erc20Abi, formatUnits } from "viem";
import type { Address } from "viem";
import { useChainId, useConfig, useConnection } from "wagmi";
import { TransactionButton } from "@/components/transaction-button";
import type { TransactionButtonProps } from "@/components/transaction-button";
import {
  allowanceQueryOptions,
  nextApproval,
  requiresAllowanceReset,
} from "@/lib/approve-button-core";

export { requiresAllowanceReset };

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
  const config = useConfig();
  const { address } = useConnection();
  const currentChainId = useChainId();
  return useQuery(
    allowanceQueryOptions(config, {
      token,
      spender,
      owner: owner ?? address,
      chainId: chainId ?? currentChainId,
    }),
  );
}

export type ApproveButtonProps = Omit<
  TransactionButtonProps,
  "contract" | "transaction" | "children" | "chainId"
> & {
  /** Token to approve. With `decimals`, the agent confirm states the amount in tokens rather than base units. */
  token: { address: Address; symbol: string; decimals?: number };
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
  const step = nextApproval({
    allowance: allowance.data,
    amount,
    chainId,
    token: token.address,
    unlimited,
    resetFirst,
  });
  if (step.kind === "none") return <>{children}</>;

  const checking = status === "connected" && allowance.isPending;
  const reset = step.kind === "reset";

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
        args: [spender, step.value],
      }}
      disabledReason={checking ? "Checking allowance…" : buttonProps.disabledReason}
      agentConfirm={
        buttonProps.agentConfirm ??
        (reset
          ? `Reset ${token.symbol} approval: sets ${spender}'s allowance to 0`
          : unlimited
            ? `Approve ${token.symbol}: lets ${spender} spend all of your ${token.symbol}, with no limit`
            : `Approve ${token.symbol}: lets ${spender} spend up to ${
                token.decimals === undefined
                  ? `${amount} base units of ${token.symbol}`
                  : `${formatUnits(amount, token.decimals)} ${token.symbol}`
              }`)
      }
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
