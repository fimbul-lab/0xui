import {
  getConnection,
  getPublicClient,
  sendCalls,
  sendTransaction,
  signMessage,
  switchChain,
  waitForCallsStatus,
  watchConnection,
} from "@wagmi/core";
import type { Config, Connector } from "@wagmi/core";
import { getCapabilitiesQueryOptions, hashFn, readContractQueryOptions } from "@wagmi/core/query";
import { encodeFunctionData, erc20Abi, formatUnits } from "viem";
import type { Address, Hash } from "viem";
import { createStore } from "@/lib/0xui-store";
import { requiresAllowanceReset } from "@/lib/approve-button-core";
import { errorCode, isUserRejection } from "@/lib/0xui-utils";
import type { ErrorCode } from "@/lib/0xui-utils";
import type {
  PreparedShield,
  PublicCall,
  ShieldDraft,
  ShieldQuote,
  ShieldedAccountStatus,
  ShieldedEngine,
} from "@/lib/shielded-engine";
import { isNativeToken } from "@/lib/token-list";

/**
 * What the form is doing. Each wallet prompt has its own phase; what
 * happens after the shield is sent is ShieldedTransactionStatus's.
 */
export type ShieldPhase =
  | "idle"
  /** The wallet step for the signature the engine needs. */
  | "signing"
  /** The wallet step for the token approval (or the reset before it). */
  | "approving"
  /** The wallet step that sends the shield, alone or batched with the approval. */
  | "shielding"
  | "cancelled"
  | "error";

/** One wallet prompt. `batch` is the approval and the shield in a single atomic prompt. */
export type ShieldStepKind = "sign" | "reset" | "approve" | "shield" | "batch";

/** `ready`: waiting for a click. `wallet`: the prompt is open. `pending`: sent, waiting to be mined. */
export type ShieldStepPhase = "ready" | "wallet" | "pending";

/** Where one step of a running shield is. */
export type ShieldStepState = "done" | "ready" | "active" | "todo";

/**
 * The wallet prompts a shield takes, in order.
 *
 * The approval and the shield are one prompt (`batch`) only when the wallet
 * can send them as one atomic transaction. Otherwise they are separate, with
 * a reset in front for tokens that need their old allowance cleared.
 */
export function shieldSteps({
  needsSignature,
  needsApproval,
  needsReset,
  atomic,
}: {
  needsSignature: boolean;
  needsApproval: boolean;
  needsReset: boolean;
  atomic: boolean;
}): Array<ShieldStepKind> {
  const send: Array<ShieldStepKind> = !needsApproval
    ? ["shield"]
    : atomic
      ? ["batch"]
      : needsReset
        ? ["reset", "approve", "shield"]
        : ["approve", "shield"];
  return needsSignature ? ["sign", ...send] : send;
}

/** Default copy for one wallet step. */
export function shieldStepCopy(kind: ShieldStepKind, symbol: string) {
  const copy: Record<
    ShieldStepKind,
    { title: string; hint: string; cta: string; wallet: string; pending?: string; done: string }
  > = {
    sign: {
      title: "Sign to prepare the shield",
      hint: "A free signature. It sends nothing.",
      cta: "Sign in wallet",
      wallet: "Sign in wallet…",
      done: "Signed",
    },
    reset: {
      title: `Reset ${symbol} approval`,
      hint: "This token needs its old approval cleared first.",
      cta: `Reset ${symbol} approval`,
      wallet: "Confirm in wallet…",
      pending: "Resetting…",
      done: "Approval reset",
    },
    approve: {
      title: `Approve ${symbol}`,
      hint: "Lets the shield contract move this amount.",
      cta: `Approve ${symbol}`,
      wallet: "Confirm in wallet…",
      pending: "Approving…",
      done: `${symbol} approved`,
    },
    shield: {
      title: `Shield ${symbol}`,
      hint: "Moves the funds into your private balance.",
      cta: `Shield ${symbol}`,
      wallet: "Confirm in wallet…",
      done: "Shield sent",
    },
    batch: {
      title: `Approve and shield ${symbol}`,
      hint: "One wallet prompt. Both happen together, or neither does.",
      cta: `Approve and shield ${symbol}`,
      wallet: "Confirm in wallet…",
      pending: "Pending…",
      done: "Approved and shield sent",
    },
  };
  return copy[kind];
}

