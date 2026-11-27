// Docs: https://0xui.io/components/tornado-engine.md
import {
  createPublicClient,
  encodeFunctionData,
  formatUnits,
  hexToBytes,
  http,
  isAddress,
  parseAbi,
  toHex,
  zeroAddress,
} from "viem";
import type { Address, Hash, Hex } from "viem";
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

/** A classic Tornado instance: `ETHTornado` or `ERC20Tornado`. */
export type TornadoPool = MixerPool & {
  /** Block the pool was deployed in. Deposits are read from here. */
  deploymentBlock: bigint;
};

/**
 * Sends withdrawals for a fee, so the recipient needs no gas. The proof
 * commits to `address` and to the fee from `quote`.
 */
export type TornadoRelayer = {
  /** The address the fee is paid to. */
  address: Address | (() => Promise<Address>);
  /** The fee for one withdrawal from `pool`, in the pool's token. */
  quote(pool: TornadoPool): Promise<bigint>;
  /** Broadcast the withdrawal. Resolves with the transaction's hash. */
  send(request: { pool: TornadoPool; proof: Hex; args: TornadoWithdrawArgs }): Promise<Hash>;
};

/** `root, nullifierHash, recipient, relayer, fee, refund`: what the proof commits to. */
export type TornadoWithdrawArgs = readonly [Hex, Hex, Address, Address, bigint, bigint];

/** The chain reads the engine makes. A viem public client fits. */
export type TornadoClient = {
  getBlockNumber(): Promise<bigint>;
  getLogs(parameters: {
    address: Address;
    event: (typeof TORNADO_ABI)[0];
    fromBlock: bigint;
    toBlock: bigint;
  }): Promise<
    ReadonlyArray<{
      blockNumber: bigint | null;
      args: { commitment?: Hex; leafIndex?: number; timestamp?: bigint };
    }>
  >;
  readContract(parameters: {
    address: Address;
    abi: typeof TORNADO_ABI;
    functionName: "isSpent" | "isKnownRoot" | "commitments" | "nextIndex";
    args?: readonly [Hex];
  }): Promise<unknown>;
  call(parameters: { to: Address; data: Hex }): Promise<unknown>;
};

/** Keeps a pool's deposits between page loads. */
export type TornadoCache = {
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string): Promise<void>;
};

export type TornadoEngineOptions = {
  pools: ReadonlyArray<TornadoPool>;
  /** One entry per chain the pools are on. */
  chains: Record<number, { rpcUrl: string; relayer?: TornadoRelayer; blockRange?: number }>;
  /**
   * Where the circuit files are served from, needed to withdraw:
   * `tornado.json` (19 MB) and `tornadoProvingKey.bin` (14 MB), the files
   * of the original trusted setup. Each is checked against a hash the engine
   * ships with, so the host does not have to be trusted.
   */
  circuitsUrl?: string;
  /** Chain reads. Defaults to a viem client on the chain's `rpcUrl`. */
  client?: (chainId: number) => TornadoClient;
  /**
   * Keeps deposits between page loads. Defaults to IndexedDB where there is
   * one. Pass `false` to read everything again on every load.
   */
  cache?: TornadoCache | false;
  /** HTTP for the circuit files. Defaults to the global `fetch`. */
  fetch?: typeof fetch;
};

export const TORNADO_ABI = parseAbi([
  "event Deposit(bytes32 indexed commitment, uint32 leafIndex, uint256 timestamp)",
  "function deposit(bytes32 _commitment) payable",
  "function withdraw(bytes _proof, bytes32 _root, bytes32 _nullifierHash, address _recipient, address _relayer, uint256 _fee, uint256 _refund) payable",
  "function isSpent(bytes32 _nullifierHash) view returns (bool)",
  "function isKnownRoot(bytes32 _root) view returns (bool)",
  "function commitments(bytes32) view returns (bool)",
  "function nextIndex() view returns (uint32)",
]);

