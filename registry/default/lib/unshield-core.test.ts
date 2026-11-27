import { parseUnits } from "viem";
import type { Address } from "viem";
import { describe, expect, it, vi } from "vitest";
import { createMockShieldedEngine } from "./mock-shielded-engine";
import {
  createUnshieldFlow,
  unshieldConfirmText,
  unshieldFormAction,
  unshieldPhase,
  unshieldQuoteQueryOptions,
  unshieldRunningLabel,
} from "./unshield-core";
import type { UnshieldFlow } from "./unshield-core";
import type { UnshieldDraft } from "./shielded-engine";

const token: Address = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
const recipient: Address = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
const amount = parseUnits("4", 18);
const draft: UnshieldDraft = { kind: "unshield", chainId: 1, token, amount, recipient };

async function setup() {
  const engine = createMockShieldedEngine({
    speed: Infinity,
    funds: [{ token, amount: parseUnits("10", 18) }],
  });
  await engine.account.unlock("password");
  await engine.sync(1);
  const onSubmitted = vi.fn();
  const flow = createUnshieldFlow(engine, { onSubmitted });
  const stop = flow.subscribe(() => {});
  const expected = await engine.quote(draft);
  return { engine, flow, stop, onSubmitted, expected };
}

const phaseOf = (flow: UnshieldFlow) => unshieldPhase(flow.get());

describe("createUnshieldFlow", () => {
  it("proves and submits with no wallet, then goes back to the form", async () => {
    const { flow, onSubmitted, expected, stop } = await setup();
    flow.start(draft, expected);
    expect(flow.get().active?.draft).toEqual(draft);
    await vi.waitFor(() => expect(onSubmitted).toHaveBeenCalledTimes(1));
    expect(onSubmitted.mock.calls[0]![0]).toMatch(/^0x[0-9a-f]{64}$/);
    expect(flow.get().active).toBeUndefined();
    expect(phaseOf(flow)).toBe("idle");
    stop();
  });

  it("stops in review when the proof's fee went up, and sends on confirm", async () => {
    const { engine, flow, onSubmitted, expected, stop } = await setup();
    const prove = engine.prove.bind(engine);
    vi.spyOn(engine, "prove").mockImplementation(async (d, options) => {
      const operation = await prove(d, options);
      return { ...operation, quote: { fee: expected.fee + 1n, received: expected.received - 1n } };
    });
    const submit = vi.spyOn(engine, "submit");
    flow.start(draft, expected);
    await vi.waitFor(() => expect(phaseOf(flow)).toBe("review"));
    expect(submit).not.toHaveBeenCalled();
    flow.confirm();
    await vi.waitFor(() => expect(onSubmitted).toHaveBeenCalledTimes(1));
    stop();
  });

  it("keeps the unshield open after a failed send, and leave drops it", async () => {
    const { engine, flow, onSubmitted, expected, stop } = await setup();
    vi.spyOn(engine, "submit").mockRejectedValueOnce(new Error("The relayer is busy."));
    flow.start(draft, expected);
    await vi.waitFor(() => expect(phaseOf(flow)).toBe("error"));
    expect(flow.get().failure?.message).toBe("The relayer is busy.");
    expect(flow.get().active).toBeDefined();
    flow.leave();
    expect(phaseOf(flow)).toBe("idle");
    expect(flow.get().active).toBeUndefined();
    expect(onSubmitted).not.toHaveBeenCalled();
    stop();
  });

  it("proves again on retry after a failed proof", async () => {
    const { engine, flow, onSubmitted, expected, stop } = await setup();
    engine.simulate.failNextProof("Out of memory");
    flow.start(draft, expected);
    await vi.waitFor(() => expect(phaseOf(flow)).toBe("error"));
    expect(flow.get().proof.error?.message).toBe("Out of memory");
    flow.retry();
    await vi.waitFor(() => expect(onSubmitted).toHaveBeenCalledTimes(1));
    stop();
  });
});

describe("unshield helpers", () => {
  it("asks the price with the zero address and only for a real amount", async () => {
    const engine = createMockShieldedEngine({ speed: Infinity });
    const quote = vi.spyOn(engine, "quote").mockResolvedValue({ fee: 1n, received: 2n });
    const options = unshieldQuoteQueryOptions(engine, { chainId: 1, token, amount });
    expect(options.enabled).toBe(true);
    await options.queryFn();
    expect(quote).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "unshield",
        recipient: "0x0000000000000000000000000000000000000000",
      }),
    );
    expect(unshieldQuoteQueryOptions(engine, { chainId: 1, token, amount: 0n }).enabled).toBe(
      false,
    );
    expect(
      unshieldQuoteQueryOptions(engine, { chainId: 1, token, amount }, { enabled: false }).enabled,
    ).toBe(false);
  });

  it("labels the button", () => {
    const base = {
      blocker: undefined,
      quoteFailed: false,
      quoting: false,
      quoted: true,
      symbol: "TKN",
    };
    expect(unshieldFormAction(base)).toEqual({ label: "Unshield TKN", ready: true });
    expect(unshieldFormAction({ ...base, blocker: "Enter an amount" })).toEqual({
      label: "Enter an amount",
      ready: false,
    });
    expect(unshieldFormAction({ ...base, quoteFailed: true }).label).toBe(
      "Can't unshield this amount",
    );
    expect(unshieldFormAction({ ...base, quoted: false }).label).toBe("Fetching quote…");
    expect(unshieldRunningLabel("review")).toBe("Unshield at the new fee");
    expect(unshieldRunningLabel("error")).toBe("Try again");
  });

  it("tells a person what an agent's unshield does", () => {
    const text = unshieldConfirmText({
      amount,
      token: { symbol: "TKN", decimals: 18 },
      quote: { fee: parseUnits("0.01", 18), received: parseUnits("3.99", 18) },
      recipient,
    });
    expect(text).toBe(
      `Unshields 4 TKN from your private balance to ${recipient}, a public address: 3.99 TKN arrives after a 0.01 TKN fee. No wallet prompt.`,
    );
  });
});
