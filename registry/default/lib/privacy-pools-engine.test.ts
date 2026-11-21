import {
  Circuits,
  PrivacyPoolSDK,
  generateMerkleProof,
  getCommitment,
} from "@0xbow/privacy-pools-core-sdk";
import { poseidon1, poseidon3 } from "poseidon-lite";
import {
  decodeFunctionData,
  encodeAbiParameters,
  parseAbi,
  parseUnits,
  type Address,
  type Hash,
} from "viem";
import { afterEach, describe, expect, it, vi } from "vitest";
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
import type { ProofStage, ShieldedEngine, ShieldedSync, UnshieldDraft } from "./shielded-engine";

const CHAIN = 11155111;
const ENTRYPOINT: Address = "0x34A2068192b1297f2a7f85D7D8CdE66F8F0921cB";
const USDC: Address = "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238";
const USDC_POOL: Address = "0x0b062Fe33c4f1592D8EA63f9a0177FcA44374C0f";
const ETH_POOL: Address = "0x644d5A2554d36e27509254F32ccfeBe8cd58861f";
const SCOPES: Record<string, bigint> = { [USDC_POOL]: 111n, [ETH_POOL]: 222n };
const DEPOSITOR: Address = "0x1111111111111111111111111111111111111111";
const RECIPIENT: Address = "0x2222222222222222222222222222222222222222";
const FEE_RECEIVER: Address = "0x3333333333333333333333333333333333333333";
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
    /** Every commitment in the pools' state tree, as the ASP publishes it. */
    stateLeaves: [] as string[],
    /** The approval root on chain. Follows the approved labels unless set. */
    aspRoot: undefined as bigint | undefined,
    relayer: {
      feeBps: 10n,
      minimum: 100n,
      /** Ms a fee commitment lasts. */
      lifetime: 60_000,
      /** Who the relayer's instructions pay. Follows the request unless set. */
      recipient: undefined as Address | undefined,
      quotes: [] as { recipient?: string; amount: string }[],
      requests: [] as Record<string, any>[],
      answer: { success: true, txHash: `0x${"ab".repeat(32)}` } as Record<string, unknown>,
    },
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
      if (functionName === "latestRoot") {
        if (state.aspRoot !== undefined) return state.aspRoot;
        const labels = (state.approved.get("111") ?? []).map(BigInt);
        return labels.length > 0 ? generateMerkleProof(labels, labels[0]!).root : 0n;
      }
      throw new Error(`unexpected read: ${functionName}`);
    },
  };

  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

  const fetchAsp: typeof fetch = async (url, init) => {
    const path = String(url);
    if (path.includes("/relayer/details")) {
      return json({ minWithdrawAmount: state.relayer.minimum.toString() });
    }
    if (path.endsWith("/relayer/quote")) {
      const body = JSON.parse(init!.body as string) as { recipient?: Address; amount: string };
      state.relayer.quotes.push(body);
      return json({
        feeBPS: state.relayer.feeBps.toString(),
        feeCommitment: body.recipient && {
          expiration: Date.now() + state.relayer.lifetime,
          withdrawalData: encodeAbiParameters(
            [{ type: "address" }, { type: "address" }, { type: "uint256" }],
            [state.relayer.recipient ?? body.recipient, FEE_RECEIVER, state.relayer.feeBps]
          ),
          signedRelayerCommitment: "0x51",
        },
      });
    }
    if (path.endsWith("/relayer/request")) {
      state.relayer.requests.push(JSON.parse(init!.body as string));
      return json(state.relayer.answer);
    }
    const scope = (init!.headers as Record<string, string>)["X-Pool-Scope"]!;
    return json(
      { aspLeaves: state.approved.get(scope) ?? [], stateTreeLeaves: state.stateLeaves },
      state.aspStatus
    );
  };

  let count = 0;
  /** Mine a deposit: the fee is already taken out of `value`, as the pool reports it. */
  function deposit(pool: Address, precommitment: bigint, value: bigint, label: bigint, block = state.head) {
    const transactionHash = `0x${(++count).toString(16).padStart(64, "0")}` as Hash;
    // The commitment the pool computes: value, label and precommitment hashed together.
    const commitment = poseidon3([value, label, precommitment]);
    state.stateLeaves.push(commitment.toString());
    state.logs.push({
      address: pool,
      eventName: "Deposited",
      args: {
        _depositor: DEPOSITOR,
        _commitment: commitment,
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
        relayerUrl: "https://relayer.test",
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
    circuitsUrl: "https://circuits.test/",
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

describe("unshield", () => {
  afterEach(() => vi.restoreAllMocks());

  const FAKE_PROOF = {
    proof: { pi_a: ["1", "2"], pi_b: [["3", "4"]], pi_c: ["5", "6"], protocol: "groth16", curve: "bn128" },
    publicSignals: ["7", "8"],
  };

  /** Stand in for the 24 MB of circuits. Everything around the proof is real. */
  function fakeProver() {
    const load = vi.spyOn(Circuits.prototype, "initArtifacts").mockResolvedValue();
    const prove = vi
      .spyOn(PrivacyPoolSDK.prototype, "proveWithdrawal")
      .mockResolvedValue(FAKE_PROOF as never);
    const verify = vi.spyOn(PrivacyPoolSDK.prototype, "verifyWithdrawal").mockResolvedValue(true);
    return { load, prove, verify };
  }

  type Context = Awaited<ReturnType<typeof unlocked>>;

  /** Shield USDC and have the ASP approve it. `value` is what the pool holds, after the fee. */
  async function fund(context: Context, value: bigint, label: bigint) {
    const { transaction } = await shieldUsdc(context.engine);
    context.deposit(USDC_POOL, precommitmentOf(transaction.data!), value, label);
    const approved = context.state.approved.get("111") ?? [];
    context.state.approved.set("111", [...approved, label.toString()]);
    context.state.head += 1n;
    await context.engine.sync(CHAIN);
  }

  const draftOf = (amount: bigint): UnshieldDraft => ({
    kind: "unshield",
    chainId: CHAIN,
    token: USDC,
    amount,
    recipient: RECIPIENT,
  });

  const prove = (engine: ShieldedEngine, amount: bigint, stages: ProofStage[] = []) =>
    engine.prove(draftOf(amount), { onStage: (stage) => stages.push(stage) });

  it("quotes the relayer's fee without asking it to sign anything", async () => {
    const context = await unlocked();
    await fund(context, parseUnits("100", 6), 7n);

    const quote = await context.engine.quote(draftOf(parseUnits("40", 6)));
    expect(quote).toEqual({ fee: parseUnits("0.04", 6), received: parseUnits("39.96", 6) });
    expect(context.state.relayer.quotes).toEqual([
      { chainId: CHAIN, amount: "40000000", asset: USDC, extraGas: false },
    ]);
  });

  it("refuses an amount that can't be unshielded", async () => {
    const context = await unlocked();
    const { engine, state } = context;
    await fund(context, parseUnits("100", 6), 7n);
    await fund(context, parseUnits("60", 6), 8n);

    await expect(engine.quote(draftOf(0n))).rejects.toThrow("Enter an amount.");
    await expect(engine.quote(draftOf(parseUnits("200", 6)))).rejects.toThrow(
      "Not enough spendable balance."
    );
    // 160 is there, but in two deposits.
    await expect(engine.quote(draftOf(parseUnits("120", 6)))).rejects.toThrow(
      "The most you can unshield at once is 100."
    );
    await expect(engine.quote(draftOf(50n))).rejects.toThrow("The minimum is 0.0001.");

    state.relayer.minimum = parseUnits("5", 6);
    // 58 fits only the 60 deposit, and would strand 2 there. 100 can still pay it.
    await expect(engine.quote(draftOf(parseUnits("58", 6)))).resolves.toBeDefined();
    await expect(engine.quote(draftOf(parseUnits("97", 6)))).rejects.toThrow(
      "That would leave 3 behind, less than the minimum of 5. Unshield 100 instead."
    );

    state.relayer.feeBps = 101n;
    await expect(engine.quote(draftOf(parseUnits("60", 6)))).rejects.toThrow(
      "above what the pool allows"
    );
  });

  it("does not count pending funds", async () => {
    const context = await unlocked();
    const { transaction } = await shieldUsdc(context.engine);
    context.deposit(USDC_POOL, precommitmentOf(transaction.data!), parseUnits("100", 6), 7n);
    context.state.head += 1n;
    await context.engine.sync(CHAIN);
    await expect(context.engine.quote(draftOf(parseUnits("10", 6)))).rejects.toThrow(
      "Not enough spendable balance."
    );
  });

  it("proves a withdrawal bound to the recipient and the fee", async () => {
    const context = await unlocked();
    const prover = fakeProver();
    await fund(context, parseUnits("100", 6), 7n);
    await fund(context, parseUnits("60", 6), 8n);

    const stages: ProofStage[] = [];
    const operation = await prove(context.engine, parseUnits("50", 6), stages);

    expect(stages).toEqual(["loading-circuits", "proving", "verifying"]);
    expect(operation.draft).toEqual(draftOf(parseUnits("50", 6)));
    expect(operation.quote).toEqual({ fee: parseUnits("0.05", 6), received: parseUnits("49.95", 6) });
    expect(operation.expiresAt).toBeGreaterThan(Date.now());
    expect(context.state.relayer.quotes.at(-1)?.recipient).toBe(RECIPIENT);

    // The smallest deposit that covers the amount is spent.
    const [source, input] = prover.prove.mock.calls[0]!;
    expect(source).toMatchObject({ label: 8n, value: parseUnits("60", 6) });
    expect(input.withdrawalAmount).toBe(parseUnits("50", 6));
    expect(input.stateTreeDepth).toBe(32n);
    expect(input.aspMerkleProof.root).toBe(
      generateMerkleProof([7n, 8n], 8n).root
    );
    expect(input.stateMerkleProof.siblings).toHaveLength(32);
    expect(input.context).toBeGreaterThan(0n);
    expect(prover.load).toHaveBeenCalledTimes(1);

    // Circuits are loaded once.
    await prove(context.engine, parseUnits("50", 6));
    expect(prover.load).toHaveBeenCalledTimes(1);
  });

  it("stops when the relayer's instructions pay someone else", async () => {
    const context = await unlocked();
    const prover = fakeProver();
    await fund(context, parseUnits("100", 6), 7n);
    context.state.relayer.recipient = FEE_RECEIVER;
    await expect(prove(context.engine, parseUnits("50", 6))).rejects.toThrow(
      "does not match this unshield"
    );
    expect(prover.prove).not.toHaveBeenCalled();
  });

  it("stops when the approval list on chain is not the one the ASP serves", async () => {
    const context = await unlocked();
    const prover = fakeProver();
    await fund(context, parseUnits("100", 6), 7n);
    context.state.aspRoot = 1n;
    await expect(prove(context.engine, parseUnits("50", 6))).rejects.toThrow(
      "The approval list is being updated."
    );
    context.state.aspRoot = undefined;
    context.state.stateLeaves = [];
    await expect(prove(context.engine, parseUnits("50", 6))).rejects.toThrow(
      "The ASP's records are behind the chain."
    );
    expect(prover.prove).not.toHaveBeenCalled();
  });

  it("rejects a proof that does not verify or could not be made", async () => {
    const context = await unlocked();
    const prover = fakeProver();
    await fund(context, parseUnits("100", 6), 7n);
    prover.verify.mockResolvedValueOnce(false);
    await expect(prove(context.engine, parseUnits("50", 6))).rejects.toThrow("did not verify");
    prover.prove.mockRejectedValueOnce(new Error("Proof generation failed"));
    await expect(prove(context.engine, parseUnits("50", 6))).rejects.toThrow(
      "Proof generation failed"
    );
  });

  it("downloads the circuits again after a failed download", async () => {
    const context = await unlocked();
    const prover = fakeProver();
    await fund(context, parseUnits("100", 6), 7n);
    prover.load.mockRejectedValueOnce(new Error("offline"));
    await expect(prove(context.engine, parseUnits("50", 6))).rejects.toThrow("offline");
    await expect(prove(context.engine, parseUnits("50", 6))).resolves.toBeDefined();
    expect(prover.load).toHaveBeenCalledTimes(2);
  });

  it("aborts with the signal's reason", async () => {
    const context = await unlocked();
    const prover = fakeProver();
    await fund(context, parseUnits("100", 6), 7n);
    prover.prove.mockReturnValue(new Promise(() => {}));
    const controller = new AbortController();
    const running = context.engine.prove(draftOf(parseUnits("50", 6)), {
      onStage: (stage) => stage === "proving" && controller.abort(new Error("cancelled")),
      signal: controller.signal,
    });
    await expect(running).rejects.toThrow("cancelled");
  });

  it("hands the proof to the relayer and shows the funds as proving", async () => {
    const context = await unlocked();
    const { engine, state } = context;
    const prover = fakeProver();
    await fund(context, parseUnits("100", 6), 7n);

    const operation = await prove(engine, parseUnits("40", 6));
    const { hash } = await engine.submit(operation);
    expect(hash).toBe(`0x${"ab".repeat(32)}`);

    const [sent] = state.relayer.requests;
    expect(sent).toMatchObject({
      withdrawal: { processooor: ENTRYPOINT },
      publicSignals: ["7", "8"],
      proof: { pi_a: ["1", "2"], pi_b: [["3", "4"]], pi_c: ["5", "6"] },
      scope: "111",
      chainId: CHAIN,
      feeCommitment: { signedRelayerCommitment: "0x51" },
    });
    expect(sent!.withdrawal.data).toBe(sent!.feeCommitment.withdrawalData);
    expect(sent!.proof).not.toHaveProperty("protocol");

    // Not mined yet: the deposit is on its way out, and can't be spent again.
    await engine.sync(CHAIN);
    expect(amountsOf(engine)).toMatchObject({ spendable: 0n, proving: parseUnits("100", 6) });
    await expect(engine.quote(draftOf(parseUnits("10", 6)))).rejects.toThrow(
      "Not enough spendable balance."
    );

    // Mined: 60 stays behind as a new commitment under the same label.
    const [source, input] = prover.prove.mock.calls[0]!;
    const change = getCommitment(parseUnits("60", 6), 7n, input.newNullifier, input.newSecret);
    state.head += 1n;
    state.logs.push({
      address: USDC_POOL,
      eventName: "Withdrawn",
      args: {
        _processooor: ENTRYPOINT,
        _value: parseUnits("40", 6),
        _spentNullifier: poseidon1([(source as { nullifier: bigint }).nullifier]),
        _newCommitment: change.hash,
      },
      blockNumber: state.head,
      transactionHash: hash,
      logIndex: 0,
    });
    state.stateLeaves.push(change.hash.toString());
    await engine.sync(CHAIN);
    expect(amountsOf(engine)).toMatchObject({ spendable: parseUnits("60", 6), proving: 0n });

    // The change can be spent next.
    await prove(engine, parseUnits("60", 6));
    expect(prover.prove.mock.calls[1]![0]).toMatchObject({ hash: change.hash });
  });

  it("submits a proof once", async () => {
    const context = await unlocked();
    fakeProver();
    await fund(context, parseUnits("100", 6), 7n);
    const operation = await prove(context.engine, parseUnits("40", 6));

    context.state.relayer.answer = { success: false, error: "Simulation failed." };
    await expect(context.engine.submit(operation)).rejects.toThrow("Simulation failed.");
    context.state.relayer.answer = { success: true, txHash: "0x01" };
    await expect(context.engine.submit(operation)).rejects.toThrow("Prove again.");
    expect(context.state.relayer.requests).toHaveLength(1);
    // A failed submit leaves the funds spendable.
    await context.engine.sync(CHAIN);
    expect(amountsOf(context.engine)?.spendable).toBe(parseUnits("100", 6));
  });

  it("renews a fee commitment that ran out, if the fee is the same", async () => {
    const context = await unlocked();
    const { engine, state } = context;
    fakeProver();
    await fund(context, parseUnits("100", 6), 7n);
    state.relayer.lifetime = 1_000;

    const first = await prove(engine, parseUnits("40", 6));
    const quotes = state.relayer.quotes.length;
    await engine.submit(first);
    expect(state.relayer.quotes).toHaveLength(quotes + 1);
    expect(state.relayer.requests).toHaveLength(1);
    await engine.sync(CHAIN);

    await fund(context, parseUnits("50", 6), 8n);
    const second = await prove(engine, parseUnits("50", 6));
    state.relayer.feeBps = 20n;
    await expect(engine.submit(second)).rejects.toThrow("The relayer's fee changed. Prove again.");
    expect(state.relayer.requests).toHaveLength(1);
  });

  it("drops proofs when the account locks", async () => {
    const context = await unlocked();
    fakeProver();
    await fund(context, parseUnits("100", 6), 7n);
    const operation = await prove(context.engine, parseUnits("40", 6));
    context.engine.account.lock();
    await expect(context.engine.submit(operation)).rejects.toThrow("Unlock the private account");
    await context.engine.account.unlock("password");
    await expect(context.engine.submit(operation)).rejects.toThrow("Prove again.");
  });

  // Runs the real circuits. They are 24 MB, so point PP_CIRCUITS_URL at a
  // server that has them under /artifacts to run this.
  it.skipIf(!process.env.PP_CIRCUITS_URL)(
    "makes a proof the real verifier accepts",
    async () => {
      const chain = fakeChain();
      const engine = createPrivacyPoolsEngine({
        chains: {
          [CHAIN]: {
            rpcUrl: "http://unused.test",
            entrypoint: ENTRYPOINT,
            aspUrl: "https://asp.test",
            relayerUrl: "https://relayer.test",
            pools: [{ asset: USDC, deploymentBlock: 100n }],
          },
        },
        storage: memory(),
        pollInterval: 0,
        client: () => chain.client,
        fetch: chain.fetchAsp,
        circuitsUrl: process.env.PP_CIRCUITS_URL,
      });
      await engine.account.import(PHRASE, "password");
      await engine.sync(CHAIN);
      const context = { engine, storage: memory(), ...chain };
      // Other people's deposits, so the trees have more than one leaf.
      chain.state.stateLeaves.push("11", "12", "13");
      chain.state.approved.set("111", ["21", "22"]);
      await fund(context, parseUnits("100", 6), 7n);

      const operation = await prove(engine, parseUnits("40", 6));
      await engine.submit(operation);
      const [sent] = chain.state.relayer.requests;
      // Public signals: new commitment, spent nullifier, amount, state root, depth, ASP root, depth, context.
      expect(sent!.publicSignals).toHaveLength(8);
      expect(sent!.publicSignals[2]).toBe("40000000");
      expect(sent!.publicSignals[4]).toBe("32");
    },
    120_000
  );

  it("says what is missing when unshield is not set up", async () => {
    const chain = fakeChain();
    const engine = createPrivacyPoolsEngine({
      chains: {
        [CHAIN]: {
          rpcUrl: "http://unused.test",
          entrypoint: ENTRYPOINT,
          aspUrl: "https://asp.test",
          pools: [{ asset: USDC, deploymentBlock: 100n }],
        },
      },
      storage: memory(),
      pollInterval: 0,
      client: () => chain.client,
      fetch: chain.fetchAsp,
    });
    await expect(engine.quote(draftOf(parseUnits("1", 6)))).rejects.toThrow("it has no relayer");
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
