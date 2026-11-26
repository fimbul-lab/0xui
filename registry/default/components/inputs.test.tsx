import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createAgent } from "@ui-sdk/react/agent";
import { useState } from "react";
import { parseEther, parseUnits } from "viem";
import type { Address } from "viem";
import { describe, expect, it, vi } from "vitest";
import {
  connectMock,
  createTestConfig,
  ensResolveRpc,
  erc20CallRpc,
  renderWithWagmi,
  testAccounts,
} from "../../../test/wagmi";
import { AddressInput } from "./address-input";
import type { AddressInputState } from "./address-input";
import { AmountInput, getAmountState, sanitizeAmountInput } from "./amount-input";
import type { AmountState } from "./amount-input";
import { TokenInput } from "./token-input";
import type { TokenInputState } from "./token-input";
import { TransactionButton } from "./transaction-button";
import { NATIVE_TOKEN_ADDRESS, TokenSelect, filterTokens, sortByHoldings } from "./token-select";
import type { Token } from "./token-select";

const eth: Token = {
  chainId: 1,
  address: NATIVE_TOKEN_ADDRESS,
  symbol: "ETH",
  name: "Ether",
  decimals: 18,
};
const usdc: Token = {
  chainId: 1,
  address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  symbol: "USDC",
  name: "USD Coin",
  decimals: 6,
};
const usdt: Token = {
  chainId: 1,
  address: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
  symbol: "USDT",
  name: "Tether USD",
  decimals: 6,
};
const dai: Token = {
  chainId: 1,
  address: "0x6B175474E89094C44Da98b954EedeAC495271d0F",
  symbol: "DAI",
  name: "Dai Stablecoin",
  decimals: 18,
};
const baseUsdc: Token = {
  ...usdc,
  chainId: 8453,
  address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
};
const tokens = [eth, usdc, usdt, dai, baseUsdc];

describe("sanitizeAmountInput", () => {
  it.each([
    ["1.5", 18, "1.5"],
    ["1,5", 18, "1.5"],
    [".5", 18, "0.5"],
    ["", 18, ""],
    ["007", 18, "007"],
    ["1.123456", 6, "1.123456"],
  ])("accepts %j", (raw, decimals, expected) => {
    expect(sanitizeAmountInput(raw, decimals)).toBe(expected);
  });

  it.each([
    ["abc", 18],
    ["1.2.3", 18],
    ["-1", 18],
    ["1e5", 18],
    ["1.1234567", 6],
  ])("refuses %j", (raw, decimals) => {
    expect(sanitizeAmountInput(raw, decimals)).toBeUndefined();
  });

  it("flags amounts over the max", () => {
    expect(getAmountState("2", 18, parseEther("1"))).toEqual({
      amount: parseEther("2"),
      exceedsMax: true,
    });
    expect(getAmountState("", 18, parseEther("1"))).toEqual({
      amount: undefined,
      exceedsMax: false,
    });
  });
});

function ControlledAmount({
  onState,
  max,
}: {
  onState?: (state: AmountState) => void;
  max?: bigint;
}) {
  const [value, setValue] = useState("");
  return (
    <AmountInput
      value={value}
      decimals={6}
      max={max}
      onValueChange={(next, state) => {
        setValue(next);
        onState?.(state);
      }}
    />
  );
}