/** The circuit files and their SHA-256, as published with tornado-core v2.1. */
export const TORNADO_CIRCUIT_FILES = {
  circuit: {
    name: "tornado.json",
    sha256: "3ddd61dbff09caeec82d8edde95c674a3c34f9e66b1fe9f2c8783e72fe536f98",
  },
  provingKey: {
    name: "tornadoProvingKey.bin",
    sha256: "8e2d2f22beafb5a9666daebca57b13f8029c3656c65fcfbcc86e2418fa16a3af",
  },
} as const;

/** The Sepolia test pools. Same verifier as mainnet, so the same circuit files. */
export const TORNADO_SEPOLIA_POOLS: ReadonlyArray<TornadoPool> = (
  [
    ["0x0E999C5285141ccB6dFaE68A0921F37ABd3e6A87", 10n ** 16n],
    ["0x8C4A04d872a6C1BE37964A21ba3a138525dFF50b", 10n ** 17n],
    ["0x8cc930096B4Df705A007c4A039BDFA1320Ed2508", 10n ** 18n],
  ] as const
).map(([address, denomination]) => ({
  chainId: 11_155_111,
  address,
  symbol: "ETH",
  decimals: 18,
  denomination,
  deploymentBlock: 5_594_000n,
}));

const TREE_LEVELS = 20;
/** keccak256("tornado") mod the field: what an empty leaf holds. */
const ZERO_LEAF =
  21_663_839_004_416_932_945_382_355_908_790_599_225_266_501_822_907_911_457_504_978_515_578_255_421_292n;
/** Blocks behind the head that are taken as final, and so kept in the cache. */
const FINALITY = 64n;
/** `eth_getLogs` requests in flight at once. */
const LOG_REQUESTS = 3;
const RATE_LIMIT_RETRIES = 6;
const RATE_LIMIT_WAIT = 1000;

const lower = (value: string) => value.toLowerCase();
const aborted = () => new DOMException("The proof was cancelled.", "AbortError");

/** True when an RPC refused a request for coming too fast, not for what it asked. */
function isRateLimit(cause: unknown) {
  const { status, code, message, details } = cause as {
    status?: number;
    code?: number;
    message?: string;
    details?: string;
  };
  return (
    status === 429 ||
    code === -32_005 ||
    /rate limit|too many requests|429/i.test(`${details ?? ""} ${message ?? ""}`)
  );
}

/** A cache in IndexedDB, or undefined where there is none. */
function browserCache(): TornadoCache | undefined {
  if (typeof indexedDB === "undefined") {
    return undefined;
  }
  const run = async <T>(
    mode: IDBTransactionMode,
    work: (store: IDBObjectStore) => IDBRequest<T>,
  ) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("0xui.tornado", 1);
      request.onupgradeneeded = () => request.result.createObjectStore("deposits");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise<T>((resolve, reject) => {
        const request = work(database.transaction("deposits", mode).objectStore("deposits"));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    } finally {
      database.close();
    }
  };
  return {
    get: (key) => run<string | undefined>("readonly", (store) => store.get(key)),
    set: async (key, value) => void (await run("readwrite", (store) => store.put(value, key))),
  };
}

const littleEndian = (bytes: Uint8Array) =>
  bytes.reduceRight((value, byte) => (value << 8n) | BigInt(byte), 0n);

const loadHashes = async () => {
  const [pedersen, mimc] = await Promise.all([
    import("micro-zk-proofs/pedersen.js"),
    import("micro-zk-proofs/mimcsponge.js"),
  ]);
  /** Pedersen hash on Baby Jubjub, as the circuit does it: the x coordinate of the point. */
  const pedersenX = (bytes: Uint8Array) =>
    (
      pedersen.Point.decode(pedersen.pedersenHash(bytes)) as { toAffine(): { x: bigint } }
    ).toAffine().x;
  /** One node of the deposit tree: MiMC sponge over its two children. */
  const node = (left: bigint, right: bigint) => mimc.multiHash([left, right]) as bigint;
  return { pedersenX, node };
};

