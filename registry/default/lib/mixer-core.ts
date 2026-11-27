import {
  getConnection,
  getPublicClient,
  sendCalls,
  sendTransaction,
  switchChain,
  waitForCallsStatus,
  watchConnection,
} from "@wagmi/core";
import type { Config } from "@wagmi/core";
import { getCapabilitiesQueryOptions, hashFn, readContractQueryOptions } from "@wagmi/core/query";
import { encodeFunctionData, erc20Abi, formatUnits } from "viem";
import type { Address, Hash, Hex } from "viem";
import { createStore } from "@/lib/0xui-store";
import { errorCode, errorMessage, isUserRejection } from "@/lib/0xui-utils";
import type { ErrorCode } from "@/lib/0xui-utils";
import { requiresAllowanceReset } from "@/lib/approve-button-core";
import { MIXER_STAGES, mixerPoolLabel } from "@/lib/mixer-engine";
import type {
  MixerCall,
  MixerDeposit,
  MixerEngine,
  MixerNote,
  MixerPool,
  MixerQuote,
  MixerStage,
  MixerWithdrawDraft,
  MixerWithdrawVia,
  MixerWithdrawal,
} from "@/lib/mixer-engine";
import { proofStageMeta } from "@/lib/proof-progress-core";
import type { ProofStepState } from "@/lib/proof-progress-core";

const toError = (cause: unknown) => (cause instanceof Error ? cause : new Error(String(cause)));

export type MixerProblem = { message: string; code?: ErrorCode };

/* -------------------------------------------------------------------------- */
/* Wallet                                                                     */
/* -------------------------------------------------------------------------- */

/** Why the wallet can't act on `chainId` yet, or undefined when it can. */
export function mixerWalletBlocker({
  address,
  walletChainId,
  chainId,
  chainName = "the right network",
}: {
  address: Address | undefined;
  walletChainId: number | undefined;
  chainId: number;
  chainName?: string;
}): { label: string; action: "connect" | "switch-chain" } | undefined {
  if (!address) {
    return { label: "Connect wallet", action: "connect" };
  }
  if (walletChainId !== chainId) {
    return { label: `Switch to ${chainName}`, action: "switch-chain" };
  }
  return undefined;
}

export type MixerWalletState = {
  address: Address | undefined;
  walletChainId: number | undefined;
  connected: boolean;
  /** A network switch is waiting on the wallet. */
  switching: boolean;
};

function readWallet(config: Config) {
  const connection = getConnection(config);
  return {
    address: connection.address,
    walletChainId: connection.chainId,
    connected: connection.status === "connected",
  };
}

/** Follows the connected wallet, and asks it to switch chains. Shared by both forms. */
export function createMixerWallet(config: Config) {
  const store = createStore<MixerWalletState>(
    { ...readWallet(config), switching: false },
    (store) => {
      store.set(readWallet(config));
      return watchConnection(config, { onChange: () => store.set(readWallet(config)) });
    },
  );
  return {
    get: store.get,
    subscribe: store.subscribe,
    /** Ask the wallet to move to `chainId`. A failure leaves things as they were. */
    async switchChain(chainId: number) {
      if (store.get().switching) {
        return;
      }
      store.set({ switching: true });
      try {
        await switchChain(config, { chainId });
      } catch {
        // A rejected or failed switch leaves the button offering it again.
      } finally {
        store.set({ switching: false });
      }
    },
  };
}

export type MixerWallet = ReturnType<typeof createMixerWallet>;

/* -------------------------------------------------------------------------- */
/* Deposit                                                                    */
/* -------------------------------------------------------------------------- */

/** One wallet prompt of a deposit. `batch` is approval and deposit as one atomic transaction. */
export type MixerDepositStep = "reset" | "approve" | "deposit" | "batch";

/**
 * `backup`: the note is on screen and nothing has been sent. `wallet`: a
 * prompt is open. `pending`: an approval or a batch is being mined.
 */
export type MixerDepositPhase =
  | "idle"
  | "creating"
  | "backup"
  | "wallet"
  | "pending"
  | "cancelled"
  | "error";

