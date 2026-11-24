import {
  getBalance,
  getBlockNumber,
  getChainId,
  getChains,
  getConnection,
  getEnsAddress,
  getEnsName,
  getGasPrice,
  getTransaction,
  getTransactionReceipt,
  readContracts,
  switchChain,
  type Config,
} from "@wagmi/core";
import { agentTools, registerTools, type AgentAction, type createAgent } from "@ui-sdk/core/agent";
import { erc20Abi, formatUnits, isAddress, isHash, type Address } from "viem";
import { normalize } from "viem/ens";

export type AgentTool = {
  name: string;
  title: string;
  description: string;
  inputSchema: object;
  annotations: {
    readOnlyHint: boolean;
    consequentialHint?: boolean;
    /** The result holds text other people wrote, like a token's symbol. */
    untrustedContentHint?: boolean;
  };
  execute: (input: Record<string, unknown>) => Promise<unknown>;
};

/** ui-sdk's agent bridge, from `createAgent` in `@ui-sdk/react/agent`. */
export type Agent = ReturnType<typeof createAgent>;

/**
 * Asks the person whether an agent may do what `message` says, like "Send
 * 0.1 ETH: sends a transaction on Ethereum from your wallet". Resolve `true`
 * only when they agree. `signal` aborts when the agent stops waiting: close
 * the prompt then.
 */
export type AgentConfirm = (
  message: string,
  options: { signal: AbortSignal },
) => boolean | Promise<boolean>;

type Allow = (step: AgentAction, context: { signal: AbortSignal }) => boolean | Promise<boolean>;

type ModelContext = {
  registerTool(tool: AgentTool, options?: { signal?: AbortSignal }): Promise<void> | void;
};

/**
 * The permissions for a ui-sdk agent bridge, asking the person in one place.
 *
 * - `allow` is `createAgent`'s: a step on a `data-agent-confirm` control goes
 *   to `confirm` with the mark's sentence, every other step runs. With
 *   `confirm: false` those steps are always refused.
 * - `approved` is `registerTools`'s: it runs after `allow` for the browser's
 *   agent, and passes a marked step only when the person approved that very
 *   step in `allow`, so nobody is asked twice and nothing is answered for them.
 */
export function agentPermissions(confirm: AgentConfirm | false) {
  const approved = new WeakSet<AgentAction>();
  const allow: Allow = (step, { signal }) => {
    if (!step.confirm) return true;
    if (!confirm) return false;
    const sentence = step.confirm;
    return Promise.resolve()
      .then(() => confirm(sentence, { signal }))
      .then(
        (yes) => {
          if (yes === true && !signal.aborted) {
            approved.add(step);
            return true;
          }
          return false;
        },
        () => false,
      );
  };
  return {
    allow,
    approved: (step: AgentAction) => !step.confirm || approved.has(step),
  };
}

/** How long a wallet tool waits for the person, like the bridge's default. */
const CONFIRM_TIMEOUT = 5 * 60_000;

/** Runs `confirm` for a wallet tool, with the bridge's wording when it can't go ahead. */
async function askPerson(confirm: AgentConfirm | false | undefined, sentence: string, ask: string) {
  if (!confirm) throw new Error(`Needs a person: "${sentence}". ${ask}`);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CONFIRM_TIMEOUT);
  try {
    const yes = await confirm(sentence, { signal: controller.signal });
    if (yes !== true) throw new Error(`The person said no to "${sentence}".`);
  } finally {
    clearTimeout(timer);
  }
}

const pageTitles: Record<string, string> = {
  snapshot: "Read the page's controls",
  act: "Use the page's controls",
  query: "Find controls and their choices",
};

/**
 * ui-sdk's `snapshot`, `act` and `query` as `AgentTool`s bound to `agent`,
 * for your own model loop next to `walletAgentTools`. `act` goes through the
 * bridge's `allow`, so marked steps still wait for the person.
 */
export function pageAgentTools(agent: Agent): AgentTool[] {
  return agentTools.map((tool) => {
    const name = tool.name as "snapshot" | "act" | "query";
    return {
      name,
      title: pageTitles[name] ?? name,
      description: tool.description,
      inputSchema: tool.inputSchema,
      annotations:
        name === "act"
          ? { readOnlyHint: false, consequentialHint: true, untrustedContentHint: true }
          : { readOnlyHint: true, untrustedContentHint: true },
      execute: async (input) => (agent[name] as (input: unknown) => unknown)(input),
    };
  });
}

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

function tokenOf(value: unknown): Address {
  const token = String(value ?? "");
  if (!isAddress(token)) throw new Error(`"${token}" isn't a contract address.`);
  return token;
}

