import { CheckIcon, CircleIcon, Loader2Icon, XIcon } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useShieldedEngine } from "@/components/shielded-provider";
import { Button } from "@/components/ui/button";
import {
  PROOF_STAGES,
  type PrivateDraft,
  type ProofStage,
  type ProvedOperation,
} from "@/lib/shielded-engine";
import { cn } from "@/lib/utils";

/** While a proof runs, the phase is the stage it is in. */
export type ProofPhase = "idle" | ProofStage | "done" | "cancelled" | "error";

const isStage = (phase: ProofPhase): phase is ProofStage =>
  (PROOF_STAGES as readonly string[]).includes(phase);

export type UseProofParameters = {
  /** Called with the proved operation, ready to submit. */
  onProved?: (operation: ProvedOperation) => void;
  /** Called when proving fails. Not called on cancel. */
  onError?: (error: Error) => void;
};

/**
 * Generate a proof with the engine and follow it stage by stage. There is no
 * percentage, because provers don't report a real one. `cancel` aborts the
 * proof; unmounting does too.
 */
export function useProof({ onProved, onError }: UseProofParameters = {}) {
  const engine = useShieldedEngine();
  const [state, setState] = useState<{
    phase: ProofPhase;
    stage?: ProofStage;
    operation?: ProvedOperation;
    error?: Error;
  }>({ phase: "idle" });

  // The run in progress. A newer run, a reset or an unmount replaces or aborts it.
  const current = useRef<AbortController>(undefined);
  useEffect(() => () => current.current?.abort(), []);

  const prove = async (draft: PrivateDraft) => {
    current.current?.abort();
    const run = new AbortController();
    current.current = run;
    const isCurrent = () => current.current === run;

    setState({ phase: PROOF_STAGES[0], stage: PROOF_STAGES[0] });
    try {
      const operation = await engine.prove(draft, {
        signal: run.signal,
        onStage: (stage) => {
          if (isCurrent() && !run.signal.aborted) setState({ phase: stage, stage });
        },
      });
      if (!isCurrent()) return undefined;
      if (run.signal.aborted) {
        setState((s) => ({ phase: "cancelled", stage: s.stage }));
        return undefined;
      }
      setState({ phase: "done", operation });
      onProved?.(operation);
      return operation;
    } catch (cause) {
      if (!isCurrent()) return undefined;
      if (run.signal.aborted) {
        setState((s) => ({ phase: "cancelled", stage: s.stage }));
        return undefined;
      }
      const error = cause instanceof Error ? cause : new Error(String(cause));
      setState((s) => ({ phase: "error", stage: s.stage, error }));
      onError?.(error);
      return undefined;
    }
  };

  return {
    phase: state.phase,
    /** The stage that is running, or the one a failed or cancelled proof stopped in. */
    stage: state.stage,
    /** The proved operation, once `phase` is "done". */
    operation: state.operation,
    error: state.error,
    isProving: isStage(state.phase),
    /** Start a proof. Resolves with the operation, or undefined if it failed or was cancelled. */
    prove,
    /** Abort the running proof. */
    cancel: () => current.current?.abort(),
    /** Abort anything running and go back to idle. */
    reset: () => {
      current.current?.abort();
      current.current = undefined;
      setState({ phase: "idle" });
    },
  };
}

/** Default label and, where the wait needs explaining, a hint for each stage. */
export const proofStageMeta: Record<ProofStage, { label: string; hint?: string }> = {
  "loading-circuits": {
    label: "Loading circuits",
    hint: "The first proof downloads the circuit files, which can take a few seconds.",
  },
  proving: {
    label: "Computing proof",
    hint: "This can take a while. Keep this tab open.",
  },
  verifying: { label: "Verifying proof" },
};

const headings: Record<ProofPhase, string> = {
  idle: "Proof not started",
  "loading-circuits": "Generating proof",
  proving: "Generating proof",
  verifying: "Generating proof",
  done: "Proof ready",
  cancelled: "Proof cancelled",
  error: "Couldn't generate proof",
};

export type ProofStepState = "done" | "active" | "failed" | "todo";

/** The state of each stage's step, for a given phase. */
export function proofStepStates(
  phase: ProofPhase,
  stage?: ProofStage
): Record<ProofStage, ProofStepState> {
  const reached = isStage(phase) ? phase : stage;
  const reachedIndex = reached ? PROOF_STAGES.indexOf(reached) : -1;
  const states = {} as Record<ProofStage, ProofStepState>;
  PROOF_STAGES.forEach((name, index) => {
    states[name] =
      phase === "done" || index < reachedIndex
        ? "done"
        : index > reachedIndex || phase === "idle" || phase === "cancelled"
          ? "todo"
          : phase === "error"
            ? "failed"
            : "active";
  });
  return states;
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
        <CheckIcon aria-label="Done" className={cn(icon, "text-emerald-500")} />
      ) : state === "failed" ? (
        <XIcon aria-label="Failed" className={cn(icon, "text-destructive")} />
      ) : state === "active" ? (
        <Loader2Icon
          aria-label="In progress"
          className={cn(icon, "animate-spin text-muted-foreground motion-reduce:animate-none")}
        />
      ) : (
        <CircleIcon aria-label="Not started" className={cn(icon, "text-muted-foreground")} />
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
  const running = isStage(phase);
  const message = typeof error === "string" ? error : error?.message;

  return (
    <div
      data-slot="proof-progress"
      data-phase={phase}
      className={cn("flex w-full flex-col gap-3 rounded-xl border p-4 text-sm", className)}
    >
      <div className="flex flex-col gap-1">
        <p
          role="status"
          className={cn(
            "font-medium",
            phase === "done" && "text-emerald-600 dark:text-emerald-400",
            phase === "error" && "text-destructive"
          )}
        >
          {title ?? headings[phase]}
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
              Cancel
            </Button>
          ) : (
            <Button variant="outline" size="sm" onClick={onRetry}>
              Try again
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