/** The wallet prompts a deposit takes. ERC-20 pools need the pool approved first. */
export function mixerDepositSteps({
  needsApproval,
  needsReset,
  atomic,
}: {
  needsApproval: boolean;
  needsReset: boolean;
  atomic: boolean;
}): Array<MixerDepositStep> {
  if (!needsApproval) {
    return ["deposit"];
  }
  if (atomic) {
    return ["batch"];
  }
  return needsReset ? ["reset", "approve", "deposit"] : ["approve", "deposit"];
}

/** What was deposited, without the note: safe to log and store. */
export type MixerDeposited = { pool: MixerPool; commitment: Hex };

/** The steps of a deposit. `leftover`: an old allowance below the amount, which a batch clears first. */
export type MixerDepositPlan = { steps: Array<MixerDepositStep>; leftover: boolean };

/** The `atomic.status` an EIP-5792 wallet reports for a chain, if any. */
function atomicStatus(capabilities: unknown) {
  if (typeof capabilities !== "object" || capabilities === null || !("atomic" in capabilities)) {
    return undefined;
  }
  const { atomic } = capabilities;
  return typeof atomic === "object" && atomic !== null && "status" in atomic
    ? atomic.status
    : undefined;
}

/**
 * Plan the wallet prompts for a pool. Undefined until the allowance of an
 * ERC-20 pool is known. Only an "supported" atomic status counts: "ready"
 * would first ask to upgrade the account, and a batch that is not atomic
 * could approve and then fail to deposit.
 */
export function planMixerDeposit({
  pool,
  allowance,
  capabilities,
}: {
  pool: MixerPool | undefined;
  allowance: bigint | undefined;
  capabilities: unknown;
}): MixerDepositPlan | undefined {
  if (!pool || (pool.token && allowance === undefined)) {
    return undefined;
  }
  const { token } = pool;
  return {
    steps: mixerDepositSteps({
      needsApproval: Boolean(token) && allowance !== undefined && allowance < pool.denomination,
      needsReset:
        Boolean(allowance) && token !== undefined && requiresAllowanceReset(pool.chainId, token),
      atomic: atomicStatus(capabilities) === "supported",
    }),
    leftover: Boolean(allowance),
  };
}

/** How much the pool may move of its token. Disabled for a native pool and without a wallet. */
export function mixerAllowanceQueryOptions(
  config: Config,
  { pool, owner }: { pool: MixerPool | undefined; owner: Address | undefined },
) {
  return {
    ...readContractQueryOptions(config, {
      address: pool?.token,
      abi: erc20Abi,
      functionName: "allowance",
      args: owner && pool ? [owner, pool.address] : undefined,
      chainId: pool?.chainId,
      query: { enabled: Boolean(pool?.token && owner) },
    }),
    queryKeyHashFn: hashFn,
  };
}

/** What the wallet can do on the pool's chain (EIP-5792). Only asked for ERC-20 pools. */
export function mixerCapabilitiesQueryOptions(
  config: Config,
  {
    pool,
    account,
    connected,
  }: { pool: MixerPool | undefined; account: Address | undefined; connected: boolean },
) {
  return {
    ...getCapabilitiesQueryOptions(config, {
      chainId: pool?.chainId,
      account,
      query: { enabled: Boolean(pool?.token) && connected },
    }),
    queryKeyHashFn: hashFn,
  };
}

/** Default copy for a deposit step's button. */
export function mixerDepositCopy(step: MixerDepositStep, pool: MixerPool) {
  const amount = mixerPoolLabel(pool);
  return {
    reset: { cta: `Reset ${pool.symbol} approval`, pending: "Resetting…" },
    approve: { cta: `Approve ${pool.symbol}`, pending: "Approving…" },
    deposit: { cta: `Deposit ${amount}`, pending: "Pending…" },
    batch: { cta: `Approve and deposit ${amount}`, pending: "Pending…" },
  }[step];
}

/** The deposit form's button label, and what pressing it does, if anything. */
export type MixerDepositAction = {
  label: string;
  action?: "connect" | "switch-chain" | "begin" | "send";
};

