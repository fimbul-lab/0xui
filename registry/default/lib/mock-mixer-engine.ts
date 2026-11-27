// Docs: https://0xui.io/components/mock-mixer-engine.md
import { encodeAbiParameters, formatUnits, keccak256, toHex } from "viem";
import type { Hash, Hex } from "viem";
import { sameMixerPool } from "@/lib/mixer-engine";
import type {
  MixerDeposit,
  MixerEngine,
  MixerNote,
  MixerPool,
  MixerQuote,
  MixerStage,
  MixerWithdrawal,
} from "@/lib/mixer-engine";

/** How long things take, in ms, before `speed` is applied. Guesses, not measurements. */
export const MOCK_MIXER_TIMINGS = {
  /** Reading the pool's deposit history. First proof per pool only; later ones take a tenth. */
  sync: 5000,
  /** Downloading the circuit files. First proof only; later proofs take a twentieth. */
  loadCircuits: 4000,
  /** Generating the proof. */
  prove: 8000,
  /** Verifying the proof. */
  verify: 1000,
  /** Looking a note up on chain. */
  lookup: 600,
};

export type MockMixerTimings = typeof MOCK_MIXER_TIMINGS;

/** The mock's pools: 0.1, 1 and 10 ETH on Ethereum. No contract lives at these addresses. */
export const MOCK_MIXER_POOLS: ReadonlyArray<MixerPool> = [
  ["0x00000000000000000000000000000000000a1ce1", 10n ** 17n],
  ["0x00000000000000000000000000000000000a1ce2", 10n ** 18n],
  ["0x00000000000000000000000000000000000a1ce3", 10n ** 19n],
].map(([address, denomination]) => ({
  chainId: 1,
  address: address as `0x${string}`,
  symbol: "ETH",
  decimals: 18,
  denomination: denomination as bigint,
}));

/** What a mock note starts with. A real protocol's note never does. */
export const MOCK_NOTE_PREFIX = "mock-note";

export type MockMixerEngineOptions = {
  /**
   * Divides every delay. 1 is real time, 10 is ten times faster, and
   * `Infinity` skips timers altogether so tests can simply `await`.
   */
  speed?: number;
  /** Override single delays, in ms. */
  timings?: Partial<MockMixerTimings>;
  /** Defaults to MOCK_MIXER_POOLS. */
  pools?: ReadonlyArray<MixerPool>;
  /** Deposits each pool already holds, so a new one has a crowd behind it. */
  existingDeposits?: number;
  /** The relayer's cut, in basis points. Pass false for an engine with no relayer. */
  relayerFeeBps?: number | false;
  /**
   * Stand in for the relayer: return the hash `relay` resolves with. By
   * default it is made up, and no chain knows it, so anything that waits for
   * its receipt waits forever.
   */
  relay?: (withdrawal: MixerWithdrawal) => Hash | Promise<Hash>;
};

/** Controls that only the mock has. */
export type MockMixerSimulate = {
  /**
   * The deposit for a commitment was mined. A real engine reads this from
   * the chain; the mock is told. Returns false if it was already known.
   */
  deposit(commitment: Hex): boolean;
  /** Other people deposit into the pool, growing the crowd. */
  crowd(pool: MixerPool, deposits: number): void;
  /** A withdrawal the wallet sent was mined: its note is spent. */
  withdrawn(withdrawal: MixerWithdrawal): void;
  /** The next proof fails while proving. */
  failNextProof(message?: string): void;
  /** The next read of the deposit history fails. */
  failNextSync(message?: string): void;
  /** The next `relay` is refused. */
  failNextRelay(message?: string): void;
};

export type MockMixerEngine = MixerEngine & { simulate: MockMixerSimulate };

const aborted = () => new DOMException("The proof was cancelled.", "AbortError");

/**
 * A mixer engine that lives in memory. Notes are random, proofs are waits,
 * and nothing touches a chain. For docs, demos and tests.
 */
