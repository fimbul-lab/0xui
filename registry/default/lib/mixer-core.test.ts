import type { Address, Hash } from "viem";
import { describe, expect, it, vi } from "vitest";
import { connectMock, createTestConfig, fakeChainRpc } from "../../../test/wagmi";
import {
  createMixerDeposit,
  createMixerNoteLookup,
  createMixerWithdraw,
  mixerDepositAction,
  mixerDepositConfirmText,
  mixerDepositPhase,
  mixerNoteView,
  mixerProofHeading,
  mixerStepStates,
  mixerWithdrawAction,
  mixerWithdrawConfirmText,
  mixerWithdrawRunningAction,
  planMixerDeposit,
} from "./mixer-core";
import type { MixerDeposited } from "./mixer-core";
import type { MixerWithdrawal } from "./mixer-engine";
import { MOCK_MIXER_POOLS, createMockMixerEngine } from "./mock-mixer-engine";

const RECIPIENT: Address = "0x9999999999999999999999999999999999999999";
const native = MOCK_MIXER_POOLS[0]!;
const erc20 = {
  ...native,
  token: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2" as Address,
  symbol: "TKN",
};

/** An `onSubmitted` that keeps every call, and resolves `first` with the first one. */
function submissions<T>() {
  const calls: Array<[Hash, T]> = [];
  const first = Promise.withResolvers<[Hash, T]>();
  const onSubmitted = (hash: Hash, value: T) => {
    calls.push([hash, value]);
    first.resolve([hash, value]);
  };
  return { calls, first: first.promise, onSubmitted };
}

function chain() {
  const sends: Array<{ to: string }> = [];
  const rpc = fakeChainRpc({});
  const send = rpc.eth_sendTransaction as (params: unknown) => unknown;
  const config = createTestConfig({
    rpc: {
      ...rpc,
      eth_sendTransaction: (params: [{ to: string }]) => {
        sends.push(params[0]);
        return send(params);
      },
    },
  });
  return { config, sends };
}

describe("createMixerDeposit", () => {
  it("makes the note, waits for the backup, then deposits and drops the note", async () => {
    const engine = createMockMixerEngine({ speed: Infinity });
    const { config, sends } = chain();
    await connectMock(config);
    const submitted = submissions<MixerDeposited>();
    const deposit = createMixerDeposit(config, engine, { onSubmitted: submitted.onSubmitted });
    const stop = deposit.subscribe(() => {});
    const plan = planMixerDeposit({ pool: native, allowance: undefined, capabilities: undefined });

    deposit.begin(native);
    await vi.waitFor(() => expect(mixerDepositPhase(deposit.get())).toBe("backup"));
    const note = deposit.get().note!;

    // Nothing goes out before the backup is confirmed.
    deposit.send(plan);
    expect(sends).toHaveLength(0);

    deposit.setSaved(true);
    deposit.send(plan);
    const call = await submitted.first;
    expect(submitted.calls).toHaveLength(1);
    // The callback gets the commitment, never the note.
    expect(call[1]).toEqual({ pool: native, commitment: note.commitment });
    expect(
      JSON.stringify(call, (_, v: unknown) => (typeof v === "bigint" ? `${v}` : v)),
    ).not.toContain(note.note);
    expect(sends).toHaveLength(1);
    expect(deposit.get().note).toBeUndefined();
    stop();
  });

  it("drops the note on leave", async () => {
    const engine = createMockMixerEngine({ speed: Infinity });
    const deposit = createMixerDeposit(chain().config, engine);
    const stop = deposit.subscribe(() => {});
    deposit.begin(native);
    await vi.waitFor(() => expect(deposit.get().note).toBeDefined());
    deposit.leave();
    expect(deposit.get().note).toBeUndefined();
    expect(mixerDepositPhase(deposit.get())).toBe("idle");
    stop();
  });
});

describe("planMixerDeposit", () => {
  it("waits for an ERC-20 pool's allowance, and batches only on an atomic wallet", () => {
    expect(
      planMixerDeposit({ pool: erc20, allowance: undefined, capabilities: undefined }),
    ).toBeUndefined();
    expect(planMixerDeposit({ pool: erc20, allowance: 0n, capabilities: undefined })).toEqual({
      steps: ["approve", "deposit"],
      leftover: false,
    });
    expect(
      planMixerDeposit({
        pool: erc20,
        allowance: 0n,
        capabilities: { atomic: { status: "supported" } },
      })?.steps,
    ).toEqual(["batch"]);
    expect(
      planMixerDeposit({
        pool: erc20,
        allowance: 0n,
        capabilities: { atomic: { status: "ready" } },
      })?.steps,
    ).toEqual(["approve", "deposit"]);
    expect(
      planMixerDeposit({ pool: erc20, allowance: erc20.denomination, capabilities: undefined })
        ?.steps,
    ).toEqual(["deposit"]);
  });
});

