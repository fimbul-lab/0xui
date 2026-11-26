import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createAgent } from "@ui-sdk/react/agent";
import { useState } from "react";
import type { ReactElement } from "react";
import { renderToString } from "react-dom/server";
import { decodeFunctionData, erc20Abi, maxUint256, parseUnits, toHex } from "viem";
import type { Address, Hex } from "viem";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  connectMock,
  createTestConfig,
  erc20CallRpc,
  fakeChainRpc,
  fakeTxHash,
  renderWithWagmi,
  testAccounts,
} from "../../../test/wagmi";
import type { RpcResponses } from "../../../test/wagmi";
import {
  MOCK_MNEMONIC,
  MOCK_SHIELD_CONTRACT,
  MOCK_TIMINGS,
  createMockShieldedEngine,
} from "../lib/mock-shielded-engine";
import type { MockShieldedEngine } from "../lib/mock-shielded-engine";
import { AddressInput } from "./address-input";
import type { AddressInputState } from "./address-input";
import {
  Shield,
  describeShieldSteps,
  formatFeePercent,
  shieldBlocker,
  shieldSteps,
} from "./shield";
import type { ShieldProps } from "./shield";
import { ShieldedAccount, passwordBlocker, phraseBlocker } from "./shielded-account";
import { ShieldedProvider } from "./shielded-provider";
import {
  ShieldedTransactionStatus,
  formatWait,
  shieldedStatusText,
} from "./shielded-transaction-status";
import { NATIVE_TOKEN_ADDRESS } from "./token-select";
import type { Token } from "./token-select";

type MockOptions = Parameters<typeof createMockShieldedEngine>[0];

const tkn: Token = {
  chainId: 1,
  address: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
  symbol: "TKN",
  name: "Token",
  decimals: 18,
};
const eth: Token = {
  chainId: 1,
  address: NATIVE_TOKEN_ADDRESS,
  symbol: "ETH",
  name: "Ether",
  decimals: 18,
};

/** Unlocked and scanned, with no timers: every engine call finishes when awaited. */
async function unlockedEngine(options: MockOptions = {}) {
  const engine = createMockShieldedEngine({ speed: Infinity, ...options });
  await engine.account.unlock("password");
  await engine.sync(1);
  return engine;
}

/** Everything instant except the standby period, which then never ends within a test. */
async function engineWithStandby() {
  const engine = createMockShieldedEngine({
    timings: { unlock: 0, firstScan: 0, repeatScan: 0, standby: 60_000 },
  });
  await engine.account.unlock("password");
  await engine.sync(1);
  return engine;
}

const withEngine = (ui: ReactElement, engine: MockShieldedEngine) => (
  <ShieldedProvider engine={engine}>{ui}</ShieldedProvider>
);

const settle = () =>
  act(
    () =>
      new Promise<void>((resolve) => {
        setTimeout(resolve);
      }),
  );

afterEach(() => vi.useRealTimers());

// One bridge for the file. A person approves only while `approve` is set.
let approve = false;
const asked: Array<string> = [];
const agent = createAgent({
  allow: (step) => {
    if (step.confirm) {
      asked.push(step.confirm);
    }
    return !step.confirm || approve;
  },
});
const onPage = () =>
  agent.snapshot().filter((entry) => !entry.offPage && entry.component !== "more");
const entry = (label: string) => onPage().find((e) => e.label === label);
const run = (steps: Array<{ ref: string; action: string; args?: Array<unknown> }>) =>
  act(() => agent.act({ steps }));
const expectNamed = (labels: Array<string>) => {
  const components = onPage();
  for (const e of components) {
    expect(e.label, `${e.component} ${e.ref} has no name`).toBeTruthy();
  }
  const names = components.map((e) => e.label);
  for (const label of labels) {
    expect(names, `${label} is missing from the snapshot`).toContain(label);
  }
};
/** Everything an agent has been shown: the page now, and what its steps returned. */
const seen = (...results: Array<unknown>) => JSON.stringify([agent.snapshot(), ...results]);
const agentReset = () => {
  approve = false;
  asked.length = 0;
};