/**
 * The deposit form's button: its label and what a click does. Order: pool,
 * wallet, balance, note, backup, then the wallet steps.
 */
export function mixerDepositAction({
  pool,
  walletBlocker,
  switching,
  balance,
  note,
  saved,
  phase,
  busy,
  step,
}: {
  pool: MixerPool | undefined;
  walletBlocker: ReturnType<typeof mixerWalletBlocker>;
  switching: boolean;
  /** The wallet's balance of the pool's token, once read. */
  balance: bigint | undefined;
  note: MixerNote | undefined;
  saved: boolean;
  phase: MixerDepositPhase;
  busy: boolean;
  /** The step waiting for a click. Undefined until the allowance is known. */
  step: MixerDepositStep | undefined;
}): MixerDepositAction {
  if (!pool) {
    return { label: "Select an amount" };
  }
  if (walletBlocker) {
    if (walletBlocker.action === "switch-chain" && switching) {
      return { label: walletBlocker.label };
    }
    return walletBlocker;
  }
  if (balance !== undefined && balance < pool.denomination) {
    return { label: `Insufficient ${pool.symbol}` };
  }
  if (!note) {
    const label = phase === "creating" ? "Creating note…" : "Create note";
    return busy ? { label } : { label, action: "begin" };
  }
  if (!saved) {
    return { label: "Save your note first" };
  }
  if (!step) {
    return { label: "Checking approval…" };
  }
  if (phase === "wallet") {
    return { label: "Confirm in wallet…" };
  }
  if (phase === "pending") {
    return { label: mixerDepositCopy(step, note.pool).pending };
  }
  return { label: mixerDepositCopy(step, note.pool).cta, action: "send" };
}

/**
 * What a person confirms before an agent's press sends a deposit: the
 * amount, that it leaves the wallet in public, and that the note is the only
 * way back. Set as the button's `data-agent-confirm`.
 */
export function mixerDepositConfirmText(pool: MixerPool, step: MixerDepositStep) {
  const what = step === "batch" ? "Approves and deposits" : "Deposits";
  return `${what} ${mixerPoolLabel(pool)} from your wallet into the pool, in public. Only the saved note can withdraw it.`;
}

export type MixerDepositState = {
  /** The note being deposited. Undefined before `begin` and after the deposit is sent. */
  note: MixerNote | undefined;
  creating: boolean;
  /** Whether the user confirmed the backup. */
  saved: boolean;
  /** The steps, frozen at the first wallet prompt. */
  frozen: MixerDepositPlan | undefined;
  /** The step waiting for a click, or running. */
  index: number;
  stepPhase: "ready" | "wallet" | "pending";
  problem: (MixerProblem & { kind: "cancelled" | "error" }) | undefined;
};

/** The deposit's phase, from its state. */
export function mixerDepositPhase({
  creating,
  stepPhase,
  problem,
  note,
}: MixerDepositState): MixerDepositPhase {
  if (creating) {
    return "creating";
  }
  if (stepPhase !== "ready") {
    return stepPhase;
  }
  if (problem) {
    return problem.kind;
  }
  return note ? "backup" : "idle";
}

export type MixerDepositOptions = {
  /** Called with the deposit transaction's hash. For a batch, that is once it is mined. */
  onSubmitted?: (hash: Hash, deposited: MixerDeposited) => void;
};

const depositIdle: MixerDepositState = {
  note: undefined,
  creating: false,
  saved: false,
  frozen: undefined,
  index: 0,
  stepPhase: "ready",
  problem: undefined,
};

/**
 * Runs a deposit: make the note, wait for the user to save it, then the
 * wallet prompts, one click each. The note is made before anything is sent
 * and never changes, so what was backed up is what is deposited. It is
 * dropped from memory once the deposit is sent, or when the flow is left.
 * Framework-free.
 */
