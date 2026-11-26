import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { parseEther, parseUnits } from "viem";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WagmiProvider } from "wagmi";
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
import { AgentTools, agentPermissions, getAgent, walletAgentTools } from "./agent-tools";
import type { AgentConfirm, AgentTool } from "./agent-tools";
import { TransactionButton } from "./transaction-button";

const usdc = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const spender = "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45";

function config() {
  return createTestConfig({
    rpc: {
      ...fakeChainRpc(),
      eth_getBalance: `0x${parseUnits("1.5", 18).toString(16)}`,
      eth_call: erc20CallRpc({
        balance: parseUnits("250", 6),
        allowance: parseUnits("40", 6),
        decimals: 6,
        symbol: "USDC",
      }),
    },
  });
}

const tool = (tools: Array<AgentTool>, name: string) => tools.find((t) => t.name === name)!;

describe("walletAgentTools", () => {
  it("reports a disconnected wallet", async () => {
    expect(await tool(walletAgentTools(config()), "get_wallet").execute({})).toEqual({
      status: "disconnected",
    });
  });

  it("reads the connected wallet, chains and balances", async () => {
    const wagmi = config();
    await connectMock(wagmi);
    const tools = walletAgentTools(wagmi);

    expect(await tool(tools, "get_wallet").execute({})).toMatchObject({
      status: "connected",
      address: testAccounts[0],
      chain: { id: 1, name: "Ethereum" },
      supportedChain: true,
    });
    expect(await tool(tools, "list_chains").execute({})).toEqual([
      expect.objectContaining({ id: 1, current: true }),
      expect.objectContaining({ id: 11155111, current: false, testnet: true }),
    ]);
    expect(await tool(tools, "get_balance").execute({})).toMatchObject({
      formatted: "1.5",
      symbol: "ETH",
    });
    expect(await tool(tools, "get_balance").execute({ token: usdc })).toEqual({
      value: "250000000",
      formatted: "250",
      symbol: "USDC",
      chainId: 1,
    });
  });

  it("reads tokens, allowances, blocks and transactions", async () => {
    const wagmi = config();
    await connectMock(wagmi);
    const tools = walletAgentTools(wagmi);

    expect(await tool(tools, "get_token").execute({ token: usdc })).toEqual({
      address: usdc,
      chainId: 1,
      decimals: 6,
      symbol: "USDC",
      name: undefined,
    });
    expect(await tool(tools, "get_allowance").execute({ token: usdc, spender })).toEqual({
      value: "40000000",
      formatted: "40",
      symbol: "USDC",
      chainId: 1,
    });
    expect(await tool(tools, "get_block_number").execute({})).toMatchObject({ chainId: 1 });
    expect(await tool(tools, "get_transaction").execute({ hash: fakeTxHash })).toEqual({
      status: "not-found",
      chainId: 1,
    });
    await expect(tool(tools, "get_transaction").execute({ hash: "0x12" })).rejects.toThrow(
      `"0x12" isn't a transaction hash.`,
    );
  });

  it("resolves ENS names", async () => {
    const wagmi = createTestConfig({
      rpc: { ...fakeChainRpc(), eth_call: ensResolveRpc({ "vitalik.eth": testAccounts[0] }) },
    });
    expect(
      await tool(walletAgentTools(wagmi), "resolve_ens").execute({ name: "Vitalik.eth" }),
    ).toEqual({ name: "vitalik.eth", address: testAccounts[0] });
  });

  it("names the supported chains when asked for another", async () => {
    await expect(
      tool(walletAgentTools(config()), "get_gas_price").execute({ chain: "Base" }),
    ).rejects.toThrow(
      'This app doesn\'t support chain "Base". Chains: Ethereum (1), Sepolia (11155111).',
    );
  });

  it("marks only switch_chain as changing anything, and flags third-party text", () => {
    for (const t of walletAgentTools(config())) {
      expect(t.annotations.readOnlyHint, t.name).toBe(t.name !== "switch_chain");
    }
    for (const name of ["get_balance", "get_token", "get_allowance", "resolve_ens"]) {
      expect(tool(walletAgentTools(config()), name).annotations.untrustedContentHint, name).toBe(
        true,
      );
    }
  });

  it("asks the person before switching chains", async () => {
    const wagmi = config();
    await connectMock(wagmi);

    await expect(
      tool(walletAgentTools(wagmi), "switch_chain").execute({ chain: "Sepolia" }),
    ).rejects.toThrow('Needs a person: "Asks your wallet to switch to Sepolia".');

    const no = vi.fn(async () => false);
    await expect(
      tool(walletAgentTools(wagmi, { confirm: no }), "switch_chain").execute({ chain: "Sepolia" }),
    ).rejects.toThrow('The person said no to "Asks your wallet to switch to Sepolia".');
    await expect(tool(walletAgentTools(wagmi), "get_wallet").execute({})).resolves.toMatchObject({
      chain: { id: 1 },
    });

    const yes = vi.fn<AgentConfirm>(async () => true);
    expect(
      await tool(walletAgentTools(wagmi, { confirm: yes }), "switch_chain").execute({
        chain: 11155111,
      }),
    ).toEqual({ id: 11155111, name: "Sepolia" });
    expect(yes).toHaveBeenCalledWith("Asks your wallet to switch to Sepolia", {
      signal: expect.any(AbortSignal),
    });
  });
});

