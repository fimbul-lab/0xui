import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createAgent } from "@ui-sdk/react/agent";
import { SwitchChainError } from "viem";
import { describe, expect, it } from "vitest";
import { connectMock, createTestConfig, renderWithWagmi } from "../../../test/wagmi";
import { ChainSelector, ChainSelectorDialog } from "./chain-selector";

describe("ChainSelector", () => {
  it("shows the current chain", async () => {
    renderWithWagmi(<ChainSelector />);
    expect(await screen.findByRole("button", { name: /ethereum/i })).toBeInTheDocument();
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

    expect(await screen.findByRole("button", { name: /sepolia/i })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("Select Network")).not.toBeInTheDocument());
  });

  it("shows a rejected switch as cancelled, not as an error", async () => {
    const user = userEvent.setup();
    const config = createTestConfig({ features: { switchChainError: true } });
    renderWithWagmi(<ChainSelector />, { config });
    await act(() => connectMock(config));

    await user.click(screen.getByRole("button", { name: /ethereum/i }));
    await user.click(await screen.findByRole("button", { name: "Sepolia" }));

    expect(await screen.findByRole("status")).toHaveTextContent("Request cancelled in wallet");
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
    expect(await screen.findByText(/network this app doesn't support/i)).toBeInTheDocument();
    // No chain is marked active.
    expect(screen.queryByRole("button", { current: true })).not.toBeInTheDocument();
  });

  it("shows per-chain meta", async () => {
    const user = userEvent.setup();
    renderWithWagmi(<ChainSelector chainMeta={(chain) => (chain.testnet ? "Testnet" : "~12s")} />);

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

describe("agent", () => {
  let approve = false;
  const agent = createAgent({ allow: (step) => !step.confirm || approve });
  const onPage = () =>
    agent.snapshot().filter((entry) => !entry.offPage && entry.component !== "more");

  it("opens the list freely and asks before each switch", async () => {
    approve = false;
    const config = createTestConfig();
    renderWithWagmi(<ChainSelector />, { config });
    await act(() => connectMock(config));

    expect(onPage().map((entry) => entry.label)).toEqual(["Network: Ethereum"]);
    expect(
      (await agent.act({ steps: [{ ref: "Network", action: "setOpen", args: [true] }] })).ok,
    ).toBe(true);

    const rows = await waitFor(() => {
      const buttons = onPage().filter((entry) => entry.component === "button");
      expect(buttons).toHaveLength(2);
      return buttons;
    });
    for (const row of rows) {
      expect(row.label, `${row.ref} has no name`).toBeTruthy();
      expect(row.confirm).toBe(`Asks your wallet to switch to ${row.label}`);
    }

    const toSepolia = { steps: [{ ref: "Sepolia", action: "press" }] };
    const refused = await agent.act(toSepolia);
    expect(refused.ok).toBe(false);
    expect(refused.error?.message).toContain("Asks your wallet to switch to Sepolia");
    expect(config.state.chainId).toBe(1);

    approve = true;
    expect((await agent.act(toSepolia)).ok).toBe(true);
    await waitFor(() => expect(config.state.chainId).toBe(11155111));

    approve = false;
    expect(
      (await agent.act({ steps: [{ ref: "Network", action: "setOpen", args: [false] }] })).ok,
    ).toBe(true);
  });

  it("switches tabs without asking, in the dialog too", async () => {
    approve = false;
    const config = createTestConfig();
    renderWithWagmi(<ChainSelectorDialog groupByNetwork iconOnly />, { config });
    await act(() => connectMock(config));

    expect(onPage().map((entry) => entry.label)).toEqual(["Network: Ethereum"]);
    await agent.act({ steps: [{ ref: "Network", action: "setOpen", args: [true] }] });
    await waitFor(() => expect(onPage().map((entry) => entry.label)).toContain("Network type"));
    expect(onPage().map((entry) => entry.label)).toContain("Close network picker");

    const result = await agent.act({
      steps: [{ ref: "Network type", action: "setValue", args: ["Testnet"] }],
    });
    expect(result.ok, result.error?.message).toBe(true);
    const sepolia = await screen.findByRole("button", { name: "Sepolia" });
    expect(sepolia).toHaveAttribute("data-agent-confirm", "Asks your wallet to switch to Sepolia");
    expect(config.state.chainId).toBe(1);
  });
});
