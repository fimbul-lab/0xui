import { createStore } from "@/lib/0xui-store";
import { PROOF_STAGES } from "@/lib/shielded-engine";
import type {
  PrivateDraft,
  ProofStage,
  ProvedOperation,
  ShieldedEngine,
} from "@/lib/shielded-engine";

/** While a proof runs, the phase is the stage it is in. */
export type ProofPhase = "idle" | ProofStage | "done" | "cancelled" | "error";

export const isProofStage = (phase: ProofPhase): phase is ProofStage =>
  (PROOF_STAGES as ReadonlyArray<string>).includes(phase);

export type ProofState = {
  phase: ProofPhase;
  /** The stage that is running, or the one a failed or cancelled proof stopped in. */
  stage: ProofStage | undefined;
  /** The proved operation, once `phase` is "done". */
  operation: ProvedOperation | undefined;
  error: Error | undefined;
};

export type ProofCallbacks = {
  /** Called with the proved operation, ready to submit. */
  onProved?: (operation: ProvedOperation) => void;
  /** Called when proving fails. Not called on cancel. */
  onError?: (error: Error) => void;
};

export type Prover = {
  get(): ProofState;
  subscribe(listener: () => void): () => void;
  /** Start a proof. Resolves with the operation, or undefined if it failed or was cancelled. */
  prove(draft: PrivateDraft): Promise<ProvedOperation | undefined>;
  /** Abort the running proof. */
  cancel(): void;
  /** Abort anything running and go back to idle. */
  reset(): void;
};

const idle: ProofState = {
  phase: "idle",
  stage: undefined,
  operation: undefined,
  error: undefined,
};

/**
 * Generate a proof with the engine and follow it stage by stage. There is no
 * percentage, because provers don't report a real one. Framework-free.
 */
export function createProver(engine: ShieldedEngine, callbacks: ProofCallbacks = {}): Prover {
  const store = createStore<ProofState>(idle);
  // The run in progress. A newer run or a reset replaces or aborts it.
  let current: AbortController | undefined;

  const stopped = () => store.set((s) => ({ ...idle, phase: "cancelled", stage: s.stage }));

  return {
    get: store.get,
    subscribe: store.subscribe,
    async prove(draft) {
      current?.abort();
      const run = new AbortController();
      current = run;
      const isCurrent = () => current === run;

      store.set({ ...idle, phase: PROOF_STAGES[0], stage: PROOF_STAGES[0] });
      try {
        const operation = await engine.prove(draft, {
          signal: run.signal,
          onStage: (stage) => {
            if (isCurrent() && !run.signal.aborted) {
              store.set({ phase: stage, stage });
            }
          },
        });
        if (!isCurrent()) {
          return undefined;
        }
        if (run.signal.aborted) {
          stopped();
          return undefined;
        }
        store.set({ ...idle, phase: "done", operation });
        callbacks.onProved?.(operation);
        return operation;
      } catch (error_) {
        if (!isCurrent()) {
          return undefined;
        }
        if (run.signal.aborted) {
          stopped();
          return undefined;
        }
        const error = error_ instanceof Error ? error_ : new Error(String(error_));
        store.set((s) => ({ ...idle, phase: "error", stage: s.stage, error }));
        callbacks.onError?.(error);
        return undefined;
      }
    },
    cancel: () => current?.abort(),
    reset() {
      current?.abort();
      current = undefined;
      store.set(idle);
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

/** Default heading for each phase. */
export const proofHeadings: Record<ProofPhase, string> = {
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
  stage?: ProofStage,
): Record<ProofStage, ProofStepState> {
  const reached = isProofStage(phase) ? phase : stage;
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
