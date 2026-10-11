import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SwitchChainError } from "viem";
import { describe, expect, it } from "vitest";
import {
  connectMock,
  createTestConfig,
  renderWithWagmi,
} from "../../../test/wagmi";
import { ChainSelector, ChainSelectorDialog } from "./chain-selector";

describe("ChainSelector", () => {
  it("shows the current chain", async () => {
    renderWithWagmi(<ChainSelector />);
    expect(
      await screen.findByRole("button", { name: /ethereum/i })
    ).toBeInTheDocument();
  });

  it("marks the active chain in the list", async () => {
    const user = userEvent.setup();
    renderWithWagmi(<ChainSelector />);

    await user.click(screen.getByRole("button", { name: /ethereum/i }));

    const active = await screen.findByRole("button", { current: true });
    expect(active).toHaveTextContent("Ethereum");
    expect(active).toBeDisabled();
    expect(screen.getByRole("button", { name: "Sepolia" })).toBeEnabled();
  });

  it("switches chain and closes", async () => {
    const user = userEvent.setup();
    renderWithWagmi(<ChainSelector />);

    await user.click(screen.getByRole("button", { name: /ethereum/i }));
    await user.click(await screen.findByRole("button", { name: "Sepolia" }));

    expect(
      await screen.findByRole("button", { name: /sepolia/i })
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByText("Select Network")).not.toBeInTheDocument()
    );
  });

  it("shows a rejected switch as cancelled, not as an error", async () => {
    const user = userEvent.setup();
    const config = createTestConfig({ features: { switchChainError: true } });
    renderWithWagmi(<ChainSelector />, { config });
    await act(() => connectMock(config));

    await user.click(screen.getByRole("button", { name: /ethereum/i }));
    await user.click(await screen.findByRole("button", { name: "Sepolia" }));

    expect(await screen.findByRole("status")).toHaveTextContent(
      "Request cancelled in wallet"
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows other switch failures inline and clears them on reopen", async () => {
    const user = userEvent.setup();
    const config = createTestConfig({
      features: {
        switchChainError: new SwitchChainError(new Error("Chain unsupported")),
      },
    });
    renderWithWagmi(<ChainSelector />, { config });
    await act(() => connectMock(config));

    const trigger = screen.getByRole("button", { name: /ethereum/i });
    await user.click(trigger);
    await user.click(await screen.findByRole("button", { name: "Sepolia" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();

    await user.keyboard("{Escape}");
    await user.click(trigger);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("ChainSelector extras", () => {
  it("flags a wallet on a chain the app doesn't support", async () => {
    const user = userEvent.setup();
    const config = createTestConfig();
    renderWithWagmi(<ChainSelector />, { config });
    await act(() => connectMock(config));

    // The wallet moves to Base, which isn't in the test config.
    act(() => config.connectors[0]!.onChainChanged("8453"));

    const trigger = await screen.findByRole("button", { name: /wrong network/i });
    await user.click(trigger);
    expect(
      await screen.findByText(/network this app doesn't support/i)
    ).toBeInTheDocument();
    // No chain is marked active.
    expect(screen.queryByRole("button", { current: true })).not.toBeInTheDocument();
  });

  it("shows per-chain meta", async () => {
    const user = userEvent.setup();
    renderWithWagmi(
      <ChainSelector chainMeta={(chain) => (chain.testnet ? "Testnet" : "~12s")} />
    );

    await user.click(screen.getByRole("button", { name: /ethereum/i }));
    expect(await screen.findByText("~12s")).toBeInTheDocument();
    expect(screen.getByText("Testnet")).toBeInTheDocument();
  });
});

describe("ChainSelectorDialog", () => {
  it("opens a dialog with the chain list", async () => {
    const user = userEvent.setup();
    renderWithWagmi(<ChainSelectorDialog />);

    await user.click(screen.getByRole("button", { name: /ethereum/i }));

    const dialog = await screen.findByRole("dialog", {
      name: "Select Network",
    });
    expect(dialog).toHaveTextContent("Sepolia");
  });
});
