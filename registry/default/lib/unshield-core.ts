import { formatUnits, parseUnits, zeroAddress } from "viem";
import type { Address, Hash } from "viem";
import { createStore } from "@/lib/0xui-store";
import { createProver, isProofStage } from "@/lib/proof-progress-core";
import type { ProofState } from "@/lib/proof-progress-core";
import type {
  PrivateQuote,
  ProvedOperation,
  ShieldedAccountStatus,
  ShieldedEngine,
  UnshieldDraft,
} from "@/lib/shielded-engine";

/** What the block is doing. No phase waits on a wallet: an unshield has no wallet prompt. */
export type UnshieldPhase =
  | "idle"
  /** The proof is being made in this tab. */
  | "proving"
  /** The proof is ready, but its fee is higher than the one shown. Waiting for a yes. */
  | "review"
  /** The proof is on its way to the network. */
  | "submitting"
  | "cancelled"
  | "error";

/** An unshield before its recipient is known. Enough to ask the price. */
export type UnshieldAmount = Pick<UnshieldDraft, "chainId" | "token" | "amount">;

/**
 * The engine's quote for an unshield. The price does not depend on the
 * recipient, so it is asked with the zero address in its place. Pass
 * `enabled: false` while the amount is still being typed.
 */
export function unshieldQuoteQueryOptions(
  engine: ShieldedEngine,
  draft: UnshieldAmount | undefined,
  { enabled = true }: { enabled?: boolean } = {},
) {
  return {
    queryKey: [
      "0xui",
      "unshield-quote",
      engine.id,
      draft?.chainId,
      draft?.token,
      draft?.amount.toString(),
    ],
    queryFn: () =>
      draft
        ? engine.quote({ kind: "unshield", ...draft, recipient: zeroAddress })
        : Promise.reject(new Error("Nothing to quote yet.")),
    enabled: Boolean(enabled && draft && draft.amount > 0n),
    staleTime: 30_000,
    retry: false,
  } as const;
}

/**
 * Why the unshield can't start yet, as button text, or undefined when it
 * can. Order matches how people get there: account, token, amount, balance,
 * recipient.
 */
export function unshieldBlocker({
  accountStatus,
  token,
  amount,
  spendable,
  recipient,
}: {
  accountStatus: ShieldedAccountStatus;
  token: { symbol: string } | undefined;
  amount: bigint | undefined;
  /** The token's spendable private balance. Undefined until the first scan finishes. */
  spendable: bigint | undefined;
  recipient: Address | undefined;
}) {
  if (accountStatus === "none") {
    return "Create a private account first";
  }
  if (accountStatus === "locked") {
    return "Unlock your private account";
  }
  if (!token) {
    return "Select a token";
  }
  if (!amount) {
    return "Enter an amount";
  }
  if (spendable === undefined) {
    return "Scanning private balance…";
  }
  if (amount > spendable) {
    return `Insufficient private ${token.symbol}`;
  }
  if (!recipient) {
    return "Enter a recipient";
  }
  return undefined;
}

/** The amount as typed, in the token's smallest unit. Undefined when empty or not a number. */
export function parseUnshieldAmount(text: string, decimals: number) {
  try {
    return text ? parseUnits(text, decimals) : undefined;
  } catch {
    return undefined;
  }
}

/** The form button's label, and whether pressing it starts the unshield. */
export type UnshieldFormAction = { label: string; ready: boolean };

/** The form's button before an unshield starts: the blocker, or the call to action. */
export function unshieldFormAction({
  blocker,
  quoteFailed,
  quoting,
  quoted,
  symbol,
}: {
  blocker: string | undefined;
  quoteFailed: boolean;
  quoting: boolean;
  quoted: boolean;
  symbol: string | undefined;
}): UnshieldFormAction {
  if (blocker) {
    return { label: blocker, ready: false };
  }
  if (quoteFailed) {
    return { label: "Can't unshield this amount", ready: false };
  }
  if (quoting || !quoted) {
    return { label: "Fetching quote…", ready: false };
  }
  return { label: `Unshield ${symbol}`, ready: true };
}

/** The button's label while an unshield runs. */
export function unshieldRunningLabel(phase: UnshieldPhase) {
  return phase === "submitting"
    ? "Sending…"
    : phase === "review"
      ? "Unshield at the new fee"
      : phase === "proving"
        ? "Generating proof…"
        : "Try again";
}

/**
 * What a person confirms before an agent starts an unshield: the amount, what
 * the recipient gets after the fee, and where it goes. Set as the button's
 * `data-agent-confirm`.
 */
