import { parseEther } from "viem";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MOCK_MNEMONIC,
  MOCK_TIMINGS,
  createMockShieldedEngine,
  type MockShieldedEngine,
} from "./mock-shielded-engine";
import type { ProofStage, ShieldedSync } from "./shielded-engine";

const weth = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2" as const;
const usdc = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" as const;

/** No timers at all: every flow finishes on the microtask queue. */
const instant = (options: Parameters<typeof createMockShieldedEngine>[0] = {}) =>
  createMockShieldedEngine({ speed: Infinity, ...options });

/** Unlocked, with the first scan finished. */
async function unlocked(options: Parameters<typeof createMockShieldedEngine>[0] = {}) {
  const engine = instant(options);
  await engine.account.unlock("password");
  await engine.sync(1);
  return engine;
}

/** Let work the engine scheduled for "later" (standby, settling) run. */
const settle = () => new Promise((resolve) => setTimeout(resolve));

const amountsOf = (engine: MockShieldedEngine, token: string = weth) =>
  engine.getBalances(1)?.find((balance) => balance.token === token)?.amounts;

function recordSync(engine: MockShieldedEngine) {
  const states: ShieldedSync[] = [];
  engine.subscribe("sync", () => states.push(engine.getSync(1)));
  return states;
}

afterEach(() => vi.useRealTimers());

describe("account", () => {
  it("starts locked and opens with the right password only", async () => {
    const engine = instant();
    expect(engine.account.status()).toBe("locked");
    expect(engine.account.address()).toBeNull();

    await expect(engine.account.unlock("nope")).rejects.toThrow("Wrong password");
    expect(engine.account.status()).toBe("locked");

    await engine.account.unlock("password");
    expect(engine.account.status()).toBe("unlocked");
  });

  it("has a 127-character 0zk address once unlocked", async () => {
    const engine = await unlocked();
    expect(engine.account.address()).toMatch(/^0zk1[a-z0-9]{123}$/);
  });

  it("creates an account, returns the phrase once, and takes about six seconds", async () => {
    vi.useFakeTimers();
    const engine = createMockShieldedEngine({ account: "none" });
    await expect(engine.account.unlock("x")).rejects.toThrow("no private account");

    let created: { mnemonic: string } | undefined;
    void engine.account.create("hunter2").then((result) => (created = result));
    await vi.advanceTimersByTimeAsync(MOCK_TIMINGS.createAccount - 1);
    expect(engine.account.status()).toBe("none");
    await vi.advanceTimersByTimeAsync(1);
    expect(created).toEqual({ mnemonic: MOCK_MNEMONIC });
    expect(engine.account.status()).toBe("unlocked");
  });

  it("imports a phrase and derives a different address from it", async () => {
    const engine = instant({ account: "none" });
    await expect(engine.account.import("too short", "pw")).rejects.toThrow("12 or 24 words");
    await engine.account.import("zoo ".repeat(11) + "wrong", "pw");
    const imported = engine.account.address();

    const other = await unlocked();
    expect(imported).not.toBe(other.account.address());
  });

  it("clears balances and scan state on lock, and tells listeners", async () => {
    const engine = await unlocked({ funds: [{ token: weth, amount: 5n }] });
    const events: string[] = [];
    engine.subscribe("account", () => events.push("account"));
    engine.subscribe("balances", () => events.push("balances"));
    engine.subscribe("sync", () => events.push("sync"));

    engine.account.lock();
    expect(engine.account.status()).toBe("locked");
    expect(engine.getBalances(1)).toBeUndefined();
    expect(engine.getSync(1).status).toBe("idle");
    expect(events.sort()).toEqual(["account", "balances", "sync"]);

    // The funds are still the account's: they come back with the next scan.
    await engine.account.unlock("password");
    await engine.sync(1);
    expect(amountsOf(engine)?.spendable).toBe(5n);
  });
});

