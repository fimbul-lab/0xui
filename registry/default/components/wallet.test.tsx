import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { parseEther } from "viem";
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
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    );
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
});

describe("WalletButton", () => {
  it("switches from connect to account once connected", async () => {
    const config = createTestConfig({ rpc: fakeChainRpc() });
    renderWithWagmi(<WalletButton />, { config });

    expect(
      await screen.findByRole("button", { name: "Connect wallet" })
    ).toBeInTheDocument();

    await act(() => connectMock(config));

    expect(
      await screen.findByRole("button", { name: /0xd8dA…6045/ })
    ).toBeInTheDocument();
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
    expect(
      await screen.findByRole("dialog", { name: "Connect a wallet" })
    ).toBeInTheDocument();
  });

  it("names the blocker when disabled", async () => {
    const config = createTestConfig({ rpc: fakeChainRpc() });
    renderWithWagmi(
      <TransactionButton transaction={send} disabledReason="Enter an amount">
        Send
      </TransactionButton>,
      { config }
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
      { config }
    );
    await act(() => connectMock(config));

    await user.click(await screen.findByRole("button", { name: "Send" }));

    expect(await screen.findByRole("button", { name: "Done" })).toBeInTheDocument();
    expect(onSubmitted).toHaveBeenCalledWith(fakeTxHash);
    expect(onSuccess).toHaveBeenCalledWith(
      expect.objectContaining({ status: "success", transactionHash: fakeTxHash })
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
      { config }
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
      { config }
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
      <TransactionButton transaction={send} chainId={11155111}>
        Send
      </TransactionButton>,
      { config }
    );
    await act(() => connectMock(config));

    await user.click(
      await screen.findByRole("button", { name: "Switch to Sepolia" })
    );

    expect(await screen.findByRole("button", { name: "Send" })).toBeEnabled();
    expect(config.state.chainId).toBe(11155111);
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
      { config }
    );

    expect(await screen.findByText("Transaction pending")).toBeInTheDocument();
    expect(screen.getByText("Send 0.1 ETH")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /view on etherscan/i })
    ).toHaveAttribute("href", `https://etherscan.io/tx/${fakeTxHash}`);

    mined = true;
    // viem backs off between receipt lookups (200ms, 400ms, …).
    expect(
      await screen.findByText("Transaction confirmed", {}, { timeout: 5_000 })
    ).toBeInTheDocument();
    expect(screen.getByText("Included in block 100")).toBeInTheDocument();
    expect(onConfirmed).toHaveBeenCalledOnce();
  });

  it("shows a reverted transaction", async () => {
    const chain = sentTransaction(fakeChainRpc({ status: "reverted" }));
    const config = createTestConfig({ rpc: chain });
    const { container } = renderWithWagmi(
      <TransactionStatus hash={fakeTxHash} />,
      { config }
    );

    expect(await screen.findByText("Transaction reverted")).toBeInTheDocument();
    expect(
      container.querySelector('[data-slot="transaction-status"]')
    ).toHaveAttribute("data-phase", "reverted");
  });
});