/** The secret and public parts of a note's 62 random bytes. */
export async function tornadoNoteHashes(preimage: Uint8Array) {
  if (preimage.length !== 62) {
    throw new Error("A note holds 62 bytes.");
  }
  const { pedersenX } = await loadHashes();
  const nullifier = preimage.subarray(0, 31);
  return {
    nullifier: littleEndian(nullifier),
    secret: littleEndian(preimage.subarray(31)),
    commitment: toHex(pedersenX(preimage), { size: 32 }),
    nullifierHash: toHex(pedersenX(nullifier), { size: 32 }),
  };
}

/** Root of the deposit tree and the path from one leaf up to it. */
export async function tornadoMerklePath(leaves: ReadonlyArray<bigint>, index: number) {
  const { node } = await loadHashes();
  const pathElements: Array<bigint> = [];
  const pathIndices: Array<number> = [];
  let level = [...leaves];
  let zero = ZERO_LEAF;
  let position = index;
  for (let depth = 0; depth < TREE_LEVELS; depth++) {
    pathIndices.push(position & 1);
    pathElements.push(level[position ^ 1] ?? zero);
    const next: Array<bigint> = [];
    for (let i = 0; i < level.length; i += 2) {
      next.push(node(level[i]!, level[i + 1] ?? zero));
    }
    level = next;
    zero = node(zero, zero);
    position >>= 1;
  }
  return { root: level[0] ?? zero, pathElements, pathIndices };
}

type ProofSystem = Awaited<ReturnType<typeof loadProver>>;

/**
 * The proving key file, read into the shape the prover takes. The file is
 * websnark's: little-endian, field elements in Montgomery form, and no C
 * polynomials. Layout as in the Ethereum Foundation's Kohaku (MIT).
 */
