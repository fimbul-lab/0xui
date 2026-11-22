import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  connectMock,
  createTestConfig,
  fakeChainRpc,
  fakeTxHash,
  renderWithWagmi,
  testAccounts,
} from "../../../test/wagmi";
import {
  MOCK_MIXER_POOLS,
  MOCK_NOTE_PREFIX,
  createMockMixerEngine,
} from "../lib/mock-mixer-engine";
import {
  Mixer,
  MixerDepositForm,
  MixerWithdrawForm,
  formatMixerAge,
  mixerDepositSteps,
  mixerWalletBlocker,
} from "./mixer";
import { NoteBackup } from "./note-backup";

const RECIPIENT = "0x9999999999999999999999999999999999999999";
const small = MOCK_MIXER_POOLS[0]!;
const button = (name: string | RegExp) => screen.findByRole("button", { name }, { timeout: 5_000 });

function chainWith({ balance = 10n ** 18n } = {}) {
  const sends: { to: string; data?: string; value?: string }[] = [];
  const chain = fakeChainRpc({});
  const send = chain.eth_sendTransaction as (params: unknown) => unknown;
  const config = createTestConfig({
    rpc: {
      ...chain,
      eth_getBalance: `0x${balance.toString(16)}`,
      eth_sendTransaction: (params: [{ to: string }]) => {
        sends.push(params[0]);
        return send(params);
      },
    },
  });
  return { config, sends };
}

describe("mixerDepositSteps", () => {
  it("plans one prompt for a native pool and for an atomic wallet", () => {
    const base = { needsApproval: true, needsReset: false, atomic: false };
    expect(mixerDepositSteps({ ...base, needsApproval: false })).toEqual(["deposit"]);
    expect(mixerDepositSteps(base)).toEqual(["approve", "deposit"]);
    expect(mixerDepositSteps({ ...base, needsReset: true })).toEqual([
      "reset",
      "approve",
      "deposit",
    ]);
    expect(mixerDepositSteps({ ...base, atomic: true })).toEqual(["batch"]);
  });
});

describe("mixerWalletBlocker", () => {
  it("asks for a wallet, then for the pool's network", () => {
    const base = { address: testAccounts[0], walletChainId: 1, chainId: 1 };
    expect(mixerWalletBlocker({ ...base, address: undefined })).toEqual({
      label: "Connect wallet",
      action: "connect",
    });
    expect(mixerWalletBlocker({ ...base, walletChainId: 10, chainName: "Ethereum" })).toEqual({
      label: "Switch to Ethereum",
      action: "switch-chain",
    });
    expect(mixerWalletBlocker(base)).toBeUndefined();
  });
});

describe("formatMixerAge", () => {
  it("rounds to the unit a person would say", () => {
    expect(formatMixerAge(30)).toBe("just now");
    expect(formatMixerAge(600)).toBe("10 min ago");
    expect(formatMixerAge(7_200)).toBe("2 hours ago");
    expect(formatMixerAge(3 * 86_400)).toBe("3 days ago");
  });
});

describe("NoteBackup", () => {
  it("hides the note and keeps the checkbox closed until the note is taken", async () => {
    const user = userEvent.setup();
    const onSavedChange = vi.fn();
    const { container } = renderWithWagmi(
      <NoteBackup note="secret-note-text" saved={false} onSavedChange={onSavedChange} />,
      { config: createTestConfig({ rpc: fakeChainRpc({}) }) },
    );
    expect(container).not.toHaveTextContent("secret-note-text");
    // The note is in no attribute either.
    expect(container.innerHTML).not.toContain("secret-note-text");
    const checkbox = screen.getByRole("checkbox", { name: /I saved my note/ });
    expect(checkbox).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Reveal note" }));
    expect(container).toHaveTextContent("secret-note-text");
    expect(checkbox).toBeEnabled();
    await user.click(checkbox);
    expect(onSavedChange).toHaveBeenCalledWith(true);
  });
});

