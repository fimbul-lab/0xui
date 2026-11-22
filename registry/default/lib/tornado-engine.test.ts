import { readFile } from "node:fs/promises";
import { decodeFunctionData, getAddress, hexToBytes, toHex, type Address, type Hex } from "viem";
import { describe, expect, it, vi } from "vitest";
import type { MixerStage } from "./mixer-engine";
import {
  TORNADO_ABI,
  createTornadoEngine,
  tornadoMerklePath,
  tornadoNoteHashes,
  type TornadoCache,
  type TornadoClient,
  type TornadoPool,
  type TornadoRelayer,
} from "./tornado-engine";

const RECIPIENT: Address = "0x9999999999999999999999999999999999999999";
const RELAYER: Address = "0x00000000000000000000000000000000000000fe";
const pool: TornadoPool = {
  chainId: 5,
  address: "0x6Bf694a291DF3FeC1f7e69701E3ab6c592435Ae7",
  symbol: "ETH",
  decimals: 18,
  denomination: 10n ** 17n,
  deploymentBlock: 1_000n,
};
// From the tornado-cli README.
const NOTE =
  "tornado-eth-0.1-5-0x1d9771a7b9f8b6c03d33116208ce8db1aa559d33e65d22dd2ff78375fc6b635f930536d2432b4bde0178c72cfc79d6b27023c5d9de60985f186b34c18c00";
const COMMITMENT: Hex = "0x1b680c7dda0c2dd1b85f0fe126d49b16ed594b3cd6d5114db5f4593877a6b84f";
const leaf = (n: number) => toHex(BigInt(n), { size: 32 });

/** A pool in memory: deposits by block, with the reads the engine makes. */
function fakeChain({ head = 2_000n } = {}) {
  const state = {
    head,
    deposits: [] as { commitment: Hex; block: bigint }[],
    spent: new Set<Hex>(),
    /** Roots the pool accepts. Undefined accepts any. */
    roots: undefined as Set<Hex> | undefined,
    logRequests: [] as [bigint, bigint][],
    /** Leaf indexes the RPC leaves out. */
    drop: new Set<number>(),
    rateLimited: 0,
    /** Ranges wider than this are refused. */
    maxRange: undefined as bigint | undefined,
    calls: [] as Hex[],
    refuse: undefined as string | undefined,
    deposit(commitment: Hex, block?: bigint) {
      state.deposits.push({ commitment, block: block ?? state.head });
    },
  };
  const client: TornadoClient = {
    getBlockNumber: async () => state.head,
    getLogs: async ({ fromBlock, toBlock }) => {
      state.logRequests.push([fromBlock, toBlock]);
      if (state.rateLimited > 0) {
        state.rateLimited--;
        throw Object.assign(new Error("Too Many Requests"), { status: 429 });
      }
      if (state.maxRange !== undefined && toBlock - fromBlock + 1n > state.maxRange) {
        throw new Error("query returned more than 10000 results");
      }
      return state.deposits
        .map((deposit, index) => ({ ...deposit, index }))
        .filter(
          ({ block, index }) => block >= fromBlock && block <= toBlock && !state.drop.has(index),
        )
        .map(({ commitment, block, index }) => ({
          blockNumber: block,
          args: { commitment, leafIndex: index, timestamp: block * 12n },
        }));
    },
    readContract: async ({ functionName, args }) => {
      const [value] = args!;
      if (functionName === "commitments") return state.deposits.some((d) => d.commitment === value);
      if (functionName === "isSpent") return state.spent.has(value);
      if (functionName === "isKnownRoot") return state.roots?.has(value) ?? true;
      throw new Error(`unexpected read ${functionName}`);
    },
    call: async ({ data }) => {
      state.calls.push(data);
      if (state.refuse) throw new Error(state.refuse);
    },
  };
  const chain = Object.assign(state, { client });
  return chain;
}