describe("scan", () => {
  it("runs two passes, reports progress that goes backwards, and ends on progress 0", async () => {
    const engine = instant();
    const states = recordSync(engine);
    await engine.account.unlock("password");
    await engine.sync(1);

    const stages = [...new Set(states.map((s) => s.stage))];
    expect(stages).toEqual(["notes", "transactions"]);

    const notes = states.filter((s) => s.stage === "notes").map((s) => s.progress);
    expect(notes.some((progress, i) => i > 0 && progress < notes[i - 1]!)).toBe(true);

    expect(states.at(-1)).toEqual({ stage: "transactions", status: "synced", progress: 0 });
  });

  it("publishes balances once, as a whole, when the scan finishes", async () => {
    vi.useFakeTimers();
    const engine = createMockShieldedEngine({
      funds: [
        { token: weth, amount: 3n },
        { token: weth, amount: 2n, state: "pending" },
        { token: usdc, amount: 7n, state: "restricted" },
      ],
    });
    const published = vi.fn();
    engine.subscribe("balances", published);
    void engine.account.unlock("password");

    await vi.advanceTimersByTimeAsync(MOCK_TIMINGS.unlock + MOCK_TIMINGS.firstScan - 100);
    expect(engine.getSync(1).status).toBe("syncing");
    expect(engine.getBalances(1)).toBeUndefined();
    expect(published).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(200);
    expect(engine.getSync(1).status).toBe("synced");
    expect(published).toHaveBeenCalledTimes(1);
    expect(engine.getBalances(1)).toEqual([
      { token: weth, amounts: { spendable: 3n, pending: 2n, proving: 0n, incomplete: 0n, restricted: 0n } },
      { token: usdc, amounts: { spendable: 0n, pending: 0n, proving: 0n, incomplete: 0n, restricted: 7n } },
    ]);
  });

  it("is quick after the first one and keeps the same snapshot when nothing changed", async () => {
    vi.useFakeTimers();
    const engine = createMockShieldedEngine({ funds: [{ token: weth, amount: 3n }] });
    void engine.account.unlock("password");
    await vi.advanceTimersByTimeAsync(MOCK_TIMINGS.unlock + MOCK_TIMINGS.firstScan + 100);
    const before = engine.getBalances(1);
    expect(engine.getSync(1)).toBe(engine.getSync(1));

    let done = false;
    void engine.sync(1).then(() => (done = true));
    await vi.advanceTimersByTimeAsync(MOCK_TIMINGS.repeatScan - 100);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(200);
    expect(done).toBe(true);
    expect(engine.getBalances(1)).toBe(before);
  });

  it("can fail part-way, keeps the last balances, and recovers on the next scan", async () => {
    const engine = await unlocked({ funds: [{ token: weth, amount: 3n }] });
    const before = engine.getBalances(1);

    engine.simulate.failNextSync("RPC rate limited");
    await engine.sync(1);
    expect(engine.getSync(1)).toMatchObject({ status: "error", error: "RPC rate limited" });
    expect(engine.getBalances(1)).toBe(before);

    await engine.sync(1);
    expect(engine.getSync(1).status).toBe("synced");
  });

  it("only scans the configured chains on its own", async () => {
    const engine = await unlocked({ chains: [1] });
    expect(engine.getSync(11155111).status).toBe("idle");
    await engine.sync(11155111);
    expect(engine.getSync(11155111).status).toBe("synced");
    expect(engine.getBalances(11155111)).toEqual([]);
  });

  it("does nothing while locked", async () => {
    const engine = instant();
    await engine.sync(1);
    expect(engine.getSync(1).status).toBe("idle");
  });
});