/** The label of a running step's button: its call to action, or what the wallet is doing. */
export function shieldStepLabel(kind: ShieldStepKind, phase: ShieldStepPhase, symbol: string) {
  const copy = shieldStepCopy(kind, symbol);
  return phase === "wallet"
    ? copy.wallet
    : phase === "pending"
      ? (copy.pending ?? "Pending…")
      : copy.cta;
}

const stepWords: Record<ShieldStepKind, string> = {
  sign: "sign",
  reset: "reset approval",
  approve: "approve",
  shield: "shield",
  batch: "approve and shield together",
};

/** "Two wallet prompts: sign, approve and shield together." */
export function describeShieldSteps(steps: ReadonlyArray<ShieldStepKind>) {
  if (steps.length === 1) {
    return "One wallet prompt.";
  }
  const count = ["", "", "Two", "Three", "Four"][steps.length] ?? String(steps.length);
  return `${count} wallet prompts: ${steps.map((kind) => stepWords[kind]).join(", ")}.`;
}

type ShieldTokenLabel = { symbol: string; decimals: number };

/**
 * What a person confirms before an agent starts a shield: the amount, what
 * arrives after the fee, the network and the wallet prompts it takes. The
 * press that starts the shield opens the first prompt. Set as the button's
 * `data-agent-confirm`.
 */
export function shieldConfirmText({
  amount,
  token,
  quote,
  steps,
  chainName,
}: {
  amount: bigint;
  token: ShieldTokenLabel;
  quote: Pick<ShieldQuote, "fee" | "received">;
  steps: ReadonlyArray<ShieldStepKind>;
  chainName?: string;
}) {
  const units = (raw: bigint) => `${formatUnits(raw, token.decimals)} ${token.symbol}`;
  const on = chainName ? ` on ${chainName}` : "";
  return (
    `Shields ${units(amount)} from your wallet into your private balance${on}: ` +
    `${units(quote.received)} arrives after a ${units(quote.fee)} fee. ${describeShieldSteps(steps)}`
  );
}

/** What a person confirms before an agent opens the wallet for one step of a running shield. */
export function shieldStepConfirmText(
  kind: ShieldStepKind,
  { amount, token }: { amount: bigint; token: ShieldTokenLabel },
) {
  const copy = shieldStepCopy(kind, token.symbol);
  return `${copy.title} in your wallet, to shield ${formatUnits(amount, token.decimals)} ${token.symbol}. ${copy.hint}`;
}

/**
 * Why the shield can't start yet, as button text, or undefined when it can.
 * Order matches how people get there: account, token, amount, balance.
 */
export function shieldBlocker({
  accountStatus,
  token,
  amount,
  insufficient,
}: {
  accountStatus: ShieldedAccountStatus;
  token: { address: Address; symbol: string } | undefined;
  amount: bigint | undefined;
  insufficient: boolean;
}) {
  if (accountStatus === "none") {
    return "Create a private account first";
  }
  if (accountStatus === "locked") {
    return "Unlock your private account";
  }
  if (!token) {
    return "Select a token";
  }
  if (isNativeToken(token)) {
    return `Wrap ${token.symbol} to shield it`;
  }
  if (!amount) {
    return "Enter an amount";
  }
  if (insufficient) {
    return `Insufficient ${token.symbol} balance`;
  }
  return undefined;
}

/** A fee as a share of the amount: "0.25%". */
export function formatFeePercent(fee: bigint, amount: bigint) {
  if (amount === 0n) {
    return "0%";
  }
  return `${Number((fee * 10_000n) / amount) / 100}%`;
}