describe("AmountInput", () => {
  it("keeps valid keystrokes and drops invalid ones", async () => {
    const user = userEvent.setup();
    renderWithWagmi(<ControlledAmount />);
    const input = screen.getByRole("textbox", { name: "Amount" });

    await user.type(input, "12a,5x");
    expect(input).toHaveValue("12.5");

    await user.type(input, "1234567");
    expect(input).toHaveValue("12.512345");
    expect(input).toHaveAttribute("inputmode", "decimal");
  });

  it("cleans up pasted amounts", () => {
    renderWithWagmi(<ControlledAmount />);
    const input = screen.getByRole("textbox", { name: "Amount" });

    fireEvent.paste(input, { clipboardData: { getData: () => "$1,000.50" } });
    expect(input).toHaveValue("1000.5");
  });

  it("fills the max and flags amounts above it", async () => {
    const user = userEvent.setup();
    const onState = vi.fn();
    renderWithWagmi(<ControlledAmount max={parseUnits("25.5", 6)} onState={onState} />);
    const input = screen.getByRole("textbox", { name: "Amount" });

    await user.click(screen.getByRole("button", { name: "Max" }));
    expect(input).toHaveValue("25.5");
    expect(input).not.toHaveAttribute("aria-invalid");

    await user.type(input, "1");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(onState).toHaveBeenLastCalledWith({
      amount: parseUnits("25.51", 6),
      exceedsMax: true,
    });
  });
});

describe("filterTokens", () => {
  it("ranks exact and prefix symbol matches first", () => {
    expect(filterTokens([dai, usdt, usdc], "usd").map((t) => t.symbol)).toEqual(["USDT", "USDC"]);
    // Symbol matches beat name matches.
    expect(filterTokens([dai, usdc], "d").map((t) => t.symbol)).toEqual(["DAI", "USDC"]);
    expect(filterTokens([usdt, usdc], "usdc").map((t) => t.symbol)).toEqual(["USDC"]);
  });

  it("finds a token by exact address", () => {
    expect(filterTokens(tokens, usdc.address.toLowerCase())).toEqual([usdc]);
  });

  it("matches names", () => {
    expect(filterTokens(tokens, "tether")).toEqual([usdt]);
  });
});

describe("sortByHoldings", () => {
  const wojak: Token = {
    ...dai,
    address: "0x5026F006B85729a8b14553FAE6af249aD16c9aaB",
    symbol: "WOJAK",
    name: "Wojak",
  };
  const balances = new Map<string, bigint>([
    [eth.address.toLowerCase(), parseEther("2")],
    [usdc.address.toLowerCase(), parseUnits("10000", 6)],
    [wojak.address.toLowerCase(), parseEther("15000000000")],
  ]);

  it("ranks priced holdings by value, never by raw amount", () => {
    const sorted = sortByHoldings([dai, wojak, usdc, eth], balances, { ETH: 3000, USDC: 1 });
    expect(sorted.map((t) => t.symbol)).toEqual(["USDC", "ETH", "WOJAK", "DAI"]);
  });

  it("keeps list order among holdings without prices", () => {
    const sorted = sortByHoldings([dai, wojak, usdc, eth], balances);
    expect(sorted.map((t) => t.symbol)).toEqual(["WOJAK", "USDC", "ETH", "DAI"]);
  });
});

