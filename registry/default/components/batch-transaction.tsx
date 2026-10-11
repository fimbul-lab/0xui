import { CheckIcon, CircleIcon, Loader2Icon, XIcon } from "lucide-react";
import { useState, type ComponentProps, type ReactNode } from "react";
import type { Address, Hex } from "viem";
import {
  useCapabilities,
  useChains,
  useConfig,
  useConnection,
  useSendCalls,
  useSendTransaction,
  useSwitchChain,
} from "wagmi";
import { getPublicClient, waitForCallsStatus } from "wagmi/actions";
import { ConnectWalletDialog } from "@/components/connect-wallet";
import { Button } from "@/components/ui/button";
import { isUserRejection } from "@/lib/0xui-utils";
import { cn } from "@/lib/utils";

export type BatchCall = {
  to: Address;
  data?: Hex;
  value?: bigint;
  /** Step name shown in the list, e.g. "Approve USDC". */
  label?: string;
};

/**
 * "atomic" sends every call in one wallet prompt (EIP-5792). "sequential"
 * sends them one by one, waiting for each to be mined. "auto" picks atomic
 * when the wallet reports support for it on the chain.
 */
export type BatchMode = "auto" | "atomic" | "sequential";

export type BatchPhase =
  | "idle"
  | "switching"
  | "confirming"
  | "pending"
  | "success"
  | "reverted"
  | "cancelled"
  | "error";

export type StepState = "todo" | "active" | "done" | "failed";

/** Send a list of calls atomically when the wallet supports it, else one at a time. */
export function useBatchTransaction({
  calls,
  chainId,
  mode = "auto",
}: {
  calls: readonly BatchCall[];
  chainId: number;
  mode?: BatchMode;
}) {
  const config = useConfig();
  const connection = useConnection();
  const chains = useChains();
  const switchChain = useSwitchChain();
  const sendCalls = useSendCalls();
  const sendTransaction = useSendTransaction();
  const capabilities = useCapabilities({
    chainId,
    query: { enabled: connection.status === "connected" && mode === "auto" },
  });

  const [phase, setPhase] = useState<BatchPhase>("idle");
  const [step, setStep] = useState(0);
  const [error, setError] = useState<Error>();

  const atomicStatus = (capabilities.data as { atomic?: { status?: string } } | undefined)?.atomic?.status;
  const atomic =
    mode === "atomic" ||
    (mode === "auto" && (atomicStatus === "supported" || atomicStatus === "ready"));
  const wrongChain =
    connection.status === "connected" && connection.chainId !== chainId;
  const targetChain = chains.find((c) => c.id === chainId);

  const fail = (e: unknown) => {
    const err = e instanceof Error ? e : new Error(String(e));
    setError(err);
    setPhase(isUserRejection(err) ? "cancelled" : "error");
  };

  const switchToTarget = async () => {
    setError(undefined);
    setPhase("switching");
    try {
      await switchChain.mutateAsync({ chainId: chainId as (typeof chains)[number]["id"] });
      setPhase("idle");
    } catch (e) {
      fail(e);
    }
  };

  const execute = async () => {
    setError(undefined);
    setStep(0);
    try {
      if (atomic) {
        setPhase("confirming");
        const { id } = await sendCalls.mutateAsync({
          chainId,
          calls: calls.map(({ to, data, value }) => ({ to, data, value })),
        });
        setPhase("pending");
        const result = await waitForCallsStatus(config, { id });
        setStep(calls.length);
        setPhase(result.status === "success" ? "success" : "reverted");
        return;
      }
      const client = getPublicClient(config, { chainId });
      for (const [i, call] of calls.entries()) {
        setStep(i);
        setPhase("confirming");
        const hash = await sendTransaction.mutateAsync({
          chainId,
          to: call.to,
          data: call.data,
          value: call.value,
        });
        setPhase("pending");
        const receipt = await client!.waitForTransactionReceipt({ hash });
        if (receipt.status === "reverted") {
          setPhase("reverted");
          return;
        }
      }
      setStep(calls.length);
      setPhase("success");
    } catch (e) {
      fail(e);
    }
  };

  const stepState = (i: number): StepState => {
    if (phase === "success" || i < step) return "done";
    if (i > step) return "todo";
    if (phase === "reverted" || phase === "error") return "failed";
    if (phase === "confirming" || phase === "pending") return "active";
    return "todo";
  };

  return {
    phase,
    step,
    error,
    atomic,
    wrongChain,
    targetChain,
    isConnected: connection.status === "connected",
    execute,
    switchToTarget,
    stepState,
    reset: () => {
      setPhase("idle");
      setStep(0);
      setError(undefined);
    },
  };
}

export type BatchTransactionProps = Omit<
  ComponentProps<typeof Button>,
  "onClick" | "children"
> & {
  calls: readonly BatchCall[];
  chainId: number;
  mode?: BatchMode;
  /** Button label. */
  children?: ReactNode;
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
  className,
  disabled,
  ...buttonProps
}: BatchTransactionProps) {
  const [connectOpen, setConnectOpen] = useState(false);
  const batch = useBatchTransaction({ calls, chainId, mode });
  const busy = batch.phase === "switching" || batch.phase === "confirming" || batch.phase === "pending";
  const total = calls.length;
  const current = Math.min(batch.step + 1, total);

  let label: ReactNode = children;
  let action: (() => void) | undefined = batch.execute;
  if (!batch.isConnected) {
    label = "Connect wallet";
    action = () => setConnectOpen(true);
  } else if (batch.phase === "switching") {
    label = "Switching network…";
  } else if (batch.phase === "confirming") {
    label = batch.atomic || total === 1 ? "Confirm in wallet…" : `Confirm ${current} of ${total} in wallet…`;
  } else if (batch.phase === "pending") {
    label = batch.atomic || total === 1 ? "Pending…" : `Pending ${current} of ${total}…`;
  } else if (batch.phase === "success") {
    label = "Done";
    action = undefined;
  } else if (batch.wrongChain) {
    label = `Switch to ${batch.targetChain?.name ?? "the right network"}`;
    action = batch.switchToTarget;
  }

  return (
    <div
      data-slot="batch-transaction"
      data-phase={batch.phase}
      data-atomic={batch.atomic || undefined}
      className={cn("flex flex-col gap-3", className)}
    >
      <ol aria-label="Steps" className="flex flex-col gap-2 text-sm">
        {calls.map((call, i) => (
          <li key={i} className="flex items-center gap-2">
            <StepIcon state={batch.stepState(i)} />
            <span>{call.label ?? `Step ${i + 1}`}</span>
          </li>
        ))}
      </ol>
      <Button
        {...buttonProps}
        disabled={disabled || busy || !action}
        aria-busy={busy || undefined}
        onClick={action}
      >
        {busy && <Loader2Icon aria-hidden className="animate-spin" />}
        {batch.phase === "success" && <CheckIcon aria-hidden />}
        {label}
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
  if (state === "done") return <CheckIcon aria-label="Done" className={cn(className, "text-emerald-500")} />;
  if (state === "failed") return <XIcon aria-label="Failed" className={cn(className, "text-destructive")} />;
  if (state === "active")
    return <Loader2Icon aria-label="In progress" className={cn(className, "animate-spin text-muted-foreground")} />;
  return <CircleIcon aria-label="Not started" className={cn(className, "text-muted-foreground")} />;
}
