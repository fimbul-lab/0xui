import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { parseEther, parseUnits, type Address } from "viem";
import { describe, expect, it, vi } from "vitest";
import {
  connectMock,
  createTestConfig,
  ensResolveRpc,
  erc20CallRpc,
  renderWithWagmi,
  testAccounts,
} from "../../../test/wagmi";
import { AddressInput, type AddressInputState } from "./address-input";
import {
  AmountInput,
  getAmountState,
  sanitizeAmountInput,
  type AmountState,
} from "./amount-input";
import { TokenInput, type TokenInputState } from "./token-input";
import {
  NATIVE_TOKEN_ADDRESS,
  TokenSelect,
  filterTokens,
  sortByHoldings,
  type Token,
} from "./token-select";

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
const baseUsdc: Token = { ...usdc, chainId: 8453, address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" };
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
    expect(filterTokens([dai, usdt, usdc], "usd").map((t) => t.symbol)).toEqual([
      "USDT",
      "USDC",
    ]);
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
  const wojak: Token = { ...dai, address: "0x5026F006B85729a8b14553FAE6af249aD16c9aaB", symbol: "WOJAK", name: "Wojak" };
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
    renderWithWagmi(
      <TokenSelect tokens={tokens} onValueChange={onValueChange} chainId={1} />
    );

    await user.click(screen.getByRole("button", { name: "Select token" }));
    const dialog = await screen.findByRole("dialog", { name: "Select a token" });
    // Only tokens on the chosen chain.
    expect(within(dialog).getAllByRole("listitem")).toHaveLength(4);

    await user.type(within(dialog).getByRole("searchbox"), "tether");
    await user.click(within(dialog).getByRole("button", { name: /USDT/ }));
    expect(onValueChange).toHaveBeenCalledWith(usdt);

    await user.click(screen.getByRole("button", { name: "Select token" }));
    const reopened = await screen.findByRole("dialog");
    expect(
      within(within(reopened).getByRole("group", { name: "Quick picks" })).getByRole(
        "button",
        { name: /USDT/ }
      )
    ).toBeInTheDocument();
  });

  it("supports arrow keys from the search field", async () => {
    const user = userEvent.setup();
    renderWithWagmi(<TokenSelect tokens={tokens} onValueChange={() => {}} chainId={1} />);

    await user.click(screen.getByRole("button", { name: "Select token" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("searchbox"));
    await user.keyboard("{ArrowDown}");
    expect(within(dialog).getAllByRole("listitem")[0]!.querySelector("button")).toHaveFocus();
    await user.keyboard("{ArrowUp}");
    expect(within(dialog).getByRole("searchbox")).toHaveFocus();
  });

  it("shows a loading state for a list that's still downloading", async () => {
    const user = userEvent.setup();
    renderWithWagmi(<TokenSelect tokens={[]} isLoading onValueChange={() => {}} chainId={1} />);

    await user.click(screen.getByRole("button", { name: "Select token" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Loading tokens…");
  });

  it("caps long lists until you search", async () => {
    const user = userEvent.setup();
    const many: Token[] = Array.from({ length: 150 }, (_, i) => ({
      chainId: 1,
      address: `0x${(i + 1).toString(16).padStart(40, "0")}`,
      symbol: `T${i}`,
      name: `Token ${i}`,
      decimals: 18,
    }));
    renderWithWagmi(<TokenSelect tokens={many} onValueChange={() => {}} chainId={1} showBalances={false} />);

    await user.click(screen.getByRole("button", { name: "Select token" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getAllByRole("button", { name: /^T\d+/ })).toHaveLength(100);
    expect(within(dialog).getByText("Showing 100 of 150. Search to find the rest.")).toBeInTheDocument();

    await user.type(within(dialog).getByRole("searchbox"), "T149");
    expect(within(dialog).getByRole("button", { name: /T149/ })).toBeInTheDocument();
  });

  it("says when nothing matches", async () => {
    const user = userEvent.setup();
    renderWithWagmi(<TokenSelect tokens={tokens} onValueChange={() => {}} chainId={1} />);

    await user.click(screen.getByRole("button", { name: "Select token" }));
    await user.type(await screen.findByRole("searchbox"), "zzz");
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

    const input = screen.getByRole("textbox", { name: "You pay" });
    await user.click(await screen.findByRole("button", { name: "Max" }));
    expect(input).toHaveValue("100");
    expect(screen.getByText("$100.00")).toBeInTheDocument();

    await user.type(input, "1");
    expect(await screen.findByRole("alert")).toHaveTextContent("Insufficient USDC balance");
    expect(onState).toHaveBeenLastCalledWith(
      expect.objectContaining({ amount: parseUnits("1001", 6), insufficient: true })
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

    await user.type(screen.getByRole("textbox", { name: "Recipient" }), vitalik.toLowerCase());

    await waitFor(() =>
      expect(onResolve).toHaveBeenLastCalledWith(
        expect.objectContaining({ phase: "valid", address: vitalik })
      )
    );
  });

  it("catches a checksum typo, but only after leaving the field", async () => {
    const user = userEvent.setup();
    renderWithWagmi(<ControlledAddress onResolve={() => {}} />);
    const input = screen.getByRole("textbox", { name: "Recipient" });
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

    await user.type(screen.getByRole("textbox", { name: "Recipient" }), "vitalik.eth");

    await waitFor(() =>
      expect(onResolve).toHaveBeenLastCalledWith(
        expect.objectContaining({ phase: "valid", address: vitalik, ensName: "vitalik.eth" })
      )
    );
    expect(screen.getByText("0xd8dA…6045")).toBeInTheDocument();
  });

  it("says when a name has no address", async () => {
    const user = userEvent.setup();
    const config = createTestConfig({ rpc: { eth_call: ensResolveRpc({}) } });
    renderWithWagmi(<ControlledAddress onResolve={() => {}} />, { config });

    await user.type(screen.getByRole("textbox", { name: "Recipient" }), "nobody.eth");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No address found for nobody.eth."
    );
  });
});
