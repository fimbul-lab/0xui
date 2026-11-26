import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createAgent } from "@ui-sdk/react/agent";
import {
  decodeFunctionData,
  encodeAbiParameters,
  encodeEventTopics,
  encodeFunctionResult,
  erc20Abi,
  parseAbi,
  parseEther,
  parseUnits,
  toHex,
} from "viem";
import type { AbiParameter, Address } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  connectMock,
  createTestConfig,
  ensResolveRpc,
  erc20CallRpc,
  fakeChainRpc,
  fakeTxHash,
  renderWithWagmi,
  testAccounts,
} from "../../../test/wagmi";
import { BatchTransaction } from "./batch-transaction";
import { ContractForm, formatAbiValue, parseAbiInput } from "./contract-form";
import { EnsProfile } from "./ens-profile";
import { EventFeed, formatEventArg } from "./event-feed";
import type { FeedEvent } from "./event-feed";
import { NftCard, expandTokenUri, resolveUri } from "./nft-card";
import { Portfolio } from "./portfolio";
import { Send, sendBlocker, sendRequest } from "./send";
import { Swap, formatRate } from "./swap";
import type { GetQuote } from "./swap";
import { NATIVE_TOKEN_ADDRESS } from "./token-select";
import type { Token } from "./token-select";
import {
  TransactionHistory,
  clearTransactionHistory,
  recordTransaction,
} from "./transaction-history";
import type { HistoryEntry } from "./transaction-history";

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
const recipient = testAccounts[1];
const router = "0x66a9893cC07D91D95644AEDD05D03f95e1dBA8Af" as Address;

const getQuote: GetQuote = async ({ sellToken, sellAmount }) => ({
  buyAmount:
    sellToken.symbol === "ETH"
      ? (sellAmount * 3150n) / 10n ** 12n
      : (sellAmount * 10n ** 12n) / 3150n,
  transaction: { to: router, data: "0x1234", value: sellToken.symbol === "ETH" ? sellAmount : 0n },
  spender: sellToken.symbol === "ETH" ? undefined : router,
  priceImpact: 0.12,
});

describe("Send", () => {
  it("names what's missing, in order", () => {
    const base = { recipient: undefined, token: usdc, amount: undefined };
    expect(sendBlocker(base, { recipientPhase: "empty", insufficient: false })).toBe(
      "Enter a recipient",
    );
    expect(sendBlocker(base, { recipientPhase: "resolving", insufficient: false })).toBe(
      "Looking up name…",
    );
    expect(sendBlocker(base, { recipientPhase: "invalid", insufficient: false })).toBe(
      "Enter a valid recipient",
    );
    expect(
      sendBlocker({ ...base, recipient }, { recipientPhase: "valid", insufficient: false }),
    ).toBe("Enter an amount");
    expect(
      sendBlocker(
        { ...base, recipient, amount: 1n },
        { recipientPhase: "valid", insufficient: true },
      ),
    ).toBe("Insufficient USDC balance");
    expect(
      sendBlocker(
        { ...base, recipient, amount: 1n },
        { recipientPhase: "valid", insufficient: false },
      ),
    ).toBeUndefined();
  });

  it("sends value for the native currency and calls transfer for ERC-20s", () => {
    expect(sendRequest({ recipient, amount: 5n, token: eth })).toEqual({
      transaction: { to: recipient, value: 5n },
    });
    expect(sendRequest({ recipient, amount: 5n, token: usdc })).toMatchObject({
      contract: { address: usdc.address, functionName: "transfer", args: [recipient, 5n] },
    });
  });

  it("sends ETH end to end", async () => {
    const user = userEvent.setup();
    const sent = vi.fn();
    const chain = fakeChainRpc();
    const send = chain.eth_sendTransaction as (p: unknown) => unknown;
    const config = createTestConfig({
      rpc: {
        ...chain,
        eth_getBalance: toHex(parseEther("1")),
        eth_sendTransaction: (params: [{ to: string; value: string }]) => {
          sent(params[0]);
          return send(params);
        },
      },
    });
    renderWithWagmi(<Send tokens={[eth]} />, { config });
    await act(() => connectMock(config));

    expect(screen.getByRole("button", { name: "Enter a recipient" })).toBeDisabled();
    await user.type(screen.getByRole("textbox", { name: "Recipient address" }), recipient);
    await user.type(screen.getByRole("textbox", { name: "Amount in ETH" }), "0.25");

    await user.click(await screen.findByRole("button", { name: "Send ETH" }));

    expect(
      await screen.findByText("Transaction confirmed", {}, { timeout: 5000 }),
    ).toBeInTheDocument();
    expect(sent).toHaveBeenCalledWith(
      expect.objectContaining({ to: recipient, value: toHex(parseEther("0.25")) }),
    );
  });
});

