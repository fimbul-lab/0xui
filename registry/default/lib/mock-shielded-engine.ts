// Docs: https://0xui.io/components/mock-shielded-engine.md
import { encodeAbiParameters } from "viem";
import type { Address, Hash } from "viem";
import { encodeBech32m } from "@/lib/0xui-utils";
import { SHIELDED_BALANCE_STATES } from "@/lib/shielded-engine";
import type {
  ShieldedAccountStatus,
  ShieldedTokenBalance,
  ShieldedBalanceState,
  ShieldedEngine,
  ShieldedEvent,
  ShieldedSync,
  ShieldedSyncStage,
  ShieldedTransaction,
} from "@/lib/shielded-engine";

/**
 * How long things take, in ms, before `speed` is applied. Measured against
 * the Railgun SDK on Sepolia unless marked as a guess.
 */
export const MOCK_TIMINGS = {
  /** Creating or importing an account. */
  createAccount: 6000,
  /** Unlocking an existing account. A guess: not measured. */
  unlock: 800,
  /** The first scan of a chain. */
  firstScan: 40_000,
  /** Every scan after the first. Also the delay before a change shows up in the balances. */
  repeatScan: 3500,
  /** Downloading the circuit files (about 9 MB). First proof only; later proofs take a twentieth of this. */
  loadCircuits: 4000,
  /** Generating the proof. */
  prove: 8000,
  /** Verifying the proof. */
  verify: 1000,
  /** How long shielded funds stay `pending`. 60 s on testnets; set 3_600_000 to imitate mainnet. */
  standby: 60_000,
  /** How long change from a spend stays `proving`. A guess: not measured. */
  settle: 15_000,
  /** One attempt at the missing proofs. A guess: not measured. */
  retryProofs: 5000,
};

export type MockTimings = typeof MOCK_TIMINGS;

/** Fee taken on the way in and on the way out: 25 bps each. */
export const MOCK_FEE_BPS = 25n;

/** The recovery phrase `account.create` returns: the BIP-39 test vector, never a real account. */
export const MOCK_MNEMONIC =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

/** The message the mock asks the public wallet to sign before a shield. */
export const MOCK_SHIELD_MESSAGE = "MOCK_SHIELD";

/** Where the mock's shield transactions go, and the spender to approve. No contract lives here. */
export const MOCK_SHIELD_CONTRACT: Address = "0x00000000000000000000000000000000005111e1";

/** How long a mock proof stays valid. */
const PROOF_LIFETIME = 240_000;

export type MockFunds = {
  token: Address;
  /** In the token's smallest unit. */
  amount: bigint;
  /** Defaults to "spendable". */
  state?: ShieldedBalanceState;
  /** Defaults to the first of `chains`. */
  chainId?: number;
  /** The public transaction that shielded them, so `getTransaction` can report on it. */
  hash?: Hash;
};

export type MockShieldedEngineOptions = {
  /**
   * Divides every delay. 1 is real time, 10 is ten times faster, and
   * `Infinity` skips timers altogether so tests can simply `await`.
   */
  speed?: number;
  /** Override single delays, in ms. */
  timings?: Partial<MockTimings>;
  /** Start with no account, or with a locked one that `password` opens. */
  account?: "none" | "locked";
  /** Password of the initial locked account. */
  password?: string;
  /** Chains scanned automatically after unlock. Other chains scan when `sync` is called. */
  chains?: ReadonlyArray<number>;
  /** Funds the account already holds. They show up after the first scan. */
  funds?: ReadonlyArray<MockFunds>;
  /** Pretend the circuit files are already downloaded, so the first proof is as fast as the rest. */
  circuitsCached?: boolean;
  /** Ask the wallet for a signature before a shield, as Railgun does. Turn off to imitate a protocol that needs none. */
  shieldSignature?: boolean;
};

