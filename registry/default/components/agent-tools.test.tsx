import { act, render } from "@testing-library/react";
import { parseUnits } from "viem";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WagmiProvider } from "wagmi";
import {
  connectMock,
  createTestConfig,
  erc20CallRpc,
  fakeChainRpc,
  testAccounts,
} from "../../../test/wagmi";
import { AgentTools, walletAgentTools, type AgentTool } from "./agent-tools";

const usdc = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";

function config() {
  return createTestConfig({
    rpc: {
      ...fakeChainRpc(),
      eth_getBalance: `0x${parseUnits("1.5", 18).toString(16)}`,
      eth_call: erc20CallRpc({ balance: parseUnits("250", 6), decimals: 6, symbol: "USDC" }),
    },
  });
}

const tool = (tools: AgentTool[], name: string) => tools.find((t) => t.name === name)!;

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

  it("names the supported chains when asked for another", async () => {
    await expect(
      tool(walletAgentTools(config()), "get_gas_price").execute({ chain: "Base" }),
    ).rejects.toThrow(
      'This app doesn\'t support chain "Base". Chains: Ethereum (1), Sepolia (11155111).',
    );
  });

  it("marks only switch_chain as changing anything", () => {
    for (const t of walletAgentTools(config())) {
      expect(t.annotations.readOnlyHint, t.name).toBe(t.name !== "switch_chain");
    }
  });
});

describe("AgentTools", () => {
  afterEach(() => {
    delete (document as { modelContext?: unknown }).modelContext;
  });

  it("registers the tools while mounted", async () => {
    const signals: AbortSignal[] = [];
    const registerTool = vi.fn(async (_tool: AgentTool, options: { signal: AbortSignal }) => {
      signals.push(options.signal);
    });
    Object.defineProperty(document, "modelContext", {
      value: { registerTool },
      configurable: true,
    });

    const { unmount } = render(
      <WagmiProvider config={config()}>
        <AgentTools />
      </WagmiProvider>,
    );
    await act(async () => {});
    expect(registerTool.mock.calls.map(([t]) => t.name)).toEqual([
      "get_wallet",
      "list_chains",
      "get_balance",
      "get_gas_price",
      "switch_chain",
    ]);

    unmount();
    expect(signals.every((signal) => signal.aborted)).toBe(true);
  });
});