describe("Swap", () => {
  it("formats the rate both ways", () => {
    const sell = { token: eth, amount: parseEther("2") };
    const buy = { token: usdc, amount: parseUnits("6300", 6) };
    expect(formatRate(sell, buy, { locale: "en-US" })).toBe("1 ETH = 3,150 USDC");
    expect(formatRate(sell, buy, { invert: true, locale: "en-US" })).toBe(
      "1 USDC = 0.00031746 ETH",
    );
  });

  it("quotes, shows the rate, and swaps", async () => {
    const user = userEvent.setup();
    const quote = vi.fn(getQuote);
    const config = createTestConfig({
      rpc: { ...fakeChainRpc(), eth_getBalance: toHex(parseEther("5")) },
    });
    renderWithWagmi(<Swap tokens={[eth, usdc]} defaultBuyToken={usdc} getQuote={quote} />, {
      config,
    });
    await act(() => connectMock(config));

    expect(screen.getByRole("button", { name: "Enter an amount" })).toBeDisabled();
    await user.type(screen.getByRole("textbox", { name: /^You pay in / }), "2");

    expect(await screen.findByRole("textbox", { name: /^You receive / })).toHaveValue("");
    await waitFor(() =>
      expect(screen.getByRole("textbox", { name: /^You receive / })).toHaveValue("6300"),
    );
    expect(screen.getByText(/1 ETH = 3,150 USDC/)).toBeInTheDocument();
    expect(screen.getByText("Price impact 0.12%")).toBeInTheDocument();
    expect(quote).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "Swap" }));
    // "Done" shows even though the input clears on success.
    expect(
      await screen.findByRole("button", { name: "Done" }, { timeout: 5000 }),
    ).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: /^You pay in / })).toHaveValue("");
  });

  it("asks for approval when selling an ERC-20", async () => {
    const user = userEvent.setup();
    const config = createTestConfig({
      rpc: {
        ...fakeChainRpc(),
        eth_call: erc20CallRpc({ balance: parseUnits("1000", 6), allowance: 0n, decimals: 6 }),
      },
    });
    renderWithWagmi(
      <Swap
        tokens={[eth, usdc]}
        defaultSellToken={usdc}
        defaultBuyToken={eth}
        getQuote={getQuote}
      />,
      {
        config,
      },
    );
    await act(() => connectMock(config));

    await user.type(screen.getByRole("textbox", { name: /^You pay in / }), "100");
    expect(
      await screen.findByRole("button", { name: "Approve USDC" }, { timeout: 3000 }),
    ).toBeEnabled();
  });

  it("flips the tokens", async () => {
    const user = userEvent.setup();
    renderWithWagmi(<Swap tokens={[eth, usdc]} defaultBuyToken={usdc} getQuote={getQuote} />);

    await user.click(screen.getByRole("button", { name: "Switch tokens" }));
    const [sellPicker, buyPicker] = screen.getAllByRole("button", { name: /token: .*, change$/ });
    expect(sellPicker).toHaveAccessibleName("You pay token: USDC, change");
    expect(buyPicker).toHaveAccessibleName("You receive token: ETH, change");
  });

  it("says when there's no route", async () => {
    const user = userEvent.setup();
    const config = createTestConfig({ rpc: { eth_getBalance: toHex(parseEther("5")) } });
    renderWithWagmi(
      <Swap
        tokens={[eth, usdc]}
        defaultBuyToken={usdc}
        getQuote={() => Promise.reject(new Error("No liquidity for this pair"))}
      />,
      { config },
    );
    await act(() => connectMock(config));

    await user.type(screen.getByRole("textbox", { name: /^You pay in / }), "1");
    expect(await screen.findByRole("button", { name: "No route found" })).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent("No liquidity for this pair");
  });
});