export function createMixerDeposit(
  config: Config,
  engine: MixerEngine,
  { onSubmitted }: MixerDepositOptions = {},
) {
  // Bumped whenever the flow is left. Work from an older run stops when it notices.
  let run = 0;
  const store = createStore<MixerDepositState>(depositIdle, () => () => {
    run++;
  });

  const leave = () => {
    run++;
    store.set(depositIdle);
  };

  const begin = async (pool: MixerPool | undefined) => {
    const { note, creating } = store.get();
    if (!pool || note || creating) {
      return;
    }
    const id = ++run;
    store.set({ problem: undefined, creating: true });
    try {
      const made = await engine.createNote(pool);
      if (run !== id) {
        return;
      }
      store.set({ note: made, saved: false, creating: false });
    } catch (error_) {
      if (run !== id) {
        return;
      }
      const error = toError(error_);
      store.set({
        creating: false,
        problem: { kind: "error", message: error.message, code: errorCode("error", error) },
      });
    }
  };

  const perform = async (planned: MixerDepositPlan | undefined) => {
    const { note, saved, frozen, index, stepPhase } = store.get();
    const plan = frozen ?? planned;
    const kind = plan?.steps[index];
    if (!note || !saved || !plan || kind === undefined || stepPhase !== "ready") {
      return;
    }
    const id = ++run;
    const live = () => run === id;
    const { pool: into, commitment } = note;
    const { chainId } = into;

    const approval = (value: bigint): MixerCall => {
      if (!into.token) {
        throw new Error("This pool takes the native token, so there is nothing to approve.");
      }
      return {
        to: into.token,
        data: encodeFunctionData({
          abi: erc20Abi,
          functionName: "approve",
          args: [into.address, value],
        }),
      };
    };

    store.set({ frozen: plan, problem: undefined, stepPhase: "wallet" });
    try {
      let hash: Hash | undefined;
      if (kind === "reset" || kind === "approve") {
        const sent = await sendTransaction(config, {
          chainId,
          ...approval(kind === "reset" ? 0n : into.denomination),
        });
        if (live()) {
          store.set({ stepPhase: "pending" });
        }
        const client = getPublicClient(config, { chainId });
        if (!client) {
          throw new Error(`Chain ${chainId} is not in the wagmi config.`);
        }
        const receipt = await client.waitForTransactionReceipt({ hash: sent });
        if (receipt.status === "reverted") {
          throw new Error("The approval reverted. Nothing changed except the gas fee.");
        }
      } else if (kind === "deposit") {
        const transaction = await engine.prepareDeposit(note.note);
        hash = await sendTransaction(config, { chainId, ...transaction });
      } else {
        const transaction = await engine.prepareDeposit(note.note);
        const batch = await sendCalls(config, {
          chainId,
          calls: [
            ...(plan.leftover ? [approval(0n)] : []),
            approval(into.denomination),
            transaction,
          ],
        });
        if (live()) {
          store.set({ stepPhase: "pending" });
        }
        const result = await waitForCallsStatus(config, { id: batch.id });
        const receipts = result.receipts ?? [];
        // The deposit is the last call. A wallet can call a batch done while a
        // call in it reverted, so every receipt has to have succeeded.
        hash = receipts.at(-1)?.transactionHash;
        if (result.status !== "success" || !hash || receipts.some((r) => r.status !== "success")) {
          throw new Error("The batch reverted. Nothing was approved or deposited.");
        }
      }
      if (!live()) {
        return;
      }

      if (hash) {
        leave();
        onSubmitted?.(hash, { pool: into, commitment });
      } else {
        store.set({ index: index + 1, stepPhase: "ready" });
      }
    } catch (error_) {
      if (!live()) {
        return;
      }
      const error = toError(error_);
      store.set({
        stepPhase: "ready",
        problem: isUserRejection(error)
          ? { kind: "cancelled", message: "Cancelled in wallet." }
          : { kind: "error", message: errorMessage(error), code: errorCode("error", error) },
      });
    }
  };

  return {
    get: store.get,
    subscribe: store.subscribe,
    /** Make the note for `pool` and show it for backup. Sends nothing. */
    begin: (pool: MixerPool | undefined) => void begin(pool),
    setSaved: (saved: boolean) => store.set({ saved }),
    /**
     * Open the wallet for the current step. One click, one prompt. Needs the
     * backup confirmed. `plan` is used until the first prompt freezes it.
     */
    send: (plan: MixerDepositPlan | undefined) => void perform(plan),
    /** Back to the form. The note is dropped; an approval that was mined stays mined. */
    leave,
  };
}

