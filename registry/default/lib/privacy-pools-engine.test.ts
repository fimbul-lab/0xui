import { decodeFunctionData, parseAbi, parseUnits, type Address, type Hash } from "viem";
import { describe, expect, it } from "vitest";
import {
  PRIVACY_POOLS_NATIVE,
  createPrivacyPoolsEngine,
  decryptPhrase,
  encryptPhrase,
  nextDepositIndex,
  poolAccountState,
  type PrivacyPoolsClient,
  type PrivacyPoolsStorage,
} from "./privacy-pools-engine";
import type { ShieldedEngine, ShieldedSync } from "./shielded-engine";

const CHAIN = 11155111;
const ENTRYPOINT: Address = "0x34A2068192b1297f2a7f85D7D8CdE66F8F0921cB";
const USDC: Address = "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238";
const USDC_POOL: Address = "0x0b062Fe33c4f1592D8EA63f9a0177FcA44374C0f";
const ETH_POOL: Address = "0x644d5A2554d36e27509254F32ccfeBe8cd58861f";
const SCOPES: Record<string, bigint> = { [USDC_POOL]: 111n, [ETH_POOL]: 222n };
const DEPOSITOR: Address = "0x1111111111111111111111111111111111111111";
const PHRASE = "test test test test test test test test test test test junk";

const depositAbi = parseAbi([
  "function deposit(uint256 _precommitment) payable returns (uint256)",
  "function deposit(address _asset, uint256 _value, uint256 _precommitment) returns (uint256)",
]);

type Log = {
  address: Address;
  eventName: string;
  args: Record<string, unknown>;
  blockNumber: bigint;
  transactionHash: Hash;
  logIndex: number;
};

/** A chain small enough to hold in a test: a head, some logs, and the Entrypoint's answers. */
function fakeChain() {
  const state = {
    head: 1_000n,
    logs: [] as Log[],
    /** Approved labels, by scope. */
    approved: new Map<string, string[]>(),
    getLogsCalls: [] as { fromBlock: bigint; toBlock: bigint }[],
    /** Refuse ranges wider than this, like an RPC with a block limit. */
    maxRange: undefined as bigint | undefined,
    failLogs: false,
    aspStatus: 200,
  };

  const client: PrivacyPoolsClient = {
    getBlockNumber: async () => state.head,
    async getLogs({ fromBlock, toBlock }) {
      state.getLogsCalls.push({ fromBlock, toBlock });
      if (state.failLogs) throw new Error("rate limited");
      if (state.maxRange !== undefined && toBlock - fromBlock + 1n > state.maxRange) {
        throw new Error("block range too wide");
      }
      return state.logs.filter((log) => log.blockNumber >= fromBlock && log.blockNumber <= toBlock);
    },
    async readContract({ address, functionName, args }) {
      if (functionName === "assetConfig") {
        const native = (args![0] as string).toLowerCase() === PRIVACY_POOLS_NATIVE.toLowerCase();
        // pool, minimum deposit, vetting fee (50 bps), max relay fee
        return native
          ? [ETH_POOL, 10n ** 15n, 50n, 100n]
          : [USDC_POOL, parseUnits("1", 6), 50n, 100n];
      }
      if (functionName === "SCOPE") return SCOPES[address];
      if (functionName === "decimals") return 6;
      throw new Error(`unexpected read: ${functionName}`);
    },
  };

  const fetchAsp: typeof fetch = async (_url, init) => {
    const scope = (init!.headers as Record<string, string>)["X-Pool-Scope"]!;
    return new Response(JSON.stringify({ aspLeaves: state.approved.get(scope) ?? [] }), {
      status: state.aspStatus,
    });
  };

  let count = 0;
  /** Mine a deposit: the fee is already taken out of `value`, as the pool reports it. */
  function deposit(pool: Address, precommitment: bigint, value: bigint, label: bigint, block = state.head) {
    const transactionHash = `0x${(++count).toString(16).padStart(64, "0")}` as Hash;
    state.logs.push({
      address: pool,
      eventName: "Deposited",
      args: {
        _depositor: DEPOSITOR,
        _commitment: 9_000n + BigInt(count),
        _label: label,
        _value: value,
        _merkleRoot: precommitment,
      },
      blockNumber: block,
      transactionHash,
      logIndex: 0,
    });
    return transactionHash;
  }

  return { state, client, fetchAsp, deposit };
}