/** The engine's quote for a shield. Pass `enabled: false` while the amount is still being typed. */
export function shieldQuoteQueryOptions(
  engine: ShieldedEngine,
  draft: ShieldDraft | undefined,
  { enabled = true }: { enabled?: boolean } = {},
) {
  return {
    queryKey: [
      "0xui",
      "shield-quote",
      engine.id,
      draft?.chainId,
      draft?.token,
      draft?.amount.toString(),
    ],
    queryFn: () =>
      draft ? engine.quoteShield(draft) : Promise.reject(new Error("Nothing to quote yet.")),
    enabled: Boolean(enabled && draft && draft.amount > 0n),
    staleTime: 30_000,
    retry: false,
  } as const;
}

/** How much `spender` may move of the draft's token. Disabled until all three are known. */
export function shieldAllowanceQueryOptions(
  config: Config,
  {
    draft,
    owner,
    spender,
  }: { draft: ShieldDraft | undefined; owner: Address | undefined; spender: Address | undefined },
) {
  return {
    ...readContractQueryOptions(config, {
      address: draft?.token,
      abi: erc20Abi,
      functionName: "allowance",
      args: owner && spender ? [owner, spender] : undefined,
      chainId: draft?.chainId,
      query: { enabled: Boolean(draft && spender && owner) },
    }),
    queryKeyHashFn: hashFn,
  };
}

/** What the connected wallet can do on a chain (EIP-5792). */
export function walletCapabilitiesQueryOptions(
  config: Config,
  {
    chainId,
    account,
    connector,
    enabled = true,
  }: {
    chainId: number | undefined;
    account: Address | undefined;
    connector: Connector | undefined;
    enabled?: boolean;
  },
) {
  return {
    ...getCapabilitiesQueryOptions(config, { chainId, account, connector, query: { enabled } }),
    queryKeyHashFn: hashFn,
  };
}

/**
 * Whether the wallet sends a batch as one atomic transaction. "ready" means
 * it would first ask to upgrade the account, and a wallet that batches
 * without atomicity could approve and then fail to shield. Neither counts.
 */
export function isAtomic(capabilities: unknown) {
  return (
    (capabilities as { atomic?: { status?: string } } | undefined)?.atomic?.status === "supported"
  );
}

/** The wallet steps of a shield, frozen when it starts. */
export type ShieldPlan = {
  steps: Array<ShieldStepKind>;
  /** The spender already has an allowance below the amount. A batch clears it first, at no extra prompt. */
  leftover: boolean;
};

/**
 * Plan the wallet prompts for a draft. Undefined until the quote and, when
 * there is a spender, the allowance are known.
 */
export function planShield({
  draft,
  quote,
  allowance,
  atomic,
}: {
  draft: ShieldDraft | undefined;
  quote: ShieldQuote | undefined;
  /** The spender's allowance, once read. */
  allowance: bigint | undefined;
  atomic: boolean;
}): ShieldPlan | undefined {
  if (!draft || !quote) {
    return undefined;
  }
  if (quote.spender && allowance === undefined) {
    return undefined;
  }
  return {
    steps: shieldSteps({
      needsSignature: quote.needsSignature,
      needsApproval: Boolean(quote.spender) && allowance !== undefined && allowance < draft.amount,
      needsReset: Boolean(allowance) && requiresAllowanceReset(draft.chainId, draft.token),
      atomic,
    }),
    leftover: Boolean(allowance),
  };
}

/** A shield in progress: what was on the form when it started, and its steps. */
export type ActiveShield = ShieldPlan & { draft: ShieldDraft; quote: ShieldQuote };

/** Why the last step didn't go through: a dismissed prompt, or an error. */
export type ShieldProblem = { kind: "cancelled" | "error"; message?: string; code?: ErrorCode };

export type ShieldFlowState = {
  /** A wallet is connected. */
  connected: boolean;
  /** The connected wallet's address. */
  account: Address | undefined;
  /** The chain the wallet is on. */
  walletChainId: number | undefined;
  connector: Connector | undefined;
  /** A network switch is waiting on the wallet. */
  switching: boolean;
  /** The shield in progress. Undefined while on the form. */
  active: ActiveShield | undefined;
  /** The step waiting for a click, or running. */
  index: number;
  stepPhase: ShieldStepPhase;
  problem: ShieldProblem | undefined;
};