export type MixerDepositController = ReturnType<typeof createMixerDeposit>;

/* -------------------------------------------------------------------------- */
/* Note lookup                                                                */
/* -------------------------------------------------------------------------- */

export type MixerNoteLookupState = {
  /** The trimmed text this state is for. */
  text: string;
  note?: MixerNote;
  deposit?: MixerDeposit;
  error?: Error;
};

/**
 * Reads pasted text as a note and looks its deposit up, once typing pauses.
 * The note stays out of query keys and caches: nothing outlives the
 * controller. Framework-free.
 */
export function createMixerNoteLookup(engine: MixerEngine, { debounce = 300 } = {}) {
  let input = "";
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lookup: AbortController | undefined;

  const stop = () => {
    clearTimeout(timer);
    lookup?.abort();
  };
  const store = createStore<MixerNoteLookupState>({ text: "" }, () => stop);

  const schedule = () => {
    stop();
    const trimmed = input.trim();
    if (!trimmed) {
      return;
    }
    const current = new AbortController();
    lookup = current;
    const read = async () => {
      try {
        const note = await engine.parseNote(trimmed);
        if (current.signal.aborted) {
          return;
        }
        store.set({ text: trimmed, note, deposit: undefined, error: undefined });
        const deposit = await engine.getDeposit(trimmed, { signal: current.signal });
        if (!current.signal.aborted) {
          store.set({ text: trimmed, note, deposit, error: undefined });
        }
      } catch (error) {
        if (current.signal.aborted) {
          return;
        }
        store.set((state) => ({
          text: trimmed,
          // A note that parsed but could not be looked up is still a note.
          note: state.text === trimmed ? state.note : undefined,
          deposit: undefined,
          error: toError(error),
        }));
      }
    };
    timer = setTimeout(() => void read(), debounce);
  };

  return {
    get: store.get,
    subscribe: store.subscribe,
    /** Look up `text` once typing pauses. The same text twice does nothing. */
    lookup(text: string) {
      if (text === input) {
        return;
      }
      input = text;
      schedule();
    },
    /** Look the deposit up again. */
    refresh: schedule,
  };
}

/** What the lookup says about `text`: nothing until the state is for that text. */
export function mixerNoteView(state: MixerNoteLookupState, text: string) {
  const trimmed = text.trim();
  const current = state.text === trimmed && trimmed !== "";
  return {
    /** The note, once the text parses. */
    note: current ? state.note : undefined,
    /** Its deposit, once looked up. */
    deposit: current ? state.deposit : undefined,
    /** Why the text is not a note, or why the lookup failed. */
    error: current ? state.error : undefined,
    isLoading: trimmed !== "" && (!current || (!state.deposit && !state.error)),
  };
}

/* -------------------------------------------------------------------------- */
/* Withdraw                                                                   */
/* -------------------------------------------------------------------------- */

/** The engine's fee for a withdrawal from `pool`, sent by `via`. */
export function mixerQuoteQueryOptions(
  engine: MixerEngine,
  pool: MixerPool | undefined,
  via: MixerWithdrawVia,
) {
  return {
    queryKey: ["0xui", "mixer-quote", engine.id, pool?.chainId, pool?.address, via],
    queryFn: () =>
      pool ? engine.quote(pool, via) : Promise.reject(new Error("Nothing to quote yet.")),
    enabled: Boolean(pool),
    staleTime: 30_000,
    retry: false,
  } as const;
}

/**
 * `syncing`: reading the pool's deposits. `review`: the proof's fee is
 * higher than the one shown. `ready`: the proof is made and the wallet step
 * waits for a click. `submitting`: on its way to the relayer.
 */
