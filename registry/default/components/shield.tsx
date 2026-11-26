// Docs: https://0xui.io/blocks/shield.md
import { useQuery } from "@tanstack/react-query";
import { Loader2Icon } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { Hash } from "viem";
import { useConfig } from "wagmi";
import { ConnectWalletDialog } from "@/components/connect-wallet";
import { MorphText } from "@/components/morph-text";
import { Button } from "@/components/primitives/button";
import { PrivacyBadge } from "@/components/privacy-badge";
import { useShieldedAccount, useShieldedEngine } from "@/components/shielded-provider";
import { ShieldedTransactionStatus, formatWait } from "@/components/shielded-transaction-status";
import { TokenAmount } from "@/components/token-amount";
import { TokenInput } from "@/components/token-input";
import type { TokenInputState } from "@/components/token-input";
import type { Token, TokenPrices } from "@/components/token-select";
import { StepIcon } from "@/components/transaction-status";
import { useStore } from "@/hooks/use-store";
import { errorCode } from "@/lib/0xui-utils";
import {
  createShieldFlow,
  describeShieldSteps,
  formatFeePercent,
  isAtomic,
  planShield,
  shieldAllowanceQueryOptions,
  shieldBlocker,
  shieldConfirmText,
  shieldFormAction,
  shieldPhase,
  shieldQuoteQueryOptions,
  shieldStepCopy,
  shieldStepConfirmText,
  shieldStepLabel,
  shieldStepStates,
  shieldSteps,
  walletCapabilitiesQueryOptions,
} from "@/lib/shield-core";
import type { ShieldPhase, ShieldStepKind, ShieldStepPhase } from "@/lib/shield-core";
import type { ShieldDraft, ShieldQuote, ShieldedTransaction } from "@/lib/shielded-engine";
import { cn } from "@/lib/utils";

export {
  describeShieldSteps,
  formatFeePercent,
  shieldBlocker,
  shieldConfirmText,
  shieldStepConfirmText,
  shieldStepCopy,
  shieldSteps,
  type ShieldPhase,
  type ShieldStepKind,
  type ShieldStepPhase,
};

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
  const query = useQuery(
    shieldQuoteQueryOptions(
      engine,
      draft && amount !== undefined ? { ...draft, amount } : undefined,
      {
        enabled: settled,
      },
    ),
  );
  return {
    quote: draft && settled ? query.data : undefined,
    isLoading: Boolean(draft) && (!settled || query.isPending),
    error: draft && settled ? query.error : null,
  };
}

/**
 * Runs a shield as a list of wallet steps, one click each: the signature
 * the engine needs, the approval, the shield. Approval and shield go out as
 * one atomic batch (EIP-5792) when the wallet reports that as "supported".
 *
 * The steps are known before anything starts, from the quote, the allowance
 * and the wallet's capabilities. `start` freezes them together with the
 * draft, so what is sent is what was on screen when the user began. The
 * logic lives in `createShieldFlow` (framework-free).
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
  // The latest callbacks, for runs that finish after a re-render.
  const latest = useRef({ onSubmitted, refetchAllowance: () => {} });
  latest.current.onSubmitted = onSubmitted;
  const controller = useMemo(
    () =>
      createShieldFlow(config, engine, {
        onSubmitted: (hash, shield) => {
          latest.current.refetchAllowance();
          latest.current.onSubmitted?.(hash, shield);
        },
      }),
    [config, engine],
  );
  const state = useStore(controller);

  const allowance = useQuery(
    shieldAllowanceQueryOptions(config, { draft, owner: state.account, spender: quote?.spender }),
  );
  latest.current.refetchAllowance = () => void allowance.refetch();
  const capabilities = useQuery(
    walletCapabilitiesQueryOptions(config, {
      chainId: draft?.chainId,
      account: state.account,
      connector: state.connector,
      enabled: Boolean(draft) && state.connected,
    }),
  );

  const planned = planShield({
    draft,
    quote,
    allowance: allowance.data,
    atomic: isAtomic(capabilities.data),
  });
  const { active, index, stepPhase } = state;

  return {
    /** The wallet prompts the form's shield would take. Undefined until the quote and allowance are known. */
    plannedSteps: planned?.steps,
    /** The shield in progress, frozen at `start`. Undefined while on the form. */
    active: active && { draft: active.draft, quote: active.quote },
    /** The steps of the shield in progress, with where each one is. */
    steps: shieldStepStates(state),
    /** The step waiting for a click, or running. */
    step: active?.steps[index],
    stepIndex: index,
    stepPhase,
    /** A wallet prompt is open or a transaction is pending. */
    busy: Boolean(active) && stepPhase !== "ready",
    /** Why the last step didn't go through: a dismissed prompt, or an error. Cleared by the next click. */
    problem: state.problem,
    /** The form's phase, for `data-phase`. */
    phase: shieldPhase(state),
    /** The connected wallet: whether there is one, and its chain. */
    wallet: { connected: state.connected, chainId: state.walletChainId },
    /** A network switch is waiting on the wallet. */
    switching: state.switching,
    /**
     * Leave the form and open the first wallet prompt. The click that starts
     * the shield is the click for its first step.
     */
    start: () => {
      if (draft && quote && planned) {
        controller.start({ draft, quote, ...planned });
      }
    },
    /** Open the wallet for the current step. One click, one prompt. */
    act: controller.act,
    /** Back to the form. Anything already mined (an approval) stays mined. */
    leave: controller.leave,
    /** Ask the wallet to move to another network. */
    switchChain: controller.switchChain,
  };
}

