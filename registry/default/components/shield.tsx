// Docs: https://0xui.io/blocks/shield.md
import { useQuery } from "@tanstack/react-query";
import { Loader2Icon } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { encodeFunctionData, erc20Abi, type Hash } from "viem";
import {
  useCapabilities,
  useChains,
  useConfig,
  useConnection,
  useReadContract,
  useSendCalls,
  useSendTransaction,
  useSignMessage,
  useSwitchChain,
} from "wagmi";
import { getPublicClient, waitForCallsStatus } from "wagmi/actions";
import { requiresAllowanceReset } from "@/components/approve-button";
import { ConnectWalletDialog } from "@/components/connect-wallet";
import { MorphText } from "@/components/morph-text";
import { PrivacyBadge } from "@/components/privacy-badge";
import { useShieldedAccount, useShieldedEngine } from "@/components/shielded-provider";
import { ShieldedTransactionStatus, formatWait } from "@/components/shielded-transaction-status";
import { TokenAmount } from "@/components/token-amount";
import { TokenInput, type TokenInputState } from "@/components/token-input";
import { isNativeToken, type Token, type TokenPrices } from "@/components/token-select";
import { StepIcon } from "@/components/transaction-status";
import { Button } from "@/components/ui/button";
import { agentConfirmText, errorCode, isUserRejection, type ErrorCode } from "@/lib/0xui-utils";
import type {
  PreparedShield,
  PublicCall,
  ShieldDraft,
  ShieldQuote,
  ShieldedAccountStatus,
  ShieldedTransaction,
} from "@/lib/shielded-engine";
import { cn } from "@/lib/utils";

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

function useDebounced<T>(value: T, delay: number) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

/**
 * Fee, amount received, standby period and wallet requirements for a shield,
 * from the engine. Waits for typing to pause. `quote` is undefined while it
 * doesn't match the draft.
 */