/** Controls that only the mock has: make things happen, or make the next thing fail. */
export type MockSimulate = {
  /**
   * Funds arrive from a public shield: the fee is taken, the rest is
   * `pending` for the standby period, then `outcome`.
   */
  shield(params: {
    token: Address;
    amount: bigint;
    chainId?: number;
    outcome?: "spendable" | "restricted";
    /** The public transaction that shielded them, so `getTransaction` can report on it. */
    hash?: Hash;
  }): Promise<{ fee: bigint; received: bigint }>;
  /**
   * Spend from the spendable balance to a public address. The recipient gets
   * `amount` minus the fee. Whole notes are spent, so the remainder comes
   * back as change: `proving` first, then `change`. Pass "incomplete" for
   * change that gets stuck. Throws if the spendable balance is too low.
   */
  unshield(params: {
    token: Address;
    amount: bigint;
    chainId?: number;
    change?: "spendable" | "incomplete";
  }): Promise<{ fee: bigint; received: bigint }>;
  /** Put funds straight into any state, with no fee and no waiting period. */
  addFunds(funds: MockFunds): Promise<void>;
  /** The next scan of the chain stops a third of the way in with an error. */
  failNextSync(message?: string, chainId?: number): void;
  /** The next proof fails while proving. */
  failNextProof(message?: string): void;
  /** The next `retryProofs` call rejects. */
  failNextRetry(message?: string): void;
  /** While on, `retryProofs` finishes but the funds stay `incomplete`. */
  keepIncomplete(keep?: boolean): void;
};

export type MockShieldedEngine = ShieldedEngine & { simulate: MockSimulate };

type Note = { token: Address; amount: bigint; state: ShieldedBalanceState; hash?: Hash };

type ChainState = {
  /** What the account really holds. Only a scan copies it into `balances`. */
  notes: Array<Note>;
  sync: ShieldedSync;
  balances: ReadonlyArray<ShieldedTokenBalance> | undefined;
  /** Public transactions the last scan found, by lower-case hash. */
  transactions: Map<string, ShieldedTransaction>;
  /** A scan has finished at least once, so the next one is a short repeat scan. */
  scanned: boolean;
  scan: Promise<void> | undefined;
  nextSyncFailure: string | undefined;
};

type ScanStep = { stage: ShieldedSyncStage; progress: number };

const ramp = (stage: ShieldedSyncStage, from: number, to: number, count: number): Array<ScanStep> =>
  Array.from({ length: count }, (_, i) => ({
    stage,
    progress: from + ((to - from) * i) / (count - 1),
  }));

/**
 * The progress a first scan reports, as the SDK did: the first pass climbs
 * to 0.87, falls back to 0.20 and climbs again, then the second pass starts
 * over from 0.
 */
const FIRST_SCAN = [
  ...ramp("notes", 0, 0.87, 14),
  ...ramp("notes", 0.2, 1, 14),
  ...ramp("transactions", 0, 1, 8),
];
const REPEAT_SCAN = [...ramp("notes", 0, 1, 3), ...ramp("transactions", 0, 1, 2)];

const IDLE: ShieldedSync = Object.freeze({ stage: "notes", status: "idle", progress: 0 });

/**
 * A 127-character `0zk` address with a valid checksum, so it passes
 * `isShieldedAddress`. The payload is noise derived from the seed: it
 * holds no keys.
 */
function mockAddress(seed: string) {
  let state = 2_166_136_261;
  for (let i = 0; i < seed.length; i++) {
    state = Math.imul(state ^ seed.charCodeAt(i), 16_777_619);
  }
  // 117 five-bit words. The first is 0, as in a real address (version byte 01).
  const words = [0];
  while (words.length < 117) {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) | 0;
    words.push((state >>> 27) & 31);
  }
  return encodeBech32m("0zk", words);
}

function toBalances(notes: ReadonlyArray<Note>): Array<ShieldedTokenBalance> {
  const byToken = new Map<
    string,
    { token: Address; amounts: Record<ShieldedBalanceState, bigint> }
  >();
  for (const note of notes) {
    const key = note.token.toLowerCase();
    let balance = byToken.get(key);
    if (!balance) {
      balance = {
        token: note.token,
        amounts: { spendable: 0n, pending: 0n, proving: 0n, incomplete: 0n, restricted: 0n },
      };
      byToken.set(key, balance);
    }
    balance.amounts[note.state] += note.amount;
  }
  return [...byToken.values()];
}

function sameBalances(
  a: ReadonlyArray<ShieldedTokenBalance>,
  b: ReadonlyArray<ShieldedTokenBalance>,
) {
  return (
    a.length === b.length &&
    a.every(
      (balance, i) =>
        balance.token === b[i]!.token &&
        SHIELDED_BALANCE_STATES.every((state) => balance.amounts[state] === b[i]!.amounts[state]),
    )
  );
}