describe("shield and unshield", () => {
  it("takes 25 bps on the way in and holds the funds for the standby period", async () => {
    vi.useFakeTimers();
    const engine = createMockShieldedEngine();
    void engine.account.unlock("password");
    await vi.advanceTimersByTimeAsync(MOCK_TIMINGS.unlock + MOCK_TIMINGS.firstScan + 100);

    let result: { fee: bigint; received: bigint } | undefined;
    void engine.simulate
      .shield({ token: weth, amount: parseEther("0.01") })
      .then((value) => (result = value));

    // Nothing shows until the next scan has finished.
    expect(amountsOf(engine)).toBeUndefined();
    await vi.advanceTimersByTimeAsync(MOCK_TIMINGS.repeatScan + 100);
    expect(result).toEqual({ fee: parseEther("0.000025"), received: parseEther("0.009975") });
    expect(amountsOf(engine)).toMatchObject({ pending: parseEther("0.009975"), spendable: 0n });

    await vi.advanceTimersByTimeAsync(MOCK_TIMINGS.standby + MOCK_TIMINGS.repeatScan);
    expect(amountsOf(engine)).toMatchObject({ pending: 0n, spendable: parseEther("0.009975") });
  });

  it("can leave shielded funds restricted", async () => {
    const engine = await unlocked();
    await engine.simulate.shield({ token: weth, amount: 10_000n, outcome: "restricted" });
    await settle();
    expect(amountsOf(engine)).toMatchObject({ restricted: 9_975n, spendable: 0n });
  });

  it("takes 25 bps on the way out and returns the rest of the note as change", async () => {
    vi.useFakeTimers();
    const engine = createMockShieldedEngine({
      funds: [{ token: weth, amount: parseEther("0.009975") }],
    });
    void engine.account.unlock("password");
    await vi.advanceTimersByTimeAsync(MOCK_TIMINGS.unlock + MOCK_TIMINGS.firstScan + 100);

    let result: { fee: bigint; received: bigint } | undefined;
    void engine.simulate
      .unshield({ token: weth, amount: parseEther("0.005") })
      .then((value) => (result = value));
    await vi.advanceTimersByTimeAsync(MOCK_TIMINGS.repeatScan + 100);

    expect(result?.received).toBe(parseEther("0.0049875"));
    expect(amountsOf(engine)).toMatchObject({ spendable: 0n, proving: parseEther("0.004975") });

    await vi.advanceTimersByTimeAsync(MOCK_TIMINGS.settle + MOCK_TIMINGS.repeatScan);
    expect(amountsOf(engine)).toMatchObject({ spendable: parseEther("0.004975"), proving: 0n });
  });

  it("refuses to spend more than is spendable", async () => {
    const engine = await unlocked({
      funds: [
        { token: weth, amount: 5n },
        { token: weth, amount: 100n, state: "pending" },
      ],
    });
    await expect(engine.simulate.unshield({ token: weth, amount: 6n })).rejects.toThrow(
      "Not enough spendable balance"
    );
    expect(amountsOf(engine)?.spendable).toBe(5n);
  });

  it("can leave change incomplete until the proofs are retried", async () => {
    const engine = await unlocked({ funds: [{ token: weth, amount: 10n }] });
    await engine.simulate.unshield({ token: weth, amount: 4n, change: "incomplete" });
    await settle();
    expect(amountsOf(engine)).toMatchObject({ incomplete: 6n, spendable: 0n });

    engine.simulate.keepIncomplete();
    await engine.retryProofs(1);
    await settle();
    expect(amountsOf(engine)?.incomplete).toBe(6n);

    engine.simulate.failNextRetry("Proof service unavailable");
    await expect(engine.retryProofs(1)).rejects.toThrow("Proof service unavailable");

    engine.simulate.keepIncomplete(false);
    await engine.retryProofs(1);
    await settle();
    expect(amountsOf(engine)).toMatchObject({ incomplete: 0n, spendable: 6n });
  });

  it("puts funds in any state on demand", async () => {
    const engine = await unlocked();
    await engine.simulate.addFunds({ token: usdc, amount: 9n, state: "incomplete" });
    expect(amountsOf(engine, usdc)?.incomplete).toBe(9n);
  });
});

