import { CheckIcon, Loader2Icon } from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";
import type { Hash, TransactionReceipt } from "viem";
import {
  useChains,
  useConnection,
  useSendTransaction,
  useSwitchChain,
  useTransactionConfirmations,
  useWriteContract,
} from "wagmi";
import { ConnectWalletDialog } from "@/components/connect-wallet";
import { MorphText } from "@/components/morph-text";
import { useMinedReceipt } from "@/components/transaction-status";
import { Button } from "@/components/ui/button";
import { isUserRejection } from "@/lib/0xui-utils";
import { cn } from "@/lib/utils";

export type TxPhase =
  | "idle"
  | "switching"
  | "confirming"
  | "pending"
  | "success"
  | "reverted"
  | "cancelled"
  | "error";

/** Arguments for `writeContract`: `{ address, abi, functionName, args, value? }`. */
export type ContractRequest = Parameters<
  ReturnType<typeof useWriteContract>["mutateAsync"]
>[0];

/** Arguments for `sendTransaction`: `{ to, value?, data? }`. */
export type TransactionRequest = Parameters<
  ReturnType<typeof useSendTransaction>["mutateAsync"]
>[0];

export type TransactionFlowOptions = {
  /** Chain the transaction must run on. Defaults to the current chain. */
  chainId?: number;
  /** Confirmations to wait for before success. */
  confirmations?: number;
  /** Called once the wallet returns a transaction hash. */
  onSubmitted?: (hash: Hash) => void;
  /** Called when the transaction is mined successfully. */
  onSuccess?: (receipt: TransactionReceipt) => void;
  /** Called on failure, including a reverted transaction. Not called when the user cancels. */
  onError?: (error: Error) => void;
};

/**
 * Transaction lifecycle as one phase: switching network, waiting for the
 * wallet, pending on-chain, then success, reverted, cancelled or error.
 */
export function useTransactionFlow({
  chainId,
  confirmations = 1,
  onSubmitted,
  onSuccess,
  onError,
}: TransactionFlowOptions = {}) {
  const connection = useConnection();
  const chains = useChains();
  const switchChain = useSwitchChain();
  const write = useWriteContract();
  const send = useSendTransaction();

  const [step, setStep] = useState<TxPhase>("idle");
  const [hash, setHash] = useState<Hash>();
  const [error, setError] = useState<Error>();

  const targetChainId = chainId ?? connection.chainId;
  const targetChain = chains.find((c) => c.id === targetChainId);
  const wrongChain =
    connection.status === "connected" &&
    targetChainId !== undefined &&
    connection.chainId !== targetChainId;

  const receipt = useMinedReceipt({ hash, chainId: targetChainId });
  const confirmed = useTransactionConfirmations({
    hash,
    chainId: targetChainId,
    query: {
      enabled: receipt.data?.status === "success" && confirmations > 1,
      refetchInterval: 4_000,
    },
  });
  const enoughConfirmations =
    confirmations <= 1 || Number(confirmed.data ?? 0n) >= confirmations;

  const phase: TxPhase =
    hash && step === "pending"
      ? receipt.data
        ? receipt.data.status === "reverted"
          ? "reverted"
          : enoughConfirmations
            ? "success"
            : "pending"
        : receipt.isError
          ? "error"
          : "pending"
      : step;

  // Fire callbacks once per transaction, when it settles.
  const reported = useRef<Hash>(undefined);
  useEffect(() => {
    const data = receipt.data;
    if (!data || reported.current === data.transactionHash) return;
    if (phase !== "success" && phase !== "reverted") return;
    reported.current = data.transactionHash;
    if (phase === "success") onSuccess?.(data);
    else onError?.(new Error("Transaction reverted"));
    // Callbacks are deliberately not dependencies: only settling should fire them.
  }, [phase, receipt.data]);

  const fail = (e: unknown) => {
    const err = e instanceof Error ? e : new Error(String(e));
    setError(err);
    if (isUserRejection(err)) {
      setStep("cancelled");
    } else {
      setStep("error");
      onError?.(err);
    }
  };

  const switchToTarget = async () => {
    if (targetChainId === undefined) return;
    setError(undefined);
    setStep("switching");
    try {
      // Narrow to the chain-id union when the app registers its config type.
      await switchChain.mutateAsync({
        chainId: targetChainId as (typeof chains)[number]["id"],
      });
      setStep("idle");
    } catch (e) {
      fail(e);
    }
  };

  const execute = async (
    request: { contract: ContractRequest } | { transaction: TransactionRequest }
  ) => {
    setError(undefined);
    setHash(undefined);
    setStep("confirming");
    try {
      // Pin the chain so the wallet can't send on a different one.
      const txHash =
        "contract" in request
          ? await write.mutateAsync({
              chainId: targetChainId,
              ...request.contract,
            } as ContractRequest)
          : await send.mutateAsync({
              chainId: targetChainId,
              ...request.transaction,
            } as TransactionRequest);
      setHash(txHash);
      setStep("pending");
      onSubmitted?.(txHash);
    } catch (e) {
      fail(e);
    }
  };

  const reset = useCallback(() => {
    setStep("idle");
    setHash(undefined);
    setError(undefined);
  }, []);

  return {
    phase,
    hash,
    receipt: receipt.data,
    error: phase === "error" ? (error ?? receipt.error ?? undefined) : error,
    isConnected: connection.status === "connected",
    wrongChain,
    targetChain,
    execute,
    switchToTarget,
    reset,
  };
}