function memory(): PrivacyPoolsStorage & { items: Map<string, string> } {
  const items = new Map<string, string>();
  return {
    items,
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => void items.set(key, value),
    removeItem: (key) => void items.delete(key),
  };
}

function setup(storage = memory(), chain = fakeChain()) {
  const engine = createPrivacyPoolsEngine({
    chains: {
      [CHAIN]: {
        rpcUrl: "http://unused.test",
        entrypoint: ENTRYPOINT,
        aspUrl: "https://asp.test",
        pools: [
          { asset: USDC, deploymentBlock: 100n },
          { asset: PRIVACY_POOLS_NATIVE, deploymentBlock: 100n },
        ],
        blockRange: 500,
      },
    },
    storage,
    pollInterval: 0,
    client: () => chain.client,
    fetch: chain.fetchAsp,
  });
  return { engine, storage, ...chain };
}

/** An imported account with its first scan finished. */
async function unlocked(storage = memory(), chain = fakeChain()) {
  const context = setup(storage, chain);
  await context.engine.account.import(PHRASE, "password");
  await context.engine.sync(CHAIN);
  return context;
}

const amountsOf = (engine: ShieldedEngine, token: Address = USDC) =>
  engine.getBalances(CHAIN)?.find((balance) => balance.token === token)?.amounts;

/** The precommitment a prepared shield carries. */
function precommitmentOf(data: `0x${string}`) {
  const { args } = decodeFunctionData({ abi: depositAbi, data });
  return args.at(-1) as bigint;
}

const shieldUsdc = (engine: ShieldedEngine, amount = parseUnits("100", 6)) =>
  engine.prepareShield(
    { chainId: CHAIN, token: USDC, amount },
    { sign: async () => "0x" }
  );

describe("account", () => {
  it("creates an account and returns a 12-word phrase once", async () => {
    const { engine, storage } = setup();
    expect(engine.account.status()).toBe("none");

    const { mnemonic } = await engine.account.create("password");
    expect(mnemonic.split(" ")).toHaveLength(12);
    expect(engine.account.status()).toBe("unlocked");
    expect(engine.account.address()).toBeNull();
    // What is stored can't be read without the password.
    expect([...storage.items.values()].join()).not.toContain(mnemonic.split(" ")[0]! + " ");
    expect(await decryptPhrase(storage.getItem("0xui.privacy-pools.account")!, "password")).toBe(
      mnemonic
    );
  });

  it("finds the stored account again and opens it with the right password only", async () => {
    const storage = memory();
    await setup(storage).engine.account.import(PHRASE, "password");

    const { engine } = setup(storage);
    expect(engine.account.status()).toBe("locked");
    await expect(engine.account.unlock("nope")).rejects.toThrow("Wrong password.");
    expect(engine.account.status()).toBe("locked");
    await engine.account.unlock("password");
    expect(engine.account.status()).toBe("unlocked");
  });

  it("rejects a phrase that is not one", async () => {
    const { engine } = setup();
    await expect(engine.account.import("one two three", "password")).rejects.toThrow(
      "12 or 24 words"
    );
    await expect(
      engine.account.import(PHRASE.replace("junk", "notaword"), "password")
    ).rejects.toThrow("not a valid recovery phrase");
    await expect(engine.account.import(PHRASE, "")).rejects.toThrow("Choose a password.");
    expect(engine.account.status()).toBe("none");
  });

  it("clears balances and scan state when locked", async () => {
    const { engine } = await unlocked();
    expect(engine.getBalances(CHAIN)).toEqual([]);
    engine.account.lock();
    expect(engine.account.status()).toBe("locked");
    expect(engine.getBalances(CHAIN)).toBeUndefined();
    expect(engine.getSync(CHAIN).status).toBe("idle");
  });

  it("encrypts with a fresh salt each time", async () => {
    const a = await encryptPhrase(PHRASE, "password");
    const b = await encryptPhrase(PHRASE, "password");
    expect(a).not.toBe(b);
    expect(await decryptPhrase(a, "password")).toBe(PHRASE);
    await expect(decryptPhrase(a, "other")).rejects.toThrow("Wrong password.");
  });
});