export type MixerWithdrawPhase =
  | "idle"
  | "syncing"
  | "proving"
  | "review"
  | "ready"
  | "wallet"
  | "submitting"
  | "cancelled"
  | "error";

export type MixerWithdrawState = {
  phase: MixerWithdrawPhase;
  /** The withdrawal in progress, frozen at `start`. Holds the note until the flow is left. */
  active: { draft: MixerWithdrawDraft; expected: MixerQuote } | undefined;
  /** The stage that is running, or the one a failed or cancelled proof stopped in. */
  stage: MixerStage | undefined;
  /** The proved withdrawal, once there is one. */
  withdrawal: MixerWithdrawal | undefined;
  /** Why it stopped. `proof` says whether the proof failed, or the send. */
  problem: (MixerProblem & { proof: boolean }) | undefined;
};

export const isMixerWithdrawBusy = (phase: MixerWithdrawPhase) =>
  phase === "syncing" || phase === "proving" || phase === "wallet" || phase === "submitting";

export type MixerWithdrawOptions = {
  /** Called with the withdrawal transaction's hash once it is broadcast. */
  onSubmitted?: (hash: Hash, withdrawal: MixerWithdrawal) => void;
};

const withdrawIdle: MixerWithdrawState = {
  phase: "idle",
  active: undefined,
  stage: undefined,
  withdrawal: undefined,
  problem: undefined,
};

/**
 * Runs a withdrawal: read the deposits, prove, then send. Through a relayer
 * nothing asks the wallet, and a fee higher than `expected` stops in
 * `review`. From the wallet, the proof stops in `ready` and `send` opens
 * the prompt, because a prompt has to come straight from a click.
 * Framework-free.
 */
export function createMixerWithdraw(
  config: Config,
  engine: MixerEngine,
  { onSubmitted }: MixerWithdrawOptions = {},
) {
  // The proof in progress. Leaving aborts it.
  let current: AbortController | undefined;
  const store = createStore<MixerWithdrawState>(withdrawIdle, () => () => current?.abort());

  const leave = () => {
    current?.abort();
    current = undefined;
    store.set(withdrawIdle);
  };

  const fail = (cause: unknown, proof: boolean) => {
    const error = toError(cause);
    store.set({
      phase: "error",
      problem: { message: errorMessage(error), code: errorCode("error", error), proof },
    });
  };

  const relay = async (proved: MixerWithdrawal, run: AbortController) => {
    store.set({ phase: "submitting" });
    try {
      const { hash } = await engine.relay(proved);
      if (current !== run) {
        return;
      }
      leave();
      onSubmitted?.(hash, proved);
    } catch (error) {
      if (current === run) {
        fail(error, false);
      }
    }
  };

  const start = async (draft: MixerWithdrawDraft, expected: MixerQuote) => {
    current?.abort();
    const run = new AbortController();
    current = run;
    store.set({
      active: { draft, expected },
      withdrawal: undefined,
      problem: undefined,
      stage: "syncing",
      phase: "syncing",
    });
    try {
      const proved = await engine.prove(draft, {
        signal: run.signal,
        onStage: (stage) => {
          if (current !== run || run.signal.aborted) {
            return;
          }
          store.set({ stage, phase: stage === "syncing" ? "syncing" : "proving" });
        },
      });
      if (current !== run) {
        return;
      }
      if (run.signal.aborted) {
        return store.set({ phase: "cancelled" });
      }
      store.set({ withdrawal: proved });
      if (proved.via === "wallet") {
        store.set({ phase: "ready" });
      } else if (proved.quote.fee > expected.fee) {
        store.set({ phase: "review" });
      } else {
        await relay(proved, run);
      }
    } catch (error) {
      if (current !== run) {
        return;
      }
      if (run.signal.aborted) {
        return store.set({ phase: "cancelled" });
      }
      fail(error, true);
    }
  };

  const send = async () => {
    const { withdrawal: proved, phase } = store.get();
    const run = current;
    if (!proved || !run || proved.via !== "wallet" || phase === "wallet") {
      return;
    }
    store.set({ problem: undefined, phase: "wallet" });
    try {
      const hash = await sendTransaction(config, {
        chainId: proved.pool.chainId,
        ...proved.transaction,
      });
      if (current !== run) {
        return;
      }
      leave();
      onSubmitted?.(hash, proved);
    } catch (error) {
      if (current !== run) {
        return;
      }
      if (isUserRejection(toError(error))) {
        return store.set({ phase: "cancelled" });
      }
      fail(error, false);
    }
  };

  return {
    get: store.get,
    subscribe: store.subscribe,
    /** Prove `draft`. `expected` is the quote on screen. */
    start: (draft: MixerWithdrawDraft, expected: MixerQuote) => void start(draft, expected),
    /** Accept the higher fee and hand the withdrawal to the relayer. */
    confirm() {
      const { phase, withdrawal } = store.get();
      if (phase === "review" && withdrawal && current) {
        void relay(withdrawal, current);
      }
    },
    /** Open the wallet for a proved `via: "wallet"` withdrawal. One click, one prompt. */
    send: () => void send(),
    /** Prove again after an error or a cancelled proof. */
    retry() {
      const { active } = store.get();
      if (active) {
        void start(active.draft, active.expected);
      }
    },
    /** Stop the proof. */
    cancel: () => current?.abort(),
    /** Back to the form. A proof that was not sent is dropped, and so is the note. */
    leave,
  };
}