describe("prove", () => {
  const draft = {
    kind: "unshield",
    chainId: 1,
    token: weth,
    amount: 4n,
    recipient: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
  } as const;
  const funds = [{ token: weth, amount: 10n }];

  it("reports the three stages in order and returns the operation", async () => {
    const engine = await unlocked({ funds });
    const stages: ProofStage[] = [];
    const operation = await engine.prove(draft, { onStage: (stage) => stages.push(stage) });

    expect(stages).toEqual(["loading-circuits", "proving", "verifying"]);
    expect(operation.draft).toBe(draft);
    expect(operation.expiresAt).toBeGreaterThan(Date.now());
    // Proving alone moves nothing.
    expect(amountsOf(engine)?.spendable).toBe(10n);
  });

  it("downloads the circuits on the first proof only", async () => {
    vi.useFakeTimers();
    const engine = createMockShieldedEngine({ funds });
    void engine.account.unlock("password");
    await vi.advanceTimersByTimeAsync(MOCK_TIMINGS.unlock + MOCK_TIMINGS.firstScan + 100);

    const time = async () => {
      const stages: ProofStage[] = [];
      let done = false;
      void engine.prove(draft, { onStage: (s) => stages.push(s) }).then(() => (done = true));
      await vi.advanceTimersByTimeAsync(MOCK_TIMINGS.loadCircuits - 100);
      const stillLoading = stages.at(-1) === "loading-circuits";
      await vi.advanceTimersByTimeAsync(MOCK_TIMINGS.prove + MOCK_TIMINGS.verify + 200);
      expect(done).toBe(true);
      return stillLoading;
    };

    expect(await time()).toBe(true);
    expect(await time()).toBe(false);
  });

  it("stops when aborted and rejects with the signal's reason", async () => {
    vi.useFakeTimers();
    const engine = createMockShieldedEngine({ funds });
    void engine.account.unlock("password");
    await vi.advanceTimersByTimeAsync(MOCK_TIMINGS.unlock + MOCK_TIMINGS.firstScan + 100);

    const controller = new AbortController();
    const stages: ProofStage[] = [];
    const proof = engine.prove(draft, { onStage: (s) => stages.push(s), signal: controller.signal });
    const outcome = expect(proof).rejects.toMatchObject({ name: "AbortError" });
    await vi.advanceTimersByTimeAsync(MOCK_TIMINGS.loadCircuits + 100);
    controller.abort();
    await outcome;
    await vi.advanceTimersByTimeAsync(MOCK_TIMINGS.prove + MOCK_TIMINGS.verify);
    expect(stages).toEqual(["loading-circuits", "proving"]);
  });

  it("fails on demand, for a locked account, and for more than is spendable", async () => {
    const engine = await unlocked({ funds });
    const onStage = () => {};

    engine.simulate.failNextProof("Out of memory");
    await expect(engine.prove(draft, { onStage })).rejects.toThrow("Out of memory");
    await expect(engine.prove(draft, { onStage })).resolves.toBeDefined();

    await expect(engine.prove({ ...draft, amount: 11n }, { onStage })).rejects.toThrow(
      "Not enough spendable balance"
    );

    engine.account.lock();
    await expect(engine.prove(draft, { onStage })).rejects.toThrow("Unlock the private account");
  });
});

describe("options", () => {
  it("scales every delay by speed", async () => {
    vi.useFakeTimers();
    const engine = createMockShieldedEngine({ speed: 10 });
    void engine.account.unlock("password");
    await vi.advanceTimersByTimeAsync((MOCK_TIMINGS.unlock + MOCK_TIMINGS.firstScan) / 10 + 100);
    expect(engine.getSync(1).status).toBe("synced");
  });

  it("rejects a speed that would never finish", () => {
    expect(() => createMockShieldedEngine({ speed: 0 })).toThrow(RangeError);
  });

  it("stops notifying a listener once it unsubscribes", async () => {
    const engine = instant();
    const listener = vi.fn();
    const unsubscribe = engine.subscribe("account", listener);
    unsubscribe();
    await engine.account.unlock("password");
    expect(listener).not.toHaveBeenCalled();
  });
});
