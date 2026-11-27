import { parseEther } from "viem";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MOCK_TIMINGS, createMockShieldedEngine } from "./mock-shielded-engine";
import { createProver, proofStepStates } from "./proof-progress-core";

const weth = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
const draft = {
  kind: "unshield",
  chainId: 1,
  token: weth,
  amount: parseEther("0.5"),
  recipient: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
} as const;

async function timedEngine() {
  vi.useFakeTimers();
  const engine = createMockShieldedEngine({ funds: [{ token: weth, amount: parseEther("1") }] });
  void engine.account.unlock("password");
  await vi.advanceTimersByTimeAsync(MOCK_TIMINGS.unlock + MOCK_TIMINGS.firstScan + 100);
  return engine;
}

afterEach(() => vi.useRealTimers());

describe("createProver", () => {
  it("walks through the stages without any framework", async () => {
    const engine = await timedEngine();
    const onProved = vi.fn();
    const prover = createProver(engine, { onProved });
    const phases: Array<string> = [];
    prover.subscribe(() => phases.push(prover.get().phase));

    const proved = prover.prove(draft);
    await vi.advanceTimersByTimeAsync(
      MOCK_TIMINGS.loadCircuits + MOCK_TIMINGS.prove + MOCK_TIMINGS.verify + 100,
    );
    expect(await proved).toMatchObject({ draft });
    expect(phases).toEqual(["loading-circuits", "proving", "verifying", "done"]);
    expect(onProved).toHaveBeenCalledOnce();
  });

  it("cancels quietly and remembers the stage it stopped in", async () => {
    const engine = await timedEngine();
    const onError = vi.fn();
    const prover = createProver(engine, { onError });
    const proved = prover.prove(draft);
    await vi.advanceTimersByTimeAsync(MOCK_TIMINGS.loadCircuits + 100);
    prover.cancel();
    expect(await proved).toBeUndefined();
    expect(prover.get()).toMatchObject({ phase: "cancelled", stage: "proving" });
    expect(proofStepStates("cancelled", "proving")).toMatchObject({ proving: "todo" });
    expect(onError).not.toHaveBeenCalled();

    prover.reset();
    expect(prover.get().phase).toBe("idle");
  });
});