function memoryCache() {
  const store = new Map<string, string>();
  const cache: TornadoCache = {
    get: async (key) => store.get(key),
    set: async (key, value) => void store.set(key, value),
  };
  return { store, cache };
}

function setup({
  relayer,
  cache = false,
  circuitsUrl,
  fetch: request,
  blockRange,
}: {
  relayer?: TornadoRelayer;
  cache?: TornadoCache | false;
  circuitsUrl?: string;
  fetch?: typeof fetch;
  blockRange?: number;
} = {}) {
  const chain = fakeChain();
  const engine = createTornadoEngine({
    pools: [pool],
    chains: { 5: { rpcUrl: "http://unused", relayer, blockRange } },
    client: () => chain.client,
    cache,
    circuitsUrl,
    fetch: request,
  });
  return { chain, engine };
}

describe("tornado hashing", () => {
  it("matches the published commitment for a published note", async () => {
    const preimage = hexToBytes(`0x${NOTE.split("0x")[1]}`);
    const hashes = await tornadoNoteHashes(preimage);
    expect(hashes.commitment).toBe(COMMITMENT);
    // Nullifier and secret are the two halves, little-endian.
    expect(toHex(hashes.nullifier)).toBe(
      "0x636bfc7583f72fdd225de6339d55aab18dce086211333dc0b6f8b9a771971d",
    );
    expect(hashes.nullifierHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(hashes.nullifierHash).not.toBe(hashes.commitment);
    await expect(tornadoNoteHashes(new Uint8Array(61))).rejects.toThrow("62 bytes");
  });

  it("builds the tree the contract builds", async () => {
    // `zeros(0)` and `zeros(1)` in the contract's MerkleTreeWithHistory.
    const empty = await tornadoMerklePath([], 0);
    expect(empty.pathElements.slice(0, 2).map((value) => toHex(value, { size: 32 }))).toEqual([
      "0x2fe54c60d3acabf3343a35b6eba15db4821b340f76e741e2249685ed4899af6c",
      "0x256a6135777eee2fd26f54b8b7037a25439d5235caee224154186d2b8a52e31d",
    ]);
    const { pathElements, pathIndices, root } = await tornadoMerklePath([1n, 2n, 3n], 2);
    expect(pathElements).toHaveLength(20);
    // Leaf 2 is a left child, then a right child, then left all the way up.
    expect(pathIndices).toEqual([0, 1, ...Array.from({ length: 18 }, () => 0)]);
    expect(pathElements[0]).toBe(empty.pathElements[0]);
    expect(root).not.toBe(empty.root);
  });
});

describe("tornado engine: notes", () => {
  it("makes notes any Tornado client reads, and reads theirs", async () => {
    const { engine } = setup();
    const made = await engine.createNote(pool);
    expect(made.note).toMatch(/^tornado-eth-0\.1-5-0x[0-9a-f]{124}$/);
    expect(made.pool).toBe(pool);
    expect(await engine.parseNote(made.note)).toEqual(made);
    expect((await engine.createNote(pool)).note).not.toBe(made.note);

    expect(await engine.parseNote(`\n${NOTE} `)).toEqual({
      note: NOTE,
      pool,
      commitment: COMMITMENT,
    });
  });

  it("says why text is not a usable note", async () => {
    const { engine } = setup();
    await expect(engine.parseNote(" ")).rejects.toThrow("Paste your note.");
    await expect(engine.parseNote(NOTE.slice(0, -2))).rejects.toThrow("This is not a note.");
    await expect(engine.parseNote(NOTE.replace("-5-", "-1-"))).rejects.toThrow("not offered here");
    await expect(engine.parseNote(NOTE.replace("0.1", "1"))).rejects.toThrow("not offered here");
    await expect(engine.createNote({ ...pool, chainId: 1 })).rejects.toThrow("not offered here");
  });

  it("builds the deposit call with the pool's amount", async () => {
    const { engine } = setup();
    const call = await engine.prepareDeposit(NOTE);
    expect(call.to).toBe(pool.address);
    expect(call.value).toBe(10n ** 17n);
    expect(decodeFunctionData({ abi: TORNADO_ABI, data: call.data })).toMatchObject({
      functionName: "deposit",
      args: [COMMITMENT],
    });
  });
});

describe("tornado engine: deposits", () => {
  it("follows a note from missing to deposited to withdrawn, with its crowd", async () => {
    const { chain, engine } = setup();
    chain.deposit(leaf(1), 1_100n);
    expect(await engine.getDeposit(NOTE)).toEqual({ state: "missing" });

    chain.deposit(COMMITMENT, 1_200n);
    chain.deposit(leaf(2), 1_300n);
    chain.deposit(leaf(3), 1_990n);
    expect(await engine.getDeposit(NOTE)).toEqual({
      state: "deposited",
      timestamp: 14_400,
      depositsSince: 2,
    });

    const { nullifierHash } = await tornadoNoteHashes(hexToBytes(`0x${NOTE.split("0x")[1]}`));
    chain.spent.add(nullifierHash);
    expect(await engine.getDeposit(NOTE)).toMatchObject({ state: "withdrawn" });
  });

  it("reads final blocks once, and only the tail after that", async () => {
    const { chain, engine } = setup();
    chain.deposit(COMMITMENT, 1_200n);
    await engine.getDeposit(NOTE);
    expect(chain.logRequests).toEqual([[1_000n, 2_000n]]);

    chain.logRequests.length = 0;
    chain.head = 2_010n;
    chain.deposit(leaf(7), 2_005n);
    expect(await engine.getDeposit(NOTE)).toMatchObject({ depositsSince: 1 });
    // Blocks up to head - 64 were final and are not asked for again.
    expect(chain.logRequests).toEqual([[1_937n, 2_010n]]);
  });

  it("keeps final deposits between page loads", async () => {
    const { store, cache } = memoryCache();
    const first = setup({ cache });
    first.chain.deposit(COMMITMENT, 1_200n);
    first.chain.deposit(leaf(9), 1_995n);
    await first.engine.getDeposit(NOTE);
    await vi.waitFor(() => expect(store.size).toBe(1));
    // The deposit in the last 64 blocks is not final yet, so it is not kept.
    expect(JSON.parse([...store.values()][0]!)).toEqual({
      syncedTo: "1936",
      leaves: [COMMITMENT],
      times: [14_400],
    });

    const second = setup({ cache });
    second.chain.deposits = first.chain.deposits;
    expect(await second.engine.getDeposit(NOTE)).toMatchObject({ depositsSince: 1 });
    expect(second.chain.logRequests).toEqual([[1_937n, 2_000n]]);
  });

  it("ignores a cache it can't read", async () => {
    const { store, cache } = memoryCache();
    const { chain, engine } = setup({ cache });
    store.set(`deposits:5:${pool.address.toLowerCase()}@1000`, "not json");
    chain.deposit(COMMITMENT, 1_200n);
    expect(await engine.getDeposit(NOTE)).toMatchObject({ state: "deposited", depositsSince: 0 });
  });

  it("halves a range the RPC refuses, and waits out a rate limit", async () => {
    vi.useFakeTimers();
    try {
      const { chain, engine } = setup();
      chain.deposit(COMMITMENT, 1_200n);
      chain.deposit(leaf(4), 1_900n);
      chain.maxRange = 300n;
      chain.rateLimited = 2;
      const lookup = engine.getDeposit(NOTE);
      await vi.advanceTimersByTimeAsync(10_000);
      expect(await lookup).toMatchObject({ state: "deposited", depositsSince: 1 });
      expect(chain.logRequests.length).toBeGreaterThan(5);
    } finally {
      vi.useRealTimers();
    }
  });

  it("still reports the state when the history can't be read", async () => {
    const { chain, engine } = setup();
    chain.deposit(leaf(1), 1_100n);
    chain.deposit(COMMITMENT, 1_200n);
    chain.drop.add(0);
    expect(await engine.getDeposit(NOTE)).toEqual({ state: "deposited" });
  });
});

describe("tornado engine: withdraw", () => {
  const draft = { note: NOTE, recipient: RECIPIENT, via: "wallet" } as const;
  const prove = (engine: ReturnType<typeof setup>["engine"], stages: MixerStage[] = []) =>
    engine.prove(draft, { onStage: (stage) => stages.push(stage) });

  it("quotes no fee from the wallet and the relayer's fee through one", async () => {
    const relayer: TornadoRelayer = {
      address: RECIPIENT,
      quote: async () => 10n ** 15n,
      send: async () => "0x",
    };
    const { engine } = setup({ relayer });
    expect(engine.relays).toBe(true);
    expect(await engine.quote(pool, "wallet")).toEqual({ fee: 0n, received: 10n ** 17n });
    expect(await engine.quote(pool, "relayer")).toEqual({
      fee: 10n ** 15n,
      received: 99n * 10n ** 15n,
    });

    const none = setup().engine;
    expect(none.relays).toBe(false);
    await expect(none.quote(pool, "relayer")).rejects.toThrow("No relayer");
    const greedy = setup({ relayer: { ...relayer, quote: async () => 10n ** 17n } }).engine;
    await expect(greedy.quote(pool, "relayer")).rejects.toThrow("more than the withdrawal");
  });

  it("refuses a note with no deposit, a spent one, and a history the pool does not know", async () => {
    const { chain, engine } = setup();
    const stages: MixerStage[] = [];
    await expect(prove(engine, stages)).rejects.toThrow("No deposit was found for this note.");
    expect(stages).toEqual(["syncing"]);

    chain.deposit(COMMITMENT);
    chain.roots = new Set();
    await expect(prove(engine)).rejects.toThrow("don't match the pool");

    chain.roots = undefined;
    const { nullifierHash } = await tornadoNoteHashes(hexToBytes(`0x${NOTE.split("0x")[1]}`));
    chain.spent.add(nullifierHash);
    await expect(prove(engine)).rejects.toThrow("already withdrawn");
  });

  it("says when the RPC left deposits out", async () => {
    const { chain, engine } = setup();
    chain.deposit(leaf(1), 1_100n);
    chain.deposit(COMMITMENT, 1_200n);
    chain.drop.add(0);
    await expect(prove(engine)).rejects.toThrow("left out some of the pool's deposits");
  });

  it("needs the circuit files, and refuses ones that are not the published files", async () => {
    const bare = setup();
    bare.chain.deposit(COMMITMENT, 1_200n);
    const stages: MixerStage[] = [];
    await expect(prove(bare.engine, stages)).rejects.toThrow("Set `circuitsUrl`");
    expect(stages).toEqual(["syncing", "loading-circuits"]);

    const requested: string[] = [];
    const tampered = setup({
      circuitsUrl: "https://files.example/tornado",
      fetch: (async (url: string) => {
        requested.push(url);
        return new Response("{}");
      }) as typeof fetch,
    });
    tampered.chain.deposit(COMMITMENT, 1_200n);
    await expect(prove(tampered.engine)).rejects.toThrow("is not the published circuit file");
    expect(requested.sort()).toEqual([
      "https://files.example/tornado/tornado.json",
      "https://files.example/tornado/tornadoProvingKey.bin",
    ]);

    const missing = setup({
      circuitsUrl: "https://files.example/",
      fetch: (async () => new Response("", { status: 404 })) as typeof fetch,
    });
    missing.chain.deposit(COMMITMENT, 1_200n);
    await expect(prove(missing.engine)).rejects.toThrow("the server answered 404");
  });

  it("refuses a recipient that is not an address before any work", async () => {
    const { chain, engine } = setup();
    chain.deposit(COMMITMENT, 1_200n);
    await expect(
      engine.prove({ ...draft, recipient: "0x1234" as Address }, { onStage: () => {} }),
    ).rejects.toThrow("The recipient is not a valid address.");
    expect(chain.logRequests).toHaveLength(0);
  });

  it("stops before the proof when cancelled", async () => {
    const { chain, engine } = setup();
    chain.deposit(COMMITMENT, 1_200n);
    const run = new AbortController();
    run.abort();
    await expect(
      engine.prove(draft, { onStage: () => {}, signal: run.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(chain.logRequests).toHaveLength(0);
  });

  // Needs the 33 MB of circuit files: TORNADO_CIRCUITS_DIR=/path bun run test tornado-engine
  const dir = process.env.TORNADO_CIRCUITS_DIR;
  it.skipIf(!dir)(
    "proves a withdrawal the pool's call accepts, and relays it once",
    async () => {
      const send = vi.fn(async () => `0x${"ef".repeat(32)}` as const);
      const relayer: TornadoRelayer = {
        address: async () => RELAYER,
        quote: async () => 10n ** 15n,
        send,
      };
      const { chain, engine } = setup({
        relayer,
        circuitsUrl: "https://files.example/",
        fetch: (async (url: string) =>
          new Response(await readFile(`${dir}/${url.split("/").pop()}`))) as typeof fetch,
      });
      chain.deposit(leaf(1), 1_100n);
      chain.deposit(COMMITMENT, 1_200n);
      chain.deposit(leaf(2), 1_300n);

      const stages: MixerStage[] = [];
      const withdrawal = await engine.prove(
        { ...draft, via: "relayer" },
        { onStage: (stage) => stages.push(stage) },
      );
      expect(stages).toEqual(["syncing", "loading-circuits", "proving", "verifying"]);
      expect(withdrawal.quote).toEqual({ fee: 10n ** 15n, received: 99n * 10n ** 15n });

      const { functionName, args } = decodeFunctionData({
        abi: TORNADO_ABI,
        data: withdrawal.transaction.data,
      });
      expect(functionName).toBe("withdraw");
      const [proof, root, nullifierHash, recipient, paid, fee, refund] = args as unknown as [
        Hex,
        Hex,
        Hex,
        Address,
        Address,
        bigint,
        bigint,
      ];
      expect(proof).toHaveLength(2 + 512);
      const { root: expected } = await tornadoMerklePath([1n, BigInt(COMMITMENT), 2n], 1);
      expect(root).toBe(toHex(expected, { size: 32 }));
      expect([recipient, paid, fee, refund]).toEqual([
        RECIPIENT,
        getAddress(RELAYER),
        10n ** 15n,
        0n,
      ]);
      // The pool was asked to check exactly this call.
      expect(chain.calls).toEqual([withdrawal.transaction.data]);
      // Nothing on the withdrawal points back at the deposit.
      const text = JSON.stringify(withdrawal, (_, v) => (typeof v === "bigint" ? `${v}` : v));
      expect(text).not.toContain(COMMITMENT.slice(2));

      send.mockRejectedValueOnce(new Error("The relayer is busy."));
      await expect(engine.relay(withdrawal)).rejects.toThrow("busy");
      expect(await engine.relay(withdrawal)).toEqual({ hash: `0x${"ef".repeat(32)}` });
      expect(send).toHaveBeenLastCalledWith({
        pool,
        proof,
        args: [root, nullifierHash, recipient, paid, fee, refund],
      });
      await expect(engine.relay(withdrawal)).rejects.toThrow("already sent");

      chain.refuse = "execution reverted: Invalid withdraw proof";
      await expect(engine.prove(draft, { onStage: () => {} })).rejects.toThrow(
        "The pool refused the proof: execution reverted: Invalid withdraw proof",
      );
    },
    300_000,
  );
});
