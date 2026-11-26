import { afterEach, describe, expect, it, vi } from "vitest";
import { MOCK_MNEMONIC, MOCK_TIMINGS, createMockShieldedEngine } from "./mock-shielded-engine";
import { createShieldedAccountFlow, passwordBlocker, phraseBlocker } from "./shielded-account-core";

afterEach(() => vi.useRealTimers());

describe("createShieldedAccountFlow", () => {
  it("creates an account and holds the phrase only until the backup is confirmed", async () => {
    vi.useFakeTimers();
    const engine = createMockShieldedEngine({ account: "none" });
    const flow = createShieldedAccountFlow(engine);
    const phases: Array<string> = [];
    const stop = flow.subscribe(() => phases.push(flow.get().phase));
    expect(flow.get().phase).toBe("none");

    const created = flow.create("correct horse");
    expect(flow.get().phase).toBe("creating");
    await vi.advanceTimersByTimeAsync(MOCK_TIMINGS.createAccount);
    expect(await created).toBe(true);
    expect(flow.get()).toMatchObject({ phase: "backup", mnemonic: MOCK_MNEMONIC });

    flow.confirmBackup();
    expect(flow.get()).toMatchObject({ phase: "unlocked", mnemonic: undefined });
    expect(flow.get().address).toHaveLength(127);
    expect(phases).toEqual(expect.arrayContaining(["creating", "backup", "unlocked"]));
    stop();
  });

  it("keeps a wrong password as the error, then clears it on the next try", async () => {
    const engine = createMockShieldedEngine({ speed: Infinity });
    const flow = createShieldedAccountFlow(engine);
    const stop = flow.subscribe(() => {});

    expect(await flow.unlock("wrong")).toBe(false);
    expect(flow.get()).toMatchObject({ phase: "locked", error: expect.any(Error) });
    expect(await flow.unlock("password")).toBe(true);
    expect(flow.get()).toMatchObject({ phase: "unlocked", error: undefined });

    flow.lock();
    expect(flow.get()).toMatchObject({ phase: "locked", address: null });
    stop();
  });

  it("names what a password or phrase is missing", () => {
    expect(passwordBlocker("short", "short")).toBe("Use at least 8 characters");
    expect(phraseBlocker("one two")).toBe("Enter all 12 or 24 words (2 so far)");
    expect(phraseBlocker(MOCK_MNEMONIC)).toBeUndefined();
  });
});