describe("mixerDepositAction", () => {
  const base = {
    pool: native,
    walletBlocker: undefined,
    switching: false,
    balance: 10n ** 18n,
    note: undefined,
    saved: false,
    phase: "idle",
    busy: false,
    step: undefined,
  } as const;
  const note = { note: "n", pool: native, commitment: "0x01" } as const;

  it("names what is missing, in order", () => {
    expect(mixerDepositAction({ ...base, pool: undefined }).label).toBe("Select an amount");
    expect(
      mixerDepositAction({
        ...base,
        walletBlocker: { label: "Connect wallet", action: "connect" },
      }),
    ).toEqual({ label: "Connect wallet", action: "connect" });
    expect(
      mixerDepositAction({
        ...base,
        walletBlocker: { label: "Switch to Sepolia", action: "switch-chain" },
        switching: true,
      }),
    ).toEqual({ label: "Switch to Sepolia" });
    expect(mixerDepositAction({ ...base, balance: 0n }).label).toBe(
      `Insufficient ${native.symbol}`,
    );
    expect(mixerDepositAction(base)).toEqual({ label: "Create note", action: "begin" });
    expect(mixerDepositAction({ ...base, phase: "creating", busy: true })).toEqual({
      label: "Creating note…",
    });
    expect(mixerDepositAction({ ...base, note }).label).toBe("Save your note first");
    expect(mixerDepositAction({ ...base, note, saved: true }).label).toBe("Checking approval…");
    expect(mixerDepositAction({ ...base, note, saved: true, step: "deposit" })).toEqual({
      label: "Deposit 0.1 ETH",
      action: "send",
    });
    expect(
      mixerDepositAction({ ...base, note, saved: true, step: "approve", phase: "pending" }).label,
    ).toBe("Approving…");
  });
});

describe("createMixerNoteLookup", () => {
  it("parses the note and looks its deposit up once typing pauses", async () => {
    const engine = createMockMixerEngine({ speed: Infinity });
    const { note, commitment } = await engine.createNote(native);
    engine.simulate.deposit(commitment);
    const lookup = createMixerNoteLookup(engine, { debounce: 0 });
    const stop = lookup.subscribe(() => {});

    lookup.lookup(note);
    expect(mixerNoteView(lookup.get(), note).isLoading).toBe(true);
    await vi.waitFor(() =>
      expect(mixerNoteView(lookup.get(), note).deposit?.state).toBe("deposited"),
    );
    // A different text shows nothing from the old one.
    expect(mixerNoteView(lookup.get(), "other").note).toBeUndefined();

    lookup.lookup("not a note");
    await vi.waitFor(() => expect(mixerNoteView(lookup.get(), "not a note").error).toBeDefined());
    stop();
  });
});

describe("createMixerWithdraw", () => {
  it("proves and relays with no wallet", async () => {
    const engine = createMockMixerEngine({ speed: Infinity });
    const { note, commitment } = await engine.createNote(native);
    engine.simulate.deposit(commitment);
    const submitted = submissions<MixerWithdrawal>();
    const withdraw = createMixerWithdraw(chain().config, engine, {
      onSubmitted: submitted.onSubmitted,
    });
    const stop = withdraw.subscribe(() => {});
    const expected = await engine.quote(native, "relayer");

    withdraw.start({ note, recipient: RECIPIENT, via: "relayer" }, expected);
    await submitted.first;
    expect(submitted.calls).toHaveLength(1);
    expect(withdraw.get().active).toBeUndefined();
    expect(withdraw.get().phase).toBe("idle");
    stop();
  });

  it("stops in review when the relayer's fee went up", async () => {
    const relays: Array<MixerWithdrawal> = [];
    const relayed = Promise.withResolvers<void>();
    const engine = createMockMixerEngine({
      speed: Infinity,
      relay: (withdrawal) => {
        relays.push(withdrawal);
        relayed.resolve();
        return `0x${"cd".repeat(32)}`;
      },
    });
    const { note, commitment } = await engine.createNote(native);
    engine.simulate.deposit(commitment);
    const withdraw = createMixerWithdraw(chain().config, engine);
    const stop = withdraw.subscribe(() => {});
    const expected = await engine.quote(native, "relayer");

    withdraw.start(
      { note, recipient: RECIPIENT, via: "relayer" },
      { ...expected, fee: expected.fee - 1n },
    );
    await vi.waitFor(() => expect(withdraw.get().phase).toBe("review"));
    expect(relays).toHaveLength(0);
    withdraw.confirm();
    await relayed.promise;
    expect(relays).toHaveLength(1);
    stop();
  });
});