function accountOf(config: Config, value: unknown, what = "address"): Address {
  const address = (value ?? getConnection(config).address) as string | undefined;
  if (!address) {
    throw new Error(`No wallet is connected. Pass ${what}, or ask the person to connect.`);
  }
  if (!isAddress(address)) throw new Error(`"${address}" isn't an address.`);
  return address;
}

const chainInput = {
  type: ["number", "string"],
  description: "Chain id or name. Defaults to the current chain.",
};

export type WalletAgentToolsOptions = {
  /**
   * Asks the person before a tool opens their wallet (`switch_chain`).
   * Without it, those tools fail and tell the agent to ask the person.
   */
  confirm?: AgentConfirm | false;
};

/**
 * Tools for the wallet state of a wagmi app: who is connected, on which
 * chain, balances, tokens, ENS names, gas and transactions. They only read,
 * except `switch_chain`, which opens the wallet and so asks the person
 * through `confirm` first. Sending and signing stay with the page's buttons,
 * which 0xui marks with `data-agent-confirm`.
 */
export function walletAgentTools(
  config: Config,
  { confirm }: WalletAgentToolsOptions = {},
): AgentTool[] {
  return [
    {
      name: "get_wallet",
      title: "Get the connected wallet",
      description:
        'Returns whether a wallet is connected, its address, the wallet\'s name, and the chain it is on. Returns { status: "disconnected" } when no wallet is connected: ask the person to connect one.',
      inputSchema: { type: "object", properties: {} },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
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
          chain: chainInput,
        },
      },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      async execute(input) {
        const address = accountOf(config, input.address, "an address");
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

        const token = tokenOf(input.token);
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
      name: "get_token",
      title: "Get an ERC-20 token",
      description:
        "Returns an ERC-20 token's name, symbol and decimals. The name and symbol are whatever the contract says: check the address, not the symbol, before trusting a token.",
      inputSchema: {
        type: "object",
        properties: {
          token: { type: "string", description: "ERC-20 contract address." },
          chain: chainInput,
        },
        required: ["token"],
      },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      async execute(input) {
        const token = tokenOf(input.token);
        const chainId = chainIdOf(config, input.chain);
        const [decimals, symbol, name] = await readContracts(config, {
          contracts: [
            { address: token, abi: erc20Abi, functionName: "decimals", chainId },
            { address: token, abi: erc20Abi, functionName: "symbol", chainId },
            { address: token, abi: erc20Abi, functionName: "name", chainId },
          ],
        });
        if (decimals.status !== "success") {
          throw new Error(`${token} doesn't look like an ERC-20 token on chain ${chainId}.`);
        }
        return {
          address: token,
          chainId,
          decimals: decimals.result,
          symbol: symbol.status === "success" ? symbol.result : undefined,
          name: name.status === "success" ? name.result : undefined,
        };
      },
    },
    {
      name: "get_allowance",
      title: "Get an ERC-20 allowance",
      description:
        "Returns how much of a token a spender may move for an owner, as a decimal string and raw integer value. The owner defaults to the connected account. Use it to tell whether an approval is needed before a swap or deposit.",
      inputSchema: {
        type: "object",
        properties: {
          token: { type: "string", description: "ERC-20 contract address." },
          spender: { type: "string", description: "The contract allowed to spend." },
          owner: { type: "string", description: "Defaults to the connected account." },
          chain: chainInput,
        },
        required: ["token", "spender"],
      },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      async execute(input) {
        const token = tokenOf(input.token);
        const spender = String(input.spender ?? "");
        if (!isAddress(spender)) throw new Error(`"${spender}" isn't an address.`);
        const owner = accountOf(config, input.owner, "an owner");
        const chainId = chainIdOf(config, input.chain);
        const [value, decimals, symbol] = await readContracts(config, {
          allowFailure: false,
          contracts: [
            {
              address: token,
              abi: erc20Abi,
              functionName: "allowance",
              args: [owner, spender],
              chainId,
            },
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
      name: "resolve_ens",
      title: "Resolve an ENS name",
      description:
        'Turns an ENS name into an address ({ name: "vitalik.eth" }), or an address into its primary ENS name ({ address: "0x…" }). Returns null for the other field when nothing is set.',
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string", description: "An ENS name, like vitalik.eth." },
          address: { type: "string", description: "An address to look up." },
        },
      },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      async execute(input) {
        const chainId = getChains(config).find((c) => c.id === 1)?.id;
        if (!chainId) throw new Error("ENS needs Ethereum (chain 1) in this app's wagmi config.");
        if (typeof input.name === "string") {
          const name = normalize(input.name);
          return { name, address: await getEnsAddress(config, { name, chainId }) };
        }
        const address = String(input.address ?? "");
        if (!isAddress(address)) throw new Error("Pass a name, or an address to look up.");
        return { address, name: await getEnsName(config, { address, chainId }) };
      },
    },
    {
      name: "get_gas_price",
      title: "Get the gas price",
      description:
        "Returns the current gas price on a chain in wei and gwei. Defaults to the current chain.",
      inputSchema: { type: "object", properties: { chain: chainInput } },
      annotations: { readOnlyHint: true },
      async execute(input) {
        const chainId = chainIdOf(config, input.chain);
        const wei = await getGasPrice(config, { chainId });
        return { wei: wei.toString(), gwei: formatUnits(wei, 9), chainId };
      },
    },
    {
      name: "get_block_number",
      title: "Get the latest block",
      description: "Returns the latest block number on a chain. Defaults to the current chain.",
      inputSchema: { type: "object", properties: { chain: chainInput } },
      annotations: { readOnlyHint: true },
      async execute(input) {
        const chainId = chainIdOf(config, input.chain);
        return { blockNumber: (await getBlockNumber(config, { chainId })).toString(), chainId };
      },
    },
    {
      name: "get_transaction",
      title: "Get a transaction's status",
      description:
        'Returns a transaction\'s status by hash: "success" or "reverted" once mined, with its block, "pending" while it waits, or "not-found". Call it again to follow a pending one.',
      inputSchema: {
        type: "object",
        properties: {
          hash: { type: "string", description: "Transaction hash." },
          chain: chainInput,
        },
        required: ["hash"],
      },
      annotations: { readOnlyHint: true },
      async execute(input) {
        const hash = String(input.hash ?? "");
        if (!isHash(hash)) throw new Error(`"${hash}" isn't a transaction hash.`);
        const chainId = chainIdOf(config, input.chain);
        const receipt = await getTransactionReceipt(config, { hash, chainId }).catch(
          () => undefined,
        );
        if (receipt) {
          return {
            status: receipt.status,
            blockNumber: receipt.blockNumber.toString(),
            from: receipt.from,
            to: receipt.to,
            chainId,
          };
        }
        const pending = await getTransaction(config, { hash, chainId }).catch(() => undefined);
        return { status: pending ? "pending" : "not-found", chainId };
      },
    },
    {
      name: "switch_chain",
      title: "Switch the wallet's chain",
      description:
        "Asks the wallet to switch to another supported chain. The page asks the person first, then the wallet may show its own prompt. If either says no, this fails: don't retry on your own.",
      inputSchema: {
        type: "object",
        properties: { chain: { type: ["number", "string"], description: "Chain id or name." } },
        required: ["chain"],
      },
      annotations: { readOnlyHint: false },
      async execute(input) {
        const chainId = chainIdOf(config, input.chain);
        const name = getChains(config).find((c) => c.id === chainId)?.name ?? `chain ${chainId}`;
        await askPerson(
          confirm,
          `Asks your wallet to switch to ${name}`,
          "Ask them to switch networks in the app themselves.",
        );
        const chain = await switchChain(config, { chainId });
        return { id: chain.id, name: chain.name };
      },
    },
  ];
}

export type RegisterAgentToolsOptions = {
  /** Also register ui-sdk's `snapshot`, `act` and `query` for this bridge. */
  agent?: Agent;
  /**
   * `registerTools`' allow for the bridge's tools, like `agentPermissions(…).approved`.
   * Required with `agent`: read `step.confirm`, never answer for the person.
   */
  allow?: Allow;
};

/**
 * Registers `tools` with the browser through WebMCP, and with `agent`, ui-sdk's
 * page tools too. Returns the cleanup. Does nothing without WebMCP.
 */
export function registerAgentTools(
  tools: AgentTool[],
  { agent, allow }: RegisterAgentToolsOptions = {},
) {
  if (agent && !allow) throw new Error("registerAgentTools needs an allow with an agent.");
  const context = (globalThis.document as { modelContext?: ModelContext } | undefined)
    ?.modelContext;
  if (!context) return () => {};
  const controller = new AbortController();
  for (const tool of tools) {
    // Early builds returned synchronously, and a second registration of a name rejects.
    Promise.resolve()
      .then(() => context.registerTool(tool, { signal: controller.signal }))
      .catch(() => {});
  }
  const unregisterPage = agent && allow ? registerTools(agent, { allow }) : () => {};
  return () => {
    controller.abort();
    unregisterPage();
  };
}