describe("quote", () => {
  it("takes the pool's vetting fee and names the Entrypoint as spender", async () => {
    const { engine } = setup();
    const quote = await engine.quoteShield({
      chainId: CHAIN,
      token: USDC,
      amount: parseUnits("200", 6),
    });
    expect(quote).toEqual({
      fee: parseUnits("1", 6),
      received: parseUnits("199", 6),
      standby: 3600,
      spender: ENTRYPOINT,
      needsSignature: false,
    });
  });

  it("needs no approval for native currency", async () => {
    const { engine } = setup();
    const quote = await engine.quoteShield({
      chainId: CHAIN,
      token: PRIVACY_POOLS_NATIVE,
      amount: 10n ** 18n,
    });
    expect(quote.spender).toBeUndefined();
  });

  it("refuses an amount under the pool's minimum, and a token with no pool", async () => {
    const { engine } = setup();
    await expect(
      engine.quoteShield({ chainId: CHAIN, token: USDC, amount: 999_999n })
    ).rejects.toThrow("The minimum is 1.");
    await expect(
      engine.quoteShield({ chainId: CHAIN, token: DEPOSITOR, amount: 1n })
    ).rejects.toThrow("no Privacy Pool");
    await expect(engine.quoteShield({ chainId: 1, token: USDC, amount: 1n })).rejects.toThrow(
      "not set up for chain 1"
    );
  });
});