async function loadProver(circuit: unknown, key: ArrayBuffer) {
  const [zkp, witness, { bn254 }] = await Promise.all([
    import("micro-zk-proofs"),
    import("micro-zk-proofs/witness.js"),
    import("@noble/curves/bn254.js"),
  ]);
  type G1 = [bigint, bigint, bigint];
  type G2 = [[bigint, bigint], [bigint, bigint], [bigint, bigint]];
  const { Fp, Fr } = bn254.fields;
  const fpInverse = Fp.inv(2n ** 256n % Fp.ORDER);
  const frInverse = Fr.inv(2n ** 256n % Fr.ORDER);
  const view = new DataView(key);
  const bytes = new Uint8Array(key);
  const field = (offset: number, inverse: bigint, f: typeof Fp) =>
    f.mul(littleEndian(bytes.subarray(offset, offset + 32)), inverse);
  const fp = (offset: number) => field(offset, fpInverse, Fp);

  // The point at infinity is written as (0, 1). The prover wants null there.
  const g1 = (offset: number): G1 => {
    const [x, y] = [fp(offset), fp(offset + 32)];
    return (x === 0n && y === 1n ? null : [x, y, 1n]) as G1;
  };
  const g2 = (offset: number): G2 => {
    const [x0, x1, y0, y1] = [fp(offset), fp(offset + 32), fp(offset + 64), fp(offset + 96)];
    return (
      x0 === 0n && x1 === 0n && y0 === 1n && y1 === 0n
        ? null
        : [
            [x0, x1],
            [y0, y1],
            [1n, 0n],
          ]
    ) as G2;
  };
  const u32 = (offset: number) => view.getUint32(offset, true);

  const [nVars, nPublic, domainSize] = [u32(0), u32(4), u32(8)];
  const [polsA, polsB, pointsA, pointsB1, pointsB2, pointsC, hExps] = [
    u32(12),
    u32(16),
    u32(20),
    u32(24),
    u32(28),
    u32(32),
    u32(36),
  ];
  const polynomials = (start: number) => {
    const list: Array<Record<number, bigint>> = [];
    let offset = start;
    for (let signal = 0; signal < nVars; signal++) {
      const entries = u32(offset);
      offset += 4;
      const polynomial: Record<number, bigint> = {};
      for (let entry = 0; entry < entries; entry++) {
        const coefficient = field(offset + 4, frInverse, Fr);
        if (coefficient !== 0n) {
          polynomial[u32(offset)] = coefficient;
        }
        offset += 36;
      }
      list.push(polynomial);
    }
    return list;
  };
  const points = <T>(read: (offset: number) => T, start: number, count: number, size: number) =>
    Array.from({ length: count }, (_, i) => read(start + i * size));

  const provingKey = {
    nVars,
    nPublic,
    domainSize,
    domainBits: Math.log2(domainSize),
    polsA: polynomials(polsA),
    polsB: polynomials(polsB),
    // Not in the file, and not needed: C only touches the half of the quotient that is dropped.
    polsC: Array.from({ length: nVars }, () => ({})),
    A: points(g1, pointsA, nVars, 64),
    B1: points(g1, pointsB1, nVars, 64),
    B2: points(g2, pointsB2, nVars, 128),
    C: [
      ...Array.from({ length: nPublic + 1 }, () => null as unknown as G1),
      ...points(g1, pointsC, nVars - nPublic - 1, 64),
    ],
    hExps: points(g1, hExps, domainSize - 1, 64),
    vk_alfa_1: g1(40),
    vk_beta_1: g1(104),
    vk_delta_1: g1(168),
    vk_beta_2: g2(232),
    vk_delta_2: g2(360),
  };
  // The key was made with a non-residue of 7. The library's default of 5
  // gives other roots of unity, and proofs the verifier refuses.
  // The two heavy sums run in worker threads where the bundler can start them.
  let workers: { bn254_msmG1?: never; bn254_msmG2?: never } = {};
  try {
    workers = (await import("micro-zk-proofs/msm.js")).initMSM().methods;
  } catch {
    // No workers here. The proof still works, on this thread, several times slower.
  }
  const { groth } = zkp.buildSnark(bn254, {
    nqr: 7,
    G1msm: workers.bn254_msmG1,
    G2msm: workers.bn254_msmG2,
  });
  const makeWitness = witness.generateWitness(circuit);

  return async (inputs: Record<string, bigint | Array<bigint> | Array<number>>): Promise<Hex> => {
    const { proof } = await groth.createProof(provingKey, makeWitness(inputs));
    // The verifier reads each G2 coordinate real part first.
    const words = zkp.stringBigints.decode([
      proof.pi_a[0],
      proof.pi_a[1],
      proof.pi_b[0][1],
      proof.pi_b[0][0],
      proof.pi_b[1][1],
      proof.pi_b[1][0],
      proof.pi_c[0],
      proof.pi_c[1],
    ]) as Array<bigint>;
    return `0x${words.map((word) => word.toString(16).padStart(64, "0")).join("")}`;
  };
}

/** One line saying why. viem's full message carries the whole request. */
function reason(cause: unknown) {
  const { details, shortMessage, message } = cause as {
    details?: string;
    shortMessage?: string;
    message?: string;
  };
  return details || shortMessage || message || String(cause);
}

type PoolState = {
  /** Commitments in leaf order, from final blocks. */
  leaves: Array<Hex>;
  /** When each was deposited, in seconds, in the same order. */
  times: Array<number>;
  /** The last final block read. */
  syncedTo?: bigint;
  cacheRead?: boolean;
  /** The cache holds this session's read. */
  saved?: boolean;
  /** The read in progress. Later callers wait for it, then read what came since. */
  reading?: Promise<{ leaves: Array<Hex>; times: Array<number> }>;
};

/**
 * A mixer engine on classic Tornado Cash instances (`ETHTornado`,
 * `ERC20Tornado`) and forks with the same contracts and circuit. Notes are
 * the original format, so a note made here withdraws in any Tornado client,
 * and the other way round.
 */