export function createMockMixerEngine({
  speed = 1,
  timings: overrides,
  pools = MOCK_MIXER_POOLS,
  existingDeposits = 1200,
  relayerFeeBps = 30,
  relay,
}: MockMixerEngineOptions = {}): MockMixerEngine {
  if (!(speed > 0)) {
    throw new RangeError("speed must be greater than 0.");
  }
  const timings = { ...MOCK_MIXER_TIMINGS, ...overrides };

  const poolKey = (pool: MixerPool) => `${pool.chainId}:${pool.address.toLowerCase()}`;
  /** Deposits in each pool so far. */
  const counts = new Map(pools.map((pool) => [poolKey(pool), existingDeposits]));
  const deposits = new Map<Hex, { pool: MixerPool; index: number; timestamp: number }>();
  const spent = new Set<Hex>();
  /** The pool of every note read so far. A commitment alone doesn't say. */
  const made = new Map<Hex, MixerPool>();
  /** Proofs made, by withdrawal id. Holds the commitment so the withdrawal object doesn't. */
  const proofs = new Map<string, { commitment: Hex; relayed: boolean }>();
  const synced = new Set<string>();
  let circuitsLoaded = false;
  let nextId = 0;
  const failures: { proof?: string; sync?: string; relay?: string } = {};

  const sleep = (ms: number, signal?: AbortSignal) => {
    if (signal?.aborted) {
      return Promise.reject(aborted());
    }
    const delay = ms / speed;
    if (!(delay > 0)) {
      return Promise.resolve();
    }
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        signal?.removeEventListener("abort", stop);
        resolve();
      }, delay);
      const stop = () => {
        clearTimeout(timer);
        reject(aborted());
      };
      signal?.addEventListener("abort", stop, { once: true });
    });
  };

  const known = (pool: MixerPool) => pools.find((candidate) => sameMixerPool(candidate, pool));

  const read = (text: string): MixerNote => {
    const match = /^mock-note-([a-z0-9]+)-([0-9.]+)-(\d+)-(0x[0-9a-f]{124})$/.exec(text.trim());
    if (!match) {
      throw new Error(
        text.trim() ? "This is not a note. Paste the whole text you saved." : "Paste your note.",
      );
    }
    const [note, symbol, amount, chainId, secret] = match;
    const pool = pools.find(
      (candidate) =>
        candidate.chainId === Number(chainId) &&
        candidate.symbol.toLowerCase() === symbol &&
        formatUnits(candidate.denomination, candidate.decimals) === amount,
    );
    if (!pool) {
      throw new Error(`This note is for a pool that is not offered here.`);
    }
    const commitment = keccak256(secret as Hex);
    made.set(commitment, pool);
    return { note, pool, commitment };
  };

  const quoteFor = (pool: MixerPool, via: "wallet" | "relayer"): MixerQuote => {
    if (via === "wallet") {
      return { fee: 0n, received: pool.denomination };
    }
    if (relayerFeeBps === false) {
      throw new Error("No relayer is set up for this pool.");
    }
    const fee = (pool.denomination * BigInt(relayerFeeBps)) / 10_000n;
    return { fee, received: pool.denomination - fee };
  };

  const lookup = (commitment: Hex): MixerDeposit => {
    const deposit = deposits.get(commitment);
    if (!deposit) {
      return { state: "missing" };
    }
    return {
      state: spent.has(commitment) ? "withdrawn" : "deposited",
      timestamp: deposit.timestamp,
      depositsSince: counts.get(poolKey(deposit.pool))! - deposit.index - 1,
    };
  };

  return {
    id: "mock-mixer",
    pools,
    relays: relayerFeeBps !== false,

    async createNote(pool) {
      const target = known(pool);
      if (!target) {
        throw new Error("This pool is not offered here.");
      }
      const secret = toHex(crypto.getRandomValues(new Uint8Array(62)));
      const amount = formatUnits(target.denomination, target.decimals);
      return read(
        `${MOCK_NOTE_PREFIX}-${target.symbol.toLowerCase()}-${amount}-${target.chainId}-${secret}`,
      );
    },

    async parseNote(text) {
      return read(text);
    },

    async prepareDeposit(note) {
      const { pool, commitment } = read(note);
      return {
        to: pool.address,
        data: encodeAbiParameters([{ type: "bytes32" }], [commitment]),
        value: pool.token ? undefined : pool.denomination,
      };
    },

    async getDeposit(note, { signal } = {}) {
      const { commitment } = read(note);
      await sleep(timings.lookup, signal);
      return lookup(commitment);
    },

    async quote(pool, via) {
      return quoteFor(pool, via);
    },

    async prove(draft, { onStage, signal }) {
      const { pool, commitment } = read(draft.note);
      const quote = quoteFor(pool, draft.via);
      const stage = async (name: MixerStage, ms: number) => {
        if (signal?.aborted) {
          throw aborted();
        }
        onStage(name);
        await sleep(ms, signal);
      };

      const key = poolKey(pool);
      await stage("syncing", synced.has(key) ? timings.sync / 10 : timings.sync);
      if (failures.sync) {
        const message = failures.sync;
        failures.sync = undefined;
        throw new Error(message);
      }
      synced.add(key);
      const deposit = lookup(commitment);
      if (deposit.state === "missing") {
        throw new Error("No deposit was found for this note.");
      }
      if (deposit.state === "withdrawn") {
        throw new Error("This note was already withdrawn.");
      }

      await stage(
        "loading-circuits",
        circuitsLoaded ? timings.loadCircuits / 20 : timings.loadCircuits,
      );
      circuitsLoaded = true;
      await stage("proving", timings.prove);
      if (failures.proof) {
        const message = failures.proof;
        failures.proof = undefined;
        throw new Error(message);
      }
      await stage("verifying", timings.verify);
      if (signal?.aborted) {
        throw aborted();
      }

      const id = `mock-withdrawal-${++nextId}`;
      proofs.set(id, { commitment, relayed: false });
      return {
        id,
        pool,
        recipient: draft.recipient,
        via: draft.via,
        quote,
        transaction: {
          to: pool.address,
          data: encodeAbiParameters(
            [{ type: "address" }, { type: "uint256" }],
            [draft.recipient, quote.fee],
          ),
        },
      };
    },

    async relay(withdrawal) {
      const proof = proofs.get(withdrawal.id);
      if (!proof || withdrawal.via !== "relayer") {
        throw new Error("This withdrawal was not made for a relayer.");
      }
      if (proof.relayed) {
        throw new Error("This withdrawal was already sent.");
      }
      if (failures.relay) {
        const message = failures.relay;
        failures.relay = undefined;
        throw new Error(message);
      }
      if (spent.has(proof.commitment)) {
        throw new Error("This note was already withdrawn.");
      }
      proof.relayed = true;
      const hash = relay
        ? await relay(withdrawal)
        : keccak256(toHex(`${withdrawal.id}:${Date.now()}`));
      spent.add(proof.commitment);
      return { hash };
    },

    simulate: {
      deposit(commitment) {
        if (deposits.has(commitment)) {
          return false;
        }
        const pool = made.get(commitment) ?? pools[0]!;
        const key = poolKey(pool);
        const index = counts.get(key) ?? 0;
        counts.set(key, index + 1);
        deposits.set(commitment, { pool, index, timestamp: Math.floor(Date.now() / 1000) });
        return true;
      },
      crowd(pool, more) {
        const key = poolKey(pool);
        counts.set(key, (counts.get(key) ?? 0) + more);
      },
      withdrawn(withdrawal) {
        const proof = proofs.get(withdrawal.id);
        if (proof) {
          spent.add(proof.commitment);
        }
      },
      failNextProof(message = "The prover ran out of memory.") {
        failures.proof = message;
      },
      failNextSync(message = "The pool's deposits could not be read.") {
        failures.sync = message;
      },
      failNextRelay(message = "The relayer refused the withdrawal.") {
        failures.relay = message;
      },
    },
  };
}