describe("BatchTransaction", () => {
  const calls = [
    { to: usdc.address, data: "0x095ea7b3" as const, label: "Approve USDC" },
    { to: router, data: "0x1234" as const, label: "Swap" },
  ];

  it("falls back to one prompt per step when the wallet can't batch", async () => {
    const user = userEvent.setup();
    const sent = vi.fn();
    const chain = fakeChainRpc();
    const send = chain.eth_sendTransaction as (p: unknown) => unknown;
    const config = createTestConfig({
      rpc: { ...chain, eth_sendTransaction: (p: unknown) => (sent(), send(p)) },
    });
    const { container } = renderWithWagmi(<BatchTransaction calls={calls} chainId={1} />, {
      config,
    });
    await act(() => connectMock(config));

    expect(await screen.findByText("2 wallet prompts, one per step.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Confirm" }));

    expect(
      await screen.findByRole("button", { name: "Done" }, { timeout: 5000 }),
    ).toBeInTheDocument();
    expect(sent).toHaveBeenCalledTimes(2);
    expect(
      within(screen.getByRole("list", { name: "Steps" })).getAllByLabelText("Done"),
    ).toHaveLength(2);
    expect(container.querySelector("[data-atomic]")).toBeNull();
  });

  it("sends everything in one prompt in atomic mode", async () => {
    const user = userEvent.setup();
    const config = createTestConfig({ rpc: fakeChainRpc() });
    const { container } = renderWithWagmi(
      <BatchTransaction calls={calls} chainId={1} mode="atomic" />,
      { config },
    );
    await act(() => connectMock(config));

    expect(await screen.findByText("One wallet prompt for all steps.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Confirm" }));

    expect(
      await screen.findByRole("button", { name: "Done" }, { timeout: 5000 }),
    ).toBeInTheDocument();
    expect(container.querySelector("[data-atomic]")).not.toBeNull();
  });

  it("stops at a declined step", async () => {
    const user = userEvent.setup();
    const config = createTestConfig({
      rpc: {
        ...fakeChainRpc(),
        eth_sendTransaction: () => {
          throw { code: 4001, message: "User rejected the request." };
        },
      },
    });
    renderWithWagmi(<BatchTransaction calls={calls} chainId={1} mode="sequential" />, { config });
    await act(() => connectMock(config));

    await user.click(screen.getByRole("button", { name: "Confirm" }));
    expect(await screen.findByText("Cancelled in wallet.")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("parseAbiInput", () => {
  const p = (type: string, extra: Partial<AbiParameter> = {}): AbiParameter => ({
    type,
    name: "x",
    ...extra,
  });

  it("parses integers with range checks", () => {
    expect(parseAbiInput(p("uint256"), "1_000")).toEqual({ value: 1000n });
    expect(parseAbiInput(p("uint8"), "256").error).toBe("Out of range for uint8");
    expect(parseAbiInput(p("uint256"), "-1").error).toBe("Out of range for uint256");
    expect(parseAbiInput(p("int8"), "-128")).toEqual({ value: -128n });
    expect(parseAbiInput(p("uint256"), "1.5").error).toBe("Whole number");
  });

  it("checksums addresses and catches typos", () => {
    expect(parseAbiInput(p("address"), recipient.toLowerCase())).toEqual({ value: recipient });
    expect(parseAbiInput(p("address"), recipient.replace("C7656", "c7656")).error).toBe(
      "Checksum doesn't match",
    );
    expect(parseAbiInput(p("address"), "0x123").error).toBe("Not an address");
  });

  it("checks bytes lengths and booleans", () => {
    expect(parseAbiInput(p("bytes32"), `0x${"ab".repeat(32)}`).value).toBeDefined();
    expect(parseAbiInput(p("bytes32"), "0xab").error).toBe("Exactly 32 bytes");
    expect(parseAbiInput(p("bytes"), "hello").error).toBe("Hex, starting with 0x");
    expect(parseAbiInput(p("bool"), "true")).toEqual({ value: true });
  });

  it("parses arrays and tuples as JSON", () => {
    expect(parseAbiInput(p("uint256[]"), '["1", 2]')).toEqual({ value: [1n, 2n] });
    expect(parseAbiInput(p("uint256[2]"), "[1]").error).toBe("Expected 2 items");
    const tuple = p("tuple", {
      components: [
        { name: "to", type: "address" },
        { name: "amount", type: "uint256" },
      ],
    });
    expect(parseAbiInput(tuple, `{ "to": "${recipient}", "amount": "5" }`)).toEqual({
      value: { to: recipient, amount: 5n },
    });
  });

  it("formats results", () => {
    expect(formatAbiValue(5n)).toBe("5");
    expect(formatAbiValue([1n, recipient])).toBe(`[\n  "1",\n  "${recipient}"\n]`);
  });
});

describe("ContractForm", () => {
  const abi = parseAbi([
    "function balanceOf(address owner) view returns (uint256)",
    "function transfer(address to, uint256 amount) returns (bool)",
    "event Transfer(address indexed from, address indexed to, uint256 value)",
  ]);

  it("reads a view function", async () => {
    const user = userEvent.setup();
    const config = createTestConfig({ rpc: { eth_call: erc20CallRpc({ balance: 42n }) } });
    renderWithWagmi(<ContractForm address={usdc.address} abi={abi} show="read" />, { config });

    await user.click(screen.getByText("balanceOf(address)"));
    await user.type(screen.getByRole("textbox", { name: /owner/ }), recipient);
    await user.click(screen.getByRole("button", { name: "Read balanceOf from the contract" }));

    expect(await screen.findByLabelText("balanceOf result")).toHaveValue("42");
  });

  it("names the field to fix before writing", async () => {
    const user = userEvent.setup();
    const config = createTestConfig({ rpc: fakeChainRpc() });
    renderWithWagmi(<ContractForm address={usdc.address} abi={abi} show="write" />, { config });
    await act(() => connectMock(config));

    await user.click(screen.getByText("transfer(address, uint256)"));
    expect(screen.getByRole("button", { name: "Fill in the fields" })).toBeDisabled();
    await user.type(screen.getByRole("textbox", { name: /to/ }), recipient);
    expect(screen.getByRole("button", { name: "Check amount" })).toBeDisabled();
    await user.type(screen.getByRole("textbox", { name: /amount/ }), "10");
    expect(screen.getByRole("button", { name: "Call transfer" })).toBeEnabled();
  });
});

describe("Portfolio", () => {
  it("totals holdings and sorts by value", async () => {
    const config = createTestConfig({
      rpc: {
        eth_getBalance: toHex(parseEther("2")),
        eth_call: erc20CallRpc({ balance: parseUnits("500", 6), decimals: 6 }),
      },
    });
    renderWithWagmi(<Portfolio tokens={[usdc, eth]} prices={{ ETH: 3000, USDC: 1 }} />, { config });
    await act(() => connectMock(config));

    expect(await screen.findByText("$6,500.00")).toBeInTheDocument();
    const rows = screen.getAllByRole("listitem");
    expect(rows[0]).toHaveTextContent("Ether");
    expect(rows[1]).toHaveTextContent("USD Coin");
  });

  it("uses balances from your own source and pages the rows", async () => {
    const user = userEvent.setup();
    const many: Array<Token> = Array.from({ length: 12 }, (_, i) => ({
      chainId: 1,
      address: `0x${(i + 1).toString(16).padStart(40, "0")}`,
      symbol: `T${i}`,
      name: `Token ${i}`,
      decimals: 0,
    }));
    // No wallet, no RPC: the indexer data is all there is.
    renderWithWagmi(
      <Portfolio
        tokens={many}
        chainId={1}
        balances={Object.fromEntries(many.map((t, i) => [t.address, BigInt(i + 1)]))}
        prices={Object.fromEntries(many.map((t) => [t.symbol, 1]))}
        pageSize={5}
      />,
    );

    expect(await screen.findByText("$78.00")).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(5);
    expect(screen.getAllByRole("listitem")[0]).toHaveTextContent("Token 11");
    await user.click(screen.getByRole("button", { name: "Show more holdings (7)" }));
    expect(screen.getAllByRole("listitem")).toHaveLength(10);
  });

  it("asks to connect when there's no account", () => {
    renderWithWagmi(<Portfolio tokens={[eth]} />);
    expect(screen.getByText("Connect a wallet to see its tokens.")).toBeInTheDocument();
  });

  it("hides spam, unpriced tokens and dust, out of the total", async () => {
    const user = userEvent.setup();
    const token = (n: number, symbol: string, name = symbol): Token => ({
      chainId: 1,
      address: `0x${n.toString(16).padStart(40, "0")}`,
      symbol,
      name,
      decimals: 0,
    });
    const real = token(1, "UNI", "Uniswap");
    const fake = token(2, "UNI", "Visit uni-claim.com to claim"); // copies UNI, gets its price
    const copycat = token(3, "UNI", "Uniswap"); // same name and symbol, different address
    const meme = token(4, "MEME");
    const dust = token(5, "DUST");
    const tokens = [real, fake, copycat, meme, dust];
    renderWithWagmi(
      <Portfolio
        tokens={tokens}
        chainId={1}
        balances={Object.fromEntries(tokens.map((t) => [t.address, 10n]))}
        prices={{ [`1:${real.address}`]: 10, [fake.address]: 10, DUST: 0.01 }}
      />,
    );

    // Total and the one row: the fake UNI, also worth $100, is left out.
    expect(await screen.findAllByText("$100.00")).toHaveLength(2);
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    const toggle = screen.getByRole("button", { name: "Hidden tokens (4)" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    await user.click(toggle);
    const hidden = within(screen.getByRole("list", { name: "Hidden holdings" }));
    expect(
      hidden.getByText("Visit uni-claim.com to claim").closest("[role=listitem]"),
    ).toHaveTextContent("Likely spam");
    expect(hidden.getAllByText("No price")).toHaveLength(2);
    expect(hidden.getByText("Under $0.50")).toBeInTheDocument();
  });

  it("hides holdings off the token list unless showUnlisted is set", async () => {
    const user = userEvent.setup();
    const unlisted: Token = {
      chainId: 1,
      address: "0x00000000000000000000000000000000000000aa",
      symbol: "NEW",
      name: "New Token",
      decimals: 0,
    };
    // The indexer's own metadata for USDC loses to the list's.
    const holdings = [
      { token: { ...usdc, name: "USDC from indexer" }, balance: parseUnits("50", 6) },
      { token: unlisted, balance: 20n },
    ];
    const prices = { [`1:${usdc.address}`]: 1, [`1:${unlisted.address}`]: 2 };
    const { unmount } = renderWithWagmi(
      <Portfolio tokens={[usdc]} chainId={1} holdings={holdings} prices={prices} />,
    );

    expect(await screen.findAllByText("$50.00")).toHaveLength(2);
    expect(screen.getByText("USD Coin")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Hidden tokens (1)" }));
    expect(screen.getByText("New Token").closest("[role=listitem]")).toHaveTextContent(
      "Not on the token list",
    );

    unmount();
    renderWithWagmi(
      <Portfolio tokens={[usdc]} chainId={1} holdings={holdings} prices={prices} showUnlisted />,
    );
    expect(await screen.findByText("$90.00")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Hidden tokens/ })).not.toBeInTheDocument();
  });

  it("takes your own spam verdicts and thresholds", async () => {
    const flagged: Token = {
      ...usdc,
      address: "0x0000000000000000000000000000000000000bad",
      name: "USD Coin",
    };
    renderWithWagmi(
      <Portfolio
        tokens={[usdc, flagged]}
        chainId={1}
        balances={{ [usdc.address]: 100n, [flagged.address]: 100n }}
        prices={{ USDC: 1 }}
        isSpam={(t) => t.address === flagged.address}
        minValue={0}
      />,
    );

    expect(await screen.findByRole("button", { name: "Hidden tokens (1)" })).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
  });

  it("always shows the native currency", async () => {
    renderWithWagmi(<Portfolio tokens={[eth]} chainId={1} balances={{ [eth.address]: 1n }} />);
    expect(await screen.findByText("Ether")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Hidden tokens/ })).not.toBeInTheDocument();
  });
});

describe("TransactionHistory", () => {
  beforeEach(() => clearTransactionHistory());

  it("lists recorded transactions and tracks their status", async () => {
    const chain = fakeChainRpc();
    (chain.eth_sendTransaction as (p: unknown) => unknown)([
      { from: testAccounts[0], to: recipient },
    ]);
    renderWithWagmi(<TransactionHistory from={null} />, {
      config: createTestConfig({ rpc: chain }),
    });

    expect(screen.getByText("Transactions you send will show up here.")).toBeInTheDocument();
    act(() => recordTransaction({ hash: fakeTxHash, chainId: 1, description: "Send 1 ETH" }));

    expect(await screen.findByText("Send 1 ETH")).toBeInTheDocument();
    expect(await screen.findByText("Confirmed ·", {}, { timeout: 5000 })).toBeInTheDocument();
  });

  it("shows only the connected account's transactions", async () => {
    const config = createTestConfig();
    renderWithWagmi(<TransactionHistory />, { config });
    await act(() => connectMock(config));

    act(() => {
      recordTransaction({
        hash: `0x${"01".repeat(32)}`,
        chainId: 1,
        from: testAccounts[0],
        description: "Mine",
        status: "confirmed",
      });
      recordTransaction({
        hash: `0x${"02".repeat(32)}`,
        chainId: 1,
        from: recipient,
        description: "Theirs",
        status: "confirmed",
      });
    });

    expect(await screen.findByText("Mine")).toBeInTheDocument();
    expect(screen.queryByText("Theirs")).not.toBeInTheDocument();
  });

  it("renders transactions from your own source and pages them", async () => {
    const user = userEvent.setup();
    const indexed = Array.from({ length: 4 }, (_, i): HistoryEntry => ({
      hash: `0x${String(i + 1).repeat(64)}`,
      chainId: 1,
      description: `Indexed ${i}`,
      submittedAt: Date.now() - i * 60_000,
      status: "confirmed",
    }));
    renderWithWagmi(<TransactionHistory from={null} transactions={indexed} pageSize={3} />);

    expect(screen.getByText("Indexed 0")).toBeInTheDocument();
    expect(screen.queryByText("Indexed 3")).not.toBeInTheDocument();
    // Not the local store, so nothing to clear.
    expect(
      screen.queryByRole("button", { name: "Clear transaction history" }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Show more transactions (1)" }));
    expect(screen.getByText("Indexed 3")).toBeInTheDocument();
  });

  it("clears", async () => {
    const user = userEvent.setup();
    renderWithWagmi(<TransactionHistory from={null} />);
    act(() =>
      recordTransaction({ hash: fakeTxHash, chainId: 1, description: "Old", status: "confirmed" }),
    );

    await user.click(await screen.findByRole("button", { name: "Clear transaction history" }));
    expect(screen.queryByText("Old")).not.toBeInTheDocument();
  });
});

describe("EnsProfile", () => {
  it("shows a name's address, bio and links", async () => {
    const vitalik = testAccounts[0];
    const config = createTestConfig({
      rpc: {
        eth_call: ensResolveRpc(
          { "vitalik.eth": vitalik },
          {
            "vitalik.eth": {
              description: "mi pinxe lo crino tcati",
              "com.twitter": "VitalikButerin",
              url: "https://vitalik.ca",
            },
          },
        ),
      },
    });
    renderWithWagmi(<EnsProfile name="vitalik.eth" />, { config });

    expect(await screen.findByRole("heading", { name: "vitalik.eth" })).toBeInTheDocument();
    expect(await screen.findByText("mi pinxe lo crino tcati")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /X:\s*@VitalikButerin/ })).toHaveAttribute(
      "href",
      "https://x.com/VitalikButerin",
    );
    expect(screen.getByRole("link", { name: /Website:\s*vitalik\.ca/ })).toHaveAttribute(
      "href",
      "https://vitalik.ca",
    );
    expect(screen.getByText("0xd8dA…6045")).toBeInTheDocument();
  });

  it("says when a name has no address", async () => {
    const config = createTestConfig({ rpc: { eth_call: ensResolveRpc({}) } });
    const { container } = renderWithWagmi(<EnsProfile name="nobody.eth" />, { config });
    expect(await screen.findByText("nobody.eth doesn't point to an address.")).toBeInTheDocument();
    expect(container.querySelector("[data-phase]")).toHaveAttribute("data-phase", "not-found");
  });
});

describe("NftCard", () => {
  const nft = "0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D" as Address;
  const nftAbi = parseAbi([
    "function tokenURI(uint256) view returns (string)",
    "function name() view returns (string)",
  ]);

  it("resolves storage URIs", () => {
    expect(resolveUri("ipfs://QmX/1.json")).toBe("https://ipfs.io/ipfs/QmX/1.json");
    expect(resolveUri("ipfs://ipfs/QmX")).toBe("https://ipfs.io/ipfs/QmX");
    expect(resolveUri("ar://abc")).toBe("https://arweave.net/abc");
    expect(expandTokenUri("https://x/{id}.json", 255n)).toBe(`https://x/${"0".repeat(62)}ff.json`);
  });

  it("renders metadata from an inline data URI", async () => {
    const metadata = {
      name: "Ape #7",
      image: "ipfs://QmImage",
      attributes: [{ trait_type: "Fur", value: "Gold" }],
    };
    const uri = `data:application/json;base64,${Buffer.from(JSON.stringify(metadata)).toString("base64")}`;
    const config = createTestConfig({
      rpc: {
        eth_call: ([{ data }]: [{ data: string }]) => {
          if (data.startsWith("0xc87b56dd")) {
            return encodeFunctionResult({ abi: nftAbi, functionName: "tokenURI", result: uri });
          }
          if (data.startsWith("0x06fdde03")) {
            return encodeFunctionResult({
              abi: nftAbi,
              functionName: "name",
              result: "Bored Ape Yacht Club",
            });
          }
          throw new Error("execution reverted");
        },
      },
    });
    renderWithWagmi(<NftCard contract={nft} tokenId={7n} showAttributes />, { config });

    expect(await screen.findByRole("heading", { name: "Ape #7" })).toBeInTheDocument();
    expect(screen.getByText("Bored Ape Yacht Club · #7")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Ape #7" })).toHaveAttribute(
      "src",
      "https://ipfs.io/ipfs/QmImage",
    );
    expect(screen.getByText("Gold")).toBeInTheDocument();
  });

  it("says when the metadata host fails, not that the token is missing", async () => {
    const config = createTestConfig({
      rpc: {
        eth_call: ([{ data }]: [{ data: string }]) => {
          if (data.startsWith("0xc87b56dd")) {
            return encodeFunctionResult({
              abi: nftAbi,
              functionName: "tokenURI",
              result: "data:application/json,{broken",
            });
          }
          throw new Error("execution reverted");
        },
      },
    });
    const { container } = renderWithWagmi(<NftCard contract={nft} tokenId={1n} />, { config });
    // The metadata fetch retries once before giving up.
    expect(
      await screen.findByText("Metadata unavailable", {}, { timeout: 5000 }),
    ).toBeInTheDocument();
    expect(container.querySelector('[data-slot="nft-card"]')).toHaveAttribute(
      "data-phase",
      "metadata-error",
    );
  });

  it("says when the token doesn't exist", async () => {
    const config = createTestConfig({
      rpc: {
        eth_call: () => {
          throw new Error("execution reverted");
        },
      },
    });
    renderWithWagmi(<NftCard contract={nft} tokenId={1n} />, { config });
    expect(await screen.findByText("Token not found")).toBeInTheDocument();
  });
});

describe("EventFeed", () => {
  it("formats event arguments", () => {
    expect(formatEventArg(1_234_567n)).toBe("1,234,567");
    expect(formatEventArg(recipient)).toBe("0x71C7…976F");
    expect(formatEventArg(true)).toBe("true");
  });

  it("shows past events from your own source", () => {
    const past: FeedEvent = {
      address: usdc.address,
      topics: [],
      data: "0x",
      eventName: "Transfer",
      args: { from: testAccounts[0], to: recipient, value: 42n },
      blockNumber: 99n,
      blockHash: `0x${"44".repeat(32)}`,
      transactionHash: `0x${"55".repeat(32)}`,
      transactionIndex: 0,
      logIndex: 0,
      removed: false,
    };
    renderWithWagmi(
      <EventFeed
        address={usdc.address}
        abi={erc20Abi}
        eventName="Transfer"
        initialEvents={[past]}
      />,
      {
        config: createTestConfig({
          rpc: {
            ...fakeChainRpc(),
            eth_newFilter: "0x1",
            eth_getFilterChanges: [],
            eth_uninstallFilter: true,
          },
        }),
      },
    );
    expect(within(screen.getByRole("log")).getByText("42")).toBeInTheDocument();
  });

  it("shows new events as they arrive", async () => {
    const transfer = parseAbi([
      "event Transfer(address indexed from, address indexed to, uint256 value)",
    ]);
    const log = {
      address: usdc.address,
      topics: encodeEventTopics({
        abi: transfer,
        eventName: "Transfer",
        args: { from: testAccounts[0], to: recipient },
      }),
      data: encodeAbiParameters([{ type: "uint256" }], [5_000_000n]),
      blockNumber: "0x65",
      blockHash: `0x${"33".repeat(32)}`,
      transactionHash: fakeTxHash,
      transactionIndex: "0x0",
      logIndex: "0x0",
      removed: false,
    };
    let delivered = false;
    const config = createTestConfig({
      rpc: {
        ...fakeChainRpc(),
        eth_newFilter: "0x1",
        eth_uninstallFilter: true,
        eth_getFilterChanges: () => (delivered ? [] : ((delivered = true), [log])),
      },
    });
    renderWithWagmi(<EventFeed address={usdc.address} abi={erc20Abi} eventName="Transfer" />, {
      config,
    });

    expect(screen.getByText("Waiting for events…")).toBeInTheDocument();
    const feed = screen.getByRole("log");
    expect(await within(feed).findByText("Transfer", {}, { timeout: 5000 })).toBeInTheDocument();
    expect(within(feed).getByText("5,000,000")).toBeInTheDocument();
    expect(within(feed).getByText("0x71C7…976F")).toBeInTheDocument();
    expect(within(feed).getByRole("link", { name: /#101/ })).toHaveAttribute(
      "href",
      `https://etherscan.io/tx/${fakeTxHash}`,
    );
  });
});

describe("Agents", () => {
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
  beforeEach(() => {
    approve = false;
    asked.length = 0;
  });

  const onPage = () =>
    agent.snapshot().filter((entry) => !entry.offPage && entry.component !== "more");
  const entry = (label: string) => onPage().find((e) => e.label === label);
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
  /** The value of the item named `text` in the list labelled `within`, as an agent finds it. */
  const pick = async (within: string, text: string) => {
    const found = await act(() => agent.query({ within, text }));
    if ("error" in found) {
      throw new Error(found.error);
    }
    const value = found[0]?.items?.[0]?.value;
    expect(value, `${text} isn't in ${within}`).toBeDefined();
    return value;
  };
  const run = (steps: Array<{ ref: string; action: string; args?: Array<unknown> }>) =>
    act(() => agent.act({ steps }));

  it("sends: fills recipient, token and amount, and needs a person to press Send", async () => {
    const sent = vi.fn();
    const chain = fakeChainRpc();
    const send = chain.eth_sendTransaction as (p: unknown) => unknown;
    const config = createTestConfig({
      rpc: {
        ...chain,
        eth_getBalance: toHex(parseEther("1")),
        eth_call: erc20CallRpc({ balance: parseUnits("500", 6), decimals: 6 }),
        eth_sendTransaction: (params: [{ to: string; data?: string }]) => {
          sent(params[0]);
          return send(params);
        },
      },
    });
    renderWithWagmi(<Send tokens={[eth, usdc]} />, { config });
    await act(() => connectMock(config));
    expectNamed([
      "Recipient address",
      "Paste into Recipient",
      "Amount in ETH",
      "Amount token: ETH, change",
    ]);

    let result = await run([
      { ref: "Recipient", action: "setValue", args: [recipient] },
      { ref: "Amount token", action: "press" },
    ]);
    expect(result.ok, result.error?.message).toBe(true);
    // The picker is open: find the token's row by its name, and run it.
    const token = await pick("Search tokens", "USD Coin");
    result = await run([{ ref: "Search tokens", action: "run", args: [token] }]);
    expect(result.ok, result.error?.message).toBe(true);
    expect(
      entry("Amount token: USDC, change"),
      "the picked token shows on the trigger",
    ).toBeDefined();
    expect(result.ok, result.error?.message).toBe(true);
    result = await run([{ ref: "Amount", action: "setValue", args: ["2.5"] }]);
    expect(result.ok, result.error?.message).toBe(true);

    const sentence = `Sends 2.5 USDC from your wallet to ${recipient} on Ethereum`;
    await waitFor(() => expect(entry("Send USDC")?.confirm).toBe(sentence));

    // Alone, the agent is refused, and the person is asked in those words.
    result = await run([{ ref: "Send USDC", action: "press" }]);
    expect(result.ok).toBe(false);
    expect(asked).toEqual([sentence]);
    expect(sent).not.toHaveBeenCalled();

    approve = true;
    result = await run([{ ref: "Send USDC", action: "press" }]);
    expect(result.ok, result.error?.message).toBe(true);
    await waitFor(() => expect(sent).toHaveBeenCalledTimes(1));
    const tx = sent.mock.calls[0]![0] as { to: string; data: `0x${string}` };
    expect(tx.to).toBe(usdc.address);
    expect(decodeFunctionData({ abi: erc20Abi, data: tx.data }).args).toEqual([
      recipient,
      parseUnits("2.5", 6),
    ]);
  });

  it("swaps: fills the amount, picks the token, reads the rate, and needs a person to press Swap", async () => {
    const config = createTestConfig({
      rpc: { ...fakeChainRpc(), eth_getBalance: toHex(parseEther("5")) },
    });
    renderWithWagmi(<Swap tokens={[eth, usdc]} getQuote={getQuote} />, { config });
    await act(() => connectMock(config));
    expectNamed([
      "You pay in ETH",
      "You receive amount",
      "Switch tokens",
      "You receive token: Select token",
    ]);

    let result = await run([
      { ref: "You pay", action: "setValue", args: ["2"] },
      { ref: "Select token", action: "press" },
    ]);
    expect(result.ok, result.error?.message).toBe(true);
    result = await run([
      { ref: "Search tokens", action: "run", args: [await pick("Search tokens", "USD Coin")] },
    ]);
    expect(result.ok, result.error?.message).toBe(true);

    const sentence =
      "Swaps 2 ETH from your wallet for about 6300 USDC on Ethereum (price impact 0.12%)";
    await waitFor(() => expect(entry("Swap")?.confirm).toBe(sentence), { timeout: 3000 });
    expect(entry("You receive in USDC")?.value).toBe("6300");

    // The rate is a button too, free to press.
    result = await run([{ ref: "Invert rate", action: "press" }]);
    expect(result.ok, result.error?.message).toBe(true);
    expect(onPage().find((e) => e.label?.startsWith("Invert rate"))?.label).toBe(
      "Invert rate: 1 USDC = 0.00031746 ETH",
    );

    result = await run([{ ref: "Swap", action: "press" }]);
    expect(result.ok).toBe(false);
    expect(asked).toEqual([sentence]);

    approve = true;
    result = await run([{ ref: "Swap", action: "press" }]);
    expect(result.ok, result.error?.message).toBe(true);
    expect(
      await screen.findByRole("button", { name: "Done" }, { timeout: 5000 }),
    ).toBeInTheDocument();
  });

  it("flips a swap's tokens", async () => {
    renderWithWagmi(<Swap tokens={[eth, usdc]} defaultBuyToken={usdc} getQuote={getQuote} />);
    const result = await run([{ ref: "Switch tokens", action: "press" }]);
    expect(result.ok, result.error?.message).toBe(true);
    const [sellPicker, buyPicker] = screen.getAllByRole("button", { name: /token: .*, change$/ });
    expect(sellPicker).toHaveAccessibleName("You pay token: USDC, change");
    expect(buyPicker).toHaveAccessibleName("You receive token: ETH, change");
  });

  describe("ContractForm", () => {
    const abi = parseAbi([
      "function balanceOf(address owner) view returns (uint256)",
      "function transfer(address to, uint256 amount) returns (bool)",
      "function approve(address spender, uint256 amount) returns (bool)",
      "function setPaused(bool paused)",
    ]);

    function setup() {
      const sent = vi.fn();
      const chain = fakeChainRpc();
      const send = chain.eth_sendTransaction as (p: unknown) => unknown;
      const config = createTestConfig({
        rpc: {
          ...chain,
          eth_call: erc20CallRpc({ balance: 42n }),
          eth_sendTransaction: (params: [unknown]) => (sent(params[0]), send(params)),
        },
      });
      renderWithWagmi(<ContractForm address={usdc.address} abi={abi} />, { config });
      return { config, sent };
    }

    it("names every field after its function, so no two collide", async () => {
      const { config } = setup();
      await act(() => connectMock(config));
      const cards = onPage().map((e) => e.label!);
      expect(cards).toEqual([
        "read balanceOf(address) → uint256",
        "write transfer(address, uint256) → bool",
        "write approve(address, uint256) → bool",
        "write setPaused(bool)",
      ]);
      for (const card of cards) {
        const result = await run([{ ref: card, action: "setOpen", args: [true] }]);
        expect(result.ok, result.error?.message).toBe(true);
      }
      expectNamed([
        "balanceOf: owner address",
        "Read balanceOf from the contract",
        "transfer: to address",
        "transfer: amount uint256",
        "approve: spender address",
        "approve: amount uint256",
        "setPaused: paused bool",
      ]);
      // Two "amount" fields, each found by its own name. Disabled buttons
      // ("Fill in the fields") can't be pressed, so they may share one.
      const live = onPage().filter((e) => !e.disabled);
      expect(collisions(live.map((e) => e.label!))).toEqual([]);
    });

    it("reads freely, and shows the result to the agent", async () => {
      setup();
      // Opening a card renders its fields, so they come in the next call.
      let result = await run([{ ref: "read balanceOf", action: "setOpen", args: [true] }]);
      expect(result.ok, result.error?.message).toBe(true);
      result = await run([{ ref: "balanceOf: owner", action: "setValue", args: [recipient] }]);
      expect(result.ok, result.error?.message).toBe(true);
      result = await run([{ ref: "Read balanceOf from the contract", action: "press" }]);
      expect(result.ok, result.error?.message).toBe(true);
      expect(asked).toEqual([]);
      await waitFor(() => expect(entry("balanceOf result")?.value).toBe("42"));
    });

    it("fills a write's arguments, and needs a person to send it", async () => {
      const { config, sent } = setup();
      await act(() => connectMock(config));
      let result = await run([
        { ref: "write transfer", action: "setOpen", args: [true] },
        { ref: "write setPaused", action: "setOpen", args: [true] },
      ]);
      expect(result.ok, result.error?.message).toBe(true);
      result = await run([
        { ref: "transfer: to", action: "setValue", args: [recipient] },
        { ref: "transfer: amount", action: "setValue", args: ["10"] },
        { ref: "setPaused: paused", action: "setValue", args: ["true"] },
      ]);
      expect(result.ok, result.error?.message).toBe(true);
      expect(entry("setPaused: paused bool")?.value).toBe("true");

      const sentence = `Calls transfer(to: ${recipient}, amount: 10) on contract ${usdc.address} on Ethereum, from your wallet`;
      expect(entry("Call transfer")?.confirm).toBe(sentence);
      result = await run([{ ref: "Call transfer", action: "press" }]);
      expect(result.ok).toBe(false);
      expect(sent).not.toHaveBeenCalled();

      approve = true;
      result = await run([{ ref: "Call transfer", action: "press" }]);
      expect(result.ok, result.error?.message).toBe(true);
      await waitFor(() => expect(sent).toHaveBeenCalledTimes(1));
      const tx = sent.mock.calls[0]![0] as { data: `0x${string}` };
      expect(decodeFunctionData({ abi, data: tx.data })).toMatchObject({
        functionName: "transfer",
        args: [recipient, 10n],
      });
    });
  });

  it("confirms a batch step by step, but opens the wallet picker freely", async () => {
    const config = createTestConfig({ rpc: fakeChainRpc() });
    const calls = [
      { to: usdc.address, data: "0x095ea7b3" as const, label: "Approve USDC" },
      { to: router, data: "0x1234" as const, label: "Swap" },
    ];
    renderWithWagmi(<BatchTransaction calls={calls} chainId={1} />, { config });
    expect(entry("Connect wallet")?.confirm).toBeUndefined();

    await act(() => connectMock(config));
    const sentence = "Confirm: sends 2 calls on Ethereum from your wallet: Approve USDC, then Swap";
    await waitFor(() => expect(entry("Confirm")?.confirm).toBe(sentence));
    let result = await run([{ ref: "Confirm", action: "press" }]);
    expect(result.ok).toBe(false);

    approve = true;
    result = await run([{ ref: "Confirm", action: "press" }]);
    expect(result.ok, result.error?.message).toBe(true);
    expect(
      await screen.findByRole("button", { name: "Done" }, { timeout: 5000 }),
    ).toBeInTheDocument();
  });

  it("reads holdings, transactions and events, and finds rows by their text", async () => {
    const past: FeedEvent = {
      address: usdc.address,
      topics: [],
      data: "0x",
      eventName: "Transfer",
      args: { from: testAccounts[0], to: recipient, value: 42n },
      blockNumber: 99n,
      blockHash: `0x${"44".repeat(32)}`,
      transactionHash: `0x${"55".repeat(32)}`,
      transactionIndex: 0,
      logIndex: 0,
      removed: false,
    };
    const history = [
      {
        hash: `0x${"1".repeat(64)}` as const,
        chainId: 1,
        description: "Send 1 ETH",
        submittedAt: Date.now(),
        status: "confirmed" as const,
      },
      {
        hash: `0x${"2".repeat(64)}` as const,
        chainId: 1,
        description: "Approve USDC",
        submittedAt: Date.now(),
        status: "reverted" as const,
      },
    ];
    renderWithWagmi(
      <>
        <Portfolio
          tokens={[eth, usdc]}
          chainId={1}
          balances={{ [eth.address]: parseEther("2"), [usdc.address]: parseUnits("500", 6) }}
          prices={{ ETH: 3000, USDC: 1 }}
          pageSize={1}
          locale="en-US"
        />
        <TransactionHistory from={null} transactions={history} />
        <EventFeed
          address={usdc.address}
          abi={erc20Abi}
          eventName="Transfer"
          initialEvents={[past]}
        />
      </>,
      {
        config: createTestConfig({
          rpc: {
            ...fakeChainRpc(),
            eth_newFilter: "0x1",
            eth_getFilterChanges: [],
            eth_uninstallFilter: true,
          },
        }),
      },
    );
    await screen.findByText("$6,500.00");
    expectNamed(["Token holdings", "Show more holdings (1)", "Recent transactions", "Live events"]);

    const rowsOf = async (text: string) => {
      const found = await act(() => agent.query({ text }));
      if ("error" in found) {
        throw new Error(found.error);
      }
      return found.flatMap((e) => (e.items ?? []).map((item) => `${e.label}: ${item.label}`));
    };
    expect(await rowsOf("Ether")).toEqual([
      expect.stringMatching(/^Token holdings: Ether 2.*ETH \$6,000\.00$/),
    ]);
    // Only the first page is on the page. The agent shows more, freely.
    expect(await rowsOf("USD Coin")).toEqual([]);
    const result = await run([{ ref: "Show more holdings", action: "press" }]);
    expect(result.ok, result.error?.message).toBe(true);
    expect(await rowsOf("USD Coin")).toEqual([
      expect.stringMatching(/^Token holdings: USD Coin 500.*USDC \$500\.00$/),
    ]);

    expect(await rowsOf("Approve USDC")).toEqual([
      expect.stringMatching(/^Recent transactions: Approve USDC .* · Reverted View/),
    ]);
    expect(await rowsOf("Send 1 ETH")).toEqual([
      expect.stringMatching(/^Recent transactions: Send 1 ETH Confirmed · /),
    ]);
    expect(await rowsOf("Transfer")).toEqual([
      expect.stringMatching(/^Live events: Transfer from 0xd8dA…6045 to 0x71C7…976F value 42 #99/),
    ]);
  });
});

/**
 * Pairs of labels where every word of one is in the other, which a bridge
 * step can't tell apart by name ("Amount" and "Max amount").
 */
function collisions(labels: ReadonlyArray<string>) {
  const words = (label: string) => new Set(label.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);
  const found: Array<string> = [];
  labels.forEach((a, i) =>
    labels.forEach((b, j) => {
      if (i === j) {
        return;
      }
      const wb = words(b);
      if ([...words(a)].every((w) => wb.has(w))) {
        found.push(`${a} / ${b}`);
      }
    }),
  );
  return found;
}