export function useShieldQuote(draft: ShieldDraft | undefined, { debounce = 300 } = {}) {
  const engine = useShieldedEngine();
  const amount = useDebounced(draft?.amount, debounce);
  const settled = amount === draft?.amount;
  const query = useQuery({
    queryKey: ["0xui", "shield-quote", engine.id, draft?.chainId, draft?.token, amount?.toString()],
    queryFn: () => engine.quoteShield({ ...draft!, amount: amount! }),
    enabled: Boolean(draft && settled && amount && amount > 0n),
    staleTime: 30_000,
    retry: false,
  });
  return {
    quote: draft && settled ? query.data : undefined,
    isLoading: Boolean(draft) && (!settled || query.isPending),
    error: draft && settled ? query.error : null,
  };
}

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
}): ShieldStepKind[] {
  const send: ShieldStepKind[] = !needsApproval
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

const stepWords: Record<ShieldStepKind, string> = {
  sign: "sign",
  reset: "reset approval",
  approve: "approve",
  shield: "shield",
  batch: "approve and shield together",
};

/** "Two wallet prompts: sign, approve and shield together." */
export function describeShieldSteps(steps: readonly ShieldStepKind[]) {
  if (steps.length === 1) return "One wallet prompt.";
  const count = ["", "", "Two", "Three", "Four"][steps.length] ?? String(steps.length);
  return `${count} wallet prompts: ${steps.map((kind) => stepWords[kind]).join(", ")}.`;
}

const toError = (cause: unknown) => (cause instanceof Error ? cause : new Error(String(cause)));

/**
 * Runs a shield as a list of wallet steps, one click each: the signature
 * the engine needs, the approval, the shield. Approval and shield go out as
 * one atomic batch (EIP-5792) when the wallet reports that as "supported".
 *
 * The steps are known before anything starts, from the quote, the allowance
 * and the wallet's capabilities. `start` freezes them together with the
 * draft, so what is sent is what was on screen when the user began.
 */
export function useShieldFlow({
  draft,
  quote,
  onSubmitted,
}: {
  /** The shield on the form right now. */
  draft: ShieldDraft | undefined;
  /** Its quote, from useShieldQuote. */
  quote: ShieldQuote | undefined;
  /** Called with the shield transaction's hash. For a batch, that is once it is mined. */
  onSubmitted?: (hash: Hash, shield: { draft: ShieldDraft; quote: ShieldQuote }) => void;
}) {
  const engine = useShieldedEngine();
  const config = useConfig();
  const connection = useConnection();
  const signMessage = useSignMessage();
  const sendTransaction = useSendTransaction();
  const sendCalls = useSendCalls();

  const spender = quote?.spender;
  const allowance = useReadContract({
    address: draft?.token,
    abi: erc20Abi,
    functionName: "allowance",
    args: [connection.address!, spender!],
    chainId: draft?.chainId,
    query: { enabled: Boolean(draft && spender && connection.address) },
  });
  const capabilities = useCapabilities({
    chainId: draft?.chainId,
    query: { enabled: Boolean(draft) && connection.status === "connected" },
  });
  // "ready" means the wallet would first ask to upgrade the account, and a
  // wallet that batches without atomicity could approve and then fail to
  // shield. Neither counts.
  const atomic =
    (capabilities.data as { atomic?: { status?: string } } | undefined)?.atomic?.status ===
    "supported";

  const planned =
    draft && quote && (!spender || allowance.data !== undefined)
      ? {
          steps: shieldSteps({
            needsSignature: quote.needsSignature,
            needsApproval: Boolean(spender) && allowance.data! < draft.amount,
            needsReset:
              Boolean(allowance.data) && requiresAllowanceReset(draft.chainId, draft.token),
            atomic,
          }),
          // A batch clears any leftover allowance first: it costs no extra prompt.
          leftover: Boolean(allowance.data),
        }
      : undefined;

  const [active, setActive] = useState<{
    draft: ShieldDraft;
    quote: ShieldQuote;
    steps: ShieldStepKind[];
    leftover: boolean;
  }>();
  const [index, setIndex] = useState(0);
  const [stepPhase, setStepPhase] = useState<ShieldStepPhase>("ready");
  const [problem, setProblem] = useState<{
    kind: "cancelled" | "error";
    message?: string;
    code?: ErrorCode;
  }>();

  const prepared = useRef<PreparedShield>(undefined);
  // Bumped whenever the flow is left. Work from an older run stops when it notices.
  const run = useRef(0);
  // The latest callback, for runs that finish after a re-render.
  const submitted = useRef(onSubmitted);
  submitted.current = onSubmitted;

  type Active = NonNullable<typeof active>;

  /** Open the wallet for one step. Advances, finishes, or records why it didn't. */
  const perform = async (flow: Active, at: number) => {
    const id = ++run.current;
    const live = () => run.current === id;
    const { draft: shield, quote: terms } = flow;
    const { chainId, token, amount } = shield;
    const kind = flow.steps[at]!;

    // Built once per flow. If the engine needs a signature, this is where the wallet asks.
    const prepare = async () =>
      (prepared.current ??= await engine.prepareShield(shield, {
        sign: (message) => signMessage.mutateAsync({ message }),
      }));
    const approval = (value: bigint): PublicCall => ({
      to: token,
      data: encodeFunctionData({
        abi: erc20Abi,
        functionName: "approve",
        args: [terms.spender!, value],
      }),
    });

    setProblem(undefined);
    setStepPhase("wallet");
    try {
      let hash: Hash | undefined;
      if (kind === "sign") {
        await prepare();
      } else if (kind === "reset" || kind === "approve") {
        const sent = await sendTransaction.mutateAsync({
          chainId,
          ...approval(kind === "reset" ? 0n : amount),
        });
        if (live()) setStepPhase("pending");
        const receipt = await getPublicClient(config, { chainId })!.waitForTransactionReceipt({
          hash: sent,
        });
        if (receipt.status === "reverted") {
          throw new Error("The approval reverted. Nothing changed except the gas fee.");
        }
      } else if (kind === "shield") {
        const { transaction } = await prepare();
        hash = await sendTransaction.mutateAsync({ chainId, ...transaction });
      } else {
        const { transaction } = await prepare();
        const batch = await sendCalls.mutateAsync({
          chainId,
          calls: [...(flow.leftover ? [approval(0n)] : []), approval(amount), transaction],
        });
        if (live()) setStepPhase("pending");
        const result = await waitForCallsStatus(config, { id: batch.id });
        const receipts = result.receipts ?? [];
        // The shield is the last call. A wallet can call a batch done while a
        // call in it reverted, so every receipt has to have succeeded.
        hash = receipts.at(-1)?.transactionHash;
        if (result.status !== "success" || !hash || receipts.some((r) => r.status !== "success")) {
          throw new Error("The batch reverted. Nothing was approved or shielded.");
        }
      }
      if (!live()) return;

      if (hash) {
        prepared.current = undefined;
        setActive(undefined);
        setStepPhase("ready");
        void allowance.refetch();
        submitted.current?.(hash, { draft: shield, quote: terms });
      } else {
        setIndex(at + 1);
        setStepPhase("ready");
      }
    } catch (cause) {
      if (!live()) return;
      const error = toError(cause);
      setStepPhase("ready");
      setProblem(
        isUserRejection(error)
          ? { kind: "cancelled" }
          : {
              kind: "error",
              message: (error as { shortMessage?: string }).shortMessage ?? error.message,
              code: errorCode("error", error),
            },
      );
    }
  };

  return {
    /** The wallet prompts the form's shield would take. Undefined until the quote and allowance are known. */
    plannedSteps: planned?.steps,
    /** The shield in progress, frozen at `start`. Undefined while on the form. */
    active: active && { draft: active.draft, quote: active.quote },
    /** The steps of the shield in progress, with where each one is. */
    steps: (active?.steps ?? []).map((kind, i) => ({
      kind,
      state:
        i < index
          ? ("done" as const)
          : i > index
            ? ("todo" as const)
            : stepPhase === "ready"
              ? ("ready" as const)
              : ("active" as const),
    })),
    /** The step waiting for a click, or running. */
    step: active?.steps[index],
    stepIndex: index,
    stepPhase,
    /** A wallet prompt is open or a transaction is pending. */
    busy: Boolean(active) && stepPhase !== "ready",
    /** Why the last step didn't go through: a dismissed prompt, or an error. Cleared by the next click. */
    problem,
    /**
     * Leave the form and open the first wallet prompt. The click that starts
     * the shield is the click for its first step.
     */
    start: () => {
      if (!draft || !quote || !planned) return;
      const flow = { draft, quote, ...planned };
      prepared.current = undefined;
      setActive(flow);
      setIndex(0);
      void perform(flow, 0);
    },
    /** Open the wallet for the current step. One click, one prompt. */
    act: () => {
      if (active && stepPhase === "ready") void perform(active, index);
    },
    /** Back to the form. Anything already mined (an approval) stays mined. */
    leave: () => {
      run.current++;
      prepared.current = undefined;
      setActive(undefined);
      setStepPhase("ready");
      setProblem(undefined);
    },
  };
}

export type ShieldFlow = ReturnType<typeof useShieldFlow>;

/**
 * Why the shield can't start yet, as button text, or undefined when it can.
 * Order matches how people get there: account, token, amount, balance.
 */
export function shieldBlocker({
  accountStatus,
  token,
  amount,
  insufficient,
  shieldsNative = false,
}: {
  accountStatus: ShieldedAccountStatus;
  token: Token | undefined;
  amount: bigint | undefined;
  insufficient: boolean;
  /** The engine takes native currency as it is, so there is nothing to wrap. */
  shieldsNative?: boolean;
}) {
  if (accountStatus === "none") return "Create a private account first";
  if (accountStatus === "locked") return "Unlock your private account";
  if (!token) return "Select a token";
  if (isNativeToken(token) && !shieldsNative) return `Wrap ${token.symbol} to shield it`;
  if (!amount) return "Enter an amount";
  if (insufficient) return `Insufficient ${token.symbol} balance`;
  return undefined;
}

/** A fee as a share of the amount: "0.25%". */
export function formatFeePercent(fee: bigint, amount: bigint) {
  if (amount === 0n) return "0%";
  return `${Number((fee * 10_000n) / amount) / 100}%`;
}

const enter =
  "animate-in fade-in-0 slide-in-from-bottom-1 duration-200 ease-out motion-reduce:animate-none";

/** Animates its own height as the content inside it changes. */
function AnimatedHeight({ children }: { children: ReactNode }) {
  const inner = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number>();
  useLayoutEffect(() => {
    const element = inner.current;
    if (!element) return;
    const measure = () => setHeight(element.offsetHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return (
    // The negative margin and matching padding leave room for focus rings.
    <div
      className="-m-1 overflow-hidden transition-[height] duration-200 ease-out motion-reduce:transition-none"
      style={{ height: height || undefined }}
    >
      <div ref={inner} className="p-1">
        {children}
      </div>
    </div>
  );
}

type TokenLabel = Pick<Token, "symbol" | "decimals">;

export type ShieldQuoteRowsProps = {
  /** Leave undefined to hold the space with placeholders. */
  quote: ShieldQuote | undefined;
  /** Amount the quote is for. */
  amount: bigint | undefined;
  token: TokenLabel | undefined;
  className?: string;
};

/** Fee, amount received and wait: what the user agrees to before the first wallet prompt. */
export function ShieldQuoteRows({ quote, amount, token, className }: ShieldQuoteRowsProps) {
  const value = (raw: bigint) =>
    token && (
      <TokenAmount value={raw} decimals={token.decimals} symbol={token.symbol} maxDecimals={6} />
    );
  return (
    <dl className={cn("flex flex-col gap-1.5 rounded-xl border p-3 text-sm", className)}>
      <div className="flex items-center justify-between gap-3">
        <dt className="text-muted-foreground">
          Fee{quote && amount ? ` (${formatFeePercent(quote.fee, amount)})` : ""}
        </dt>
        <dd>{quote ? value(quote.fee) : "—"}</dd>
      </div>
      <div className="flex items-center justify-between gap-3">
        <dt className="flex items-center gap-2 text-muted-foreground">
          You receive <PrivacyBadge privacy="private" />
        </dt>
        <dd className="font-medium">{quote ? value(quote.received) : "—"}</dd>
      </div>
      <div className="flex items-center justify-between gap-3">
        <dt className="text-muted-foreground">Spendable after</dt>
        <dd>{quote ? (formatWait(quote.standby) ?? "right away") : "—"}</dd>
      </div>
    </dl>
  );
}

export type ShieldSummaryProps = {
  /** The amount as typed, e.g. "0.5". */
  amountText: string;
  token: TokenLabel;
  /** What arrives in the private balance, after the fee. */
  received: bigint;
  /** Shows an Edit button that goes back to the form. */
  onEdit?: () => void;
  /** Disables Edit, e.g. while a wallet prompt is open. */
  editDisabled?: boolean;
  className?: string;
};

/** The shield in one line, once the amount can no longer be typed into. */
export function ShieldSummary({
  amountText,
  token,
  received,
  onEdit,
  editDisabled,
  className,
}: ShieldSummaryProps) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 rounded-2xl border bg-muted/30 px-4 py-3",
        className,
      )}
    >
      <div className="flex min-w-0 flex-col">
        {/* Shrinks from the size the amount had in the input. */}
        <span className="origin-left animate-in text-xl font-medium tabular-nums duration-200 ease-out zoom-in-150 motion-reduce:animate-none">
          {amountText} <span className="text-muted-foreground">{token.symbol}</span>
        </span>
        <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <TokenAmount value={received} decimals={token.decimals} maxDecimals={6} />
          arrives <PrivacyBadge privacy="private" />
        </span>
      </div>
      {onEdit && (
        <Button variant="ghost" size="sm" disabled={editDisabled} onClick={onEdit}>
          Edit
        </Button>
      )}
    </div>
  );
}

