import { afterEach, describe, expect, it, vi } from "vitest";
import { MOCK_TIMINGS, createMockShieldedEngine } from "./mock-shielded-engine";
import { createShieldedSync } from "./shielded-sync";

afterEach(() => vi.useRealTimers());

describe("createShieldedSync", () => {
  it("follows a scan with progress that never moves backwards", async () => {
    vi.useFakeTimers();
    const engine = createMockShieldedEngine();
    const sync = createShieldedSync(engine, 1);
    const seen: Array<number> = [];
    const stop = sync.subscribe(() => seen.push(sync.get().progress));
    expect(sync.get().phase).toBe("idle");

    void engine.account.unlock("password");
    await vi.advanceTimersByTimeAsync(MOCK_TIMINGS.unlock + MOCK_TIMINGS.firstScan + 1000);
    expect(sync.get()).toMatchObject({ phase: "synced", progress: 1, isUpdate: false });
    expect(seen.every((value, i) => i === 0 || value >= seen[i - 1]!)).toBe(true);
    stop();
  });

  it("calls a later scan an update, and drops the last error once it recovers", async () => {
    const engine = createMockShieldedEngine({ speed: Infinity });
    await engine.account.unlock("password");
    await engine.sync(1);
    const sync = createShieldedSync(engine, 1);
    const stop = sync.subscribe(() => {});

    engine.simulate.failNextSync("RPC rate limited");
    await sync.sync();
    expect(sync.get()).toMatchObject({ phase: "error", error: "RPC rate limited", isUpdate: true });
    await sync.sync();
    expect(sync.get()).toMatchObject({ phase: "synced", error: undefined, isUpdate: false });
    stop();
  });
});