describe("shield", () => {
  it("builds an Entrypoint deposit and follows it from pending to spendable", async () => {
    const { engine, state, deposit } = await unlocked();
    const amount = parseUnits("100", 6);

    const { transaction } = await shieldUsdc(engine, amount);
    expect(transaction.to).toBe(ENTRYPOINT);
    expect(transaction.value).toBe(0n);
    const { functionName, args } = decodeFunctionData({ abi: depositAbi, data: transaction.data! });
    expect(functionName).toBe("deposit");
    expect(args.slice(0, 2)).toEqual([USDC, amount]);

    // The wallet sends it. The pool reports the amount after the fee.
    const received = parseUnits("99.5", 6);
    const hash = deposit(USDC_POOL, precommitmentOf(transaction.data!), received, 777n);
    expect(engine.getTransaction(CHAIN, hash)).toBeUndefined();

    await engine.sync(CHAIN);
    expect(amountsOf(engine)).toMatchObject({ pending: received, spendable: 0n });
    expect(engine.getTransaction(CHAIN, hash)).toEqual({
      kind: "shield",
      token: USDC,
      amount: received,
      state: "pending",
    });

    // The ASP approves the deposit's label.
    state.approved.set("111", ["777"]);
    await engine.sync(CHAIN);
    expect(amountsOf(engine)).toMatchObject({ pending: 0n, spendable: received });
    expect(engine.getTransaction(CHAIN, hash)?.state).toBe("spendable");
  });

  it("sends native currency as value", async () => {
    const { engine } = await unlocked();
    const { transaction } = await engine.prepareShield(
      { chainId: CHAIN, token: PRIVACY_POOLS_NATIVE, amount: 10n ** 18n },
      { sign: async () => "0x" }
    );
    expect(transaction.value).toBe(10n ** 18n);
    expect(decodeFunctionData({ abi: depositAbi, data: transaction.data! }).args).toHaveLength(1);
  });

  it("never asks for a signature", async () => {
    const { engine } = await unlocked();
    let asked = false;
    await engine.prepareShield(
      { chainId: CHAIN, token: USDC, amount: parseUnits("5", 6) },
      {
        sign: async () => {
          asked = true;
          return "0x";
        },
      }
    );
    expect(asked).toBe(false);
  });

  it("gives every prepared shield its own deposit index, across reloads too", async () => {
    const storage = memory();
    const { engine } = await unlocked(storage);
    const first = precommitmentOf((await shieldUsdc(engine)).transaction.data!);
    const second = precommitmentOf((await shieldUsdc(engine)).transaction.data!);
    expect(second).not.toBe(first);

    // A reload before either is mined: the indexes are still taken.
    const reloaded = setup(storage);
    await reloaded.engine.account.unlock("password");
    const third = precommitmentOf((await shieldUsdc(reloaded.engine)).transaction.data!);
    expect([first, second]).not.toContain(third);
  });

  it("moves past an index once its deposit is on chain", async () => {
    const { engine, deposit } = await unlocked();
    const first = precommitmentOf((await shieldUsdc(engine)).transaction.data!);
    deposit(USDC_POOL, first, parseUnits("99.5", 6), 1n);
    await engine.sync(CHAIN);
    const next = precommitmentOf((await shieldUsdc(engine)).transaction.data!);
    expect(next).not.toBe(first);
  });

  it("stops handing out indexes before the SDK would lose track of them", async () => {
    const { engine } = await unlocked();
    for (let i = 0; i < 8; i++) await shieldUsdc(engine);
    await expect(shieldUsdc(engine)).rejects.toThrow("Several shields were started");
  });

  it("keeps separate indexes per pool", async () => {
    const { engine } = await unlocked();
    for (let i = 0; i < 8; i++) await shieldUsdc(engine);
    await expect(
      engine.prepareShield(
        { chainId: CHAIN, token: PRIVACY_POOLS_NATIVE, amount: 10n ** 18n },
        { sign: async () => "0x" }
      )
    ).resolves.toBeDefined();
  });

  it("needs an unlocked account", async () => {
    const { engine } = setup();
    await expect(shieldUsdc(engine)).rejects.toThrow("Unlock the private account first.");
  });

  it("refuses to prepare a shield when the pool's history can't be read", async () => {
    const context = setup();
    context.state.failLogs = true;
    await context.engine.account.import(PHRASE, "password");
    await expect(shieldUsdc(context.engine)).rejects.toThrow("Couldn't read the pool's history");
  });

  it("can't unshield yet", async () => {
    const { engine } = await unlocked();
    await expect(
      engine.prove(
        { kind: "unshield", chainId: CHAIN, token: USDC, amount: 1n, recipient: DEPOSITOR },
        { onStage() {} }
      )
    ).rejects.toThrow("can't unshield yet");
  });
});