export type MixerWithdrawController = ReturnType<typeof createMixerWithdraw>;

/** The withdraw form's button label before a withdrawal starts, and what pressing it does. */
export type MixerWithdrawAction = {
  label: string;
  action?: "refresh" | "connect" | "switch-chain" | "start";
};

/**
 * The withdraw form's button before a withdrawal starts. Order matches how
 * people get there: note, deposit, recipient, wallet, quote.
 */
export function mixerWithdrawAction({
  text,
  note,
  deposit,
  lookupError,
  lookupLoading,
  recipient,
  via,
  walletBlocker,
  switching,
  quoteFailed,
  quote,
}: {
  text: string;
  note: MixerNote | undefined;
  deposit: MixerDeposit | undefined;
  lookupError: Error | undefined;
  lookupLoading: boolean;
  recipient: Address | undefined;
  via: MixerWithdrawVia;
  walletBlocker: ReturnType<typeof mixerWalletBlocker>;
  switching: boolean;
  quoteFailed: boolean;
  quote: MixerQuote | undefined;
}): MixerWithdrawAction {
  if (!text.trim()) {
    return { label: "Paste your note" };
  }
  if (!note && lookupError) {
    return { label: "Not a valid note" };
  }
  if (lookupLoading || !note) {
    return { label: "Checking note…" };
  }
  if (lookupError) {
    return { label: "Check again", action: "refresh" };
  }
  if (deposit?.state === "missing") {
    return { label: "No deposit found" };
  }
  if (deposit?.state === "withdrawn") {
    return { label: "Already withdrawn" };
  }
  if (!recipient) {
    return { label: "Enter a recipient" };
  }
  if (via === "wallet" && walletBlocker) {
    if (walletBlocker.action === "switch-chain" && switching) {
      return { label: walletBlocker.label };
    }
    return walletBlocker;
  }
  if (quoteFailed) {
    return { label: "Can't withdraw this way" };
  }
  if (!quote) {
    return { label: "Fetching quote…" };
  }
  return { label: `Withdraw ${mixerPoolLabel(note.pool)}`, action: "start" };
}

/** The button's label while a withdrawal runs, and what pressing it does. */
export type MixerWithdrawRunningAction = {
  label: string;
  action?: "retry" | "confirm" | "send" | "connect" | "switch-chain";
};

