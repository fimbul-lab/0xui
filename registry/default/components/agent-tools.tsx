// Docs: https://0xui.io/components/agent-tools.md
import { useEffect } from "react";
import { erc20Abi, formatUnits, isAddress, type Address } from "viem";
import { useConfig, type Config } from "wagmi";
import {
  getBalance,
  getChainId,
  getChains,
  getConnection,
  getGasPrice,
  readContracts,
  switchChain,
} from "wagmi/actions";

export type AgentTool = {
  name: string;
  title: string;
  description: string;
  inputSchema: object;
  annotations: { readOnlyHint: boolean; consequentialHint?: boolean };
  execute: (input: Record<string, unknown>) => Promise<unknown>;
};

type ModelContext = {
  registerTool(tool: AgentTool, options?: { signal?: AbortSignal }): Promise<void> | void;
};

function chainIdOf(config: Config, value: unknown) {
  if (value === undefined) return getChainId(config);
  const chain = getChains(config).find(
    (c) => c.id === Number(value) || c.name.toLowerCase() === String(value).toLowerCase(),
  );
  if (!chain) {
    const names = getChains(config).map((c) => `${c.name} (${c.id})`);
    throw new Error(`This app doesn't support chain "${value}". Chains: ${names.join(", ")}.`);
  }
  return chain.id;
}

/**
 * WebMCP tools for the wallet state of a wagmi app: who is connected, on
 * which chain, with what balances. They only read, except `switch_chain`,
 * which opens the wallet's own prompt. Sending and signing stay with the
 * person: 0xui's buttons mark those with `data-agent-confirm`.
 */
export function walletAgentTools(config: Config): AgentTool[] {
  return [
    {
      name: "get_wallet",
      title: "Get the connected wallet",
      description:
        'Returns whether a wallet is connected, its address, the wallet\'s name, and the chain it is on. Returns { status: "disconnected" } when no wallet is connected: ask the person to connect one.',
      inputSchema: { type: "object", properties: {} },
      annotations: { readOnlyHint: true },
      async execute() {
        const connection = getConnection(config);
        if (connection.status !== "connected") return { status: connection.status };
        const chain = getChains(config).find((c) => c.id === connection.chainId);
        return {
          status: "connected",
          address: connection.address,
          addresses: connection.addresses,
          wallet: connection.connector?.name,
          chain: { id: connection.chainId, name: chain?.name ?? "Unsupported network" },
          supportedChain: Boolean(chain),
        };
      },
    },
    {
      name: "list_chains",
      title: "List supported chains",
      description: "Lists the chains this app supports, with the current one marked.",
      inputSchema: { type: "object", properties: {} },
      annotations: { readOnlyHint: true },
      async execute() {
        const current = getChainId(config);
        return getChains(config).map((chain) => ({
          id: chain.id,
          name: chain.name,
          nativeCurrency: chain.nativeCurrency.symbol,
          current: chain.id === current,
          testnet: Boolean(chain.testnet),
        }));
      },
    },
    {
      name: "get_balance",
      title: "Get a token balance",
      description:
        "Returns a balance as a decimal string with its symbol and raw integer value. Defaults to the connected account's native balance on the current chain. Pass token (an ERC-20 contract address) for a token, address for another account, chain (id or name) for another chain.",
      inputSchema: {
        type: "object",
        properties: {
          token: {
            type: "string",
            description: "ERC-20 contract address. Omit for the native currency.",
          },
          address: {
            type: "string",
            description: "Account to read. Defaults to the connected account.",
          },
          chain: {
            type: ["number", "string"],
            description: "Chain id or name. Defaults to the current chain.",
          },
        },
      },
      annotations: { readOnlyHint: true },
      async execute(input) {
        const address = (input.address ?? getConnection(config).address) as Address | undefined;
        if (!address || !isAddress(address)) {
          throw new Error("No wallet is connected. Pass an address, or ask the person to connect.");
        }
        const chainId = chainIdOf(config, input.chain);

        if (input.token === undefined) {
          const balance = await getBalance(config, { address, chainId });
          return {
            value: balance.value.toString(),
            formatted: formatUnits(balance.value, balance.decimals),
            symbol: balance.symbol,
            chainId,
          };
        }

        const token = String(input.token);
        if (!isAddress(token)) throw new Error(`"${token}" isn't a contract address.`);
        const [value, decimals, symbol] = await readContracts(config, {
          allowFailure: false,
          contracts: [
            { address: token, abi: erc20Abi, functionName: "balanceOf", args: [address], chainId },
            { address: token, abi: erc20Abi, functionName: "decimals", chainId },
            { address: token, abi: erc20Abi, functionName: "symbol", chainId },
          ],
        });
        return {
          value: value.toString(),
          formatted: formatUnits(value, decimals),
          symbol,
          chainId,
        };
      },
    },
    {
      name: "get_gas_price",
      title: "Get the gas price",
      description:
        "Returns the current gas price on a chain in wei and gwei. Defaults to the current chain.",
      inputSchema: {
        type: "object",
        properties: {
          chain: { type: ["number", "string"], description: "Chain id or name." },
        },
      },
      annotations: { readOnlyHint: true },
      async execute(input) {
        const chainId = chainIdOf(config, input.chain);
        const wei = await getGasPrice(config, { chainId });
        return { wei: wei.toString(), gwei: formatUnits(wei, 9), chainId };
      },
    },
    {
      name: "switch_chain",
      title: "Switch the wallet's chain",
      description:
        "Asks the wallet to switch to another supported chain. The wallet shows the person a prompt; if they decline, this fails with a rejection and you should not retry on your own.",
      inputSchema: {
        type: "object",
        properties: { chain: { type: ["number", "string"], description: "Chain id or name." } },
        required: ["chain"],
      },
      annotations: { readOnlyHint: false },
      async execute(input) {
        const chain = await switchChain(config, { chainId: chainIdOf(config, input.chain) });
        return { id: chain.id, name: chain.name };
      },
    },
  ];
}

/** Registers `tools` with the browser through WebMCP. Returns the cleanup. Does nothing without WebMCP. */
export function registerAgentTools(tools: AgentTool[]) {
  const context = (globalThis.document as { modelContext?: ModelContext } | undefined)
    ?.modelContext;
  const controller = new AbortController();
  if (!context) return () => {};
  for (const tool of tools) {
    // Early builds returned synchronously, and a second registration of a name rejects.
    Promise.resolve()
      .then(() => context.registerTool(tool, { signal: controller.signal }))
      .catch(() => {});
  }
  return () => controller.abort();
}

export type UseAgentToolsOptions = {
  /** Your own tools, registered next to the wallet tools. */
  tools?: AgentTool[];
  /** Set to false to register nothing, e.g. until the person opts in. */
  enabled?: boolean;
};

const noTools: AgentTool[] = [];

/**
 * Registers the wallet tools, plus any of your own, while the component is
 * mounted. A new `tools` array registers everything again, so keep it stable.
 */
export function useAgentTools({ tools = noTools, enabled = true }: UseAgentToolsOptions = {}) {
  const config = useConfig();
  useEffect(() => {
    if (!enabled) return;
    return registerAgentTools([...walletAgentTools(config), ...tools]);
  }, [config, enabled, tools]);
}

/** Drop inside your `Web3Provider` to give browser agents the wallet tools. Renders nothing. */
export function AgentTools(props: UseAgentToolsOptions) {
  useAgentTools(props);
  return null;
}