describe("MixerDepositForm", () => {
  const root = () => document.querySelector("[data-slot=mixer-deposit]")!;

  async function setup({ connect = true, balance = 10n ** 18n } = {}) {
    const user = userEvent.setup();
    const engine = createMockMixerEngine({ speed: Infinity });
    const { config, sends } = chainWith({ balance });
    const onSubmitted = vi.fn();
    renderWithWagmi(<MixerDepositForm engine={engine} onSubmitted={onSubmitted} />, { config });
    if (connect) await act(() => connectMock(config));
    return { user, engine, onSubmitted, sends };
  }

  it("names the blocker: wallet first, then the balance", async () => {
    await setup({ connect: false });
    expect(await button("Connect wallet")).toBeEnabled();
  });

  it("says when the wallet can't cover the pool's amount", async () => {
    await setup({ balance: 10n ** 16n });
    expect(await button("Insufficient ETH")).toBeDisabled();
  });

  it("makes the note first and sends nothing until it is saved", async () => {
    const { user, engine, onSubmitted, sends } = await setup();
    const prepare = vi.spyOn(engine, "prepareDeposit");
    await user.click(await button("Create note"));

    expect(await button("Save your note first")).toBeDisabled();
    expect(root()).toHaveAttribute("data-phase", "backup");
    // The amount can't change under a note that was made for it.
    expect(screen.getByRole("radio", { name: "1 ETH" })).toHaveAttribute("aria-disabled", "true");
    expect(root().innerHTML).not.toContain(MOCK_NOTE_PREFIX);

    await user.click(screen.getByRole("button", { name: "Reveal note" }));
    const shown = screen.getByLabelText("Your note").textContent!;
    expect(shown.startsWith(`${MOCK_NOTE_PREFIX}-eth-0.1-1-0x`)).toBe(true);
    await user.click(screen.getByRole("checkbox", { name: /I saved my note/ }));
    expect(sends).toHaveLength(0);
    expect(prepare).not.toHaveBeenCalled();

    await user.click(await button("Deposit 0.1 ETH"));
    await waitFor(() => expect(onSubmitted).toHaveBeenCalled());
    // What was backed up is what was deposited.
    expect(prepare).toHaveBeenCalledWith(shown);
    const { commitment } = await engine.parseNote(shown);
    expect(sends).toEqual([expect.objectContaining({ to: small.address, data: commitment })]);
    expect(BigInt(sends[0]!.value!)).toBe(small.denomination);

    // The callback gets the commitment, never the note.
    const [hash, deposited] = onSubmitted.mock.calls[0]!;
    expect(hash).toBe(fakeTxHash);
    expect(deposited).toEqual({ pool: small, commitment });
    // The note is gone from the page once the deposit is sent.
    expect(root().innerHTML).not.toContain(MOCK_NOTE_PREFIX);
    expect(root()).toHaveTextContent("Keep the note");
    expect(await button("Create note")).toBeEnabled();
  });

  it("drops the note on request, and makes a new one next time", async () => {
    const { user, engine } = await setup();
    const create = vi.spyOn(engine, "createNote");
    await user.click(await button("Create note"));
    await user.click(await button("Discard note"));
    expect(root()).toHaveAttribute("data-phase", "idle");
    expect(screen.queryByRole("button", { name: "Reveal note" })).toBeNull();
    await user.click(await button("Create note"));
    await button("Save your note first");
    expect(create).toHaveBeenCalledTimes(2);
  });
});