describe("withdraw helpers", () => {
  const base = {
    text: "note",
    note: { note: "note", pool: native, commitment: "0x01" },
    deposit: { state: "deposited" },
    lookupError: undefined,
    lookupLoading: false,
    recipient: RECIPIENT,
    via: "relayer",
    walletBlocker: undefined,
    switching: false,
    quoteFailed: false,
    quote: { fee: 1n, received: 2n },
  } as const;

  it("names what is missing before a withdrawal starts", () => {
    expect(mixerWithdrawAction({ ...base, text: " " }).label).toBe("Paste your note");
    expect(
      mixerWithdrawAction({ ...base, note: undefined, lookupError: new Error("x") }).label,
    ).toBe("Not a valid note");
    expect(mixerWithdrawAction({ ...base, lookupLoading: true }).label).toBe("Checking note…");
    expect(mixerWithdrawAction({ ...base, lookupError: new Error("x") })).toEqual({
      label: "Check again",
      action: "refresh",
    });
    expect(mixerWithdrawAction({ ...base, deposit: { state: "missing" } }).label).toBe(
      "No deposit found",
    );
    expect(mixerWithdrawAction({ ...base, deposit: { state: "withdrawn" } }).label).toBe(
      "Already withdrawn",
    );
    expect(mixerWithdrawAction({ ...base, recipient: undefined }).label).toBe("Enter a recipient");
    // The wallet only matters when it sends.
    const connect = { label: "Connect wallet", action: "connect" } as const;
    expect(mixerWithdrawAction({ ...base, walletBlocker: connect }).action).toBe("start");
    expect(mixerWithdrawAction({ ...base, via: "wallet", walletBlocker: connect })).toEqual(
      connect,
    );
    expect(mixerWithdrawAction({ ...base, quoteFailed: true }).label).toBe(
      "Can't withdraw this way",
    );
    expect(mixerWithdrawAction({ ...base, quote: undefined }).label).toBe("Fetching quote…");
    expect(mixerWithdrawAction(base)).toEqual({ label: "Withdraw 0.1 ETH", action: "start" });
  });

  it("labels the button while a withdrawal runs", () => {
    const run = {
      withdrawal: undefined,
      problem: undefined,
      walletBlocker: undefined,
      switching: false,
    } as const;
    expect(mixerWithdrawRunningAction({ ...run, phase: "proving" })).toEqual({
      label: "Generating proof…",
    });
    expect(mixerWithdrawRunningAction({ ...run, phase: "review" }).action).toBe("confirm");
    expect(mixerWithdrawRunningAction({ ...run, phase: "error" }).action).toBe("retry");
    const withdrawal = { via: "wallet" } as never;
    expect(mixerWithdrawRunningAction({ ...run, phase: "ready", withdrawal })).toEqual({
      label: "Send withdrawal from wallet",
      action: "send",
    });
  });

  it("follows the proof's stages", () => {
    const states = mixerStepStates("proving", "proving", false);
    expect(states).toEqual({
      syncing: "done",
      "loading-circuits": "done",
      proving: "active",
      verifying: "todo",
    });
    expect(mixerProofHeading("proving", states, false)).toBe("Generating proof");
    expect(mixerProofHeading("error", mixerStepStates("error", "proving", true), true)).toBe(
      "Couldn't generate proof",
    );
  });

  it("tells a person what an agent's deposit and withdrawal do", () => {
    expect(mixerDepositConfirmText(native, "deposit")).toBe(
      "Deposits 0.1 ETH from your wallet into the pool, in public. Only the saved note can withdraw it.",
    );
    expect(
      mixerWithdrawConfirmText({
        pool: native,
        recipient: RECIPIENT,
        quote: { fee: 10n ** 15n, received: 99n * 10n ** 15n },
        via: "relayer",
      }),
    ).toBe(
      `Withdraws a 0.1 ETH deposit to ${RECIPIENT}, a public address: 0.099 ETH arrives after a 0.001 ETH fee. A relayer sends it.`,
    );
  });
});
