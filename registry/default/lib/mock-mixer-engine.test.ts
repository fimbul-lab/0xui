import { describe, expect, it, vi } from "vitest";
import { mixerPoolLabel, type MixerStage } from "./mixer-engine";
import { MOCK_MIXER_POOLS, MOCK_NOTE_PREFIX, createMockMixerEngine } from "./mock-mixer-engine";

const RECIPIENT = "0x9999999999999999999999999999999999999999";
const [small, medium] = MOCK_MIXER_POOLS as [
  (typeof MOCK_MIXER_POOLS)[0],
  (typeof MOCK_MIXER_POOLS)[0],
];
const options = { onStage: () => {} };

describe("mixerPoolLabel", () => {
  it("writes the pool's amount", () => {
    expect(mixerPoolLabel(small)).toBe("0.1 ETH");
    expect(mixerPoolLabel(medium)).toBe("1 ETH");
  });
});

describe("mock mixer engine", () => {
  it("makes a different note every time, and reads it back", async () => {
    const engine = createMockMixerEngine({ speed: Infinity });
    const a = await engine.createNote(small);
    const b = await engine.createNote(small);
    expect(a.note).toMatch(new RegExp(`^${MOCK_NOTE_PREFIX}-eth-0\\.1-1-0x[0-9a-f]{124}$`));
    expect(a.note).not.toBe(b.note);
    expect(a.commitment).not.toBe(b.commitment);
    // The commitment says nothing about the note.
    expect(a.note).not.toContain(a.commitment.slice(2));

    const read = await engine.parseNote(`  ${a.note}\n`);
    expect(read).toEqual(a);
    expect((await engine.createNote(medium)).pool).toBe(medium);
  });

  it("says why text is not a note", async () => {
    const engine = createMockMixerEngine({ speed: Infinity, pools: [small] });
    await expect(engine.parseNote("")).rejects.toThrow("Paste your note.");
    await expect(engine.parseNote("hello")).rejects.toThrow("This is not a note.");
    const other = await createMockMixerEngine({ speed: Infinity }).createNote(medium);
    await expect(engine.parseNote(other.note)).rejects.toThrow("not offered here");
    await expect(engine.createNote(medium)).rejects.toThrow("not offered here");
  });

  it("builds a deposit that carries the denomination", async () => {
    const engine = createMockMixerEngine({ speed: Infinity });
    const { note, commitment } = await engine.createNote(small);
    const call = await engine.prepareDeposit(note);
    expect(call).toEqual({ to: small.address, data: commitment, value: 10n ** 17n });
  });

  it("follows a deposit from missing to deposited to withdrawn", async () => {
    const engine = createMockMixerEngine({ speed: Infinity, existingDeposits: 5 });
    const { note, commitment } = await engine.createNote(small);
    expect(await engine.getDeposit(note)).toEqual({ state: "missing" });

    expect(engine.simulate.deposit(commitment)).toBe(true);
    expect(engine.simulate.deposit(commitment)).toBe(false);
    expect(await engine.getDeposit(note)).toMatchObject({ state: "deposited", depositsSince: 0 });
    engine.simulate.crowd(small, 40);
    expect(await engine.getDeposit(note)).toMatchObject({ depositsSince: 40 });

    const withdrawal = await engine.prove({ note, recipient: RECIPIENT, via: "relayer" }, options);
    await engine.relay(withdrawal);
    expect(await engine.getDeposit(note)).toMatchObject({ state: "withdrawn" });
  });

  it("charges nothing from the wallet and the relayer's cut through a relayer", async () => {
    const engine = createMockMixerEngine({ speed: Infinity, relayerFeeBps: 50 });
    expect(await engine.quote(small, "wallet")).toEqual({ fee: 0n, received: 10n ** 17n });
    expect(await engine.quote(small, "relayer")).toEqual({
      fee: 5n * 10n ** 14n,
      received: 995n * 10n ** 14n,
    });

    const none = createMockMixerEngine({ speed: Infinity, relayerFeeBps: false });
    expect(none.relays).toBe(false);
    await expect(none.quote(small, "relayer")).rejects.toThrow("No relayer");
  });

  it("proves stage by stage, and refuses a note with nothing behind it", async () => {
    const engine = createMockMixerEngine({ speed: Infinity });
    const { note, commitment } = await engine.createNote(small);
    const stages: MixerStage[] = [];
    const onStage = (stage: MixerStage) => stages.push(stage);

    await expect(
      engine.prove({ note, recipient: RECIPIENT, via: "wallet" }, { onStage }),
    ).rejects.toThrow("No deposit was found for this note.");
    expect(stages).toEqual(["syncing"]);

    engine.simulate.deposit(commitment);
    stages.length = 0;
    const withdrawal = await engine.prove(
      { note, recipient: RECIPIENT, via: "wallet" },
      { onStage },
    );
    expect(stages).toEqual(["syncing", "loading-circuits", "proving", "verifying"]);
    expect(withdrawal).toMatchObject({
      pool: small,
      recipient: RECIPIENT,
      via: "wallet",
      quote: { fee: 0n, received: 10n ** 17n },
    });
    expect(withdrawal.transaction.to).toBe(small.address);
    // Nothing on the withdrawal points back at the deposit.
    expect(
      JSON.stringify(withdrawal, (_, v) => (typeof v === "bigint" ? `${v}` : v)),
    ).not.toContain(commitment.slice(2));

    engine.simulate.withdrawn(withdrawal);
    await expect(
      engine.prove({ note, recipient: RECIPIENT, via: "wallet" }, options),
    ).rejects.toThrow("already withdrawn");
  });

  it("stops a proof that is cancelled", async () => {
    vi.useFakeTimers();
    try {
      const engine = createMockMixerEngine();
      const { note, commitment } = await engine.createNote(small);
      engine.simulate.deposit(commitment);
      const run = new AbortController();
      const stages: MixerStage[] = [];
      const proof = engine.prove(
        { note, recipient: RECIPIENT, via: "wallet" },
        { onStage: (stage) => stages.push(stage), signal: run.signal },
      );
      const failed = expect(proof).rejects.toMatchObject({ name: "AbortError" });
      await vi.advanceTimersByTimeAsync(6_000);
      run.abort();
      await failed;
      expect(stages).toEqual(["syncing", "loading-circuits"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("relays a withdrawal once, and only one made for a relayer", async () => {
    const relay = vi.fn(() => `0x${"cd".repeat(32)}` as const);
    const engine = createMockMixerEngine({ speed: Infinity, relay });
    const { note, commitment } = await engine.createNote(small);
    engine.simulate.deposit(commitment);

    const own = await engine.prove({ note, recipient: RECIPIENT, via: "wallet" }, options);
    await expect(engine.relay(own)).rejects.toThrow("not made for a relayer");

    const relayed = await engine.prove({ note, recipient: RECIPIENT, via: "relayer" }, options);
    engine.simulate.failNextRelay();
    await expect(engine.relay(relayed)).rejects.toThrow("refused");
    expect(await engine.relay(relayed)).toEqual({ hash: `0x${"cd".repeat(32)}` });
    expect(relay).toHaveBeenCalledTimes(1);
    await expect(engine.relay(relayed)).rejects.toThrow("already sent");
  });

  it("fails the next sync or proof on request, then recovers", async () => {
    const engine = createMockMixerEngine({ speed: Infinity });
    const { note, commitment } = await engine.createNote(small);
    engine.simulate.deposit(commitment);
    const draft = { note, recipient: RECIPIENT, via: "wallet" } as const;
    engine.simulate.failNextSync();
    await expect(engine.prove(draft, options)).rejects.toThrow("could not be read");
    engine.simulate.failNextProof();
    await expect(engine.prove(draft, options)).rejects.toThrow("out of memory");
    await expect(engine.prove(draft, options)).resolves.toBeDefined();
  });
});