export function unshieldConfirmText({
  amount,
  token,
  quote,
  recipient,
}: {
  amount: bigint;
  token: { symbol: string; decimals: number };
  quote: Pick<PrivateQuote, "fee" | "received">;
  recipient: Address;
}) {
  const units = (raw: bigint) => `${formatUnits(raw, token.decimals)} ${token.symbol}`;
  return (
    `Unshields ${units(amount)} from your private balance to ${recipient}, a public address: ` +
    `${units(quote.received)} arrives after a ${units(quote.fee)} fee. No wallet prompt.`
  );
}

export type UnshieldFlowState = {
  /** The unshield in progress, frozen at `start`. Undefined while on the form. */
  active: { draft: UnshieldDraft; expected: PrivateQuote } | undefined;
  /** The proved operation waiting for a yes, when its fee went up. */
  review: ProvedOperation | undefined;
  submitting: boolean;
  /** Why the send failed. A failed proof is in `proof.error`. */
  failure: Error | undefined;
  /** The proof's own state, for ProofProgress. */
  proof: ProofState;
};

/** The flow's phase, from its state. */
export function unshieldPhase({
  submitting,
  review,
  failure,
  proof,
}: UnshieldFlowState): UnshieldPhase {
  if (submitting) {
    return "submitting";
  }
  if (review) {
    return "review";
  }
  if (failure || proof.phase === "error") {
    return "error";
  }
  if (isProofStage(proof.phase)) {
    return "proving";
  }
  if (proof.phase === "cancelled") {
    return "cancelled";
  }
  return "idle";
}

export type UnshieldFlow = {
  get(): UnshieldFlowState;
  subscribe(listener: () => void): () => void;
  /** Prove `draft` and submit it. `expected` is the quote on screen. */
  start(draft: UnshieldDraft, expected: PrivateQuote): void;
  /** Accept the higher fee and submit. */
  confirm(): void;
  /** Prove again after an error or a cancel. */
  retry(): void;
  /** Stop the proof. */
  cancel(): void;
  /** Back to the form. A proof that was not submitted is dropped. */
  leave(): void;
};

export type UnshieldFlowOptions = {
  /** Called with the transaction's hash once it is broadcast. */
  onSubmitted?: (hash: Hash, operation: ProvedOperation) => void;
};

const toError = (cause: unknown) => (cause instanceof Error ? cause : new Error(String(cause)));

/**
 * Runs an unshield: prove, then submit. Nothing asks the wallet.
 *
 * The proof commits to its own fee, which can differ from the one quoted
 * while typing. A fee that is no higher is submitted at once. A higher one
 * stops in `review` until `confirm` is called. Framework-free.
 */
export function createUnshieldFlow(
  engine: ShieldedEngine,
  { onSubmitted }: UnshieldFlowOptions = {},
): UnshieldFlow {
  const prover = createProver(engine);
  const store = createStore<UnshieldFlowState>(
    {
      active: undefined,
      review: undefined,
      submitting: false,
      failure: undefined,
      proof: prover.get(),
    },
    (store) => {
      store.set({ proof: prover.get() });
      const stop = prover.subscribe(() => store.set({ proof: prover.get() }));
      return () => {
        stop();
        prover.cancel();
      };
    },
  );
  // Bumped whenever the flow is left. Work from an older run stops when it notices.
  let run = 0;

  const submit = async (operation: ProvedOperation, id: number) => {
    store.set({ review: undefined, submitting: true });
    try {
      const { hash } = await engine.submit(operation);
      if (run !== id) {
        return;
      }
      store.set({ active: undefined, submitting: false });
      prover.reset();
      onSubmitted?.(hash, operation);
    } catch (error) {
      if (run === id) {
        store.set({ failure: toError(error), submitting: false });
      }
    }
  };

  const start = async (draft: UnshieldDraft, expected: PrivateQuote) => {
    const id = ++run;
    store.set({ active: { draft, expected }, review: undefined, failure: undefined });
    const operation = await prover.prove(draft);
    if (!operation || run !== id) {
      return;
    }
    if (operation.quote.fee > expected.fee) {
      store.set({ review: operation });
    } else {
      await submit(operation, id);
    }
  };

  return {
    get: store.get,
    subscribe: store.subscribe,
    start: (draft, expected) => void start(draft, expected),
    confirm() {
      const { review } = store.get();
      if (review) {
        void submit(review, run);
      }
    },
    retry() {
      const { active, submitting } = store.get();
      if (active && !submitting) {
        void start(active.draft, active.expected);
      }
    },
    cancel: prover.cancel,
    leave() {
      run++;
      prover.reset();
      store.set({ active: undefined, review: undefined, submitting: false, failure: undefined });
    },
  };
}