export type TransactionButtonProps = Omit<
  ComponentProps<typeof Button>,
  "onClick" | "onError" | "children"
> &
  TransactionFlowOptions & {
    /** Contract call to make. Pass this or `transaction`. */
    contract?: ContractRequest;
    /** Plain transaction to send. Pass this or `contract`. */
    transaction?: TransactionRequest;
    /** Disable the button and show this text, e.g. "Enter an amount". Name the blocker, not just "Disabled". */
    disabledReason?: string;
    /** Button label. */
    children?: ReactNode;
    /** Label after success. */
    successLabel?: ReactNode;
    /** Return to idle this long after success, in ms. Pass false to stay. */
    resetAfter?: number | false;
    /** Hide the status line under the button. */
    hideStatus?: boolean;
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
 * root.
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
  children = "Submit",
  successLabel = "Done",
  resetAfter = 4000,
  hideStatus = false,
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
    if (phase !== "success" || resetAfter === false) return;
    const timer = setTimeout(reset, resetAfter);
    return () => clearTimeout(timer);
  }, [phase, resetAfter, reset]);

  const busy =
    phase === "switching" || phase === "confirming" || phase === "pending";

  let label: ReactNode = children;
  let action: (() => void) | undefined;
  // In-flight and success states win over `disabledReason`: a form that
  // clears itself on success shouldn't hide the confirmation.
  if (!flow.isConnected) {
    label = "Connect wallet";
    action = () => setConnectOpen(true);
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
    action = flow.switchToTarget;
  } else if (contract) {
    action = () => flow.execute({ contract });
  } else if (transaction) {
    action = () => flow.execute({ transaction });
  }

  const message =
    phase === "reverted"
      ? "Transaction reverted. Nothing changed except the gas fee."
      : phase === "error"
        ? ((flow.error as { shortMessage?: string } | undefined)?.shortMessage ??
          flow.error?.message ??
          "Something went wrong.")
        : undefined;

  return (
    <div
      data-slot="transaction-button"
      data-phase={phase}
      className={cn("inline-flex flex-col gap-2", className)}
    >
      <Button
        {...buttonProps}
        disabled={disabled || busy || !action}
        aria-busy={busy || undefined}
        onClick={action}
      >
        {busy && <Loader2Icon aria-hidden className="animate-spin" />}
        {phase === "success" && <CheckIcon aria-hidden />}
        <MorphText>{label}</MorphText>
      </Button>
      {!hideStatus && (
        <>
          <p
            role="status"
            className="text-sm text-muted-foreground empty:hidden"
          >
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