/** The button while a withdrawal runs: its label and what a click does. */
export function mixerWithdrawRunningAction({
  phase,
  withdrawal,
  problem,
  walletBlocker,
  switching,
}: Pick<MixerWithdrawState, "phase" | "withdrawal" | "problem"> & {
  walletBlocker: ReturnType<typeof mixerWalletBlocker>;
  switching: boolean;
}): MixerWithdrawRunningAction {
  if (phase === "syncing" || phase === "proving") {
    return { label: "Generating proof…" };
  }
  if (phase === "submitting") {
    return { label: "Sending…" };
  }
  if (phase === "wallet") {
    return { label: "Confirm in wallet…" };
  }
  if (phase === "review") {
    return { label: "Withdraw at the new fee", action: "confirm" };
  }
  if (withdrawal?.via === "wallet" && !problem?.proof) {
    // Proved, and waiting for the wallet: also after a dismissed prompt or a failed send.
    if (walletBlocker) {
      if (walletBlocker.action === "switch-chain" && switching) {
        return { label: walletBlocker.label };
      }
      return walletBlocker;
    }
    return { label: "Send withdrawal from wallet", action: "send" };
  }
  return { label: "Try again", action: "retry" };
}

/**
 * What a person confirms before an agent's press starts or sends a
 * withdrawal: the amount, the recipient, the fee and who sends it. Set as
 * the button's `data-agent-confirm`.
 */
export function mixerWithdrawConfirmText({
  pool,
  recipient,
  quote,
  via,
}: {
  pool: MixerPool;
  recipient: Address;
  quote: MixerQuote;
  via: MixerWithdrawVia;
}) {
  const units = (raw: bigint) => `${formatUnits(raw, pool.decimals)} ${pool.symbol}`;
  const by =
    via === "relayer" ? "A relayer sends it" : "Your wallet sends it and pays the gas, in public";
  return (
    `Withdraws a ${mixerPoolLabel(pool)} deposit to ${recipient}, a public address: ` +
    `${units(quote.received)} arrives after a ${units(quote.fee)} fee. ${by}.`
  );
}

/** How long ago, in words, for a time in seconds. */
export function formatMixerAge(seconds: number) {
  if (seconds < 90) {
    return "just now";
  }
  if (seconds < 5400) {
    return `${Math.round(seconds / 60)} min ago`;
  }
  if (seconds < 129_600) {
    return `${Math.round(seconds / 3600)} hours ago`;
  }
  return `${Math.round(seconds / 86_400)} days ago`;
}

/** Below this many later deposits, the form warns that the withdrawal is easy to link. */
export const MIXER_SMALL_CROWD = 10;

/** The state of each stage of a withdrawal proof, starting with the read of the deposits. */
export function mixerStepStates(
  phase: MixerWithdrawPhase,
  stage: MixerStage | undefined,
  proofFailed: boolean,
): Record<MixerStage, ProofStepState> {
  const done =
    phase === "review" || phase === "ready" || phase === "wallet" || phase === "submitting";
  const reached = stage ? MIXER_STAGES.indexOf(stage) : -1;
  const state = (name: MixerStage): ProofStepState => {
    const index = MIXER_STAGES.indexOf(name);
    return done || (!proofFailed && phase === "error") || index < reached
      ? "done"
      : index > reached || phase === "cancelled" || phase === "idle"
        ? "todo"
        : phase === "error"
          ? "failed"
          : "active";
  };
  return {
    syncing: state("syncing"),
    "loading-circuits": state("loading-circuits"),
    proving: state("proving"),
    verifying: state("verifying"),
  };
}

/** Default label and hint for each stage of a withdrawal proof. */
export const mixerStageMeta: Record<MixerStage, { label: string; hint?: string }> = {
  syncing: {
    label: "Reading the pool's deposits",
    hint: "The proof is built from every deposit in the pool. The first read is the slow one.",
  },
  ...proofStageMeta,
};

/** The proof card's heading. */
export function mixerProofHeading(
  phase: MixerWithdrawPhase,
  states: Record<MixerStage, ProofStepState>,
  failed: boolean,
) {
  if (phase === "syncing" || phase === "proving") {
    return "Generating proof";
  }
  if (failed) {
    return "Couldn't generate proof";
  }
  if (phase === "cancelled" && states.verifying !== "done") {
    return "Proof cancelled";
  }
  return "Proof ready";
}