export type ShieldFlow = {
  get(): ShieldFlowState;
  subscribe(listener: () => void): () => void;
  /**
   * Leave the form and open the first wallet prompt. The click that starts
   * the shield is the click for its first step.
   */
  start(shield: ActiveShield): void;
  /** Open the wallet for the current step. One click, one prompt. */
  act(): void;
  /** Back to the form. Anything already mined (an approval) stays mined. */
  leave(): void;
  /** Ask the wallet to move to `chainId`. A failure leaves the form as it was. */
  switchChain(chainId: number): Promise<void>;
};

export type ShieldFlowOptions = {
  /** Called with the shield transaction's hash. For a batch, that is once it is mined. */
  onSubmitted?: (hash: Hash, shield: { draft: ShieldDraft; quote: ShieldQuote }) => void;
};

const phaseOf: Record<ShieldStepKind, ShieldPhase> = {
  sign: "signing",
  reset: "approving",
  approve: "approving",
  shield: "shielding",
  batch: "shielding",
};

/** The form's phase: the running step's, or why the last step stopped. */
export function shieldPhase({
  problem,
  active,
  index,
}: Pick<ShieldFlowState, "problem" | "active" | "index">): ShieldPhase {
  if (problem) {
    return problem.kind;
  }
  const step = active?.steps[index];
  return step ? phaseOf[step] : "idle";
}

/** Each step of the running shield, with where it is. */
export function shieldStepStates({
  active,
  index,
  stepPhase,
}: Pick<ShieldFlowState, "active" | "index" | "stepPhase">): Array<{
  kind: ShieldStepKind;
  state: ShieldStepState;
}> {
  return (active?.steps ?? []).map((kind, i) => ({
    kind,
    state: i < index ? "done" : i > index ? "todo" : stepPhase === "ready" ? "ready" : "active",
  }));
}

/** The form button's label, and what pressing it does, if anything. */
export type ShieldFormAction = { label: string; action?: "connect" | "switch" | "start" };

/**
 * What the form's button does before a shield starts, and its label. It
 * names the blocker, or offers to connect, switch network or shield.
 */
export function shieldFormAction({
  connected,
  blocker,
  wrongChain,
  switching,
  chainName,
  quoteFailed,
  quoting,
  planned,
  symbol,
}: {
  connected: boolean;
  blocker: string | undefined;
  wrongChain: boolean;
  switching: boolean;
  chainName: string;
  quoteFailed: boolean;
  quoting: boolean;
  planned: boolean;
  symbol: string | undefined;
}): ShieldFormAction {
  if (!connected) {
    return { label: "Connect wallet", action: "connect" };
  }
  if (blocker) {
    return { label: blocker };
  }
  if (wrongChain) {
    return switching
      ? { label: "Switching network…" }
      : { label: `Switch to ${chainName}`, action: "switch" };
  }
  if (quoteFailed) {
    return { label: "Can't shield this amount" };
  }
  if (quoting || !planned) {
    return { label: "Fetching quote…" };
  }
  return { label: `Shield ${symbol}`, action: "start" };
}

const toError = (cause: unknown) => (cause instanceof Error ? cause : new Error(String(cause)));

function readWallet(config: Config) {
  const connection = getConnection(config);
  return {
    connected: connection.status === "connected",
    account: connection.address,
    walletChainId: connection.chainId,
    connector: connection.connector,
  };
}

/**
 * Runs a shield as a list of wallet steps, one click each: the signature
 * the engine needs, the approval, the shield. Approval and shield go out as
 * one atomic batch (EIP-5792) when the plan says so. `start` freezes the
 * draft, quote and steps, so what is sent is what was on screen when the
 * user began. Framework-free.
 */