describe("ShieldedAccount", () => {
  const type = (label: string, value: string) =>
    fireEvent.input(screen.getByLabelText(label), { target: { value } });
  const phase = () =>
    document.querySelector("[data-slot=shielded-account]")?.getAttribute("data-phase");

  it("names what a new password is missing", () => {
    expect(passwordBlocker("", "")).toBe("Enter a password");
    expect(passwordBlocker("short", "short")).toBe("Use at least 8 characters");
    expect(passwordBlocker("long enough", "long enougj")).toBe("Passwords don't match");
    expect(passwordBlocker("long enough", "long enough")).toBeUndefined();
  });

  it("counts the words of a recovery phrase", () => {
    expect(phraseBlocker("  ")).toBe("Enter your recovery phrase");
    expect(phraseBlocker("one two  three")).toBe("Enter all 12 or 24 words (3 so far)");
    expect(phraseBlocker(MOCK_MNEMONIC)).toBeUndefined();
    expect(phraseBlocker(`${MOCK_MNEMONIC}\n${MOCK_MNEMONIC.toUpperCase()}`)).toBeUndefined();
  });

  it("renders nothing on the server", () => {
    const engine = createMockShieldedEngine();
    expect(renderToString(withEngine(<ShieldedAccount />, engine))).toBe("");
  });

  it("creates an account, shows the phrase once, and opens only after it is saved", async () => {
    vi.useFakeTimers();
    const engine = createMockShieldedEngine({ account: "none" });
    const onUnlocked = vi.fn();
    render(withEngine(<ShieldedAccount onUnlocked={onUnlocked} />, engine));
    expect(phase()).toBe("none");

    expect(screen.getByRole("button", { name: "Enter a password" })).toBeDisabled();
    type("New password", "correct horse");
    expect(screen.getByRole("button", { name: "Passwords don't match" })).toBeDisabled();
    type("Confirm password", "correct horse");

    fireEvent.click(screen.getByRole("button", { name: "Create private account" }));
    expect(phase()).toBe("creating");
    expect(screen.getByRole("button", { name: "Creating account…" })).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("This takes a few seconds.");
    expect(screen.getByLabelText("New password")).toBeDisabled();

    await act(() => vi.advanceTimersByTimeAsync(MOCK_TIMINGS.createAccount));
    expect(phase()).toBe("backup");
    // The engine is unlocked, but the account isn't handed over before the backup.
    expect(engine.account.status()).toBe("unlocked");
    expect(onUnlocked).not.toHaveBeenCalled();

    // Hidden until asked for: the words aren't in the page at all.
    expect(screen.queryByText("abandon")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reveal the phrase first" })).toBeDisabled();
    expect(screen.getByRole("checkbox")).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Reveal phrase" }));
    expect(screen.getAllByText("abandon")).toHaveLength(11);
    expect(screen.getByText("about")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirm you saved it" })).toBeDisabled();

    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    expect(phase()).toBe("unlocked");
    expect(screen.queryByText("abandon")).not.toBeInTheDocument();
    expect(onUnlocked).toHaveBeenCalledExactlyOnceWith(engine.account.address());
    expect(screen.getByRole("button", { name: "Copy private address" })).toBeInTheDocument();
  });

  it("imports a recovery phrase", async () => {
    const user = userEvent.setup();
    const engine = createMockShieldedEngine({ account: "none", speed: Infinity });
    const importAccount = vi.spyOn(engine.account, "import");
    render(withEngine(<ShieldedAccount />, engine));

    await user.click(screen.getByRole("button", { name: "Import a recovery phrase instead" }));
    const phrase = screen.getByLabelText("Recovery phrase");
    // Nothing may store or spell-check a recovery phrase.
    expect(phrase).toHaveAttribute("autocomplete", "off");
    expect(phrase).toHaveAttribute("spellcheck", "false");

    await user.click(phrase);
    await user.paste("  Abandon abandon ");
    expect(
      screen.getByRole("button", { name: "Enter all 12 or 24 words (2 so far)" }),
    ).toBeDisabled();
    await user.clear(phrase);
    await user.paste(`  ${MOCK_MNEMONIC.toUpperCase()}  `);
    await user.type(screen.getByLabelText("New password"), "correct horse");
    await user.type(screen.getByLabelText("Confirm password"), "correct horse");
    await user.click(screen.getByRole("button", { name: "Import private account" }));

    await waitFor(() => expect(phase()).toBe("unlocked"));
    // Normalized before it reaches the engine.
    expect(importAccount).toHaveBeenCalledWith(MOCK_MNEMONIC, "correct horse");
  });

  it("shows why an import failed and keeps the form", async () => {
    const user = userEvent.setup();
    const engine = createMockShieldedEngine({ account: "none", speed: Infinity });
    engine.simulate.failNextImport("That recovery phrase isn't valid.");
    render(withEngine(<ShieldedAccount />, engine));

    await user.click(screen.getByRole("button", { name: "Import a recovery phrase instead" }));
    await user.click(screen.getByLabelText("Recovery phrase"));
    await user.paste(MOCK_MNEMONIC);
    await user.type(screen.getByLabelText("New password"), "correct horse");
    await user.type(screen.getByLabelText("Confirm password"), "correct horse");
    await user.click(screen.getByRole("button", { name: "Import private account" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("That recovery phrase isn't valid.");
    expect(phase()).toBe("none");
    expect(screen.getByLabelText("Recovery phrase")).toHaveValue(MOCK_MNEMONIC);

    // The error stays with the form it happened in.
    await user.click(screen.getByRole("button", { name: "Create a new account instead" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("unlocks with the right password only, and locks again", async () => {
    const user = userEvent.setup();
    const engine = createMockShieldedEngine({ speed: Infinity });
    render(withEngine(<ShieldedAccount />, engine));
    expect(phase()).toBe("locked");
    expect(screen.getByRole("button", { name: "Enter your password" })).toBeDisabled();

    await user.type(screen.getByLabelText("Password"), "wrong");
    await user.keyboard("{Enter}");
    expect(await screen.findByRole("alert")).toHaveTextContent("Wrong password.");
    expect(phase()).toBe("locked");
    expect(screen.getByLabelText("Password")).toHaveAttribute("aria-invalid", "true");

    await user.clear(screen.getByLabelText("Password"));
    await user.type(screen.getByLabelText("Password"), "password");
    await user.click(screen.getByRole("button", { name: "Unlock" }));
    await waitFor(() => expect(phase()).toBe("unlocked"));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Lock private account" }));
    expect(phase()).toBe("locked");
    expect(engine.account.status()).toBe("locked");
    expect(screen.getByLabelText("Password")).toHaveValue("");
  });

  it("gates its children behind the account", async () => {
    const engine = createMockShieldedEngine({ speed: Infinity });
    render(
      withEngine(
        <ShieldedAccount>
          <p>Private area</p>
        </ShieldedAccount>,
        engine,
      ),
    );
    expect(screen.queryByText("Private area")).not.toBeInTheDocument();

    await act(() => engine.account.unlock("password"));
    expect(screen.getByText("Private area")).toBeInTheDocument();
    expect(document.querySelector("[data-slot=shielded-account]")).not.toBeInTheDocument();

    act(() => engine.account.lock());
    expect(screen.queryByText("Private area")).not.toBeInTheDocument();
  });

  describe("with an agent", () => {
    beforeEach(agentReset);

    it("fills a new password without seeing it, and needs a person to create the account", async () => {
      const engine = createMockShieldedEngine({ account: "none", speed: Infinity });
      render(withEngine(<ShieldedAccount />, engine));
      expectNamed(["New password", "Confirm password", "Import a recovery phrase instead"]);

      let result = await run([
        { ref: "New password", action: "setValue", args: ["correct horse"] },
        { ref: "Confirm password", action: "setValue", args: ["correct horse"] },
      ]);
      expect(result.ok, result.error?.message).toBe(true);
      expect(entry("New password")?.value).toBe("[redacted]");
      expect(seen(result)).not.toContain("correct horse");

      const sentence =
        "Creates a new private account on this device, locked with the password entered here";
      expect(entry("Create private account")?.confirm).toBe(sentence);
      result = await run([{ ref: "Create private account", action: "press" }]);
      expect(result.ok).toBe(false);
      expect(asked).toEqual([sentence]);
      expect(phase()).toBe("none");

      approve = true;
      result = await run([{ ref: "Create private account", action: "press" }]);
      expect(result.ok, result.error?.message).toBe(true);
      await waitFor(() => expect(phase()).toBe("backup"));

      // The backup step is the person's alone: the agent sees none of it.
      for (const name of [
        "Reveal phrase",
        "Reveal the phrase first",
        "I saved my recovery phrase somewhere safe",
      ]) {
        expect(entry(name), name).toBeUndefined();
      }
      result = await run([{ ref: "Reveal phrase", action: "press" }]);
      expect(result.ok).toBe(false);
      fireEvent.click(screen.getByRole("button", { name: "Reveal phrase" }));
      expect(screen.getAllByText("abandon")).toHaveLength(11);
      expect(seen(result)).not.toContain("abandon");
      expect(entry("Copy recovery phrase")).toBeUndefined();
    });

    it("pastes a recovery phrase it can't read back, and needs a person to import it", async () => {
      const engine = createMockShieldedEngine({ account: "none", speed: Infinity });
      const importAccount = vi.spyOn(engine.account, "import");
      render(withEngine(<ShieldedAccount />, engine));

      let result = await run([{ ref: "Import a recovery phrase instead", action: "press" }]);
      expect(result.ok, result.error?.message).toBe(true);
      result = await run([
        { ref: "Recovery phrase", action: "setValue", args: [MOCK_MNEMONIC] },
        { ref: "New password", action: "setValue", args: ["correct horse"] },
        { ref: "Confirm password", action: "setValue", args: ["correct horse"] },
      ]);
      expect(result.ok, result.error?.message).toBe(true);
      expect(screen.getByLabelText("Recovery phrase")).toHaveValue(MOCK_MNEMONIC);
      expect(entry("Recovery phrase")?.value).toBe("[redacted]");
      expect(seen(result)).not.toContain("abandon");

      result = await run([{ ref: "Import private account", action: "press" }]);
      expect(result.ok).toBe(false);
      expect(importAccount).not.toHaveBeenCalled();

      approve = true;
      result = await run([{ ref: "Import private account", action: "press" }]);
      expect(result.ok, result.error?.message).toBe(true);
      await waitFor(() => expect(phase()).toBe("unlocked"));
      expect(asked).toEqual([
        "Restores the private account from the recovery phrase entered here and keeps it on this device, locked with the new password",
        "Restores the private account from the recovery phrase entered here and keeps it on this device, locked with the new password",
      ]);
    });

    it("needs a person to unlock and to lock", async () => {
      const engine = createMockShieldedEngine({ speed: Infinity });
      render(withEngine(<ShieldedAccount />, engine));

      let result = await run([{ ref: "Password", action: "setValue", args: ["password"] }]);
      expect(result.ok, result.error?.message).toBe(true);
      expect(entry("Password")?.value).toBe("[redacted]");
      result = await run([{ ref: "Unlock", action: "press" }]);
      expect(result.ok).toBe(false);
      expect(phase()).toBe("locked");

      approve = true;
      result = await run([{ ref: "Unlock", action: "press" }]);
      expect(result.ok, result.error?.message).toBe(true);
      await waitFor(() => expect(phase()).toBe("unlocked"));

      approve = false;
      expect(entry("Lock private account")?.confirm).toBe(
        "Locks your private account. Unlocking it again takes its password",
      );
      result = await run([{ ref: "Lock private account", action: "press" }]);
      expect(result.ok).toBe(false);
      expect(phase()).toBe("unlocked");
      approve = true;
      result = await run([{ ref: "Lock private account", action: "press" }]);
      expect(result.ok, result.error?.message).toBe(true);
      expect(phase()).toBe("locked");
      expect(seen(result)).not.toContain('"password"');
    });
  });
});

describe("AddressInput with private addresses", () => {
  // From the Railgun engine's own address tests.
  const zk =
    "0zk1qyqqqqdl645pcpreh6dga7xa3w4dm9c3tzv6ntesk0fy2kzr476pkumpd9kxwatw8qqqqqdl645pcpreh6dga7xa3w4dm9c3tzv6ntesk0fy2kzr476pkwrfm4m";

  function Controlled({
    shielded,
    onResolve,
  }: {
    shielded?: boolean;
    onResolve?: (state: AddressInputState) => void;
  }) {
    const [value, setValue] = useState("");
    return (
      <AddressInput
        value={value}
        onValueChange={setValue}
        onResolve={onResolve}
        shielded={shielded}
      />
    );
  }

  const paste = async (text: string) => {
    const user = userEvent.setup();
    await user.click(screen.getByRole("textbox", { name: "Recipient address" }));
    await user.paste(text);
    return user;
  };

  it("accepts a private address and reports it apart from a public one", async () => {
    const onResolve = vi.fn();
    const { container } = renderWithWagmi(<Controlled shielded onResolve={onResolve} />);
    await paste(zk);

    expect(onResolve).toHaveBeenLastCalledWith(
      expect.objectContaining({ phase: "valid", shieldedAddress: zk, address: undefined }),
    );
    expect(container.firstChild).toHaveAttribute("data-phase", "valid");
    expect(screen.getByRole("status")).toHaveTextContent("Private address 0zk1qyqqq…wrfm4m");
  });

  it("catches a typo through the checksum, after leaving the field", async () => {
    renderWithWagmi(<Controlled shielded />);
    const user = await paste(zk.replace("dl645", "dl654"));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    await user.tab();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Checksum doesn't match. Check the private address for typos.",
    );
  });

  it("says how long a private address is when it is cut short", async () => {
    const { container } = renderWithWagmi(<Controlled shielded />);
    const user = await paste(zk.slice(0, 80));
    await user.tab();
    expect(container.firstChild).toHaveAttribute("data-phase", "incomplete");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "full 127-character private address",
    );
  });

  it("turns a private address down where only public ones work", async () => {
    const onResolve = vi.fn();
    renderWithWagmi(<Controlled onResolve={onResolve} />);
    const user = await paste(zk);
    await user.tab();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Private (0zk) addresses can't be used here.",
    );
    expect(onResolve).toHaveBeenLastCalledWith(
      expect.objectContaining({ phase: "invalid", shieldedAddress: undefined }),
    );
  });

  it("still resolves public addresses when private ones are allowed", async () => {
    const onResolve = vi.fn();
    renderWithWagmi(<Controlled shielded onResolve={onResolve} />);
    await paste(testAccounts[0]);
    await waitFor(() =>
      expect(onResolve).toHaveBeenLastCalledWith(
        expect.objectContaining({
          phase: "valid",
          address: testAccounts[0],
          shieldedAddress: undefined,
        }),
      ),
    );
  });
});

/** A chain where `fakeTxHash` is already mined, in a block stamped now. */
function minedRpc(status: "success" | "reverted" = "success"): RpcResponses {
  const chain = fakeChainRpc({ status });
  // Sending is what makes the fake chain know the hash.
  chain.eth_sendTransaction([{ from: testAccounts[0], to: MOCK_SHIELD_CONTRACT }]);
  return {
    ...chain,
    eth_getBlockByNumber: {
      ...(chain.eth_getBlockByNumber as object),
      timestamp: toHex(Math.floor(Date.now() / 1000)),
    },
  };
}

describe("ShieldedTransactionStatus", () => {
  const amount = parseUnits("1", 18);
  const phase = () =>
    document.querySelector("[data-slot=shielded-transaction-status]")!.getAttribute("data-phase");
  const steps = () => screen.getAllByRole("listitem").map((item) => item.textContent);
  // The copy button has a status region of its own; the heading comes first. Scoped to
  // the card, because ui-sdk keeps a page-level announcer (also a status) on <body>.
  const heading = () =>
    within(
      document.querySelector<HTMLElement>("[data-slot=shielded-transaction-status]")!,
    ).getAllByRole("status")[0]!;

  it("formats a wait", () => {
    expect(formatWait(0)).toBeUndefined();
    expect(formatWait(45)).toBe("45 s");
    expect(formatWait(90)).toBe("about 2 min");
    expect(formatWait(600)).toBe("about 10 min");
    expect(formatWait(3600)).toBe("about 1 hour");
    expect(formatWait(7200)).toBe("about 2 hours");
  });

  it("does not call a mined shield done until the private account has found it", async () => {
    const engine = await engineWithStandby();
    const sync = vi.spyOn(engine, "sync");
    const onSpendable = vi.fn();
    const config = createTestConfig({ rpc: minedRpc() });
    renderWithWagmi(
      withEngine(
        <ShieldedTransactionStatus
          hash={fakeTxHash}
          chainId={1}
          standby={60}
          token={tkn}
          onSpendable={onSpendable}
        >
          Shield 1 TKN
        </ShieldedTransactionStatus>,
        engine,
      ),
      { config },
    );
    expect(phase()).toBe("pending");
    expect(heading()).toHaveTextContent("Shield pending");

    // Mined: still not shielded as far as the user is concerned.
    await waitFor(() => expect(phase()).toBe("confirmed"));
    expect(heading()).toHaveTextContent("Confirmed, updating private balance");
    expect(steps()).toEqual([
      "Submitted",
      "Included in block 100",
      "Updating your private balance",
      "Waiting period before it can be spent",
    ]);
    // It asked the engine to look, once.
    expect(sync).toHaveBeenCalledExactlyOnceWith(1);

    // The scan finds it: in the balance, on standby, with a countdown.
    await act(() => engine.simulate.shield({ token: tkn.address, amount, hash: fakeTxHash }));
    expect(phase()).toBe("standby");
    expect(heading()).toHaveTextContent("Shielded, not spendable yet");
    expect(screen.getByText("0.9975")).toBeInTheDocument();
    await waitFor(() => expect(steps()[3]).toMatch(/^Waiting period: (5\d|60) s left$/));
    expect(steps()[2]).toBe("Added to your private balance");
    expect(onSpendable).not.toHaveBeenCalled();
  });

  it("finishes when the funds are spendable", async () => {
    const engine = await unlockedEngine();
    const onSpendable = vi.fn();
    const config = createTestConfig({ rpc: minedRpc() });
    renderWithWagmi(
      withEngine(
        <ShieldedTransactionStatus
          hash={fakeTxHash}
          chainId={1}
          token={tkn}
          onSpendable={onSpendable}
        />,
        engine,
      ),
      { config },
    );
    await waitFor(() => expect(phase()).toBe("confirmed"));

    await act(() => engine.simulate.shield({ token: tkn.address, amount, hash: fakeTxHash }));
    await settle();

    expect(phase()).toBe("spendable");
    expect(heading()).toHaveTextContent("Shielded and spendable");
    expect(steps().at(-1)).toBe("Spendable");
    expect(onSpendable).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        kind: "shield",
        amount: parseUnits("0.9975", 18),
        state: "spendable",
      }),
    );
  });

  it("says so when the funds end up restricted", async () => {
    const engine = await unlockedEngine({
      funds: [{ token: tkn.address, amount, state: "restricted", hash: fakeTxHash }],
    });
    renderWithWagmi(
      withEngine(<ShieldedTransactionStatus hash={fakeTxHash} chainId={1} />, engine),
      { config: createTestConfig({ rpc: minedRpc() }) },
    );
    expect(phase()).toBe("restricted");
    expect(heading()).toHaveTextContent("Shielded, but restricted");
    expect(screen.getByRole("alert")).toHaveTextContent(
      "only go back to the address they came from",
    );
  });

  it("says the same in one line", async () => {
    expect(shieldedStatusText("pending")).toBe("waiting for a block");
    expect(shieldedStatusText("standby", 45)).toBe("spendable in 45 s");
    expect(shieldedStatusText("standby", 0)).toBe("spendable any moment now");
    expect(shieldedStatusText("standby")).toBe("in its waiting period");

    const engine = await unlockedEngine();
    renderWithWagmi(
      withEngine(
        <ShieldedTransactionStatus variant="line" hash={fakeTxHash} chainId={1} token={tkn}>
          Shield 1 TKN
        </ShieldedTransactionStatus>,
        engine,
      ),
      { config: createTestConfig({ rpc: minedRpc() }) },
    );
    const line = () =>
      document.querySelector<HTMLElement>("[data-slot=shielded-transaction-status]");
    await waitFor(() => expect(line()).toHaveAttribute("data-phase", "confirmed"));
    expect(line()).toHaveTextContent("Shield 1 TKN: updating private balance");
    expect(screen.queryByRole("list")).not.toBeInTheDocument();

    await act(() => engine.simulate.shield({ token: tkn.address, amount, hash: fakeTxHash }));
    await settle();
    expect(line()).toHaveTextContent("Shield 1 TKN: spendable");
    const status = line();
    if (!status) {
      throw new Error("The status line isn't an element.");
    }
    expect(within(status).getByText("0.9975")).toBeInTheDocument();
  });

  it("reports a reverted shield and stops there", async () => {
    const engine = await unlockedEngine();
    const sync = vi.spyOn(engine, "sync");
    renderWithWagmi(
      withEngine(<ShieldedTransactionStatus hash={fakeTxHash} chainId={1} />, engine),
      { config: createTestConfig({ rpc: minedRpc("reverted") }) },
    );
    await waitFor(() => expect(phase()).toBe("reverted"));
    expect(screen.getByRole("alert")).toHaveTextContent("Nothing was shielded");
    expect(steps()).toHaveLength(2);
    expect(sync).not.toHaveBeenCalled();
  });
});

describe("Shield", () => {
  it("names the blocker in the order people meet it", () => {
    const base = {
      accountStatus: "unlocked",
      token: tkn,
      amount: 1n,
      insufficient: false,
    } as const;
    expect(shieldBlocker({ ...base, accountStatus: "none" })).toBe(
      "Create a private account first",
    );
    expect(shieldBlocker({ ...base, accountStatus: "locked" })).toBe("Unlock your private account");
    expect(shieldBlocker({ ...base, token: undefined })).toBe("Select a token");
    expect(shieldBlocker({ ...base, token: eth })).toBe("Wrap ETH to shield it");
    expect(shieldBlocker({ ...base, amount: undefined })).toBe("Enter an amount");
    expect(shieldBlocker({ ...base, insufficient: true })).toBe("Insufficient TKN balance");
    expect(shieldBlocker(base)).toBeUndefined();
  });

  it("formats a fee as a share", () => {
    expect(formatFeePercent(25n, 10_000n)).toBe("0.25%");
    expect(formatFeePercent(100n, 10_000n)).toBe("1%");
    expect(formatFeePercent(0n, 0n)).toBe("0%");
  });

  it("works out the wallet prompts a shield takes", () => {
    const plan = (options: Partial<Parameters<typeof shieldSteps>[0]>) =>
      shieldSteps({
        needsSignature: true,
        needsApproval: true,
        needsReset: false,
        atomic: false,
        ...options,
      });
    // A plain wallet: three prompts.
    expect(plan({})).toEqual(["sign", "approve", "shield"]);
    // A wallet that batches atomically: two.
    expect(plan({ atomic: true })).toEqual(["sign", "batch"]);
    // Nothing to approve, so nothing to batch.
    expect(plan({ needsApproval: false, atomic: true })).toEqual(["sign", "shield"]);
    // Tokens like USDT clear the old allowance first, unless it rides along in a batch.
    expect(plan({ needsReset: true })).toEqual(["sign", "reset", "approve", "shield"]);
    expect(plan({ needsReset: true, atomic: true })).toEqual(["sign", "batch"]);
    // An engine that needs no signature.
    expect(plan({ needsSignature: false, atomic: true })).toEqual(["batch"]);
  });

  it("says how many wallet prompts to expect", () => {
    expect(describeShieldSteps(["batch"])).toBe("One wallet prompt.");
    expect(describeShieldSteps(["sign", "batch"])).toBe(
      "Two wallet prompts: sign, approve and shield together.",
    );
    expect(describeShieldSteps(["sign", "approve", "shield"])).toBe(
      "Three wallet prompts: sign, approve, shield.",
    );
  });

  type Sent = { to: Address; data?: Hex };

  /** A wallet holding 10 TKN, with `allowance` for the shield contract. */
  function walletConfig({
    allowance = maxUint256,
    features,
    onSend,
    capabilities,
    status,
  }: {
    allowance?: bigint | (() => bigint);
    features?: { signMessageError?: boolean };
    onSend?: (tx: Sent) => void;
    /** EIP-5792 capabilities the wallet reports. Without it, it can't batch. */
    capabilities?: NonNullable<Parameters<typeof createTestConfig>[0]>["capabilities"];
    /** How sent transactions are mined. */
    status?: "success" | "reverted";
  } = {}) {
    const chain = fakeChainRpc({ status });
    const send = chain.eth_sendTransaction;
    return createTestConfig({
      features,
      capabilities,
      rpc: {
        ...chain,
        eth_call: erc20CallRpc({ balance: parseUnits("10", 18), allowance, symbol: "TKN" }),
        eth_sign: () => `0x${"11".repeat(65)}`,
        eth_sendTransaction: (params: [Sent]) => {
          onSend?.(params[0]);
          return send(params);
        },
      },
    });
  }

  const atomic = { 1: { atomic: { status: "supported" } } };
  const spender = MOCK_SHIELD_CONTRACT.toLowerCase();
  /** Spender (lower case) and amount of an `approve` call. */
  const approveArgs = (tx: Sent) => {
    if (!tx.data) {
      throw new Error("The transaction has no calldata.");
    }
    const { args } = decodeFunctionData({ abi: erc20Abi, data: tx.data });
    return [String(args[0]).toLowerCase(), args[1]];
  };

  const root = () => document.querySelector("[data-slot=shield]")!;
  const phase = () => root().getAttribute("data-phase");
  const input = () => screen.getByRole("textbox", { name: /^Amount to shield in / });
  const button = (name: string | RegExp, timeout = 5000) =>
    screen.findByRole("button", { name }, { timeout });
  const card = () => document.querySelector("[data-slot=shielded-transaction-status]");

  /** Rendered, wallet connected, and 2 TKN typed. */
  async function setup(
    config: ReturnType<typeof walletConfig>,
    { engine: engineOptions, ...props }: Partial<ShieldProps> & { engine?: MockOptions } = {},
  ) {
    const user = userEvent.setup();
    const engine = await unlockedEngine(engineOptions);
    const onSubmitted = vi.fn();
    renderWithWagmi(
      withEngine(
        <Shield tokens={[tkn]} chainId={1} onSubmitted={onSubmitted} {...props} />,
        engine,
      ),
      { config },
    );
    await act(() => connectMock(config));
    await user.type(input(), "2");
    return { user, engine, onSubmitted };
  }

  it("asks for an unlocked private account before anything else", async () => {
    const engine = createMockShieldedEngine({ speed: Infinity });
    const config = walletConfig();
    renderWithWagmi(withEngine(<Shield tokens={[tkn]} chainId={1} />, engine), { config });
    await act(() => connectMock(config));

    expect(screen.getByRole("button", { name: "Unlock your private account" })).toBeDisabled();
    await act(() => engine.account.unlock("password"));
    expect(screen.getByRole("button", { name: "Enter an amount" })).toBeDisabled();
  });

  it("offers to connect a wallet first", async () => {
    const engine = await unlockedEngine();
    renderWithWagmi(withEngine(<Shield tokens={[tkn]} chainId={1} />, engine), {
      config: walletConfig(),
    });
    expect(screen.getByRole("button", { name: "Connect wallet" })).toBeEnabled();
  });

  it("offers to switch when the wallet is on another network", async () => {
    const user = userEvent.setup();
    const engine = await unlockedEngine({ chains: [11_155_111] });
    await engine.sync(11_155_111);
    const config = walletConfig();
    renderWithWagmi(
      withEngine(
        <Shield tokens={[{ ...tkn, chainId: 11_155_111 }]} chainId={11_155_111} />,
        engine,
      ),
      { config },
    );
    await act(() => connectMock(config));
    await user.type(input(), "2");

    await user.click(await button("Switch to Sepolia"));
    expect(await button("Shield TKN")).toBeEnabled();
  });

  it("shows the cost and the wallet prompts before anything is signed", async () => {
    const config = walletConfig({ allowance: 0n });
    const { engine } = await setup(config);
    const prepare = vi.spyOn(engine, "prepareShield");

    const quote = await screen.findByText("Fee (0.25%)");
    const rows = within(quote.closest("dl")!);
    expect(rows.getByText("0.005")).toBeInTheDocument();
    expect(rows.getByText("1.995")).toBeInTheDocument();
    expect(rows.getByText("Private")).toBeInTheDocument();
    expect(
      await screen.findByText("Three wallet prompts: sign, approve, shield."),
    ).toBeInTheDocument();
    expect(prepare).not.toHaveBeenCalled();
  });

  it("takes a plain wallet through sign, approve and shield, one click each", async () => {
    let allowance = 0n;
    const sent: Array<Sent> = [];
    const config = walletConfig({
      allowance: () => allowance,
      onSend: (tx) => {
        sent.push(tx);
        if (sent.length === 1) {
          allowance = maxUint256;
        }
      },
    });
    const { user, engine, onSubmitted } = await setup(config);
    const prepare = vi.spyOn(engine, "prepareShield");

    // Click one: the signature. It is the same click that leaves the form.
    await user.click(await button("Shield TKN"));
    expect(await button("Approve TKN")).toBeEnabled();
    expect(phase()).toBe("approving");
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(sent).toHaveLength(0);
    expect(screen.getByText(/2 of 3/)).toBeInTheDocument();
    // The form is locked to what was typed.
    expect(input().closest("[inert]")).not.toBeNull();

    // Click two: the approval, for exactly the amount.
    await user.click(screen.getByRole("button", { name: "Approve TKN" }));
    expect(await button("Shield TKN")).toBeEnabled();
    expect(phase()).toBe("shielding");
    expect(approveArgs(sent[0]!)).toEqual([spender, parseUnits("2", 18)]);

    // Click three: the shield.
    await user.click(screen.getByRole("button", { name: "Shield TKN" }));
    await waitFor(() => expect(onSubmitted).toHaveBeenCalled());
    expect(sent).toHaveLength(2);
    expect(sent[1]!.to.toLowerCase()).toBe(spender);
    expect(onSubmitted).toHaveBeenCalledExactlyOnceWith(fakeTxHash, {
      chainId: 1,
      token: tkn.address,
      amount: parseUnits("2", 18),
    });
    // One preparation, so one signature, for the whole flow.
    expect(prepare).toHaveBeenCalledTimes(1);

    // The form is free again at once, and the shield is one line under it.
    expect(input()).toHaveValue("");
    expect(input().closest("[inert]")).toBeNull();
    expect(phase()).toBe("idle");
    expect(card()).toHaveTextContent("Shield 2 TKN:");
    expect(screen.queryByRole("list")).not.toBeInTheDocument();

    // The chain is what tells a real engine. Here the test does.
    await act(() => engine.simulate.shield({ ...onSubmitted.mock.calls[0]![1], hash: fakeTxHash }));
    await settle();
    expect(card()).toHaveAttribute("data-phase", "spendable");
  });

  it("skips the approval when the allowance already covers the amount", async () => {
    const sent: Array<Sent> = [];
    const { user, onSubmitted } = await setup(walletConfig({ onSend: (tx) => sent.push(tx) }));

    expect(await screen.findByText("Two wallet prompts: sign, shield.")).toBeInTheDocument();
    await user.click(await button("Shield TKN"));
    await waitFor(() => expect(phase()).toBe("shielding"));
    await user.click(await button("Shield TKN"));
    await waitFor(() => expect(onSubmitted).toHaveBeenCalled());
    expect(sent).toHaveLength(1);
  });

  describe("with a wallet that batches", () => {
    it("approves and shields in one prompt: two prompts in all", async () => {
      const sent: Array<Sent> = [];
      const config = walletConfig({
        allowance: 0n,
        capabilities: atomic,
        onSend: (tx) => sent.push(tx),
      });
      const { user, onSubmitted } = await setup(config);

      expect(
        await screen.findByText("Two wallet prompts: sign, approve and shield together."),
      ).toBeInTheDocument();

      await user.click(await button("Shield TKN"));
      const both = await button("Approve and shield TKN");
      expect(screen.queryByRole("button", { name: "Approve TKN" })).not.toBeInTheDocument();
      expect(sent).toHaveLength(0);

      await user.click(both);
      await waitFor(() => expect(onSubmitted).toHaveBeenCalled(), { timeout: 5000 });

      // One click sent the approval for exactly the amount, then the shield.
      expect(sent.map((tx) => tx.to.toLowerCase())).toEqual([tkn.address.toLowerCase(), spender]);
      expect(approveArgs(sent[0]!)).toEqual([spender, parseUnits("2", 18)]);
      expect(onSubmitted).toHaveBeenCalledExactlyOnceWith(fakeTxHash, {
        chainId: 1,
        token: tkn.address,
        amount: parseUnits("2", 18),
      });
      expect(card()).toBeInTheDocument();
    });

    it("clears a leftover allowance inside the same batch", async () => {
      const sent: Array<Sent> = [];
      const config = walletConfig({
        allowance: 5n,
        capabilities: atomic,
        onSend: (tx) => sent.push(tx),
      });
      const { user, onSubmitted } = await setup(config);

      await user.click(await button("Shield TKN"));
      await user.click(await button("Approve and shield TKN"));
      await waitFor(() => expect(onSubmitted).toHaveBeenCalled(), { timeout: 5000 });

      expect(sent).toHaveLength(3);
      expect(approveArgs(sent[0]!)).toEqual([spender, 0n]);
      expect(approveArgs(sent[1]!)).toEqual([spender, parseUnits("2", 18)]);
      expect(sent[2]!.to.toLowerCase()).toBe(spender);
    });

    it("keeps separate prompts when the wallet would first have to upgrade the account", async () => {
      const config = walletConfig({
        allowance: 0n,
        capabilities: { 1: { atomic: { status: "ready" } } },
      });
      const { user } = await setup(config);

      expect(
        await screen.findByText("Three wallet prompts: sign, approve, shield."),
      ).toBeInTheDocument();
      await user.click(await button("Shield TKN"));
      expect(await button("Approve TKN")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /Approve and shield/ })).not.toBeInTheDocument();
    });

    it("has nothing to batch when the allowance already covers the amount", async () => {
      const { user } = await setup(walletConfig({ capabilities: atomic }));

      expect(await screen.findByText("Two wallet prompts: sign, shield.")).toBeInTheDocument();
      await user.click(await button("Shield TKN"));
      await waitFor(() => expect(phase()).toBe("shielding"));
      expect(screen.queryByRole("button", { name: /Approve and shield/ })).not.toBeInTheDocument();
    });

    it("treats a declined batch as a cancel and lets the user try again", async () => {
      const config = walletConfig({
        allowance: 0n,
        capabilities: atomic,
        onSend: () => {
          throw { code: 4001, message: "User rejected the request." };
        },
      });
      const { user, onSubmitted } = await setup(config);

      await user.click(await button("Shield TKN"));
      await user.click(await button("Approve and shield TKN"));
      expect(await screen.findByText("Cancelled in wallet.")).toBeInTheDocument();
      expect(phase()).toBe("cancelled");
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(onSubmitted).not.toHaveBeenCalled();
      expect(screen.getByRole("button", { name: "Approve and shield TKN" })).toBeEnabled();
    });

    it("reads every receipt, and reports a reverted batch as shielding nothing", async () => {
      // The wallet says the batch succeeded. Its receipts say it reverted.
      const config = walletConfig({ allowance: 0n, capabilities: atomic, status: "reverted" });
      const { user, onSubmitted } = await setup(config);

      await user.click(await button("Shield TKN"));
      await user.click(await button("Approve and shield TKN"));
      expect(await screen.findByRole("alert", {}, { timeout: 5000 })).toHaveTextContent(
        "The batch reverted. Nothing was approved or shielded.",
      );
      expect(phase()).toBe("error");
      expect(onSubmitted).not.toHaveBeenCalled();
      expect(card()).not.toBeInTheDocument();
    });

    it("opens the wallet from the form when the shield takes a single prompt", async () => {
      const sent: Array<Sent> = [];
      const config = walletConfig({
        allowance: 0n,
        capabilities: atomic,
        onSend: (tx) => sent.push(tx),
      });
      // An engine that needs no signature: the batch is the only prompt.
      const { user, engine, onSubmitted } = await setup(config, {
        engine: { shieldSignature: false },
      });
      const prepare = vi.spyOn(engine, "prepareShield");

      expect(await screen.findByText("One wallet prompt.")).toBeInTheDocument();
      await user.click(await button("Shield TKN"));
      await waitFor(() => expect(onSubmitted).toHaveBeenCalled(), { timeout: 5000 });

      expect(sent).toHaveLength(2);
      expect(prepare).toHaveBeenCalledTimes(1);
    });
  });

  it("treats a declined signature as a cancel, and Cancel brings the form back as it was", async () => {
    const config = walletConfig({ features: { signMessageError: true } });
    const { user } = await setup(config);

    await user.click(await button("Shield TKN"));
    expect(await screen.findByText("Cancelled in wallet.")).toBeInTheDocument();
    expect(phase()).toBe("cancelled");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    // Still on the signature step, ready for another try.
    expect(screen.getByRole("button", { name: "Sign in wallet" })).toBeEnabled();

    await user.click(screen.getByRole("button", { name: "Cancel shield" }));
    expect(phase()).toBe("idle");
    expect(input()).toHaveValue("2");
    expect(input().closest("[inert]")).toBeNull();
    expect(await button("Shield TKN")).toBeEnabled();
  });

  it("shows why the engine couldn't build the shield", async () => {
    const { user, engine } = await setup(walletConfig());
    engine.simulate.failNextShield("This token can't be shielded.");

    await user.click(await button("Shield TKN"));
    expect(await screen.findByRole("alert")).toHaveTextContent("This token can't be shielded.");
    expect(phase()).toBe("error");
  });

  it("reports an approval that reverted and stays on that step", async () => {
    const config = walletConfig({ allowance: 0n, status: "reverted" });
    const { user, onSubmitted } = await setup(config);

    await user.click(await button("Shield TKN"));
    await user.click(await button("Approve TKN"));
    expect(await screen.findByRole("alert", {}, { timeout: 5000 })).toHaveTextContent(
      "The approval reverted.",
    );
    expect(screen.getByRole("button", { name: "Approve TKN" })).toBeEnabled();
    expect(onSubmitted).not.toHaveBeenCalled();
  });

  it("shields what was on screen when it started, not what a later quote says", async () => {
    const sent: Array<Sent> = [];
    const { user, engine, onSubmitted } = await setup(
      walletConfig({ onSend: (tx) => sent.push(tx) }),
    );
    const prepare = vi.spyOn(engine, "prepareShield");

    await user.click(await button("Shield TKN"));
    await waitFor(() => expect(phase()).toBe("shielding"));
    await user.click(await button("Shield TKN"));
    await waitFor(() => expect(onSubmitted).toHaveBeenCalled());

    expect(prepare).toHaveBeenCalledExactlyOnceWith(
      { chainId: 1, token: tkn.address, amount: parseUnits("2", 18) },
      expect.anything(),
    );
    expect(sent).toHaveLength(1);
  });

  it("blocks an amount above the wallet balance", async () => {
    const user = userEvent.setup();
    const engine = await unlockedEngine();
    const config = walletConfig();
    renderWithWagmi(withEngine(<Shield tokens={[tkn]} chainId={1} />, engine), { config });
    await act(() => connectMock(config));
    await user.type(input(), "11");
    expect(await button("Insufficient TKN balance")).toBeDisabled();
  });

  it("won't shield a native token directly", async () => {
    const engine = await unlockedEngine();
    const config = createTestConfig({
      rpc: { ...fakeChainRpc(), eth_getBalance: toHex(parseUnits("5", 18)) },
    });
    renderWithWagmi(withEngine(<Shield tokens={[eth]} chainId={1} />, engine), { config });
    await act(() => connectMock(config));
    expect(screen.getByRole("button", { name: "Wrap ETH to shield it" })).toBeDisabled();
  });

  it("offers only tokens on its chain", async () => {
    const engine = await unlockedEngine();
    const elsewhere: Token = { ...tkn, chainId: 8453, symbol: "BASE" };
    renderWithWagmi(withEngine(<Shield tokens={[elsewhere, tkn]} chainId={1} />, engine), {
      config: walletConfig(),
    });
    // One token left on chain 1, so it is locked in, not a picker.
    expect(screen.getByText("TKN")).toBeInTheDocument();
    expect(screen.queryByText("BASE")).not.toBeInTheDocument();
  });

  describe("collapse variant", () => {
    const steps = () =>
      screen
        .getAllByRole("listitem")
        .map((item) => [item.getAttribute("data-state"), item.textContent]);

    it("folds the form into a summary and a step list, then hands over to the status card", async () => {
      const config = walletConfig({ allowance: 0n, capabilities: atomic });
      const { user, engine, onSubmitted } = await setup(config, { variant: "collapse" });
      expect(root()).toHaveAttribute("data-variant", "collapse");

      // The click that leaves the form signs; the form is replaced, not locked.
      await user.click(await button("Shield TKN"));
      await button("Approve and shield TKN");
      expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
      expect(screen.getByText("1.995")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Edit shield" })).toBeEnabled();
      expect(steps()).toEqual([
        ["done", "Signed"],
        [
          "ready",
          "Approve and shield TKNOne wallet prompt. Both happen together, or neither does.",
        ],
      ]);
      expect(screen.getByText("Step 2 of 2")).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Approve and shield TKN" }));
      await waitFor(() => expect(onSubmitted).toHaveBeenCalled(), { timeout: 5000 });

      // The status card takes the form's place, with the summary above it.
      expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
      expect(card()).toHaveTextContent("Submitted");
      expect(screen.getByText("1.995")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Edit shield" })).not.toBeInTheDocument();

      // The wait can be an hour: the form comes back on request, the card stays.
      await user.click(screen.getByRole("button", { name: "Shield more" }));
      expect(input()).toHaveValue("");
      expect(card()).toBeInTheDocument();

      await act(() =>
        engine.simulate.shield({ ...onSubmitted.mock.calls[0]![1], hash: fakeTxHash }),
      );
      await settle();
      expect(card()).toHaveAttribute("data-phase", "spendable");
    });

    it("goes back to the form with the amount intact on Edit", async () => {
      const { user } = await setup(walletConfig({ allowance: 0n }), { variant: "collapse" });

      await user.click(await button("Shield TKN"));
      await button("Approve TKN");
      expect(steps().map(([state]) => state)).toEqual(["done", "ready", "todo"]);

      await user.click(screen.getByRole("button", { name: "Edit shield" }));
      expect(input()).toHaveValue("2");
      expect(phase()).toBe("idle");
      expect(await button("Shield TKN")).toBeEnabled();
    });
  });
  describe("with an agent", () => {
    beforeEach(agentReset);

    it("fills the amount and reaches the shield, but can't shield without a person", async () => {
      const sent: Array<Sent> = [];
      const config = walletConfig({ allowance: 0n, onSend: (tx) => sent.push(tx) });
      const engine = await unlockedEngine();
      const prepare = vi.spyOn(engine, "prepareShield");
      renderWithWagmi(withEngine(<Shield tokens={[tkn]} chainId={1} />, engine), { config });
      // Opening the wallet picker is free: its wallets ask on their own.
      expect(entry("Connect wallet")?.confirm).toBeUndefined();
      await act(() => connectMock(config));
      expectNamed(["Amount to shield in TKN"]);

      let result = await run([{ ref: "Amount to shield", action: "setValue", args: ["2"] }]);
      expect(result.ok, result.error?.message).toBe(true);
      const sentence =
        "Shields 2 TKN from your wallet into your private balance on Ethereum: " +
        "1.995 TKN arrives after a 0.005 TKN fee. Three wallet prompts: sign, approve, shield.";
      await waitFor(() => expect(entry("Shield TKN")?.confirm).toBe(sentence), { timeout: 3000 });

      result = await run([{ ref: "Shield TKN", action: "press" }]);
      expect(result.ok).toBe(false);
      expect(asked).toEqual([sentence]);
      expect(prepare).not.toHaveBeenCalled();
      expect(phase()).toBe("idle");

      // The person says yes: the signature goes, and the next prompt asks again.
      approve = true;
      result = await run([{ ref: "Shield TKN", action: "press" }]);
      expect(result.ok, result.error?.message).toBe(true);
      await waitFor(() =>
        expect(entry("Approve TKN")?.confirm).toBe(
          "Approve TKN in your wallet, to shield 2 TKN. Lets the shield contract move this amount.",
        ),
      );
      expect(prepare).toHaveBeenCalledTimes(1);

      approve = false;
      result = await run([{ ref: "Approve TKN", action: "press" }]);
      expect(result.ok).toBe(false);
      expect(sent).toHaveLength(0);

      // Backing out touches no wallet.
      result = await run([{ ref: "Cancel shield", action: "press" }]);
      expect(result.ok, result.error?.message).toBe(true);
      expect(phase()).toBe("idle");
      expect(seen(result)).not.toContain("abandon");
    });

    it("asks a person before switching the wallet's network", async () => {
      const engine = await unlockedEngine({ chains: [11_155_111] });
      await engine.sync(11_155_111);
      const config = walletConfig();
      renderWithWagmi(
        withEngine(
          <Shield tokens={[{ ...tkn, chainId: 11_155_111 }]} chainId={11_155_111} />,
          engine,
        ),
        { config },
      );
      await act(() => connectMock(config));
      await run([{ ref: "Amount to shield", action: "setValue", args: ["2"] }]);
      await waitFor(() =>
        expect(entry("Switch to Sepolia")?.confirm).toBe("Asks your wallet to switch to Sepolia"),
      );
      expect((await run([{ ref: "Switch to Sepolia", action: "press" }])).ok).toBe(false);
    });

    it("confirms each wallet step in the collapse variant too", async () => {
      const config = walletConfig({ allowance: 0n });
      const engine = await unlockedEngine();
      renderWithWagmi(
        withEngine(<Shield tokens={[tkn]} chainId={1} variant="collapse" />, engine),
        { config },
      );
      await act(() => connectMock(config));
      await run([{ ref: "Amount to shield", action: "setValue", args: ["2"] }]);
      await waitFor(() => expect(entry("Shield TKN")?.confirm).toMatch(/^Shields 2 TKN/), {
        timeout: 3000,
      });

      approve = true;
      expect((await run([{ ref: "Shield TKN", action: "press" }])).ok).toBe(true);
      await waitFor(() =>
        expect(entry("Approve TKN")?.confirm).toMatch(/^Approve TKN in your wallet/),
      );
      // Edit goes back to the form, free.
      approve = false;
      expect((await run([{ ref: "Edit shield", action: "press" }])).ok).toBe(true);
      expect(phase()).toBe("idle");
    });
  });
});