describe("agentPermissions", () => {
  const step = (confirm?: string) => ({
    ref: "c1",
    component: "button",
    action: "press",
    args: [],
    confirm,
  });
  const signal = new AbortController().signal;

  it("lets unmarked steps run without asking", () => {
    const confirm = vi.fn(() => true);
    const { allow, approved } = agentPermissions(confirm);
    expect(allow(step(), { signal })).toBe(true);
    expect(approved(step())).toBe(true);
    expect(confirm).not.toHaveBeenCalled();
  });

  it("passes a marked step to registerTools only once the person approved that step", async () => {
    let answer = false;
    const { allow, approved } = agentPermissions(() => answer);
    const refused = step("Sends 1 ETH");
    expect(await allow(refused, { signal })).toBe(false);
    expect(approved(refused)).toBe(false);

    answer = true;
    const agreed = step("Sends 1 ETH");
    expect(await allow(agreed, { signal })).toBe(true);
    expect(approved(agreed)).toBe(true);
    expect(approved(step("Sends 1 ETH"))).toBe(false);
  });

  it("refuses every marked step with confirm false", () => {
    expect(agentPermissions(false).allow(step("Sends 1 ETH"), { signal })).toBe(false);
  });
});

type Registered = Omit<AgentTool, "execute"> & { execute: (input: object) => Promise<any> };

