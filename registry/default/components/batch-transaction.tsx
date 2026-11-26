// Docs: https://0xui.io/components/batch-transaction.md
import { Timeline, TimelineItem, TimelineTitle } from "@ui-sdk/react/timeline";
import type { TimelineStatus } from "@ui-sdk/react/timeline";
import { CheckIcon, CircleIcon, Loader2Icon, XIcon } from "lucide-react";
import { useMemo, useState } from "react";
import type { ComponentProps, ReactNode } from "react";
import { useConfig } from "wagmi";
import { ConnectWalletDialog } from "@/components/connect-wallet";
import { MorphText } from "@/components/morph-text";
import { Button } from "@/components/primitives/button";
import { useStore } from "@/hooks/use-store";
import { agentConfirmText, errorCode } from "@/lib/0xui-utils";
import {
  batchStepState,
  createBatchTransaction,
  describeBatchCalls,
} from "@/lib/batch-transaction-core";
import type { BatchCall, BatchMode, StepState } from "@/lib/batch-transaction-core";
import { cn } from "@/lib/utils";

export {
  batchStepState,
  createBatchTransaction,
  describeBatchCalls,
  type BatchCall,
  type BatchMode,
  type BatchPhase,
  type BatchTransactionState,
  type StepState,
} from "@/lib/batch-transaction-core";

/**
 * Send a list of calls atomically when the wallet supports it, else one at a
 * time. The logic lives in `createBatchTransaction` (framework-free).
 */
export function useBatchTransaction({
  calls,
  chainId,
  mode = "auto",
}: {
  calls: ReadonlyArray<BatchCall>;
  chainId: number;
  mode?: BatchMode;
}) {
  const config = useConfig();
  const batch = useMemo(
    () => createBatchTransaction(config, { chainId, mode }),
    [config, chainId, mode],
  );
  const state = useStore(batch);

  return {
    ...state,
    execute: () => batch.execute(calls),
    switchToTarget: batch.switchToTarget,
    stepState: (i: number) => batchStepState(state, i),
    reset: batch.reset,
  };
}

const timelineStatus: Record<StepState, TimelineStatus> = {
  done: "complete",
  active: "current",
  failed: "current",
  todo: "upcoming",
};

export type BatchTransactionProps = Omit<ComponentProps<typeof Button>, "onClick" | "children"> & {
  calls: ReadonlyArray<BatchCall>;
  chainId: number;
  mode?: BatchMode;
  /** Button label. */
  children?: ReactNode;
  /**
   * What a browser agent must ask a person before pressing the button, set
   * as `data-agent-confirm`. Defaults to the label plus what it does, step
   * by step. Pass `false` to drop it. Opening the wallet picker while
   * disconnected needs no person; the picker's wallets ask on their own.
   */
  agentConfirm?: string | false;
};

/**
 * Runs several calls as one action, e.g. approve then swap. Uses a single
 * wallet prompt when the wallet supports atomic batches (EIP-5792), and
 * otherwise sends them one by one. A step list shows progress either way.
 */
export function BatchTransaction({
  calls,
  chainId,
  mode = "auto",
  children = "Confirm",
  agentConfirm,
  className,
  disabled,
  ...buttonProps
}: BatchTransactionProps) {
  const [connectOpen, setConnectOpen] = useState(false);
  const batch = useBatchTransaction({ calls, chainId, mode });
  const busy =
    batch.phase === "switching" || batch.phase === "confirming" || batch.phase === "pending";
  const total = calls.length;
  const current = Math.min(batch.step + 1, total);

  const chainName = batch.targetChain?.name ?? "the selected network";
  let label: ReactNode = children;
  let action: (() => void) | undefined = batch.execute;
  // What a person confirms before an agent's press reaches the wallet.
  let confirm: string | undefined =
    agentConfirm === false
      ? undefined
      : (agentConfirm ??
        agentConfirmText(
          children,
          `sends ${calls.length} calls on ${chainName} from your wallet: ${describeBatchCalls(calls)}`,
        ));
  if (!batch.isConnected) {
    label = "Connect wallet";
    action = () => setConnectOpen(true);
    // Only opens the wallet picker.
    confirm = undefined;
  } else if (batch.phase === "switching") {
    label = "Switching network…";
  } else if (batch.phase === "confirming") {
    label =
      batch.atomic || total === 1
        ? "Confirm in wallet…"
        : `Confirm ${current} of ${total} in wallet…`;
  } else if (batch.phase === "pending") {
    label = batch.atomic || total === 1 ? "Pending…" : `Pending ${current} of ${total}…`;
  } else if (batch.phase === "success") {
    label = "Done";
    action = undefined;
  } else if (batch.wrongChain) {
    label = `Switch to ${batch.targetChain?.name ?? "the right network"}`;
    action = batch.switchToTarget;
    if (agentConfirm !== false) {
      confirm = `Asks your wallet to switch to ${chainName}`;
    }
  }

  return (
    <div
      data-slot="batch-transaction"
      data-phase={batch.phase}
      data-error={errorCode(batch.phase, batch.error)}
      data-atomic={batch.atomic || undefined}
      className={cn("flex flex-col gap-3", className)}
    >
      <Timeline aria-label="Steps" className="flex flex-col gap-2 text-sm">
        {calls.map((call, i) => (
          // A step is its position in the batch.
          <TimelineItem
            key={i}
            status={timelineStatus[batch.stepState(i)]}
            className="flex items-center gap-2 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            <StepIcon state={batch.stepState(i)} />
            <TimelineTitle>{call.label ?? `Step ${i + 1}`}</TimelineTitle>
          </TimelineItem>
        ))}
      </Timeline>
      <Button
        {...buttonProps}
        disabled={disabled || busy || !action}
        focusableWhenDisabled
        aria-busy={busy || undefined}
        onClick={action}
        data-agent-confirm={confirm}
      >
        {busy && <Loader2Icon aria-hidden className="animate-spin" />}
        {batch.phase === "success" && <CheckIcon aria-hidden />}
        <MorphText>{label}</MorphText>
      </Button>
      <p role="status" className="text-xs text-muted-foreground">
        {batch.phase === "cancelled"
          ? "Cancelled in wallet."
          : batch.phase === "idle" && batch.isConnected && total > 1
            ? batch.atomic
              ? "One wallet prompt for all steps."
              : `${total} wallet prompts, one per step.`
            : ""}
      </p>
      {batch.phase === "reverted" && (
        <p role="alert" className="text-sm text-destructive">
          {batch.atomic
            ? "The batch reverted. None of the steps took effect."
            : "A step reverted. Later steps weren't sent."}
        </p>
      )}
      {batch.phase === "error" && batch.error && (
        <p role="alert" className="text-sm text-destructive">
          {(batch.error as { shortMessage?: string }).shortMessage ?? batch.error.message}
        </p>
      )}
      <ConnectWalletDialog open={connectOpen} onOpenChange={setConnectOpen} />
    </div>
  );
}

function StepIcon({ state }: { state: StepState }) {
  const className = "size-4 shrink-0";
  if (state === "done") {
    return <CheckIcon role="img" aria-label="Done" className={cn(className, "text-emerald-500")} />;
  }
  if (state === "failed") {
    return <XIcon role="img" aria-label="Failed" className={cn(className, "text-destructive")} />;
  }
  if (state === "active") {
    return (
      <Loader2Icon
        role="img"
        aria-label="In progress"
        className={cn(className, "animate-spin text-muted-foreground")}
      />
    );
  }
  return (
    <CircleIcon
      role="img"
      aria-label="Not started"
      className={cn(className, "text-muted-foreground")}
    />
  );
}
