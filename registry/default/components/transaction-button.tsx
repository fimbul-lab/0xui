// Docs: https://0xui.io/components/transaction-button.md
import { useQuery } from "@tanstack/react-query";
import { CheckIcon, Loader2Icon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ComponentProps, ReactNode } from "react";
import { useChainId, useConfig, useConnection } from "wagmi";
import { ConnectWalletDialog } from "@/components/connect-wallet";
import { MorphText } from "@/components/morph-text";
import { Button } from "@/components/primitives/button";
import { useStore } from "@/hooks/use-store";
import { agentConfirmText, errorCode, errorMessage } from "@/lib/0xui-utils";
import {
  createTransactionFlow,
  revertReason,
  simulationStatus,
  transactionSimulationQueryOptions,
} from "@/lib/tx-flow";
import type {
  ContractRequest,
  SimulationStatus,
  TransactionFlowOptions,
  TransactionRequest,
  TxPhase,
} from "@/lib/tx-flow";
import { cn } from "@/lib/utils";

export type {
  ContractRequest,
  SimulationStatus,
  TransactionFlowOptions,
  TransactionRequest,
  TxPhase,
};
export { revertReason };

/**
 * Transaction lifecycle as one phase: switching network, waiting for the
 * wallet, pending on-chain, then success, reverted, cancelled or error.
 * The logic lives in `createTransactionFlow` (framework-free).
 */
export function useTransactionFlow({
  chainId,
  confirmations,
  onSubmitted,
  onSuccess,
  onError,
}: TransactionFlowOptions = {}) {
  const config = useConfig();
  const callbacks = useRef({ onSubmitted, onSuccess, onError });
  useEffect(() => {
    callbacks.current = { onSubmitted, onSuccess, onError };
  }, [onSubmitted, onSuccess, onError]);
  const flow = useMemo(
    () =>
      createTransactionFlow(config, {
        chainId,
        confirmations,
        onSubmitted: (hash) => callbacks.current.onSubmitted?.(hash),
        onSuccess: (receipt) => callbacks.current.onSuccess?.(receipt),
        onError: (error) => callbacks.current.onError?.(error),
      }),
    [config, chainId, confirmations],
  );
  const state = useStore(flow);

  return {
    ...state,
    execute: flow.execute,
    switchToTarget: flow.switchToTarget,
    reset: flow.reset,
  };
}

export type UseTransactionSimulationParameters = {
  /** Contract call to simulate. Pass this or `transaction`. */
  contract?: ContractRequest;
  /** Plain transaction to simulate. Pass this or `contract`. */
  transaction?: TransactionRequest;
  /** Chain to simulate on. Defaults to the current chain. */
  chainId?: number;
  /** Set false to skip the simulation. */
  enabled?: boolean;
};

/**
 * Dry-runs a transaction from the connected account with `eth_call`, so a
 * revert shows up before the wallet opens. `status` is `idle` until a wallet
 * is connected. `reason` is set when it would fail.
 */
export function useTransactionSimulation({
  contract,
  transaction,
  chainId,
  enabled = true,
}: UseTransactionSimulationParameters) {
  const config = useConfig();
  const currentChainId = useChainId();
  const { address } = useConnection();
  const query = useQuery(
    transactionSimulationQueryOptions(config, {
      contract,
      transaction,
      chainId: chainId ?? currentChainId,
      account: address,
      enabled,
    }),
  );
  const status = simulationStatus({
    active: enabled && Boolean(address) && Boolean(contract || transaction),
    isError: query.isError,
    isPending: query.isPending,
  });

  return {
    status,
    reason: status === "failed" ? revertReason(query.error) : undefined,
    error: status === "failed" ? query.error : undefined,
    refetch: query.refetch,
  };
}

export type TransactionButtonProps = Omit<
  ComponentProps<typeof Button>,
  "onClick" | "onError" | "children" | "className"
> &
  TransactionFlowOptions & {
    /** Contract call to make. Pass this or `transaction`. */
    contract?: ContractRequest;
    /** Plain transaction to send. Pass this or `contract`. */
    transaction?: TransactionRequest;
    /** Disable the button and show this text, e.g. "Enter an amount". Name the blocker, not just "Disabled". */
    disabledReason?: string;
    /**
     * Dry-run the transaction first. If it would revert, the button is
     * disabled and the revert reason is shown, before the wallet opens.
     */
    simulate?: boolean;
    /** Button label. */
    children?: ReactNode;
    /** Label after success. */
    successLabel?: ReactNode;
    /** Return to idle this long after success, in ms. Pass false to stay. */
    resetAfter?: number | false;
    /** Hide the status line under the button. */
    hideStatus?: boolean;
    /**
     * What a browser agent must ask a person before pressing the button, set
     * as `data-agent-confirm`. Defaults to the label plus what it does. Pass
     * `false` to drop it. While the button offers a network switch it asks
     * about the switch instead, and while it opens the wallet picker it
     * asks nothing (each wallet in the picker asks before connecting).
     */
    agentConfirm?: string | false;
    /** Class for the root, which holds the button and its status line. Target the button with `[&>button]:`. */
    className?: string;
  };

