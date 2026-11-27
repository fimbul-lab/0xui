import { parseUnits } from "viem";
import type { Address, Hash } from "viem";
import { describe, expect, it, vi } from "vitest";
import { connectMock, createTestConfig, fakeChainRpc, testAccounts } from "../../../test/wagmi";
import { MOCK_SHIELD_CONTRACT, createMockShieldedEngine } from "./mock-shielded-engine";
import { createShieldedClient } from "./shielded-client";
import type { ShieldedExit } from "./shielded-engine";
import {
  createShieldedExitFlow,
  exitProofPhase,
  selectShieldedExits,
  shieldedExitAction,
  shieldedExitConfirmText,
} from "./shielded-exits-core";

const token: Address = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
const depositor = testAccounts[0] as Address;

async function setup() {
  const engine = createMockShieldedEngine({
    speed: Infinity,
    funds: [{ token, amount: parseUnits("3", 18), state: "restricted", depositor }],
  });
  await engine.account.unlock("password");
  await engine.sync(1);
  const sends: Array<{ to: string }> = [];
  const chain = fakeChainRpc({});
  const send = chain.eth_sendTransaction as (params: unknown) => unknown;
  const config = createTestConfig({
    rpc: {
      ...chain,
      eth_sendTransaction: (params: [{ to: string }]) => {
        sends.push(params[0]);
        return send(params);
      },
    },
  });
  await connectMock(config);
  /** `firstSubmit` resolves with the first call to `onSubmitted`. */
  const { promise: firstSubmit, resolve } = Promise.withResolvers<[Hash, ShieldedExit]>();
  const flow = createShieldedExitFlow(config, engine, {
    chainId: 1,
    onSubmitted: (hash, exit) => resolve([hash, exit]),
  });
  const stop = flow.subscribe(() => {});
  const exits = selectShieldedExits(createShieldedClient(engine), 1).get()!;
  return { engine, flow, stop, firstSubmit, sends, exit: exits[0]! };
}

describe("createShieldedExitFlow", () => {
  it("proves on one call and opens the wallet on the next", async () => {
    const { flow, firstSubmit, sends, exit, stop } = await setup();
    expect(flow.get().address).toBe(depositor);

    flow.prepare(exit);
    expect(flow.get().phase).toBe("proving");
    await vi.waitFor(() => expect(flow.get().phase).toBe("ready"));
    expect(sends).toHaveLength(0);

    flow.send();
    const [hash, sent] = await firstSubmit;
    expect(hash).toMatch(/^0x/);
    expect(sent).toEqual(exit);
    expect(sends[0]!.to.toLowerCase()).toBe(MOCK_SHIELD_CONTRACT.toLowerCase());
    // Sent: the exit is closed.
    expect(flow.get().exit).toBeUndefined();
    expect(flow.get().phase).toBe("idle");
    stop();
  });

  it("records a failed proof and closes on leave", async () => {
    const { engine, flow, exit, stop } = await setup();
    // The funds went back before the proof was asked for, so the engine can't prove it.
    await engine.simulate.exit(exit.id);
    flow.prepare(exit);
    await vi.waitFor(() => expect(flow.get().phase).toBe("error"));
    expect(flow.get().problem).toMatchObject({
      message: "These funds are no longer there to exit. Scan again.",
      proof: true,
    });
    flow.leave();
    expect(flow.get()).toMatchObject({ phase: "idle", exit: undefined, problem: undefined });
    stop();
  });

  it("opens an exit without proving", async () => {
    const { engine, flow, exit, stop } = await setup();
    const prepare = vi.spyOn(engine, "prepareExit");
    flow.open(exit);
    expect(flow.get()).toMatchObject({ phase: "idle", exit });
    expect(prepare).not.toHaveBeenCalled();
    stop();
  });
});

describe("shielded exit helpers", () => {
  it("labels the open exit's button", () => {
    const base = { blocker: undefined, phase: "idle", prepared: false, switching: false } as const;
    expect(shieldedExitAction(base)).toEqual({ label: "Prepare exit", action: "prepare" });
    expect(shieldedExitAction({ ...base, phase: "proving" })).toEqual({ label: "Preparing exit…" });
    expect(shieldedExitAction({ ...base, phase: "ready", prepared: true })).toEqual({
      label: "Send exit from wallet",
      action: "send",
    });
    expect(shieldedExitAction({ ...base, phase: "wallet", prepared: true })).toEqual({
      label: "Confirm in wallet…",
    });
    expect(shieldedExitAction({ ...base, phase: "error" })).toEqual({
      label: "Try again",
      action: "prepare",
    });
    const wrongChain = { label: "Switch to Ethereum", action: "switch-chain" } as const;
    expect(shieldedExitAction({ ...base, blocker: wrongChain })).toEqual(wrongChain);
    expect(shieldedExitAction({ ...base, blocker: wrongChain, switching: true })).toEqual({
      label: "Switching network…",
    });
  });

  it("shows the proof the way ProofProgress expects", () => {
    const base = { phase: "idle", stage: undefined, problem: undefined, prepared: false } as const;
    expect(exitProofPhase(base)).toBe("idle");
    expect(exitProofPhase({ ...base, phase: "proving", stage: "proving" })).toBe("proving");
    expect(exitProofPhase({ ...base, phase: "proving" })).toBe("loading-circuits");
    expect(exitProofPhase({ ...base, phase: "ready", prepared: true })).toBe("done");
    expect(exitProofPhase({ ...base, phase: "cancelled" })).toBe("cancelled");
    // A wallet cancel after the proof keeps the proof done.
    expect(exitProofPhase({ ...base, phase: "cancelled", prepared: true })).toBe("done");
    expect(
      exitProofPhase({ ...base, phase: "error", problem: { message: "x", proof: true } }),
    ).toBe("error");
  });

  it("tells a person the exit is public and final", () => {
    expect(
      shieldedExitConfirmText({
        exit: { amount: parseUnits("3", 18), depositor },
        token: { symbol: "TKN", decimals: 18 },
      }),
    ).toBe(
      `Sends 3 TKN from your private balance back to ${depositor} in public. Anyone can see it, and it can't be undone.`,
    );
  });
});