describe("AgentTools", () => {
  let tools: Map<string, Registered>;
  let signals: Array<AbortSignal>;

  beforeEach(() => {
    tools = new Map();
    signals = [];
    Object.defineProperty(document, "modelContext", {
      value: {
        registerTool: async (t: Registered, options: { signal: AbortSignal }) => {
          tools.set(t.name, t);
          signals.push(options.signal);
          options.signal.addEventListener("abort", () => tools.delete(t.name));
        },
      },
      configurable: true,
    });
  });

  afterEach(() => {
    delete (document as { modelContext?: unknown }).modelContext;
  });

  const send = { to: testAccounts[1], value: parseEther("0.1") };
  const sentence = "Send 0.1 ETH: sends a transaction on Ethereum from your wallet";

  /** A connected wallet, a marked Send button, and AgentTools with `props`. */
  async function setup(
    props: Parameters<typeof AgentTools>[0] = {},
    agentConfirm?: string | false,
  ) {
    const rpc = fakeChainRpc();
    const sendTransaction = vi.fn(rpc.eth_sendTransaction as (params: unknown) => unknown);
    const wagmi = createTestConfig({ rpc: { ...rpc, eth_sendTransaction: sendTransaction } });
    const view = renderWithWagmi(
      <>
        <AgentTools {...props} />
        <TransactionButton transaction={send} resetAfter={false} agentConfirm={agentConfirm}>
          Send 0.1 ETH
        </TransactionButton>
      </>,
      { config: wagmi },
    );
    await act(() => connectMock(wagmi));
    await screen.findByRole("button", { name: "Send 0.1 ETH" });
    await waitFor(() => expect(tools.has("act")).toBe(true));
    const press = () =>
      tools.get("act")!.execute({ steps: [{ ref: "Send 0.1 ETH", action: "press" }] });
    return { ...view, sendTransaction, press };
  }

  it("registers the page and wallet tools while mounted", async () => {
    const { unmount } = render(
      <WagmiProvider config={config()}>
        <AgentTools />
      </WagmiProvider>,
    );
    await waitFor(() => expect(tools.size).toBe(13));
    expect([...tools.keys()].sort()).toEqual(
      [
        "snapshot",
        "act",
        "query",
        "get_wallet",
        "list_chains",
        "get_balance",
        "get_token",
        "get_allowance",
        "resolve_ens",
        "get_gas_price",
        "get_block_number",
        "get_transaction",
        "switch_chain",
      ].sort(),
    );
    expect(await tools.get("snapshot")!.execute({})).toBeInstanceOf(Array);

    unmount();
    expect(signals.length).toBe(13);
    expect(signals.every((signal) => signal.aborted)).toBe(true);
    expect(tools.size).toBe(0);
  });

  it("registers once however many render", async () => {
    const wagmi = config();
    const { unmount } = render(
      <WagmiProvider config={wagmi}>
        <AgentTools />
        <AgentTools />
      </WagmiProvider>,
    );
    await waitFor(() => expect(tools.size).toBe(13));
    expect(signals.length).toBe(13);
    unmount();
  });

  it("asks the person before an agent presses a marked button", async () => {
    const { sendTransaction, press } = await setup();

    let result = press();
    const dialog = await screen.findByRole("alertdialog", {
      name: "Allow the AI agent to do this?",
    });
    expect(dialog).toHaveAccessibleDescription(sentence);
    // The agent can't see the question, so it can't answer it.
    expect(
      getAgent()
        .snapshot()
        .map((entry) => entry.label),
    ).not.toContain("Allow");
    fireEvent.click(within(dialog).getByRole("button", { name: "Don't allow" }));
    expect(await result).toMatchObject({
      ok: false,
      error: { message: expect.stringContaining(`said no to "${sentence}"`) },
    });
    expect(sendTransaction).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());

    result = press();
    fireEvent.click(await screen.findByRole("button", { name: "Allow" }));
    expect((await result).ok).toBe(true);
    expect(sendTransaction).toHaveBeenCalledOnce();
  });

  it("lets unmarked steps run without asking", async () => {
    const confirm = vi.fn(async () => true);
    const { sendTransaction, press } = await setup({ confirm }, false);
    expect((await press()).ok).toBe(true);
    expect(confirm).not.toHaveBeenCalled();
    expect(sendTransaction).toHaveBeenCalledOnce();
  });

  it("uses the confirm prop instead of the dialog", async () => {
    const confirm = vi.fn<AgentConfirm>(async () => true);
    const { sendTransaction, press } = await setup({ confirm });

    expect((await press()).ok).toBe(true);
    expect(confirm).toHaveBeenCalledWith(sentence, { signal: expect.any(AbortSignal) });
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(sendTransaction).toHaveBeenCalledOnce();
  });

  it("refuses every marked step with confirm={false}", async () => {
    const { sendTransaction, press } = await setup({ confirm: false });

    expect((await press()).ok).toBe(false);
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(sendTransaction).not.toHaveBeenCalled();
  });

  it("asks in the same dialog before switch_chain", async () => {
    await setup();
    const switched = tools.get("switch_chain")!.execute({ chain: "Sepolia" });
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveAccessibleDescription("Asks your wallet to switch to Sepolia");
    fireEvent.click(within(dialog).getByRole("button", { name: "Don't allow" }));
    await expect(switched).rejects.toThrow("The person said no");
  });
});