export type ShieldStepListProps = {
  steps: ShieldFlow["steps"];
  /** Token symbol, for the step labels. */
  symbol: string;
  className?: string;
};

/** The wallet steps as a list: done, current with its hint, still to come. */
export function ShieldStepList({ steps, symbol, className }: ShieldStepListProps) {
  return (
    <ol className={cn("flex flex-col gap-2.5 text-sm", className)}>
      {steps.map(({ kind, state }) => {
        const copy = shieldStepCopy(kind, symbol);
        const current = state === "ready" || state === "active";
        return (
          <li key={kind} data-state={state} className="flex items-start gap-2">
            <span className="mt-0.5">
              <StepIcon state={state === "ready" ? "todo" : state} />
            </span>
            <span className="flex flex-col">
              <span className={cn(state === "todo" && "text-muted-foreground")}>
                {state === "done" ? copy.done : copy.title}
              </span>
              {current && <span className="text-muted-foreground">{copy.hint}</span>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

export type ShieldProps = {
  /** ERC-20 tokens the user can shield. Only those on `chainId` are offered. */
  tokens: readonly Token[];
  /** Chain to shield on. */
  chainId: number;
  /**
   * What happens to the form once the shield starts.
   *
   * "in-place": the form stays where it is and locks, and the button steps
   * through the wallet prompts. Afterwards the form is free at once and the
   * shield is followed in one line under it.
   *
   * "collapse": the form folds into a summary line with a list of the
   * wallet steps. Afterwards the status card takes its place until the user
   * asks to shield more.
   */
  variant?: "in-place" | "collapse";
  /** Initially selected token. Defaults to the first on `chainId`. */
  defaultToken?: Token;
  /** Symbols or addresses for quick picks. */
  popular?: readonly string[];
  /** Prices keyed by `chainId:address`, address or symbol, for the fiat line. */
  prices?: TokenPrices;
  /** Called with the shield transaction's hash. For a batched shield, that is once it is mined. */
  onSubmitted?: (hash: Hash, draft: ShieldDraft) => void;
  /** Called when the shielded funds become spendable. */
  onSpendable?: (transaction: ShieldedTransaction) => void;
  /** Heading. Pass null to hide. */
  title?: ReactNode;
  className?: string;
};

const phaseOf: Record<ShieldStepKind, ShieldPhase> = {
  sign: "signing",
  reset: "approving",
  approve: "approving",
  shield: "shielding",
  batch: "shielding",
};

/**
 * Shield form: move an ERC-20 from the connected wallet into the private
 * balance. Shows the fee, what arrives and how long until it can be spent,
 * then takes the user through the wallet prompts one click at a time: the
 * signature the protocol needs, the approval, the shield. With a wallet
 * that batches atomically, approval and shield are one prompt. After
 * sending it follows the funds until they are spendable. The button names
 * whatever is missing.
 */
export function Shield({
  tokens,
  chainId,
  variant = "in-place",
  defaultToken,
  popular,
  prices,
  onSubmitted,
  onSpendable,
  title = "Shield",
  className,
}: ShieldProps) {
  const engine = useShieldedEngine();
  const account = useShieldedAccount();
  const connection = useConnection();
  const chains = useChains();
  const switchChain = useSwitchChain();
  const onChain = tokens.filter((t) => t.chainId === chainId);

  const [token, setToken] = useState<Token | undefined>(defaultToken ?? onChain[0]);
  const [amountText, setAmountText] = useState("");
  const [amount, setAmount] = useState<TokenInputState>();
  const [connectOpen, setConnectOpen] = useState(false);
  /** The shield being followed after it was sent. */
  const [sent, setSent] = useState<{
    hash: Hash;
    amountText: string;
    token: Token;
    quote: ShieldQuote;
  }>();
  /** Collapse only: the status has taken the form's place. */
  const [following, setFollowing] = useState(false);
  // What was typed and picked when the shield started. The form may be
  // cleared before a batched shield reports its hash.
  const started = useRef<{ amountText: string; token: Token }>(undefined);

  const blocker = shieldBlocker({
    accountStatus: account.status,
    token,
    amount: amount?.amount,
    insufficient: amount?.insufficient ?? false,
    shieldsNative: engine.shieldsNative,
  });
  const draft: ShieldDraft | undefined =
    !blocker && token && amount?.amount
      ? { chainId, token: token.address, amount: amount.amount }
      : undefined;
  const { quote, isLoading: quoting, error: quoteError } = useShieldQuote(draft);

  const flow = useShieldFlow({
    draft,
    quote,
    onSubmitted: (hash, shield) => {
      setSent({ hash, ...started.current!, quote: shield.quote });
      setFollowing(true);
      setAmountText("");
      setAmount(undefined);
      onSubmitted?.(hash, shield.draft);
    },
  });

  const connected = connection.status === "connected";
  const wrongChain = connected && connection.chainId !== chainId;
  const chainName = chains.find((c) => c.id === chainId)?.name ?? "the right network";
  const running = flow.active !== undefined;
  const shown = started.current;

  const phase: ShieldPhase = flow.problem
    ? flow.problem.kind
    : flow.step
      ? phaseOf[flow.step]
      : "idle";

  // The form's button: names the blocker, or starts the shield.
  let label: string;
  let action: (() => void) | undefined;
  if (!connected) {
    label = "Connect wallet";
    action = () => setConnectOpen(true);
  } else if (blocker) {
    label = blocker;
  } else if (wrongChain) {
    label = switchChain.isPending ? "Switching network…" : `Switch to ${chainName}`;
    action = switchChain.isPending
      ? undefined
      : () => switchChain.mutate({ chainId: chainId as (typeof chains)[number]["id"] });
  } else if (quoteError) {
    label = "Can't shield this amount";
  } else if (quoting || !flow.plannedSteps) {
    label = "Fetching quote…";
  } else {
    label = `Shield ${token!.symbol}`;
    action = () => {
      started.current = { amountText, token: token! };
      flow.start();
    };
  }

  // The button of the step in progress.
  const copy = flow.step && shown ? shieldStepCopy(flow.step, shown.token.symbol) : undefined;
  const stepLabel =
    copy &&
    (flow.stepPhase === "wallet"
      ? copy.wallet
      : flow.stepPhase === "pending"
        ? (copy.pending ?? "Pending…")
        : copy.cta);

  const problem = flow.problem && (
    <>
      <p role="status" className="text-sm text-muted-foreground empty:hidden">
        {flow.problem.kind === "cancelled" ? "Cancelled in wallet." : ""}
      </p>
      {flow.problem.kind === "error" && (
        <p role="alert" className="text-sm text-destructive">
          {flow.problem.message}
        </p>
      )}
    </>
  );
  const quoteProblem = !running && quoteError && (
    <p role="alert" className="text-sm text-destructive">
      {quoteError.message}
    </p>
  );

  const input = (
    <TokenInput
      label="Amount to shield"
      value={amountText}
      onValueChange={(next, state) => {
        setAmountText(next);
        setAmount(state);
      }}
      token={token}
      onTokenChange={(next) => {
        setToken(next);
        setAmountText("");
        setAmount(undefined);
      }}
      tokens={onChain.length > 1 ? onChain : undefined}
      popular={popular}
      prices={prices}
    />
  );

  const status = (kind: "card" | "line") =>
    sent && (
      <ShieldedTransactionStatus
        key={sent.hash}
        variant={kind}
        hash={sent.hash}
        chainId={chainId}
        standby={sent.quote.standby}
        token={sent.token}
        onSpendable={onSpendable}
      >
        Shield {sent.amountText} {sent.token.symbol}
      </ShieldedTransactionStatus>
    );

  return (
    <div
      data-slot="shield"
      data-variant={variant}
      data-phase={phase}
      data-error={flow.problem?.code ?? errorCode(phase)}
      className={cn("flex w-full max-w-md flex-col gap-3", className)}
    >
      {title && <h3 className="text-lg font-semibold">{title}</h3>}

      {variant === "in-place" ? (
        <>
          {/* The form never moves. It only stops taking input while a shield runs. */}
          <div
            inert={running}
            className={cn("transition-opacity duration-200", running && "opacity-60")}
          >
            {input}
          </div>
          <ShieldQuoteRows
            quote={running ? flow.active!.quote : quote}
            amount={running ? flow.active!.draft.amount : draft?.amount}
            token={running ? shown?.token : token}
            // Space is held for the quote, so nothing below shifts as it arrives.
            className={cn("transition-opacity duration-200", !running && !quote && "opacity-50")}
          />
          <div className="flex flex-col gap-2">
            <Button
              size="lg"
              // While a prompt is open the button is the progress display, so it keeps full strength.
              className={cn(
                "relative h-11 w-full overflow-hidden",
                flow.busy && "disabled:opacity-100",
              )}
              disabled={running ? flow.busy : !action}
              aria-busy={flow.busy || undefined}
              onClick={running ? flow.act : action}
            >
              {flow.busy && (
                <Loader2Icon aria-hidden className="animate-spin motion-reduce:animate-none" />
              )}
              <MorphText>{running ? stepLabel : label}</MorphText>
              {/* One segment per wallet prompt, along the button's bottom edge. */}
              {running && flow.steps.length > 1 && (
                <span aria-hidden className="absolute inset-x-0 bottom-0 flex gap-0.5">
                  {flow.steps.map(({ kind, state }) => (
                    <span
                      key={kind}
                      className={cn(
                        "h-0.5 flex-1 bg-primary-foreground transition-opacity duration-200",
                        state === "done" && "opacity-90",
                        state === "active" && "animate-pulse opacity-90 motion-reduce:animate-none",
                        state === "ready" && "opacity-50",
                        state === "todo" && "opacity-20",
                      )}
                    />
                  ))}
                </span>
              )}
            </Button>
            <p className="flex min-h-5 items-center justify-between gap-3 text-xs text-muted-foreground">
              {running && copy ? (
                <>
                  <span>
                    {flow.steps.length > 1 && `${flow.stepIndex + 1} of ${flow.steps.length} · `}
                    {copy.hint}
                  </span>
                  <button
                    type="button"
                    className="shrink-0 font-medium text-foreground underline-offset-4 hover:underline disabled:opacity-50"
                    disabled={flow.busy}
                    onClick={flow.leave}
                  >
                    Cancel
                  </button>
                </>
              ) : (
                flow.plannedSteps && <span>{describeShieldSteps(flow.plannedSteps)}</span>
              )}
            </p>
            {problem}
            {quoteProblem}
          </div>
          {/* The shield in flight: one line, in the same place every time. */}
          {sent && <div className="border-t pt-3">{status("line")}</div>}
        </>
      ) : (
        <AnimatedHeight>
          {running && shown ? (
            <div className="flex flex-col gap-4">
              <ShieldSummary
                amountText={shown.amountText}
                token={shown.token}
                received={flow.active!.quote.received}
                onEdit={flow.leave}
                editDisabled={flow.busy}
              />
              <ShieldStepList steps={flow.steps} symbol={shown.token.symbol} className={enter} />
              <div className="flex flex-col gap-2">
                <Button
                  size="lg"
                  className="h-11 w-full"
                  disabled={flow.busy}
                  aria-busy={flow.busy || undefined}
                  onClick={flow.act}
                >
                  {flow.busy && (
                    <Loader2Icon aria-hidden className="animate-spin motion-reduce:animate-none" />
                  )}
                  <MorphText>{stepLabel}</MorphText>
                </Button>
                {flow.steps.length > 1 && (
                  <p className="text-center text-xs text-muted-foreground">
                    Step {flow.stepIndex + 1} of {flow.steps.length}
                  </p>
                )}
                {problem}
              </div>
            </div>
          ) : following && sent ? (
            <div className="flex flex-col gap-4">
              <ShieldSummary
                amountText={sent.amountText}
                token={sent.token}
                received={sent.quote.received}
              />
              <div className={enter}>{status("card")}</div>
              {/* Never hold the user here: on mainnet the wait is an hour. */}
              <Button
                variant="outline"
                size="lg"
                className="h-11 w-full"
                onClick={() => setFollowing(false)}
              >
                Shield more
              </Button>
            </div>
          ) : (
            <div className={cn("flex flex-col gap-3", enter)}>
              {input}
              {draft && quote && (
                <ShieldQuoteRows
                  quote={quote}
                  amount={draft.amount}
                  token={token}
                  className={enter}
                />
              )}
              <Button
                size="lg"
                className="h-11 w-full"
                disabled={!action}
                onClick={action}
                data-agent-confirm={
                  action && connected
                    ? agentConfirmText(label, "asks your wallet to approve or send a transaction")
                    : undefined
                }
              >
                <MorphText>{label}</MorphText>
              </Button>
              {flow.plannedSteps && (
                <p className="text-center text-xs text-muted-foreground">
                  {describeShieldSteps(flow.plannedSteps)}
                </p>
              )}
              {problem}
              {quoteProblem}
              {/* A shield still in flight stays in view while the next one is typed. */}
              {status("card")}
            </div>
          )}
        </AnimatedHeight>
      )}
      <ConnectWalletDialog open={connectOpen} onOpenChange={setConnectOpen} />
    </div>
  );
}