describe("scan", () => {
  it("finds the account's deposits from the phrase alone", async () => {
    const storage = memory();
    const chain = fakeChain();
    const { engine } = await unlocked(storage, chain);
    const precommitment = precommitmentOf((await shieldUsdc(engine)).transaction.data!);
    chain.deposit(USDC_POOL, precommitment, parseUnits("50", 6), 5n, 400n);
    // Someone else's deposit in the same pool.
    chain.deposit(USDC_POOL, 123_456n, parseUnits("70", 6), 6n, 401n);

    // A new device: nothing stored, same phrase.
    const fresh = await unlocked(memory(), chain);
    expect(amountsOf(fresh.engine)).toMatchObject({ pending: parseUnits("50", 6) });
  });

  it("reads final blocks once and only what is new after that", async () => {
    const { engine, state } = await unlocked();
    // First scan: blocks 100 to 1000 in chunks of 500.
    expect(state.getLogsCalls).toEqual([
      { fromBlock: 100n, toBlock: 599n },
      { fromBlock: 600n, toBlock: 1_000n },
    ]);

    state.getLogsCalls.length = 0;
    state.head = 1_010n;
    await engine.sync(CHAIN);
    // Blocks past head - 64 could still be reorganised, so they are read again.
    expect(state.getLogsCalls).toEqual([{ fromBlock: 937n, toBlock: 1_010n }]);
  });

  it("halves a range the RPC refuses", async () => {
    const context = setup();
    context.state.maxRange = 200n;
    await context.engine.account.import(PHRASE, "password");
    await context.engine.sync(CHAIN);
    expect(context.engine.getSync(CHAIN).status).toBe("synced");
    const accepted = context.state.getLogsCalls.filter(
      ({ fromBlock, toBlock }) => toBlock - fromBlock + 1n <= 200n
    );
    // Every block from 100 to 1000 was read exactly once.
    expect(accepted.reduce((sum, { fromBlock, toBlock }) => sum + toBlock - fromBlock + 1n, 0n)).toBe(
      901n
    );
  });

  it("reports progress through both stages and ends synced", async () => {
    const context = setup();
    const states: ShieldedSync[] = [];
    context.engine.subscribe("sync", () => states.push(context.engine.getSync(CHAIN)));
    await context.engine.account.import(PHRASE, "password");
    await context.engine.sync(CHAIN);

    expect(states.map((sync) => sync.stage)).toContain("notes");
    expect(states.at(-1)).toEqual({ stage: "transactions", status: "synced", progress: 1 });
    expect(states.every((sync) => sync.progress >= 0 && sync.progress <= 1)).toBe(true);
  });

  it("reports a failed scan through getSync and keeps the last balances", async () => {
    const { engine, state, deposit } = await unlocked();
    const precommitment = precommitmentOf((await shieldUsdc(engine)).transaction.data!);
    deposit(USDC_POOL, precommitment, parseUnits("10", 6), 3n);
    await engine.sync(CHAIN);
    const before = engine.getBalances(CHAIN);

    state.failLogs = true;
    state.head = 1_100n;
    await expect(engine.sync(CHAIN)).resolves.toBeUndefined();
    expect(engine.getSync(CHAIN)).toMatchObject({ status: "error", error: "rate limited" });
    expect(engine.getBalances(CHAIN)).toBe(before);

    state.failLogs = false;
    await engine.sync(CHAIN);
    expect(engine.getSync(CHAIN).status).toBe("synced");
  });

  it("fails the scan when the ASP can't be reached", async () => {
    const context = setup();
    context.state.aspStatus = 503;
    await context.engine.account.import(PHRASE, "password");
    await context.engine.sync(CHAIN);
    expect(context.engine.getSync(CHAIN)).toMatchObject({
      status: "error",
      stage: "transactions",
      error: "The ASP answered 503.",
    });
    expect(context.engine.getBalances(CHAIN)).toBeUndefined();
  });

  it("returns the same balances array until they change", async () => {
    const { engine, state } = await unlocked();
    const before = engine.getBalances(CHAIN);
    state.head = 1_005n;
    await engine.sync(CHAIN);
    expect(engine.getBalances(CHAIN)).toBe(before);
  });
});

describe("poolAccountState", () => {
  const commitment = (value: bigint) => ({ value }) as never;
  const account = (overrides: object = {}) =>
    ({ label: 7n, deposit: commitment(100n), children: [], ...overrides }) as never;

  it("is pending until the ASP lists the label", () => {
    expect(poolAccountState(account(), new Set())).toBe("pending");
    expect(poolAccountState(account(), new Set(["7"]))).toBe("spendable");
  });

  it("is nothing once the funds are gone", () => {
    const approved = new Set(["7"]);
    expect(poolAccountState(account({ ragequit: {} }), approved)).toBeUndefined();
    expect(poolAccountState(account({ isMigrated: true }), approved)).toBeUndefined();
    expect(poolAccountState(account({ children: [commitment(0n)] }), approved)).toBeUndefined();
    expect(poolAccountState(account({ children: [commitment(40n)] }), approved)).toBe("spendable");
  });
});

describe("nextDepositIndex", () => {
  it("follows the highest recorded index, not the count", () => {
    expect(nextDepositIndex([])).toBe(0n);
    expect(nextDepositIndex([{ depositIndex: 0n }, { depositIndex: 4n }])).toBe(5n);
    expect(nextDepositIndex([{ depositIndex: 2n }, { isMigrationDerived: true }])).toBe(3n);
    // Accounts restored without a recorded index: fall back to the count.
    expect(nextDepositIndex([{}, {}])).toBe(2n);
  });
});
