// Docs: https://0xui.io/components/proof-progress.md
import { CheckIcon, CircleIcon, Loader2Icon, XIcon } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";
import type { ReactNode } from "react";
import { Button } from "@/components/primitives/button";
import { useShieldedEngine } from "@/components/shielded-provider";
import { useStore } from "@/hooks/use-store";
import { errorCode } from "@/lib/0xui-utils";
import {
  createProver,
  isProofStage,
  proofHeadings,
  proofStageMeta,
  proofStepStates,
} from "@/lib/proof-progress-core";
import type { ProofCallbacks, ProofPhase, ProofStepState } from "@/lib/proof-progress-core";
import { PROOF_STAGES } from "@/lib/shielded-engine";
import type { ProofStage } from "@/lib/shielded-engine";
import { cn } from "@/lib/utils";

export { proofStageMeta, proofStepStates, type ProofPhase, type ProofStepState };

export type UseProofParameters = ProofCallbacks;

/**
 * Generate a proof with the engine and follow it stage by stage. There is no
 * percentage, because provers don't report a real one. `cancel` aborts the
 * proof; unmounting does too. The logic lives in `createProver` (framework-free).
 */
export function useProof(callbacks: UseProofParameters = {}) {
  const engine = useShieldedEngine();
  const latest = useRef(callbacks);
  latest.current = callbacks;
  const prover = useMemo(
    () =>
      createProver(engine, {
        onProved: (operation) => latest.current.onProved?.(operation),
        onError: (error) => latest.current.onError?.(error),
      }),
    [engine],
  );
  const state = useStore(prover);
  useEffect(() => () => prover.cancel(), [prover]);

  return {
    ...state,
    isProving: isProofStage(state.phase),
    prove: prover.prove,
    cancel: prover.cancel,
    reset: prover.reset,
  };
}

export type ProofStepProps = {
  state: ProofStepState;
  label: ReactNode;
  /** Shown under the label while the step is active. */
  hint?: ReactNode;
};

/** One stage of the proof: an icon for its state, its label, and a hint while it runs. */
export function ProofStep({ state, label, hint }: ProofStepProps) {
  const icon = "mt-0.5 size-4 shrink-0";
  return (
    <li data-state={state} className="flex items-start gap-2">
      {state === "done" ? (
        <CheckIcon role="img" aria-label="Done" className={cn(icon, "text-emerald-500")} />
      ) : state === "failed" ? (
        <XIcon role="img" aria-label="Failed" className={cn(icon, "text-destructive")} />
      ) : state === "active" ? (
        <Loader2Icon
          role="img"
          aria-label="In progress"
          className={cn(icon, "animate-spin text-muted-foreground motion-reduce:animate-none")}
        />
      ) : (
        <CircleIcon
          role="img"
          aria-label="Not started"
          className={cn(icon, "text-muted-foreground")}
        />
      )}
      <span className="flex flex-col">
        <span className={cn(state === "todo" && "text-muted-foreground")}>{label}</span>
        {hint && state === "active" && <span className="text-muted-foreground">{hint}</span>}
      </span>
    </li>
  );
}

export type ProofProgressProps = {
  /** Where the proof is. Pass `phase` from useProof. */
  phase: ProofPhase;
  /** The stage a failed or cancelled proof stopped in. Pass `stage` from useProof. */
  stage?: ProofStage;
  /** Shown when `phase` is "error". */
  error?: Error | string;
  /** Shows a Cancel button while the proof runs. Pass `cancel` from useProof. */
  onCancel?: () => void;
  /** Shows a "Try again" button after an error or a cancel. */
  onRetry?: () => void;
  /** Heading. Defaults to a phase description such as "Generating proof". */
  title?: ReactNode;
  /** What is being proved, e.g. "Unshield 0.5 WETH". */
  children?: ReactNode;
  className?: string;
};

/**
 * Proof generation as a list of stages: loading circuits, generating,
 * verifying. No percentage and never a bare spinner. Takes its state as
 * props, so it works with useProof or with your own flow.
 */
export function ProofProgress({
  phase,
  stage,
  error,
  onCancel,
  onRetry,
  title,
  children,
  className,
}: ProofProgressProps) {
  const steps = proofStepStates(phase, stage);
  const running = isProofStage(phase);
  const message = typeof error === "string" ? error : error?.message;

  return (
    <div
      data-slot="proof-progress"
      data-phase={phase}
      data-error={errorCode(phase, error)}
      className={cn("flex w-full flex-col gap-3 rounded-xl border p-4 text-sm", className)}
    >
      <div className="flex flex-col gap-1">
        <p
          role="status"
          className={cn(
            "font-medium",
            phase === "done" && "text-emerald-600 dark:text-emerald-400",
            phase === "error" && "text-destructive",
          )}
        >
          {title ?? proofHeadings[phase]}
        </p>
        {children && <div className="text-muted-foreground">{children}</div>}
      </div>

      <ol className="flex flex-col gap-2">
        {PROOF_STAGES.map((name) => (
          <ProofStep key={name} state={steps[name]} {...proofStageMeta[name]} />
        ))}
      </ol>

      {phase === "error" && (
        <p role="alert" className="text-destructive">
          {message ?? "The proof could not be generated."}
        </p>
      )}

      {((running && onCancel) || ((phase === "error" || phase === "cancelled") && onRetry)) && (
        <div className="flex justify-end border-t pt-3">
          {running ? (
            <Button variant="ghost" size="sm" onClick={onCancel}>
              {/* Named for what it stops, apart from other Cancel buttons on the page. */}
              Cancel <span className="sr-only">proof</span>
            </Button>
          ) : (
            <Button variant="outline" size="sm" onClick={onRetry}>
              Try again <span className="sr-only">to generate the proof</span>
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