const statusText: Partial<Record<TxPhase, string>> = {
  switching: "Approve the network switch in your wallet.",
  confirming: "Confirm the transaction in your wallet.",
  pending: "Transaction submitted. Waiting for confirmation…",
  success: "Transaction confirmed.",
  cancelled: "Cancelled in wallet.",
};

/**
 * Sends a transaction and shows every step on the button itself. When
 * disconnected it opens the wallet picker. On the wrong network it offers to
 * switch. Each phase gets a label, a status line, and `data-phase` on the
 * root. With `simulate` it dry-runs the call and names the revert reason
 * instead of letting the wallet open on a transaction that will fail.
 */
export function TransactionButton({
  contract,
  transaction,
  chainId,
  confirmations,
  onSubmitted,
  onSuccess,
  onError,
  disabledReason,
  simulate = false,
  children = "Submit",
  successLabel = "Done",
  resetAfter = 4000,
  hideStatus = false,
  agentConfirm,
  disabled,
  className,
  ...buttonProps
}: TransactionButtonProps) {
  const [connectOpen, setConnectOpen] = useState(false);
  const flow = useTransactionFlow({
    chainId,
    confirmations,
    onSubmitted,
    onSuccess,
    onError,
  });
  const { phase, reset } = flow;

  useEffect(() => {
    if (phase !== "success" || resetAfter === false) {
      return;
    }
    const timer = setTimeout(reset, resetAfter);
    return () => clearTimeout(timer);
  }, [phase, resetAfter, reset]);

  const busy = phase === "switching" || phase === "confirming" || phase === "pending";

  const simulation = useTransactionSimulation({
    contract,
    transaction,
    chainId: flow.targetChain?.id,
    enabled: simulate && !flow.wrongChain && !disabledReason && !busy && phase !== "success",
  });
  // The transaction just sent may have changed what the next one would do.
  const resimulate = simulation.refetch;
  useEffect(() => {
    if (simulate && (phase === "success" || phase === "reverted")) {
      void resimulate();
    }
  }, [simulate, phase, resimulate]);

  let label: ReactNode = children;
  let action: (() => void) | undefined;
  // What an agent must ask the person before pressing: the transaction by
  // default, the network switch while that's what the button does, and
  // nothing while it only opens the wallet picker (connecting asks there).
  let confirm: string | undefined =
    agentConfirm === false
      ? undefined
      : (agentConfirm ??
        agentConfirmText(
          children,
          `sends a transaction on ${flow.targetChain?.name ?? "the selected network"} from your wallet`,
        ));
  // In-flight and success states win over `disabledReason`: a form that
  // clears itself on success shouldn't hide the confirmation.
  if (!flow.isConnected) {
    label = "Connect wallet";
    action = () => setConnectOpen(true);
    confirm = undefined;
  } else if (phase === "switching") {
    label = "Switching network…";
  } else if (phase === "confirming") {
    label = "Confirm in wallet…";
  } else if (phase === "pending") {
    label = "Pending…";
  } else if (phase === "success") {
    label = successLabel;
  } else if (disabledReason) {
    label = disabledReason;
  } else if (flow.wrongChain) {
    label = `Switch to ${flow.targetChain?.name ?? "the right network"}`;
    action = () => void flow.switchToTarget();
    confirm = `Asks your wallet to switch to ${flow.targetChain?.name ?? "the right network"}`;
  } else if (simulation.status === "checking") {
    label = "Checking…";
  } else if (simulation.status === "failed") {
    label = "Transaction will fail";
  } else if (contract) {
    action = () => void flow.execute({ contract });
  } else if (transaction) {
    action = () => void flow.execute({ transaction });
  }

  const message =
    phase === "reverted"
      ? "Transaction reverted. Nothing changed except the gas fee."
      : phase === "error"
        ? flow.error
          ? errorMessage(flow.error)
          : "Something went wrong."
        : simulation.status === "failed"
          ? `This transaction would fail: ${simulation.reason}`
          : undefined;

  return (
    <div
      data-slot="transaction-button"
      data-phase={phase}
      data-error={errorCode(phase, flow.error)}
      className={cn("inline-flex flex-col gap-2", className)}
    >
      <Button
        {...buttonProps}
        disabled={disabled || busy || !action}
        // Keeps focus on the button while it waits on the wallet and the chain.
        focusableWhenDisabled={busy}
        // The status line already announces each phase.
        pendingAnnouncement={buttonProps.pendingAnnouncement ?? (hideStatus ? undefined : "")}
        aria-busy={busy || undefined}
        onClick={action}
        data-agent-confirm={confirm}
      >
        {busy && <Loader2Icon aria-hidden className="animate-spin" />}
        {phase === "success" && <CheckIcon aria-hidden />}
        <MorphText>{label}</MorphText>
      </Button>
      {!hideStatus && (
        <>
          <p role="status" className="text-sm text-muted-foreground empty:hidden">
            {statusText[phase] ?? ""}
          </p>
          {message && (
            <p role="alert" className="text-sm text-destructive">
              {message}
            </p>
          )}
        </>
      )}
      <ConnectWalletDialog open={connectOpen} onOpenChange={setConnectOpen} />
    </div>
  );
}