export function createTornadoEngine({
  pools,
  chains,
  circuitsUrl,
  client: clientOption,
  cache: cacheOption,
  fetch: request = (...args) => fetch(...args),
}: TornadoEngineOptions): MixerEngine {
  const clients = new Map<number, TornadoClient>();
  const client = (chainId: number) => {
    let reader = clients.get(chainId);
    if (!reader) {
      const chain = chains[chainId];
      if (!chain) {
        throw new Error(`Chain ${chainId} is not set up.`);
      }
      reader =
        clientOption?.(chainId) ??
        (createPublicClient({ transport: http(chain.rpcUrl) }) as TornadoClient);
      clients.set(chainId, reader);
    }
    return reader;
  };
  const cache = cacheOption === false ? undefined : (cacheOption ?? browserCache());
  const states = new Map<string, PoolState>();
  const stateOf = (pool: TornadoPool) => {
    const key = `${pool.chainId}:${lower(pool.address)}@${pool.deploymentBlock}`;
    let state = states.get(key);
    if (!state) {
      states.set(key, (state = { leaves: [], times: [] }));
    }
    return { key, state };
  };
  const known = (pool: MixerPool) => pools.find((candidate) => sameMixerPool(candidate, pool));
  const read = <T>(
    pool: TornadoPool,
    functionName: "isSpent" | "isKnownRoot" | "commitments",
    arg: Hex,
  ) =>
    client(pool.chainId).readContract({
      address: pool.address,
      abi: TORNADO_ABI,
      functionName,
      args: [arg],
    }) as Promise<T>;

  const noteText = (pool: TornadoPool, preimage: Uint8Array) =>
    `tornado-${lower(pool.symbol)}-${formatUnits(pool.denomination, pool.decimals)}-${pool.chainId}-${toHex(preimage)}`;

  async function parse(text: string) {
    const trimmed = text.trim();
    const match = /^tornado-(\w+)-([\d.]+)-(\d+)-0x([0-9a-fA-F]{124})$/.exec(trimmed);
    if (!match) {
      throw new Error(
        trimmed ? "This is not a note. Paste the whole text you saved." : "Paste your note.",
      );
    }
    const [, currency, amount, chainId, hex] = match;
    const pool = pools.find(
      (candidate) =>
        candidate.chainId === Number(chainId) &&
        lower(candidate.symbol) === lower(currency!) &&
        formatUnits(candidate.denomination, candidate.decimals) === amount,
    );
    if (!pool) {
      throw new Error("This note is for a pool that is not offered here.");
    }
    const hashes = await tornadoNoteHashes(hexToBytes(`0x${hex}`));
    return { note: trimmed, pool, ...hashes };
  }

  /** Deposit events over a block range, in chunks, in leaf order. */
  async function fetchDeposits(pool: TornadoPool, from: bigint, to: bigint) {
    const reader = client(pool.chainId);
    const size = BigInt(Math.max(1, chains[pool.chainId]?.blockRange ?? 50_000));
    const found: Array<{ index: number; commitment: Hex; block: bigint; time: number }> = [];
    /** When requests may go out again after a rate limit. Shared by every worker. */
    let resumeAt = 0;

    async function range(fromBlock: bigint, toBlock: bigint, attempt = 0): Promise<void> {
      const wait = resumeAt - Date.now();
      if (wait > 0) {
        await new Promise((resolve) => setTimeout(resolve, wait));
      }
      try {
        const logs = await reader.getLogs({
          address: pool.address,
          event: TORNADO_ABI[0],
          fromBlock,
          toBlock,
        });
        for (const { args, blockNumber } of logs) {
          // A log with no block yet is pending: it counts as newer than anything final.
          found.push({
            index: args.leafIndex!,
            commitment: args.commitment!,
            block: blockNumber ?? toBlock,
            time: Number(args.timestamp ?? 0n),
          });
        }
      } catch (error) {
        if (isRateLimit(error)) {
          // Smaller ranges would only mean more requests. Slow down instead.
          if (attempt >= RATE_LIMIT_RETRIES) {
            throw error;
          }
          resumeAt = Math.max(resumeAt, Date.now() + RATE_LIMIT_WAIT * 2 ** attempt);
          return range(fromBlock, toBlock, attempt + 1);
        }
        if (fromBlock === toBlock) {
          throw error;
        }
        const middle = fromBlock + (toBlock - fromBlock) / 2n;
        await range(fromBlock, middle);
        await range(middle + 1n, toBlock);
      }
    }

    const ranges: Array<[bigint, bigint]> = [];
    for (let start = from; start <= to; start += size) {
      ranges.push([start, start + size - 1n > to ? to : start + size - 1n]);
    }
    let next = 0;
    const worker = async () => {
      while (next < ranges.length) {
        const [start, end] = ranges[next++]!;
        await range(start, end);
      }
    };
    await Promise.all(Array.from({ length: Math.min(LOG_REQUESTS, ranges.length) }, worker));
    return found.sort((a, b) => a.index - b.index);
  }

  /** Every deposit in the pool, in leaf order. Final blocks are read once and kept. */
  function deposits(pool: TornadoPool): Promise<{ leaves: Array<Hex>; times: Array<number> }> {
    const { key, state } = stateOf(pool);
    const start = async () => {
      if (cache && !state.cacheRead) {
        state.cacheRead = true;
        try {
          const stored = await cache.get(`deposits:${key}`);
          const saved =
            stored &&
            (JSON.parse(stored) as { syncedTo: string; leaves: Array<Hex>; times: Array<number> });
          if (
            saved &&
            Array.isArray(saved.leaves) &&
            saved.times?.length === saved.leaves.length &&
            state.syncedTo === undefined
          ) {
            state.leaves = saved.leaves;
            state.times = saved.times;
            state.syncedTo = BigInt(saved.syncedTo);
          }
        } catch {
          // Unreadable or from another version. The chain is read instead.
        }
      }
      const head = await client(pool.chainId).getBlockNumber();
      const final = head > FINALITY ? head - FINALITY : 0n;
      const from = state.syncedTo === undefined ? pool.deploymentBlock : state.syncedTo + 1n;
      const fresh = from <= head ? await fetchDeposits(pool, from, head) : [];

      // Leaves are numbered. A gap means the RPC left out an event.
      const all = [...state.leaves];
      const times = [...state.times];
      let settled = all.length;
      for (const { index, commitment, block, time } of fresh) {
        if (index < all.length) {
          continue;
        }
        if (index !== all.length) {
          throw new Error(
            "The RPC left out some of the pool's deposits. Try again, or use another RPC.",
          );
        }
        all.push(commitment);
        times.push(time);
        if (block <= final) {
          settled = all.length;
        }
      }
      if (final >= from) {
        // Only what is final is kept. The newest blocks are read again next time.
        const grew = settled > state.leaves.length;
        state.leaves = all.slice(0, settled);
        state.times = times.slice(0, settled);
        state.syncedTo = final;
        if (grew || !state.saved) {
          state.saved = true;
          void cache
            ?.set(
              `deposits:${key}`,
              JSON.stringify({ syncedTo: `${final}`, leaves: state.leaves, times: state.times }),
            )
            .catch(() => {
              // A full or blocked disk only costs the next load a longer read.
            });
        }
      }
      return { leaves: all, times };
    };
    const waitFor = state.reading;
    const reading = (waitFor ? waitFor.catch(() => undefined).then(start) : start()).finally(() => {
      if (state.reading === reading) {
        state.reading = undefined;
      }
    });
    state.reading = reading;
    return reading;
  }

  let files: Promise<ProofSystem> | undefined;
  /** Download the circuit files once, check their hashes, and build the prover. */
  function prover() {
    if (!circuitsUrl) {
      return Promise.reject(
        new Error("Set `circuitsUrl` to withdraw: the prover needs the circuit files."),
      );
    }
    files ??= (async () => {
      const base = circuitsUrl.endsWith("/") ? circuitsUrl : `${circuitsUrl}/`;
      const download = async ({ name, sha256 }: { name: string; sha256: string }) => {
        const response = await request(
          new URL(name, new URL(base, globalThis.location?.href)).href,
        );
        if (!response.ok) {
          throw new Error(`Could not load ${name}: the server answered ${response.status}.`);
        }
        const data = await response.arrayBuffer();
        const digest = toHex(new Uint8Array(await crypto.subtle.digest("SHA-256", data))).slice(2);
        if (digest !== sha256) {
          throw new Error(`${name} is not the published circuit file. Nothing was proved.`);
        }
        return data;
      };
      const [circuit, key] = await Promise.all([
        download(TORNADO_CIRCUIT_FILES.circuit),
        download(TORNADO_CIRCUIT_FILES.provingKey),
      ]);
      return loadProver(JSON.parse(new TextDecoder().decode(circuit)), key);
    })();
    // A failed download is tried again on the next proof.
    files.catch(() => (files = undefined));
    return files;
  }

  /** Proofs made, by withdrawal id. Kept here so the withdrawal object carries no link to the deposit. */
  const proofs = new Map<
    string,
    { proof: Hex; args: TornadoWithdrawArgs; pool: TornadoPool; relayed: boolean }
  >();
  let nextId = 0;

  const relayerOf = (pool: TornadoPool) => chains[pool.chainId]?.relayer;
  const quoteFor = async (pool: TornadoPool, via: "wallet" | "relayer"): Promise<MixerQuote> => {
    if (via === "wallet") {
      return { fee: 0n, received: pool.denomination };
    }
    const relayer = relayerOf(pool);
    if (!relayer) {
      throw new Error("No relayer is set up for this pool.");
    }
    const fee = await relayer.quote(pool);
    if (fee < 0n || fee >= pool.denomination) {
      throw new Error("The relayer's fee is more than the withdrawal.");
    }
    return { fee, received: pool.denomination - fee };
  };
  const requirePool = (pool: MixerPool) => {
    const target = known(pool);
    if (!target) {
      throw new Error("This pool is not offered here.");
    }
    return target;
  };

  return {
    id: "tornado",
    pools,
    relays: Object.values(chains).some((chain) => chain.relayer),

    async createNote(pool): Promise<MixerNote> {
      const target = requirePool(pool);
      const preimage = crypto.getRandomValues(new Uint8Array(62));
      const { commitment } = await tornadoNoteHashes(preimage);
      return { note: noteText(target, preimage), pool: target, commitment };
    },

    async parseNote(text): Promise<MixerNote> {
      const { note, pool, commitment } = await parse(text);
      return { note, pool, commitment };
    },

    async prepareDeposit(note) {
      const { pool, commitment } = await parse(note);
      return {
        to: pool.address,
        data: encodeFunctionData({ abi: TORNADO_ABI, functionName: "deposit", args: [commitment] }),
        value: pool.token ? undefined : pool.denomination,
      };
    },

    async getDeposit(note, { signal } = {}): Promise<MixerDeposit> {
      const { pool, commitment, nullifierHash } = await parse(note);
      const [deposited, spent] = await Promise.all([
        read<boolean>(pool, "commitments", commitment),
        read<boolean>(pool, "isSpent", nullifierHash),
      ]);
      if (signal?.aborted) {
        throw aborted();
      }
      if (!deposited) {
        return { state: "missing" };
      }
      const state = spent ? "withdrawn" : "deposited";
      try {
        // The crowd: how many deposits came after this one. Needs the pool's history.
        const { leaves, times } = await deposits(pool);
        const index = leaves.indexOf(commitment);
        return index < 0
          ? { state }
          : {
              state,
              timestamp: times[index] || undefined,
              depositsSince: leaves.length - index - 1,
            };
      } catch {
        // The history could not be read. The state is still known.
        return { state };
      }
    },

    async quote(pool, via) {
      return quoteFor(requirePool(pool), via);
    },

    async prove(draft, { onStage, signal }): Promise<MixerWithdrawal> {
      const stage = (name: MixerStage) => {
        if (signal?.aborted) {
          throw aborted();
        }
        onStage(name);
      };
      if (!isAddress(draft.recipient)) {
        throw new Error("The recipient is not a valid address.");
      }
      stage("syncing");
      const { pool, commitment, nullifierHash, nullifier, secret } = await parse(draft.note);
      const relayer = draft.via === "relayer" ? relayerOf(pool) : undefined;
      const quote = await quoteFor(pool, draft.via);
      const relayerAddress = relayer
        ? typeof relayer.address === "function"
          ? await relayer.address()
          : relayer.address
        : zeroAddress;
      if (!isAddress(relayerAddress)) {
        throw new Error("The relayer's address is not valid.");
      }

      let leaves: Array<Hex>;
      try {
        ({ leaves } = await deposits(pool));
      } catch (error) {
        throw new Error(`The pool's deposits could not be read: ${reason(error)}`, {
          cause: error,
        });
      }
      const index = leaves.indexOf(commitment);
      if (index < 0) {
        throw new Error("No deposit was found for this note.");
      }
      if (await read<boolean>(pool, "isSpent", nullifierHash)) {
        throw new Error("This note was already withdrawn.");
      }
      const { root, pathElements, pathIndices } = await tornadoMerklePath(
        leaves.map(BigInt),
        index,
      );
      const rootHex = toHex(root, { size: 32 });
      // The pool remembers its last 30 roots. Anything else means the read was wrong or too old.
      if (!(await read<boolean>(pool, "isKnownRoot", rootHex))) {
        throw new Error("The deposits read from the RPC don't match the pool. Try again.");
      }

      stage("loading-circuits");
      const createProof = await prover();

      stage("proving");
      // Let the stage paint before the tab is busy with the proof.
      await new Promise((resolve) => setTimeout(resolve, 30));
      if (signal?.aborted) {
        throw aborted();
      }
      const args: TornadoWithdrawArgs = [
        rootHex,
        nullifierHash,
        draft.recipient,
        relayerAddress,
        quote.fee,
        0n,
      ];
      const proof = await createProof({
        root,
        nullifierHash: BigInt(nullifierHash),
        recipient: BigInt(draft.recipient),
        relayer: BigInt(relayerAddress),
        fee: quote.fee,
        refund: 0n,
        nullifier,
        secret,
        pathElements,
        pathIndices,
      });

      stage("verifying");
      const data = encodeFunctionData({
        abi: TORNADO_ABI,
        functionName: "withdraw",
        args: [proof, ...args],
      });
      try {
        // The pool's own verifier checks the proof, in a call that sends nothing.
        await client(pool.chainId).call({ to: pool.address, data });
      } catch (error) {
        throw new Error(`The pool refused the proof: ${reason(error)}`, { cause: error });
      }
      if (signal?.aborted) {
        throw aborted();
      }

      const id = `tornado-withdrawal-${++nextId}`;
      proofs.set(id, { proof, args, pool, relayed: false });
      return {
        id,
        pool,
        recipient: draft.recipient,
        via: draft.via,
        quote,
        transaction: { to: pool.address, data },
      };
    },

    async relay(withdrawal) {
      const made = proofs.get(withdrawal.id);
      const relayer = made && relayerOf(made.pool);
      if (!made || !relayer || withdrawal.via !== "relayer") {
        throw new Error("This withdrawal was not made for a relayer.");
      }
      if (made.relayed) {
        throw new Error("This withdrawal was already sent.");
      }
      made.relayed = true;
      try {
        return {
          hash: await relayer.send({ pool: made.pool, proof: made.proof, args: made.args }),
        };
      } catch (error) {
        // A refusal spends nothing, so the same proof may be sent again.
        made.relayed = false;
        throw error;
      }
    },
  };
}