export type ShieldFlow = ReturnType<typeof useShieldFlow>;

const enter =
  "animate-in fade-in-0 slide-in-from-bottom-1 duration-200 ease-out motion-reduce:animate-none";

/** Animates its own height as the content inside it changes. */
function AnimatedHeight({ children }: { children: ReactNode }) {
  const inner = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number>();
  useLayoutEffect(() => {
    const element = inner.current;
    if (!element) {
      return;
    }
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
          Edit <span className="sr-only">shield</span>
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
  tokens: ReadonlyArray<Token>;
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
  popular?: ReadonlyArray<string>;
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
  const account = useShieldedAccount();
  const { chains } = useConfig();
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

  const connected = flow.wallet.connected;
  const wrongChain = connected && flow.wallet.chainId !== chainId;
  const chainName = chains.find((c) => c.id === chainId)?.name ?? "the right network";
  const running = flow.active !== undefined;
  const shown = started.current;
  const phase = flow.phase;

  // The form's button: names the blocker, or starts the shield.
  const form = shieldFormAction({
    connected,
    blocker,
    wrongChain,
    switching: flow.switching,
    chainName,
    quoteFailed: Boolean(quoteError),
    quoting,
    planned: flow.plannedSteps !== undefined,
    symbol: token?.symbol,
  });
  const label = form.label;
  const action =
    form.action === "connect"
      ? () => setConnectOpen(true)
      : form.action === "switch"
        ? () => void flow.switchChain(chainId)
        : form.action === "start"
          ? () => {
              started.current = { amountText, token: token! };
              flow.start();
            }
          : undefined;

  // The button of the step in progress.
  const copy = flow.step && shown ? shieldStepCopy(flow.step, shown.token.symbol) : undefined;
  const stepLabel =
    flow.step && shown && shieldStepLabel(flow.step, flow.stepPhase, shown.token.symbol);

  // What a person confirms before an agent's press opens the wallet. Opening
  // the wallet picker needs no one: its wallets ask on their own.
  const formConfirm =
    form.action === "switch"
      ? `Asks your wallet to switch to ${chainName}`
      : form.action === "start" && draft && quote && flow.plannedSteps && token
        ? shieldConfirmText({
            amount: draft.amount,
            token,
            quote,
            steps: flow.plannedSteps,
            chainName,
          })
        : undefined;
  const stepConfirm =
    flow.step && flow.active && shown
      ? shieldStepConfirmText(flow.step, { amount: flow.active.draft.amount, token: shown.token })
      : undefined;

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
                flow.busy && "aria-disabled:opacity-100",
              )}
              disabled={running ? flow.busy : !action}
              // Keeps focus on the button while it steps through the wallet prompts.
              focusableWhenDisabled={running}
              aria-busy={flow.busy || undefined}
              onClick={running ? flow.act : action}
              data-agent-confirm={running ? stepConfirm : formConfirm}
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
                  <Button
                    variant="link"
                    // Reads as a text link inside the hint line.
                    className="h-auto border-0 p-0 text-xs text-foreground active:not-aria-[haspopup]:translate-y-0"
                    disabled={flow.busy}
                    onClick={flow.leave}
                  >
                    Cancel <span className="sr-only">shield</span>
                  </Button>
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
                  className={cn("h-11 w-full", flow.busy && "aria-disabled:opacity-100")}
                  disabled={flow.busy}
                  focusableWhenDisabled
                  aria-busy={flow.busy || undefined}
                  onClick={flow.act}
                  data-agent-confirm={stepConfirm}
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
                data-agent-confirm={formConfirm}
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