describe("TokenSelect", () => {
  it("searches, picks, and remembers recent tokens", async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    renderWithWagmi(<TokenSelect tokens={tokens} onValueChange={onValueChange} chainId={1} />);

    await user.click(screen.getByRole("button", { name: "Select token" }));
    const dialog = await screen.findByRole("dialog", { name: "Select a token" });
    // Only tokens on the chosen chain.
    expect(within(dialog).getAllByRole("option")).toHaveLength(4);

    await user.type(within(dialog).getByRole("combobox", { name: "Search tokens" }), "tether");
    await user.click(within(dialog).getByRole("option", { name: /USDT/ }));
    expect(onValueChange).toHaveBeenCalledWith(usdt);

    await user.click(screen.getByRole("button", { name: "Select token" }));
    const reopened = await screen.findByRole("dialog");
    expect(
      within(within(reopened).getByRole("group", { name: "Quick picks" })).getByRole("button", {
        name: /USDT/,
      }),
    ).toBeInTheDocument();
  });

  it("picks with arrow keys while focus stays in the search field", async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    renderWithWagmi(
      <TokenSelect
        tokens={tokens}
        onValueChange={onValueChange}
        chainId={1}
        showBalances={false}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Select token" }));
    const dialog = await screen.findByRole("dialog");
    const search = within(dialog).getByRole("combobox", { name: "Search tokens" });
    await user.click(search);
    await user.keyboard("{ArrowDown}");
    const options = within(dialog).getAllByRole("option");
    expect(search).toHaveFocus();
    expect(search).toHaveAttribute("aria-activedescendant", options[1]!.id);

    await user.keyboard("{Enter}");
    expect(onValueChange).toHaveBeenCalledWith(usdc);
  });

  it("returns focus to its button on Escape, and says whether it's open", async () => {
    const user = userEvent.setup();
    renderWithWagmi(
      <TokenSelect tokens={tokens} onValueChange={() => {}} chainId={1} showBalances={false} />,
    );
    const trigger = screen.getByRole("button", { name: "Select token" });
    expect(trigger).toHaveAttribute("aria-haspopup", "dialog");
    expect(trigger).toHaveAttribute("aria-expanded", "false");

    await user.click(trigger);
    await screen.findByRole("dialog", { name: "Select a token" });
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });

  it("shows a loading state for a list that's still downloading", async () => {
    const user = userEvent.setup();
    renderWithWagmi(<TokenSelect tokens={[]} isLoading onValueChange={() => {}} chainId={1} />);

    await user.click(screen.getByRole("button", { name: "Select token" }));
    expect(await screen.findByText("Loading tokens…")).toHaveAttribute("role", "status");
    expect(screen.getByRole("listbox", { name: "Tokens" })).toHaveAttribute("aria-busy", "true");
  });

  it("pages through long lists", async () => {
    const user = userEvent.setup();
    const many: Array<Token> = Array.from({ length: 7 }, (_, i) => ({
      chainId: 1,
      address: `0x${(i + 1).toString(16).padStart(40, "0")}`,
      symbol: `T${i}`,
      name: `Token ${i}`,
      decimals: 18,
    }));
    renderWithWagmi(
      <TokenSelect
        tokens={many}
        pageSize={3}
        onValueChange={() => {}}
        chainId={1}
        showBalances={false}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Select token" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getAllByRole("option")).toHaveLength(3);
    expect(within(dialog).getByText("Showing 3 of 7")).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Show more tokens" }));
    expect(within(dialog).getAllByRole("option")).toHaveLength(6);

    // A search starts from the first page again and finds tokens beyond it.
    await user.type(within(dialog).getByRole("combobox", { name: "Search tokens" }), "T6");
    expect(within(dialog).getByRole("option", { name: /T6/ })).toBeInTheDocument();
  });

  it("loads the next page when the arrow keys reach the last row", async () => {
    const user = userEvent.setup();
    renderWithWagmi(
      <TokenSelect
        tokens={tokens}
        pageSize={2}
        onValueChange={() => {}}
        chainId={1}
        showBalances={false}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Select token" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getAllByRole("option")).toHaveLength(2);
    await user.click(within(dialog).getByRole("combobox", { name: "Search tokens" }));
    await user.keyboard("{ArrowDown}");
    expect(within(dialog).getAllByRole("option")).toHaveLength(4);
  });

  it("uses balances from your own source instead of the RPC", async () => {
    const user = userEvent.setup();
    // No RPC is mocked: any balance read would fail.
    renderWithWagmi(
      <TokenSelect
        tokens={[dai, usdc, usdt]}
        balances={{ [usdt.address]: parseUnits("250", 6) }}
        onValueChange={() => {}}
        chainId={1}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Select token" }));
    const rows = within(await screen.findByRole("listbox", { name: "Tokens" })).getAllByRole(
      "option",
    );
    expect(rows[0]).toHaveTextContent("USDT");
    expect(rows[0]).toHaveTextContent("250");
  });

  it("says when nothing matches", async () => {
    const user = userEvent.setup();
    renderWithWagmi(<TokenSelect tokens={tokens} onValueChange={() => {}} chainId={1} />);

    await user.click(screen.getByRole("button", { name: "Select token" }));
    await user.type(await screen.findByRole("combobox", { name: "Search tokens" }), "zzz");
    expect(screen.getByText("No tokens match “zzz”.")).toBeInTheDocument();
  });
});

function ControlledTokenInput({ onState }: { onState: (s: TokenInputState) => void }) {
  const [value, setValue] = useState("");
  return (
    <TokenInput
      label="You pay"
      value={value}
      token={usdc}
      onValueChange={(next, state) => {
        setValue(next);
        onState(state);
      }}
      price={1}
    />
  );
}

describe("TokenInput", () => {
  it("shows the balance, fills max, and flags an insufficient amount", async () => {
    const user = userEvent.setup();
    const onState = vi.fn();
    const config = createTestConfig({
      rpc: { eth_call: erc20CallRpc({ balance: parseUnits("100", 6), decimals: 6 }) },
    });
    renderWithWagmi(<ControlledTokenInput onState={onState} />, { config });
    await act(() => connectMock(config));

    const input = screen.getByRole("textbox", { name: "You pay in USDC" });
    await user.click(await screen.findByRole("button", { name: "Max You pay" }));
    expect(input).toHaveValue("100");
    expect(screen.getByText("$100.00")).toBeInTheDocument();

    await user.type(input, "1");
    expect(await screen.findByRole("alert")).toHaveTextContent("Insufficient USDC balance");
    expect(onState).toHaveBeenLastCalledWith(
      expect.objectContaining({ amount: parseUnits("1001", 6), insufficient: true }),
    );
  });
});

function ControlledAddress({ onResolve }: { onResolve: (s: AddressInputState) => void }) {
  const [value, setValue] = useState("");
  return <AddressInput value={value} onValueChange={setValue} onResolve={onResolve} />;
}

describe("AddressInput", () => {
  const vitalik = testAccounts[0];

  it("accepts a valid address and returns it checksummed", async () => {
    const user = userEvent.setup();
    const onResolve = vi.fn();
    renderWithWagmi(<ControlledAddress onResolve={onResolve} />);

    await user.type(
      screen.getByRole("textbox", { name: "Recipient address" }),
      vitalik.toLowerCase(),
    );

    await waitFor(() =>
      expect(onResolve).toHaveBeenLastCalledWith(
        expect.objectContaining({ phase: "valid", address: vitalik }),
      ),
    );
  });

  it("catches a checksum typo, but only after leaving the field", async () => {
    const user = userEvent.setup();
    renderWithWagmi(<ControlledAddress onResolve={() => {}} />);
    const input = screen.getByRole("textbox", { name: "Recipient address" });
    // One letter's case flipped.
    const typo = vitalik.replace("dA6", "Da6");

    await user.type(input, typo);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    await user.tab();
    expect(await screen.findByRole("alert")).toHaveTextContent("Checksum doesn't match");
    expect(input).toHaveAttribute("aria-invalid", "true");
  });

  it("resolves ENS names", async () => {
    const user = userEvent.setup();
    const onResolve = vi.fn();
    const config = createTestConfig({
      rpc: { eth_call: ensResolveRpc({ "vitalik.eth": vitalik as Address }) },
    });
    renderWithWagmi(<ControlledAddress onResolve={onResolve} />, { config });

    await user.type(screen.getByRole("textbox", { name: "Recipient address" }), "vitalik.eth");

    await waitFor(() =>
      expect(onResolve).toHaveBeenLastCalledWith(
        expect.objectContaining({ phase: "valid", address: vitalik, ensName: "vitalik.eth" }),
      ),
    );
    expect(screen.getByText("0xd8dA…6045")).toBeInTheDocument();
  });

  it("says when a name has no address", async () => {
    const user = userEvent.setup();
    const config = createTestConfig({ rpc: { eth_call: ensResolveRpc({}) } });
    renderWithWagmi(<ControlledAddress onResolve={() => {}} />, { config });

    await user.type(screen.getByRole("textbox", { name: "Recipient address" }), "nobody.eth");

    expect(await screen.findByRole("alert")).toHaveTextContent("No address found for nobody.eth.");
  });
});

describe("agents", () => {
  let approve = false;
  const agent = createAgent({ allow: (step) => !step.confirm || approve });
  const onPage = () =>
    agent.snapshot().filter((entry) => !entry.offPage && entry.component !== "more");

  /** Every entry is named, and no label's words all appear in another's. */
  function expectNamedAndDistinct() {
    const entries = onPage();
    const words = (label: string) =>
      label
        .toLowerCase()
        .split(/[^\p{L}\p{N}…]+/u)
        .filter(Boolean);
    for (const a of entries) {
      expect(a.label, `${a.component} ${a.ref} has no name`).toBeTruthy();
      for (const b of entries) {
        if (a === b) {
          continue;
        }
        const inside = words(a.label!).every((word) => words(b.label!).includes(word));
        expect(inside, `"${a.label}" also names "${b.label}"`).toBe(false);
      }
    }
    return entries;
  }

  function SendForm({ onState }: { onState: (s: AmountState) => void }) {
    const [recipient, setRecipient] = useState("");
    const [amount, setAmount] = useState("");
    return (
      <>
        <AddressInput value={recipient} onValueChange={setRecipient} />
        <AmountInput
          value={amount}
          decimals={6}
          max={parseUnits("10", 6)}
          onValueChange={(next, state) => {
            setAmount(next);
            onState(state);
          }}
        />
        <TokenSelect tokens={tokens} onValueChange={() => {}} chainId={1} showBalances={false} />
      </>
    );
  }

  it("can find and fill every control", async () => {
    const onState = vi.fn();
    renderWithWagmi(<SendForm onState={onState} />);

    const components = agent
      .snapshot()
      .filter((entry) => !entry.offPage && entry.component !== "more");
    for (const entry of components) {
      expect(entry.label, `${entry.component} ${entry.ref} has no name`).toBeTruthy();
    }
    const labels = components.map((entry) => entry.label);
    for (const label of [
      "Recipient address",
      "Paste into Recipient",
      "Amount",
      "Max",
      "Select token",
    ]) {
      expect(labels, `${label} is missing from the snapshot`).toContain(label);
    }

    const result = await act(() =>
      agent.act({
        steps: [
          { ref: "Recipient", action: "setValue", args: [testAccounts[0].toLowerCase()] },
          { ref: "Amount", action: "setValue", args: ["2.5"] },
        ],
      }),
    );
    expect(result.ok, result.error?.message).toBe(true);
    expect(screen.getByRole("textbox", { name: "Recipient address" })).toHaveValue(
      testAccounts[0].toLowerCase(),
    );
    expect(onState).toHaveBeenLastCalledWith({ amount: parseUnits("2.5", 6), exceedsMax: false });

    // Typing rules hold for agents too.
    await act(() => agent.act({ steps: [{ ref: "Amount", action: "setValue", args: ["abc"] }] }));
    expect(screen.getByRole("textbox", { name: "Amount" })).toHaveValue("2.5");
  });

  it("finds a token in the picker and picks it", async () => {
    const onValueChange = vi.fn();
    renderWithWagmi(
      <TokenSelect
        tokens={tokens}
        onValueChange={onValueChange}
        chainId={1}
        showBalances={false}
      />,
    );

    // Closed, the picker is one button. Pressing it shows the searchable list.
    expect(onPage().map((entry) => [entry.component, entry.label])).toEqual([
      ["button", "Select token"],
    ]);
    const opened = await agent.act({ steps: [{ ref: "Select token", action: "press" }] });
    expect(opened.ok, opened.error?.message).toBe(true);
    const list = opened.appeared?.find((entry) => entry.component === "command");
    expect(list?.label).toBe("Search tokens");
    expect(list?.items?.map((item) => item.label)).toEqual([
      "ETH Ether",
      "USDC USD Coin",
      "USDT Tether USD",
      "DAI Dai Stablecoin",
    ]);
    // Open, the dialog takes its title, "Select a token". It shares words with
    // the button behind it, but a step there goes to the open dialog.
    for (const entry of onPage()) {
      expect(entry.label, `${entry.ref} has no name`).toBeTruthy();
    }
    expect(onPage().map((entry) => entry.label)).toContain("Close token picker");

    const found = await agent.query({ within: "Search tokens", text: "tether" });
    if ("error" in found) {
      throw new Error(found.error);
    }
    const [usdtItem] = found[0]!.items!;
    expect(usdtItem!.label).toBe("USDT Tether USD");

    const picked = await agent.act({
      steps: [{ ref: "Search tokens", action: "run", args: [usdtItem!.value] }],
    });
    expect(picked.ok, picked.error?.message).toBe(true);
    expect(onValueChange).toHaveBeenCalledWith(usdt);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("picks a token by its symbol, or by its row's text", async () => {
    const onValueChange = vi.fn();
    renderWithWagmi(
      <TokenSelect
        tokens={tokens}
        onValueChange={onValueChange}
        chainId={1}
        showBalances={false}
      />,
    );
    const bySymbol = await agent.act({
      steps: [
        { ref: "Select token", action: "press" },
        { ref: "Search tokens", action: "run", args: ["USDC"] },
      ],
    });
    expect(bySymbol.ok, bySymbol.error?.message).toBe(true);
    expect(onValueChange).toHaveBeenLastCalledWith(usdc);

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    const byWholeRow = await agent.act({
      steps: [
        { ref: "Select token", action: "press" },
        { ref: "Search tokens", action: "run", args: ["usdt tether usd"] },
      ],
    });
    expect(byWholeRow.ok, byWholeRow.error?.message).toBe(true);
    expect(onValueChange).toHaveBeenLastCalledWith(usdt);
  });

  it("keeps a send and a swap on one page apart", async () => {
    const config = createTestConfig({
      rpc: {
        eth_call: erc20CallRpc({ balance: parseUnits("100", 6), decimals: 6 }),
        eth_getBalance: "0x4563918244f40000",
      },
    });
    const noop = () => {};
    renderWithWagmi(
      <>
        <AddressInput value="" onValueChange={noop} />
        <TokenInput
          label="Amount"
          value=""
          onValueChange={noop}
          token={eth}
          onTokenChange={noop}
          tokens={tokens}
        />
        <TransactionButton transaction={{ to: testAccounts[1], value: 1n }}>Send</TransactionButton>
        <TokenInput
          label="You pay"
          value=""
          onValueChange={noop}
          token={usdc}
          onTokenChange={noop}
          tokens={tokens}
        />
        <TokenInput
          label="You receive"
          value=""
          onValueChange={noop}
          onTokenChange={noop}
          tokens={tokens}
          checkBalance={false}
          readOnly
        />
        <TransactionButton transaction={{ to: testAccounts[1], value: 1n }}>Swap</TransactionButton>
      </>,
      { config },
    );
    await act(() => connectMock(config));
    await screen.findByRole("button", { name: "Max Amount" });
    await screen.findByRole("button", { name: "Max You pay" });

    expect(
      expectNamedAndDistinct()
        .map((entry) => entry.label)
        .sort(),
    ).toEqual(
      [
        "Recipient address",
        "Paste into Recipient",
        "Amount in ETH",
        "Max Amount",
        "Amount token: ETH, change",
        "Send",
        "You pay in USDC",
        "Max You pay",
        "You pay token: USDC, change",
        "You receive amount",
        "You receive token: Select token",
        "Swap",
      ].sort(),
    );
    const result = await agent.act({
      steps: [
        { ref: "You pay", action: "setValue", args: ["3"] },
        { ref: "Max Amount", action: "press" },
      ],
    });
    expect(result.ok, result.error?.message).toBe(true);
  });

  it("reaches tokens past the first page by searching", async () => {
    const many: Array<Token> = Array.from({ length: 12 }, (_, i) => ({
      chainId: 1,
      address: `0x${String(i + 1).padStart(40, "0")}` as Address,
      symbol: `TK${i}`,
      name: `Token ${i}`,
      decimals: 18,
    }));
    const onValueChange = vi.fn();
    renderWithWagmi(
      <TokenSelect
        tokens={many}
        pageSize={5}
        onValueChange={onValueChange}
        chainId={1}
        showBalances={false}
      />,
    );
    await agent.act({ steps: [{ ref: "Select token", action: "press" }] });
    await waitFor(() => expect(onPage().map((entry) => entry.label)).toContain("Show more tokens"));

    const result = await agent.act({
      steps: [
        { ref: "Search tokens", action: "setQuery", args: ["TK11"] },
        { ref: "Search tokens", action: "run", args: ["TK11"] },
      ],
    });
    expect(result.ok, result.error?.message).toBe(true);
    expect(onValueChange).toHaveBeenCalledWith(many[11]);
  });

  it("fills a send form: recipient, amount with Max, token, then asks before sending", async () => {
    approve = false;
    const config = createTestConfig({
      rpc: {
        eth_call: erc20CallRpc({ balance: parseUnits("100", 6), decimals: 6 }),
        eth_getBalance: "0x4563918244f40000",
      },
    });
    function SendForm() {
      const [recipient, setRecipient] = useState("");
      const [amount, setAmount] = useState("");
      const [token, setToken] = useState<Token>(eth);
      return (
        <>
          <AddressInput value={recipient} onValueChange={setRecipient} />
          <TokenInput
            label="Amount"
            value={amount}
            onValueChange={setAmount}
            token={token}
            onTokenChange={setToken}
            tokens={tokens}
          />
          <TransactionButton
            transaction={{ to: testAccounts[1], value: 1n }}
            agentConfirm="Sends the amount to the recipient"
          >
            Send
          </TransactionButton>
        </>
      );
    }
    renderWithWagmi(<SendForm />, { config });
    await act(() => connectMock(config));
    await screen.findByRole("button", { name: "Max Amount" });

    const labels = expectNamedAndDistinct().map((entry) => entry.label);
    for (const label of [
      "Recipient address",
      "Paste into Recipient",
      "Amount in ETH",
      "Amount token: ETH, change",
      "Max Amount",
      "Send",
    ]) {
      expect(labels, `${label} is missing from the snapshot`).toContain(label);
    }

    const filled = await agent.act({
      steps: [
        { ref: "Recipient", action: "setValue", args: [testAccounts[1]] },
        { ref: "Max Amount", action: "press" },
      ],
    });
    expect(filled.ok, filled.error?.message).toBe(true);
    expect(screen.getByRole("textbox", { name: "Amount in ETH" })).toHaveValue("5");

    expect(onPage().find((entry) => entry.label === "Send")?.confirm).toBe(
      "Sends the amount to the recipient",
    );
    expect((await agent.act({ steps: [{ ref: "Send", action: "press" }] })).ok).toBe(false);
  });

  it("presses an amount input's Max", async () => {
    const onState = vi.fn();
    renderWithWagmi(<SendForm onState={onState} />);
    const result = await act(() => agent.act({ steps: [{ ref: "Max", action: "press" }] }));
    expect(result.ok, result.error?.message).toBe(true);
    expect(screen.getByRole("textbox", { name: "Amount" })).toHaveValue("10");
  });
});