describe("MixerWithdrawForm", () => {
  const root = () => document.querySelector("[data-slot=mixer-withdraw]")!;

  async function setup({
    deposited = true,
    connect = false,
    crowd = 0,
    engineOptions = {},
  }: {
    deposited?: boolean;
    connect?: boolean;
    crowd?: number;
    engineOptions?: Parameters<typeof createMockMixerEngine>[0];
  } = {}) {
    const user = userEvent.setup();
    const engine = createMockMixerEngine({ speed: Infinity, ...engineOptions });
    const { note, commitment } = await engine.createNote(small);
    if (deposited) engine.simulate.deposit(commitment);
    if (crowd) engine.simulate.crowd(small, crowd);
    const { config, sends } = chainWith();
    const onSubmitted = vi.fn();
    renderWithWagmi(<MixerWithdrawForm engine={engine} onSubmitted={onSubmitted} />, { config });
    if (connect) await act(() => connectMock(config));
    const paste = async (text = note) => {
      const field = screen.getByLabelText("Note");
      await user.click(field);
      await user.paste(text);
    };
    const enterRecipient = async () => {
      await user.type(screen.getByRole("textbox", { name: "Recipient address" }), RECIPIENT);
    };
    return { user, engine, note, commitment, onSubmitted, sends, paste, enterRecipient };
  }

  it("names what is missing, in the order people get there", async () => {
    const { paste, enterRecipient } = await setup({ crowd: 200 });
    expect(await button("Paste your note")).toBeDisabled();
    await paste();
    expect(await button("Enter a recipient")).toBeDisabled();
    expect(root()).toHaveTextContent(/0\.1 ETH · deposited just now · 200 deposits since/);
    await enterRecipient();
    expect(await button("Withdraw 0.1 ETH")).toBeEnabled();
    expect(root()).toHaveTextContent(/Relayer fee\s*0\.0003\s*ETH/);
    expect(root()).toHaveTextContent(/Recipient gets.*0\.0997\s*ETH/);
  });

  it("refuses text that is not a note, a note with no deposit, and a spent one", async () => {
    const first = await setup({ deposited: false });
    await first.paste("not a note");
    expect(await button("Not a valid note")).toBeDisabled();
    expect(root()).toHaveTextContent("This is not a note.");
    await first.user.clear(screen.getByLabelText("Note"));
    await first.paste();
    expect(await button("No deposit found")).toBeDisabled();
  });

  it("says when a note was already withdrawn", async () => {
    const { engine, note, paste } = await setup();
    const spent = await engine.prove(
      { note, recipient: RECIPIENT, via: "relayer" },
      { onStage: () => {} },
    );
    await engine.relay(spent);
    await paste();
    expect(await button("Already withdrawn")).toBeDisabled();
  });

  it("warns when few deposits came after this one", async () => {
    const { paste } = await setup({ crowd: 3 });
    await paste();
    expect(await screen.findByRole("note")).toHaveTextContent("easy to link");
  });

  it("withdraws through the relayer with no wallet, and clears the note", async () => {
    const { user, engine, onSubmitted, sends, paste, enterRecipient, commitment } = await setup({
      crowd: 50,
    });
    const relay = vi.spyOn(engine, "relay");
    await paste();
    await enterRecipient();
    await user.click(await button("Withdraw 0.1 ETH"));

    await waitFor(() => expect(onSubmitted).toHaveBeenCalled());
    expect(relay).toHaveBeenCalledTimes(1);
    expect(sends).toHaveLength(0);
    const [, withdrawal] = onSubmitted.mock.calls[0]!;
    expect(withdrawal).toMatchObject({ recipient: RECIPIENT, via: "relayer" });
    // Nothing handed out links the withdrawal to its deposit.
    expect(
      JSON.stringify(withdrawal, (_, v) => (typeof v === "bigint" ? `${v}` : v)),
    ).not.toContain(commitment.slice(2));
    expect(screen.getByLabelText("Note")).toHaveValue("");
    expect(root()).toHaveAttribute("data-phase", "idle");
  });

  it("asks before sending when the relayer's fee went up", async () => {
    const { user, engine, onSubmitted, paste, enterRecipient } = await setup({ crowd: 50 });
    await paste();
    await enterRecipient();
    const start = await button("Withdraw 0.1 ETH");
    // The fee doubles between the quote on screen and the proof.
    const prove = engine.prove.bind(engine);
    vi.spyOn(engine, "prove").mockImplementation(async (draft, options) => {
      const proved = await prove(draft, options);
      return {
        ...proved,
        quote: { fee: proved.quote.fee * 2n, received: proved.quote.received - proved.quote.fee },
      };
    });
    await user.click(start);

    const confirm = await button("Withdraw at the new fee");
    expect(root()).toHaveAttribute("data-phase", "review");
    expect(onSubmitted).not.toHaveBeenCalled();
    expect(root()).toHaveTextContent(/Relayer fee\s*0\.0006\s*ETH/);
    await user.click(confirm);
    await waitFor(() => expect(onSubmitted).toHaveBeenCalled());
  });

  it("from the wallet: proves on one click, opens the wallet on the next", async () => {
    const { user, onSubmitted, sends, paste, enterRecipient } = await setup({
      connect: true,
      crowd: 50,
    });
    await paste();
    await enterRecipient();
    await user.click(screen.getByRole("radio", { name: "My wallet" }));
    expect(root()).toHaveTextContent("pays the gas in public");
    await user.click(await button("Withdraw 0.1 ETH"));

    const send = await button("Send withdrawal from wallet");
    expect(root()).toHaveAttribute("data-phase", "ready");
    expect(sends).toHaveLength(0);
    // The whole amount arrives: the wallet pays the gas instead of a fee.
    expect(root()).toHaveTextContent(/Recipient gets.*0\.1\s*ETH/);
    await user.click(send);
    await waitFor(() => expect(onSubmitted).toHaveBeenCalled());
    expect(sends).toEqual([expect.objectContaining({ to: small.address })]);
  });

  it("asks for a wallet only when the wallet sends", async () => {
    const { user, paste, enterRecipient } = await setup({ crowd: 50 });
    await paste();
    await enterRecipient();
    expect(await button("Withdraw 0.1 ETH")).toBeEnabled();
    await user.click(screen.getByRole("radio", { name: "My wallet" }));
    expect(await button("Connect wallet")).toBeEnabled();
  });

  it("offers only the wallet on an engine with no relayer", async () => {
    await setup({ engineOptions: { relayerFeeBps: false } });
    expect(screen.getByRole("radio", { name: "A relayer" })).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("radio", { name: "My wallet" })).toBeChecked();
  });

  it("shows a failed proof in the stage list, and proves again on request", async () => {
    const { user, engine, onSubmitted, paste, enterRecipient } = await setup({ crowd: 50 });
    await paste();
    await enterRecipient();
    const start = await button("Withdraw 0.1 ETH");
    engine.simulate.failNextProof();
    await user.click(start);

    expect(await screen.findByRole("alert")).toHaveTextContent("out of memory");
    expect(root()).toHaveAttribute("data-phase", "error");
    expect(
      root().querySelector("[data-slot=mixer-proof-progress] li[data-state=failed]"),
    ).toHaveTextContent("Computing proof");
    await user.click(await button("Try again"));
    await waitFor(() => expect(onSubmitted).toHaveBeenCalled());
  });

  it("keeps the proof after the relayer refuses, and lets the user go back", async () => {
    const { user, engine, onSubmitted, note, paste, enterRecipient } = await setup({ crowd: 50 });
    await paste();
    await enterRecipient();
    const start = await button("Withdraw 0.1 ETH");
    engine.simulate.failNextRelay();
    await user.click(start);

    expect(await screen.findByRole("alert")).toHaveTextContent("refused");
    expect(onSubmitted).not.toHaveBeenCalled();
    await user.click(await button("Back"));
    expect(root()).toHaveAttribute("data-phase", "idle");
    // The note is still in the field: nothing was spent.
    expect(screen.getByLabelText("Note")).toHaveValue(note);
  });
});

describe("Mixer", () => {
  it("keeps a pasted note while the other tab is open", async () => {
    const user = userEvent.setup();
    const engine = createMockMixerEngine({ speed: Infinity });
    const { note } = await engine.createNote(small);
    const { config } = chainWith();
    renderWithWagmi(<Mixer engine={engine} />, { config });

    await user.click(screen.getByRole("tab", { name: "Withdraw" }));
    await user.click(screen.getByLabelText("Note"));
    await user.paste(note);
    await user.click(screen.getByRole("tab", { name: "Deposit" }));
    expect(await button("Connect wallet")).toBeVisible();
    await user.click(screen.getByRole("tab", { name: "Withdraw" }));
    expect(screen.getByLabelText("Note")).toHaveValue(note);
  });
});
