import { parseEther } from "viem";
import { describe, expect, it } from "vitest";
import { createMockShieldedEngine } from "./mock-shielded-engine";
import { createShieldedBalances, tokenAmounts, totalShielded } from "./shielded-balance-core";

const weth = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";

describe("createShieldedBalances", () => {
  it("goes from idle to ready as the account unlocks and scans", async () => {
    const engine = createMockShieldedEngine({
      speed: Infinity,
      funds: [
        { token: weth, amount: parseEther("1") },
        { token: weth, amount: parseEther("0.5"), state: "incomplete" },
      ],
    });
    const balances = createShieldedBalances(engine, 1);
    const stop = balances.subscribe(() => {});
    expect(balances.get().phase).toBe("idle");

    await engine.account.unlock("password");
    await engine.sync(1);
    const { phase, balances: snapshot } = balances.get();
    expect(phase).toBe("ready");
    const amounts = tokenAmounts(snapshot!, weth.toLowerCase() as `0x${string}`);
    expect(amounts.incomplete).toBe(parseEther("0.5"));
    expect(totalShielded(amounts)).toBe(parseEther("1.5"));

    await balances.retryProofs();
    expect(balances.get().retryPhase).toBe("retried");
    expect(tokenAmounts(balances.get().balances!, weth).incomplete).toBe(0n);
    stop();
  });

  it("reports a failed retry", async () => {
    const engine = createMockShieldedEngine({
      speed: Infinity,
      funds: [{ token: weth, amount: 5n, state: "incomplete" }],
    });
    await engine.account.unlock("password");
    await engine.sync(1);
    const balances = createShieldedBalances(engine, 1);
    engine.simulate.failNextRetry("Proof service unavailable");
    await balances.retryProofs();
    expect(balances.get()).toMatchObject({
      retryPhase: "error",
      retryError: expect.objectContaining({ message: "Proof service unavailable" }),
    });
  });
});