export function createShieldFlow(
  config: Config,
  engine: ShieldedEngine,
  { onSubmitted }: ShieldFlowOptions = {},
): ShieldFlow {
  const store = createStore<ShieldFlowState>(
    {
      ...readWallet(config),
      switching: false,
      active: undefined,
      index: 0,
      stepPhase: "ready",
      problem: undefined,
    },
    (store) => {
      store.set(readWallet(config));
      return watchConnection(config, { onChange: () => store.set(readWallet(config)) });
    },
  );

  let prepared: PreparedShield | undefined;
  // Bumped whenever the flow is left. Work from an older run stops when it notices.
  let run = 0;

  /** Open the wallet for one step. Advances, finishes, or records why it didn't. */
  const perform = async (flow: ActiveShield, at: number) => {
    const id = ++run;
    const live = () => run === id;
    const { draft, quote } = flow;
    const { chainId, token, amount } = draft;
    const kind = flow.steps[at];
    if (kind === undefined) {
      return;
    }

    // Built once per flow. If the engine needs a signature, this is where the wallet asks.
    const prepare = async () =>
      (prepared ??= await engine.prepareShield(draft, {
        sign: (message) => signMessage(config, { message }),
      }));
    const approval = (value: bigint): PublicCall => {
      if (!quote.spender) {
        throw new Error("This shield has no spender to approve.");
      }
      return {
        to: token,
        data: encodeFunctionData({
          abi: erc20Abi,
          functionName: "approve",
          args: [quote.spender, value],
        }),
      };
    };

    store.set({ problem: undefined, stepPhase: "wallet" });
    try {
      let hash: Hash | undefined;
      if (kind === "sign") {
        await prepare();
      } else if (kind === "reset" || kind === "approve") {
        const sent = await sendTransaction(config, {
          chainId,
          ...approval(kind === "reset" ? 0n : amount),
        });
        if (live()) {
          store.set({ stepPhase: "pending" });
        }
        const client = getPublicClient(config, { chainId });
        if (!client) {
          throw new Error(`Chain ${chainId} is not in the wagmi config.`);
        }
        const receipt = await client.waitForTransactionReceipt({ hash: sent });
        if (receipt.status === "reverted") {
          throw new Error("The approval reverted. Nothing changed except the gas fee.");
        }
      } else if (kind === "shield") {
        const { transaction } = await prepare();
        hash = await sendTransaction(config, { chainId, ...transaction });
      } else {
        const { transaction } = await prepare();
        const batch = await sendCalls(config, {
          chainId,
          calls: [...(flow.leftover ? [approval(0n)] : []), approval(amount), transaction],
        });
        if (live()) {
          store.set({ stepPhase: "pending" });
        }
        const result = await waitForCallsStatus(config, { id: batch.id });
        const receipts = result.receipts ?? [];
        // The shield is the last call. A wallet can call a batch done while a
        // call in it reverted, so every receipt has to have succeeded.
        hash = receipts.at(-1)?.transactionHash;
        if (result.status !== "success" || !hash || receipts.some((r) => r.status !== "success")) {
          throw new Error("The batch reverted. Nothing was approved or shielded.");
        }
      }
      if (!live()) {
        return;
      }

      if (hash) {
        prepared = undefined;
        store.set({ active: undefined, stepPhase: "ready" });
        onSubmitted?.(hash, { draft, quote });
      } else {
        store.set({ index: at + 1, stepPhase: "ready" });
      }
    } catch (error_) {
      if (!live()) {
        return;
      }
      const error = toError(error_);
      store.set({
        stepPhase: "ready",
        problem: isUserRejection(error)
          ? { kind: "cancelled" }
          : {
              kind: "error",
              message: (error as { shortMessage?: string }).shortMessage ?? error.message,
              code: errorCode("error", error),
            },
      });
    }
  };

  return {
    get: store.get,
    subscribe: store.subscribe,
    start(shield) {
      prepared = undefined;
      store.set({ active: shield, index: 0 });
      void perform(shield, 0);
    },
    act() {
      const { active, stepPhase, index } = store.get();
      if (active && stepPhase === "ready") {
        void perform(active, index);
      }
    },
    leave() {
      run++;
      prepared = undefined;
      store.set({ active: undefined, stepPhase: "ready", problem: undefined });
    },
    async switchChain(chainId) {
      store.set({ switching: true });
      try {
        await switchChain(config, { chainId });
      } catch {
        // A rejected or failed switch leaves the button offering it again.
      } finally {
        store.set({ switching: false });
      }
    },
  };
}
