import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createAgent } from "@ui-sdk/react/agent";
import { encodeErrorResult, encodeFunctionResult, erc20Abi, parseAbi, parseEther } from "viem";
import { describe, expect, it, vi } from "vitest";
import {
  connectMock,
  createTestConfig,
  fakeChainRpc,
  fakeTxHash,
  renderWithWagmi,
  testAccounts,
} from "../../../test/wagmi";
import { Account } from "./account";
import { Balance } from "./balance";
import { ChainSelector } from "./chain-selector";
import { ConnectWallet } from "./connect-wallet";
import { TransactionButton } from "./transaction-button";
import { TransactionStatus } from "./transaction-status";
import { WalletButton } from "./wallet-button";

const recipient = testAccounts[1];

/** A fake chain that has already received a transaction from the test account. */
function sentTransaction(chain: ReturnType<typeof fakeChainRpc>) {
  (chain.eth_sendTransaction as (params: unknown) => unknown)([
    { from: testAccounts[0], to: recipient },
  ]);
  return chain;
}

describe("ConnectWallet", () => {
  it("lists wallets and connects", async () => {
    const user = userEvent.setup();
    const onConnect = vi.fn();
    const { config } = renderWithWagmi(<ConnectWallet onConnect={onConnect} />);

    await user.click(screen.getByRole("button", { name: "Connect wallet" }));
    const dialog = await screen.findByRole("dialog", { name: "Connect a wallet" });
    await user.click(within(dialog).getByRole("button", { name: "Mock Connector" }));

    await waitFor(() => expect(config.state.status).toBe("connected"));
    expect(onConnect).toHaveBeenCalledOnce();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("treats a rejected connection as cancelled", async () => {
    const user = userEvent.setup();
    const config = createTestConfig({ features: { connectError: true } });
    renderWithWagmi(<ConnectWallet />, { config });

    await user.click(screen.getByRole("button", { name: "Connect wallet" }));
    await user.click(await screen.findByRole("button", { name: "Mock Connector" }));

    expect(await screen.findByText(/request cancelled/i)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("dialog")).toHaveAttribute("data-phase", "cancelled");
  });

  it("shows other connection errors", async () => {
    const user = userEvent.setup();
    const config = createTestConfig({
      features: { connectError: new Error("Wallet is locked") },
    });
    renderWithWagmi(<ConnectWallet />, { config });

    await user.click(screen.getByRole("button", { name: "Connect wallet" }));
    await user.click(await screen.findByRole("button", { name: "Mock Connector" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Wallet is locked");
  });

  it("opens as a sheet on a small touch screen and still connects", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query.includes("pointer: coarse"),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    // jsdom has neither; ui-sdk's sheet uses them to track and animate its snap points.
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
        takeRecords() {
          return [];
        }
      },
    );
    Element.prototype.animate = (() => ({
      finished: Promise.resolve(),
      cancel() {},
      finish() {},
      addEventListener() {},
      removeEventListener() {},
    })) as never;
    const { config } = renderWithWagmi(<ConnectWallet />);

    await user.click(screen.getByRole("button", { name: "Connect wallet" }));
    const sheet = await screen.findByRole("dialog", { name: "Connect a wallet" });
    expect(sheet).toHaveAttribute("data-presentation", "sheet");
    await user.click(within(sheet).getByRole("button", { name: "Mock Connector" }));

    await waitFor(() => expect(config.state.status).toBe("connected"));
    delete (Element.prototype as Partial<Element>).animate;
  });
});

describe("WalletButton", () => {
  it("switches from connect to account once connected", async () => {
    const config = createTestConfig({ rpc: fakeChainRpc() });
    renderWithWagmi(<WalletButton />, { config });

    expect(await screen.findByRole("button", { name: "Connect wallet" })).toBeInTheDocument();

    await act(() => connectMock(config));

    expect(await screen.findByRole("button", { name: /0xd8dA…6045/ })).toBeInTheDocument();
  });
});

describe("Account", () => {
  it("renders nothing when disconnected", () => {
    const { container } = renderWithWagmi(<Account />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows balance and disconnects", async () => {
    const user = userEvent.setup();
    const onDisconnect = vi.fn();
    const config = createTestConfig({
      rpc: { ...fakeChainRpc(), eth_getBalance: "0x1bc16d674ec80000" },
    });
    renderWithWagmi(<Account onDisconnect={onDisconnect} />, { config });
    await act(() => connectMock(config));

    await user.click(await screen.findByRole("button", { name: /0xd8dA…6045/ }));
    expect(await screen.findByTitle("2 ETH")).toBeInTheDocument();
    expect(screen.getByText("Connected with Mock Connector")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Disconnect" }));
    await waitFor(() => expect(config.state.status).toBe("disconnected"));
    expect(onDisconnect).toHaveBeenCalledOnce();
  });

  it("switches to another connected wallet", async () => {
    const user = userEvent.setup();
    const config = createTestConfig({
      rpc: { ...fakeChainRpc(), eth_getBalance: "0x0" },
      wallets: [[testAccounts[0]], [testAccounts[1]]],
    });
    renderWithWagmi(<Account />, { config });
    await act(() => connectMock(config, 0));
    await act(() => connectMock(config, 1));

    await user.click(await screen.findByRole("button", { name: /0x71C7…976F/ }));
    await user.click(await screen.findByRole("button", { name: /0xd8dA…6045/ }));

    expect(
      await screen.findByRole("button", { name: /0xd8dA…6045/, expanded: true }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /0x71C7…976F/ })).toBeInTheDocument();
  });
});

describe("Balance", () => {
  it("reads the native balance of any address", async () => {
    const config = createTestConfig({ rpc: { eth_getBalance: "0xde0b6b3a7640000" } });
    renderWithWagmi(<Balance address={recipient} locale="en-US" />, { config });

    expect(screen.getByText("Loading balance")).toBeInTheDocument();
    expect(await screen.findByTitle("1 ETH")).toBeInTheDocument();
  });

  it("renders nothing without an address", () => {
    const { container } = renderWithWagmi(<Balance />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows a dash when the read fails", async () => {
    renderWithWagmi(<Balance address={recipient} />);
    expect(await screen.findByTitle("Couldn't load balance")).toHaveTextContent("—");
  });
});

describe("TransactionButton", () => {
  const send = { to: recipient, value: parseEther("0.1") };

  it("asks to connect when disconnected", async () => {
    const user = userEvent.setup();
    renderWithWagmi(<TransactionButton transaction={send}>Send</TransactionButton>);

    await user.click(screen.getByRole("button", { name: "Connect wallet" }));
    expect(await screen.findByRole("dialog", { name: "Connect a wallet" })).toBeInTheDocument();
  });

  it("names the blocker when disabled", async () => {
    const config = createTestConfig({ rpc: fakeChainRpc() });
    renderWithWagmi(
      <TransactionButton transaction={send} disabledReason="Enter an amount">
        Send
      </TransactionButton>,
      { config },
    );
    await act(() => connectMock(config));
    expect(await screen.findByRole("button", { name: "Enter an amount" })).toBeDisabled();
  });

  it("goes from confirm to pending to success", async () => {
    const user = userEvent.setup();
    const onSubmitted = vi.fn();
    const onSuccess = vi.fn();
    const config = createTestConfig({ rpc: fakeChainRpc() });
    renderWithWagmi(
      <TransactionButton
        transaction={send}
        onSubmitted={onSubmitted}
        onSuccess={onSuccess}
        resetAfter={false}
      >
        Send
      </TransactionButton>,
      { config },
    );
    await act(() => connectMock(config));

    await user.click(await screen.findByRole("button", { name: "Send" }));

    expect(await screen.findByRole("button", { name: "Done" })).toBeInTheDocument();
    expect(onSubmitted).toHaveBeenCalledWith(fakeTxHash);
    expect(onSuccess).toHaveBeenCalledWith(
      expect.objectContaining({ status: "success", transactionHash: fakeTxHash }),
    );
    expect(screen.getByRole("status")).toHaveTextContent("Transaction confirmed.");
  });

  it("reports a reverted transaction", async () => {
    const user = userEvent.setup();
    const onError = vi.fn();
    const config = createTestConfig({ rpc: fakeChainRpc({ status: "reverted" }) });
    renderWithWagmi(
      <TransactionButton transaction={send} onError={onError}>
        Send
      </TransactionButton>,
      { config },
    );
    await act(() => connectMock(config));

    await user.click(await screen.findByRole("button", { name: "Send" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("reverted");
    expect(onError).toHaveBeenCalledOnce();
    // The button is ready to retry.
    expect(screen.getByRole("button", { name: "Send" })).toBeEnabled();
  });

  it("treats a rejected request as cancelled", async () => {
    const user = userEvent.setup();
    const onError = vi.fn();
    const config = createTestConfig({
      rpc: {
        ...fakeChainRpc(),
        eth_sendTransaction: () => {
          throw { code: 4001, message: "User rejected the request." };
        },
      },
    });
    renderWithWagmi(
      <TransactionButton transaction={send} onError={onError}>
        Send
      </TransactionButton>,
      { config },
    );
    await act(() => connectMock(config));

    await user.click(await screen.findByRole("button", { name: "Send" }));

    expect(await screen.findByText("Cancelled in wallet.")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(onError).not.toHaveBeenCalled();
  });

  it("offers to switch to the transaction's chain", async () => {
    const user = userEvent.setup();
    const config = createTestConfig({ rpc: fakeChainRpc() });
    renderWithWagmi(
      <TransactionButton transaction={send} chainId={11_155_111}>
        Send
      </TransactionButton>,
      { config },
    );
    await act(() => connectMock(config));

    await user.click(await screen.findByRole("button", { name: "Switch to Sepolia" }));

    expect(await screen.findByRole("button", { name: "Send" })).toBeEnabled();
    expect(config.state.chainId).toBe(11_155_111);
  });
});

describe("TransactionButton simulate", () => {
  const transfer = {
    address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    abi: erc20Abi,
    functionName: "transfer",
    args: [recipient, 1n],
  } as const;

  it("names the revert reason instead of opening the wallet", async () => {
    const config = createTestConfig({
      rpc: {
        ...fakeChainRpc(),
        eth_call: () => {
          throw {
            code: 3,
            message: "execution reverted",
            data: encodeErrorResult({
              abi: parseAbi(["error Error(string)"]),
              args: ["Transfers are paused"],
            }),
          };
        },
      },
    });
    renderWithWagmi(
      <TransactionButton contract={transfer} simulate>
        Send
      </TransactionButton>,
      { config },
    );
    await act(() => connectMock(config));

    expect(await screen.findByRole("button", { name: "Transaction will fail" })).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent("Transfers are paused");
  });

  it("enables the button when the call would succeed", async () => {
    const config = createTestConfig({
      rpc: {
        ...fakeChainRpc(),
        eth_call: () =>
          encodeFunctionResult({ abi: erc20Abi, functionName: "transfer", result: true }),
      },
    });
    renderWithWagmi(
      <TransactionButton contract={transfer} simulate>
        Send
      </TransactionButton>,
      { config },
    );
    await act(() => connectMock(config));

    expect(await screen.findByRole("button", { name: "Send" })).toBeEnabled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("TransactionStatus", () => {
  it("moves from pending to confirmed", async () => {
    const onConfirmed = vi.fn();
    let mined = false;
    const chain = sentTransaction(fakeChainRpc());
    const config = createTestConfig({
      rpc: {
        ...chain,
        eth_getTransactionReceipt: () =>
          mined ? (chain.eth_getTransactionReceipt as () => unknown)() : null,
      },
    });
    renderWithWagmi(
      <TransactionStatus hash={fakeTxHash} onConfirmed={onConfirmed}>
        Send 0.1 ETH
      </TransactionStatus>,
      { config },
    );

    expect(await screen.findByText("Transaction pending")).toBeInTheDocument();
    expect(screen.getByText("Send 0.1 ETH")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /view on etherscan/i })).toHaveAttribute(
      "href",
      `https://etherscan.io/tx/${fakeTxHash}`,
    );

    mined = true;
    // viem backs off between receipt lookups (200ms, 400ms, …).
    expect(
      await screen.findByText("Transaction confirmed", {}, { timeout: 5000 }),
    ).toBeInTheDocument();
    expect(screen.getByText("Included in block 100")).toBeInTheDocument();
    expect(onConfirmed).toHaveBeenCalledOnce();
  });

  it("shows a reverted transaction", async () => {
    const chain = sentTransaction(fakeChainRpc({ status: "reverted" }));
    const config = createTestConfig({ rpc: chain });
    const { container } = renderWithWagmi(<TransactionStatus hash={fakeTxHash} />, { config });

    expect(await screen.findByText("Transaction reverted")).toBeInTheDocument();
    expect(container.querySelector('[data-slot="transaction-status"]')).toHaveAttribute(
      "data-phase",
      "reverted",
    );
  });
});

describe("agent", () => {
  // One bridge per file. `approve` stands in for the person answering.
  let approve = false;
  const agent = createAgent({ allow: (step) => !step.confirm || approve });

  /** The bridge's entries on the page, after asserting each has a name. */
  function components() {
    const entries = agent
      .snapshot()
      .filter((entry) => !entry.offPage && entry.component !== "more");
    for (const entry of entries) {
      expect(entry.label, `${entry.component} ${entry.ref} has no name`).toBeTruthy();
    }
    return entries;
  }

  /** No label's words all appear in another's, so a step by label finds one control. */
  function expectDistinctLabels(entries: ReturnType<typeof components>) {
    const words = (label: string) =>
      label
        .toLowerCase()
        .split(/[^\p{L}\p{N}…]+/u)
        .filter(Boolean);
    for (const a of entries) {
      for (const b of entries) {
        if (a === b) continue;
        const inside = words(a.label!).every((word) => words(b.label!).includes(word));
        expect(inside, `"${a.label}" also names "${b.label}"`).toBe(false);
      }
    }
  }

  function byLabel(label: string) {
    return components().find((entry) => entry.label === label);
  }

  it("connects, switches network and disconnects in a header, asking the person each time", async () => {
    approve = false;
    const config = createTestConfig({ rpc: { ...fakeChainRpc(), eth_getBalance: "0x0" } });
    renderWithWagmi(
      <>
        <WalletButton />
        <ChainSelector />
      </>,
      { config },
    );

    let entries = components();
    expect(entries.map((entry) => entry.label)).toEqual(["Connect wallet", "Network: Ethereum"]);
    expectDistinctLabels(entries);
    // Opening the picker is free.
    expect(byLabel("Connect wallet")?.confirm).toBeUndefined();
    expect((await agent.act({ steps: [{ ref: "Connect wallet", action: "press" }] })).ok).toBe(
      true,
    );

    const wallet = await waitFor(() => {
      const row = byLabel("Mock Connector");
      expect(row).toBeDefined();
      return row!;
    });
    expect(wallet.confirm).toBe("Connects Mock Connector and shares your address with this site");
    const connect = {
      steps: [{ ref: "Connect a wallet", action: "press", args: ["Mock Connector"] }],
    };
    const refused = await agent.act(connect);
    expect(refused.ok).toBe(false);
    expect(refused.error?.message).toContain("Connects Mock Connector and shares your address");
    expect(config.state.status).toBe("disconnected");

    approve = true;
    expect((await agent.act(connect)).ok).toBe(true);
    await waitFor(() => expect(config.state.status).toBe("connected"));

    entries = await waitFor(() => {
      const now = components();
      expect(now.map((entry) => entry.label)).toEqual(["Network: Ethereum", "Account 0xd8dA…6045"]);
      return now;
    });
    expectDistinctLabels(entries);

    // Switching network asks the person; opening the list doesn't.
    approve = false;
    const toSepolia = { steps: [{ ref: "Network", action: "press", args: ["Sepolia"] }] };
    const declined = await agent.act(toSepolia);
    expect(declined.error?.message).toContain("Asks your wallet to switch to Sepolia");
    expect(config.state.chainId).toBe(1);
    approve = true;
    expect((await agent.act(toSepolia)).ok).toBe(true);
    await waitFor(() => expect(config.state.chainId).toBe(11_155_111));
    await waitFor(() => expect(byLabel("Network: Sepolia")).toBeDefined());

    // Opening the account panel is free; disconnecting asks.
    approve = false;
    expect(
      (await agent.act({ steps: [{ ref: "Account", action: "setOpen", args: [true] }] })).ok,
    ).toBe(true);
    const disconnect = await waitFor(() => {
      const button = byLabel("Disconnect");
      expect(button).toBeDefined();
      return button!;
    });
    expect(disconnect.confirm).toBe("Disconnects Mock Connector from this site");
    expect(byLabel("Copy your address")?.confirm).toBeUndefined();
    expect((await agent.act({ steps: [{ ref: "Disconnect", action: "press" }] })).ok).toBe(false);
    expect(config.state.status).toBe("connected");
    approve = true;
    expect((await agent.act({ steps: [{ ref: "Disconnect", action: "press" }] })).ok).toBe(true);
    await waitFor(() => expect(config.state.status).toBe("disconnected"));
  });

  it("asks the person before switching to another connected account", async () => {
    approve = false;
    const config = createTestConfig({
      rpc: { ...fakeChainRpc(), eth_getBalance: "0x0" },
      wallets: [[testAccounts[0]], [testAccounts[1]]],
    });
    renderWithWagmi(<Account />, { config });
    await act(() => connectMock(config, 0));
    await act(() => connectMock(config, 1));

    await agent.act({ steps: [{ ref: "Account", action: "setOpen", args: [true] }] });
    const row = await waitFor(() => {
      const found = byLabel("0xd8dA…6045 Mock Connector");
      expect(found).toBeDefined();
      return found!;
    });
    expect(row.confirm).toBe("Switches this site to your Mock Connector account 0xd8dA…6045");

    const switchAccount = { steps: [{ ref: row.ref, action: "press" }] };
    expect((await agent.act(switchAccount)).ok).toBe(false);
    expect(config.state.current).toBe(config.connectors[1]!.uid);
    approve = true;
    expect((await agent.act(switchAccount)).ok).toBe(true);
    await waitFor(() => expect(config.state.current).toBe(config.connectors[0]!.uid));
  });

  it("only asks about what a transaction button does now", async () => {
    approve = false;
    const send = { to: recipient, value: parseEther("0.1") };
    const config = createTestConfig({ rpc: fakeChainRpc() });
    renderWithWagmi(
      <>
        <TransactionButton transaction={send}>Send</TransactionButton>
        <TransactionButton transaction={send} chainId={11_155_111}>
          Mint
        </TransactionButton>
      </>,
      { config },
    );

    // Disconnected, each opens the wallet picker, which asks per wallet.
    const disconnected = components();
    expect(disconnected).toHaveLength(2);
    expect(disconnected.every((entry) => entry.label === "Connect wallet" && !entry.confirm)).toBe(
      true,
    );

    await act(() => connectMock(config));
    await waitFor(() => expect(byLabel("Send")).toBeDefined());
    expect(byLabel("Send")?.confirm).toBe("Send: sends a transaction on Ethereum from your wallet");
    expect(byLabel("Switch to Sepolia")?.confirm).toBe("Asks your wallet to switch to Sepolia");
    expectDistinctLabels(components());

    expect(
      (await agent.act({ steps: [{ ref: "Send", action: "press" }] })).error?.message,
    ).toContain("sends a transaction on Ethereum");
    expect(
      screen.getByRole("button", { name: "Send" }).closest("[data-slot=transaction-button]"),
    ).toHaveAttribute("data-phase", "idle");
    approve = true;
    expect((await agent.act({ steps: [{ ref: "Send", action: "press" }] })).ok).toBe(true);
    expect(await screen.findByRole("button", { name: "Done" })).toBeInTheDocument();
  });

  it("reads a transaction's status card", async () => {
    const config = createTestConfig({ rpc: sentTransaction(fakeChainRpc()) });
    renderWithWagmi(<TransactionStatus hash={fakeTxHash}>Send 0.1 ETH</TransactionStatus>, {
      config,
    });
    expect(
      await screen.findByText("Transaction confirmed", {}, { timeout: 5000 }),
    ).toBeInTheDocument();
    expect(components().map((entry) => entry.label)).toEqual(["Copy transaction hash"]);
  });
});
