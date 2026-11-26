import { readContract } from "@wagmi/core";
import { decodeFunctionData, erc20Abi, parseUnits, type Address, type Hash } from "viem";
import { describe, expect, it, vi } from "vitest";
import {
  connectMock,
  createTestConfig,
  erc20CallRpc,
  fakeChainRpc,
  fakeTxHash,
  testAccounts,
} from "../../../test/wagmi";
import { MOCK_SHIELD_CONTRACT, createMockShieldedEngine } from "./mock-shielded-engine";
import {
  createShieldFlow,
  planShield,
  shieldConfirmText,
  shieldFormAction,
  shieldPhase,
  shieldStepConfirmText,
  shieldStepLabel,
  shieldStepStates,
  type ShieldFlow,
} from "./shield-core";

const token: Address = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
const amount = parseUnits("2", 18);
type Sent = { to: Address; data?: `0x${string}` };

/** A wallet holding 10 TKN, with no allowance until the first transaction raises it. */
function walletConfig({ sent, reject }: { sent: Array<Sent>; reject?: boolean }) {
  let allowance = 0n;
  const chain = fakeChainRpc();
  const send = chain.eth_sendTransaction as (params: unknown) => unknown;
  return createTestConfig({
    features: reject ? { signMessageError: true } : undefined,
    rpc: {
      ...chain,
      eth_call: erc20CallRpc({ balance: parseUnits("10", 18), allowance: () => allowance }),
      eth_sign: () => `0x${"11".repeat(65)}`,
      eth_sendTransaction: (params: [Sent]) => {
        sent.push(params[0]);
        allowance = amount;
        return send(params);
      },
    },
  });
}

/** Wait until the flow is waiting for a click again. */
const ready = (flow: ShieldFlow) =>
  vi.waitFor(() => expect(flow.get()).toMatchObject({ stepPhase: "ready" }), { timeout: 5_000 });

describe("createShieldFlow", () => {
  it("signs, approves and shields, one call each, without any framework", async () => {
    const sent: Array<Sent> = [];
    const config = walletConfig({ sent });
    await connectMock(config);
    const engine = createMockShieldedEngine({ speed: Infinity });
    await engine.account.unlock("password");
    const submitted: Array<Hash> = [];
    const flow = createShieldFlow(config, engine, { onSubmitted: (hash) => submitted.push(hash) });
    const stop = flow.subscribe(() => {});
    expect(flow.get()).toMatchObject({
      connected: true,
      account: testAccounts[0],
      walletChainId: 1,
    });

    const draft = { chainId: 1, token, amount };
    const quote = await engine.quoteShield(draft);
    const allowance = await readContract(config, {
      address: token,
      abi: erc20Abi,
      functionName: "allowance",
      args: [testAccounts[0], quote.spender!],
    });
    const plan = planShield({ draft, quote, allowance, atomic: false })!;
    expect(plan.steps).toEqual(["sign", "approve", "shield"]);

    flow.start({ draft, quote, ...plan });
    expect(shieldPhase(flow.get())).toBe("signing");
    await ready(flow);
    expect(shieldStepStates(flow.get()).map((s) => s.state)).toEqual(["done", "ready", "todo"]);
    expect(shieldStepLabel("approve", flow.get().stepPhase, "TKN")).toBe("Approve TKN");

    flow.act();
    await ready(flow);
    expect(shieldPhase(flow.get())).toBe("shielding");
    const { args } = decodeFunctionData({ abi: erc20Abi, data: sent[0]!.data! });
    expect([String(args![0]).toLowerCase(), args![1]]).toEqual([
      MOCK_SHIELD_CONTRACT.toLowerCase(),
      amount,
    ]);

    flow.act();
    await vi.waitFor(() => expect(submitted).toEqual([fakeTxHash]));
    expect(flow.get().active).toBeUndefined();
    expect(shieldPhase(flow.get())).toBe("idle");
    stop();
  });

  it("treats a declined signature as a cancel, and leave goes back to the form", async () => {
    const sent: Array<Sent> = [];
    const config = walletConfig({ sent, reject: true });
    await connectMock(config);
    const engine = createMockShieldedEngine({ speed: Infinity });
    await engine.account.unlock("password");
    const flow = createShieldFlow(config, engine);

    const draft = { chainId: 1, token, amount };
    const quote = await engine.quoteShield(draft);
    flow.start({ draft, quote, steps: ["sign", "shield"], leftover: false });
    await ready(flow);
    expect(flow.get().problem).toEqual({ kind: "cancelled" });
    expect(shieldPhase(flow.get())).toBe("cancelled");

    flow.leave();
    expect(flow.get()).toMatchObject({ active: undefined, problem: undefined });
    expect(sent).toHaveLength(0);
  });

  it("names what the form's button does", () => {
    const base = {
      connected: true,
      blocker: undefined,
      wrongChain: false,
      switching: false,
      chainName: "Sepolia",
      quoteFailed: false,
      quoting: false,
      planned: true,
      symbol: "TKN",
    };
    expect(shieldFormAction({ ...base, connected: false })).toEqual({
      label: "Connect wallet",
      action: "connect",
    });
    expect(shieldFormAction({ ...base, blocker: "Enter an amount" })).toEqual({
      label: "Enter an amount",
    });
    expect(shieldFormAction({ ...base, wrongChain: true })).toEqual({
      label: "Switch to Sepolia",
      action: "switch",
    });
    expect(shieldFormAction({ ...base, wrongChain: true, switching: true })).toEqual({
      label: "Switching network…",
    });
    expect(shieldFormAction({ ...base, planned: false })).toEqual({ label: "Fetching quote…" });
    expect(shieldFormAction(base)).toEqual({ label: "Shield TKN", action: "start" });
  });

  it("waits for the allowance before planning, when there is a spender", () => {
    const draft = { chainId: 1, token, amount };
    const quote = {
      fee: 0n,
      received: amount,
      standby: 0,
      spender: MOCK_SHIELD_CONTRACT,
      needsSignature: false,
    };
    expect(planShield({ draft, quote, allowance: undefined, atomic: true })).toBeUndefined();
    expect(planShield({ draft, quote, allowance: 5n, atomic: true })).toEqual({
      steps: ["batch"],
      leftover: true,
    });
    // USDT clears a leftover allowance before raising it.
    const usdt = { ...draft, token: "0xdAC17F958D2ee523a2206206994597C13D831ec7" as Address };
    expect(planShield({ draft: usdt, quote, allowance: 5n, atomic: false })!.steps).toEqual([
      "reset",
      "approve",
      "shield",
    ]);
  });
});

describe("shield confirmations", () => {
  const token = { symbol: "TKN", decimals: 18 };
  const amount = parseUnits("2", 18);

  it("names the amount, what arrives after the fee, the network and the prompts", () => {
    const quote = { fee: parseUnits("0.005", 18), received: parseUnits("1.995", 18) };
    expect(
      shieldConfirmText({ amount, token, quote, steps: ["sign", "batch"], chainName: "Sepolia" }),
    ).toBe(
      "Shields 2 TKN from your wallet into your private balance on Sepolia: " +
        "1.995 TKN arrives after a 0.005 TKN fee. Two wallet prompts: sign, approve and shield together.",
    );
  });

  it("names each wallet step with what it is for", () => {
    expect(shieldStepConfirmText("sign", { amount, token })).toBe(
      "Sign to prepare the shield in your wallet, to shield 2 TKN. A free signature. It sends nothing.",
    );
    expect(shieldStepConfirmText("shield", { amount, token })).toBe(
      "Shield TKN in your wallet, to shield 2 TKN. Moves the funds into your private balance.",
    );
  });
});