/**
 * An in-memory ShieldedEngine: no network, no cryptography, no real funds.
 * It behaves the way the Railgun SDK did on Sepolia, awkward parts included:
 *
 * - a scan runs in two passes, its progress goes backwards, and the final
 *   event carries progress 0;
 * - balances only change when a scan finishes, and arrive as one snapshot;
 * - shielded funds wait out a standby period, and change from a spend can
 *   get stuck as `incomplete`;
 * - proofs report stages, and the first one downloads the circuits;
 * - shield and unshield each take 25 bps.
 *
 * Use it for demos, tests and building UI before a real engine is wired up.
 * `simulate` makes things happen that would otherwise need a chain.
 */
export function createMockShieldedEngine({
  speed = 1,
  timings: timingOverrides,
  account: initialAccount = "locked",
  password: initialPassword = "password",
  chains: autoChains = [1],
  funds = [],
  circuitsCached = false,
  shieldSignature = true,
}: MockShieldedEngineOptions = {}): MockShieldedEngine {
  if (!(speed > 0)) {
    throw new RangeError("speed must be greater than 0.");
  }

  const timings = { ...MOCK_TIMINGS, ...timingOverrides };
  const defaultChain = autoChains[0] ?? 1;

  const listeners: Record<ShieldedEvent, Set<() => void>> = {
    account: new Set(),
    sync: new Set(),
    balances: new Set(),
  };
  const emit = (event: ShieldedEvent) => {
    for (const listener of listeners[event]) {
      listener();
    }
  };

  let status: ShieldedAccountStatus = initialAccount;
  let password = initialAccount === "locked" ? initialPassword : undefined;
  let address = mockAddress(MOCK_MNEMONIC);
  /** Goes up on every lock. Work that started in an older session stops when it notices. */
  let session = 0;
  let circuitsLoaded = circuitsCached;
  let proofCount = 0;
  let keepIncomplete = false;
  let nextProofFailure: string | undefined;
  let nextRetryFailure: string | undefined;

  const chainStates = new Map<number, ChainState>();
  function chainOf(chainId: number) {
    let chain = chainStates.get(chainId);
    if (!chain) {
      chain = {
        notes: funds
          .filter((fund) => (fund.chainId ?? defaultChain) === chainId)
          .map(({ token, amount, state = "spendable", hash }) => ({ token, amount, state, hash })),
        sync: IDLE,
        balances: undefined,
        transactions: new Map(),
        scanned: false,
        scan: undefined,
        nextSyncFailure: undefined,
      };
      chainStates.set(chainId, chain);
    }
    return chain;
  }

  function wait(ms: number, signal?: AbortSignal) {
    const delay = ms / speed;
    return new Promise<void>((resolve, reject) => {
      if (signal?.aborted) {
        reject(signal.reason);
        return;
      }
      // Nothing to wait for: stay on the microtask queue, so at
      // `speed: Infinity` a whole flow finishes without a single timer.
      if (!(delay >= 1)) {
        resolve();
        return;
      }
      const onAbort = () => {
        clearTimeout(timer);
        reject(signal!.reason);
      };
      const timer = setTimeout(() => {
        signal?.removeEventListener("abort", onAbort);
        resolve();
      }, delay);
      signal?.addEventListener("abort", onAbort, { once: true });
    });
  }

  function setSync(chain: ChainState, sync: ShieldedSync) {
    chain.sync = sync;
    emit("sync");
  }

  async function runScan(chain: ChainState) {
    const started = session;
    const first = !chain.scanned;
    const steps = first ? FIRST_SCAN : REPEAT_SCAN;
    const stepTime = (first ? timings.firstScan : timings.repeatScan) / steps.length;
    const failure = chain.nextSyncFailure;
    chain.nextSyncFailure = undefined;
    // A failing scan gets a third of the way in first, like an RPC that drops out mid-scan.
    const failAt = failure === undefined ? -1 : Math.floor(steps.length / 3);

    for (const [index, step] of steps.entries()) {
      setSync(chain, { ...step, status: "syncing" });
      await wait(stepTime);
      if (started !== session) {
        return;
      }
      if (index === failAt) {
        setSync(chain, { ...step, status: "error", error: failure });
        return;
      }
    }

    chain.scanned = true;
    let changed = false;
    const balances = toBalances(chain.notes);
    if (!chain.balances || !sameBalances(chain.balances, balances)) {
      chain.balances = balances;
      changed = true;
    }
    for (const note of chain.notes) {
      if (!note.hash) {
        continue;
      }
      const key = note.hash.toLowerCase();
      // A new object only when the state moved, so the reference is stable in between.
      if (chain.transactions.get(key)?.state === note.state) {
        continue;
      }
      chain.transactions.set(key, {
        kind: "shield",
        token: note.token,
        amount: note.amount,
        state: note.state,
      });
      changed = true;
    }
    if (changed) {
      emit("balances");
    }
    // The SDK's "complete" event carries progress 0.
    setSync(chain, { stage: "transactions", status: "synced", progress: 0 });
  }

  /** Scan a chain, or join the scan already running. Does nothing while the account is not unlocked. */
  function scan(chainId: number): Promise<void> {
    if (status !== "unlocked") {
      return Promise.resolve();
    }
    const chain = chainOf(chainId);
    if (!chain.scan) {
      const running: Promise<void> = runScan(chain).finally(() => {
        if (chain.scan === running) {
          chain.scan = undefined;
        }
      });
      chain.scan = running;
    }
    return chain.scan;
  }

  /** Change what the account holds after a delay. The change shows up with the next scan. */
  function later(ms: number, chainId: number, change: () => void) {
    void wait(ms).then(() => {
      change();
      return scan(chainId);
    });
  }

  const feeOn = (amount: bigint) => (amount * MOCK_FEE_BPS) / 10_000n;

  function requireUnlocked() {
    if (status !== "unlocked") {
      throw new Error("Unlock the private account first.");
    }
  }

  function requirePassword(value: string) {
    if (!value) {
      throw new Error("Choose a password.");
    }
  }

  /** Drop everything that needs the decrypted account. */
  function close() {
    session++;
    for (const chain of chainStates.values()) {
      chain.sync = IDLE;
      chain.balances = undefined;
      chain.transactions = new Map();
      chain.scan = undefined;
    }
    emit("sync");
    emit("balances");
  }

  function open() {
    status = "unlocked";
    emit("account");
    for (const chainId of autoChains) {
      void scan(chainId);
    }
  }

  async function setAccount(mnemonic: string, newPassword: string) {
    await wait(timings.createAccount);
    if (status === "unlocked") {
      close();
    }
    password = newPassword;
    address = mockAddress(mnemonic);
    open();
  }

  return {
    id: "mock",

    account: {
      status: () => status,
      address: () => (status === "unlocked" ? address : null),
      async create(newPassword) {
        requirePassword(newPassword);
        await setAccount(MOCK_MNEMONIC, newPassword);
        return { mnemonic: MOCK_MNEMONIC };
      },
      async import(mnemonic, newPassword) {
        const words = mnemonic.trim().split(/\s+/);
        if (words.length !== 12 && words.length !== 24) {
          throw new Error("A recovery phrase has 12 or 24 words.");
        }
        requirePassword(newPassword);
        await setAccount(words.join(" "), newPassword);
      },
      async unlock(attempt) {
        if (status === "none") {
          throw new Error("There is no private account to unlock.");
        }
        if (status === "unlocked") {
          return;
        }
        await wait(timings.unlock);
        if (attempt !== password) {
          throw new Error("Wrong password.");
        }
        open();
      },
      lock() {
        if (status !== "unlocked") {
          return;
        }
        status = "locked";
        close();
        emit("account");
      },
    },

    subscribe(event, listener) {
      listeners[event].add(listener);
      return () => {
        listeners[event].delete(listener);
      };
    },

    getSync: (chainId) => chainOf(chainId).sync,
    getBalances: (chainId) => chainOf(chainId).balances,
    getTransaction: (chainId, hash) => chainOf(chainId).transactions.get(hash.toLowerCase()),
    sync: scan,

    // Fees are read once when a real engine starts, so a quote costs nothing.
    async quoteShield(draft) {
      if (draft.amount <= 0n) {
        throw new Error("Enter an amount.");
      }
      const fee = feeOn(draft.amount);
      return {
        fee,
        received: draft.amount - fee,
        standby: Math.round(timings.standby / speed / 1000),
        spender: MOCK_SHIELD_CONTRACT,
        needsSignature: shieldSignature,
      };
    },

    async prepareShield(draft, { sign }) {
      requireUnlocked();
      if (draft.amount <= 0n) {
        throw new Error("Enter an amount.");
      }
      // A real engine turns this signature into a one-off key. The mock only asks for it.
      if (shieldSignature) {
        await sign(MOCK_SHIELD_MESSAGE);
      }
      requireUnlocked();
      return {
        transaction: {
          to: MOCK_SHIELD_CONTRACT,
          data: encodeAbiParameters(
            [{ type: "address" }, { type: "uint256" }],
            [draft.token, draft.amount],
          ),
          value: 0n,
        },
      };
    },

    async retryProofs(chainId) {
      requireUnlocked();
      const started = session;
      const failure = nextRetryFailure;
      nextRetryFailure = undefined;
      await wait(timings.retryProofs);
      if (started !== session) {
        return;
      }
      if (failure !== undefined) {
        throw new Error(failure);
      }
      if (keepIncomplete) {
        return;
      }

      const notes = chainOf(chainId).notes.filter((note) => note.state === "incomplete");
      if (notes.length === 0) {
        return;
      }
      for (const note of notes) {
        note.state = "proving";
      }
      later(timings.settle, chainId, () => {
        for (const note of notes) {
          note.state = "spendable";
        }
      });
      await scan(chainId);
    },

    async prove(draft, { onStage, signal }) {
      requireUnlocked();
      if (signal?.aborted) {
        throw signal.reason;
      }
      if (draft.amount <= 0n) {
        throw new Error("Enter an amount.");
      }
      const spendable = chainOf(draft.chainId)
        .notes.filter((note) => note.state === "spendable" && sameToken(note.token, draft.token))
        .reduce((sum, note) => sum + note.amount, 0n);
      if (spendable < draft.amount) {
        throw new Error("Not enough spendable balance.");
      }

      const started = session;
      const failure = nextProofFailure;
      nextProofFailure = undefined;

      onStage("loading-circuits");
      await wait(circuitsLoaded ? timings.loadCircuits / 20 : timings.loadCircuits, signal);
      circuitsLoaded = true;
      onStage("proving");
      await wait(timings.prove, signal);
      if (failure !== undefined) {
        throw new Error(failure);
      }
      onStage("verifying");
      await wait(timings.verify, signal);
      if (started !== session) {
        throw new Error("The private account was locked.");
      }

      return { id: `mock-proof-${++proofCount}`, draft, expiresAt: Date.now() + PROOF_LIFETIME };
    },

    simulate: {
      async shield({ token, amount, chainId = defaultChain, outcome = "spendable", hash }) {
        const fee = feeOn(amount);
        const note: Note = { token, amount: amount - fee, state: "pending", hash };
        chainOf(chainId).notes.push(note);
        later(timings.standby, chainId, () => {
          note.state = outcome;
        });
        await scan(chainId);
        return { fee, received: note.amount };
      },

      async unshield({ token, amount, chainId = defaultChain, change = "spendable" }) {
        const chain = chainOf(chainId);
        // Spend whole notes, oldest first, until they cover the amount.
        let covered = 0n;
        const spent = new Set<Note>();
        for (const note of chain.notes) {
          if (covered >= amount) {
            break;
          }
          if (note.state !== "spendable" || !sameToken(note.token, token)) {
            continue;
          }
          spent.add(note);
          covered += note.amount;
        }
        if (amount <= 0n || covered < amount) {
          throw new Error("Not enough spendable balance.");
        }
        chain.notes = chain.notes.filter((note) => !spent.has(note));

        if (covered > amount) {
          const note: Note = { token, amount: covered - amount, state: "proving" };
          chain.notes.push(note);
          later(timings.settle, chainId, () => {
            note.state = change;
          });
        }
        await scan(chainId);
        const fee = feeOn(amount);
        return { fee, received: amount - fee };
      },

      addFunds({ token, amount, state = "spendable", chainId = defaultChain, hash }) {
        chainOf(chainId).notes.push({ token, amount, state, hash });
        return scan(chainId);
      },

      failNextSync(message = "Couldn't reach the RPC while scanning.", chainId = defaultChain) {
        chainOf(chainId).nextSyncFailure = message;
      },
      failNextProof(message = "Proof generation failed.") {
        nextProofFailure = message;
      },
      failNextRetry(message = "Couldn't generate the missing proofs.") {
        nextRetryFailure = message;
      },
      keepIncomplete(keep = true) {
        keepIncomplete = keep;
      },
    },
  };
}

const sameToken = (a: Address, b: Address) => a.toLowerCase() === b.toLowerCase();
