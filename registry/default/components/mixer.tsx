// Docs: https://0xui.io/blocks/mixer.md
import { useQuery } from "@tanstack/react-query";
import { Field, FieldLabel } from "@ui-sdk/react/field";
import { Radio, RadioGroup } from "@ui-sdk/react/radio";
import { Textarea } from "@ui-sdk/react/textarea";
import { Loader2Icon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { SkeletonBox } from "skullet/react";
import type { Address, Hash } from "viem";
import { useConfig } from "wagmi";
import { AddressInput } from "@/components/address-input";
import { ConnectWalletDialog } from "@/components/connect-wallet";
import { MorphText } from "@/components/morph-text";
import { NoteBackup } from "@/components/note-backup";
import { Button } from "@/components/primitives/button";
import { Tabs, TabsList, TabsPanel, TabsTab } from "@/components/primitives/tabs";
import { PrivacyBadge } from "@/components/privacy-badge";
import { ProofStep } from "@/components/proof-progress";
import { TokenAmount } from "@/components/token-amount";
import { TransactionStatus } from "@/components/transaction-status";
import { useStore } from "@/hooks/use-store";
import { errorCode } from "@/lib/0xui-utils";
import { tokenBalanceQueryOptions } from "@/lib/balance-core";
import {
  MIXER_SMALL_CROWD,
  createMixerDeposit,
  createMixerNoteLookup,
  createMixerWallet,
  createMixerWithdraw,
  formatMixerAge,
  isMixerWithdrawBusy,
  mixerAllowanceQueryOptions,
  mixerCapabilitiesQueryOptions,
  mixerDepositAction,
  mixerDepositConfirmText,
  mixerDepositPhase,
  mixerNoteView,
  mixerProofHeading,
  mixerQuoteQueryOptions,
  mixerStageMeta,
  mixerStepStates,
  mixerWalletBlocker,
  mixerWithdrawAction,
  mixerWithdrawConfirmText,
  mixerWithdrawRunningAction,
  planMixerDeposit,
} from "@/lib/mixer-core";
import type { MixerDeposited, MixerWithdrawPhase } from "@/lib/mixer-core";
import { MIXER_STAGES, mixerPoolLabel, sameMixerPool } from "@/lib/mixer-engine";
import type {
  MixerEngine,
  MixerPool,
  MixerStage,
  MixerWithdrawVia,
  MixerWithdrawal,
} from "@/lib/mixer-engine";
import { cn } from "@/lib/utils";

export {
  MIXER_SMALL_CROWD,
  createMixerDeposit,
  createMixerNoteLookup,
  createMixerWithdraw,
  formatMixerAge,
  mixerDepositSteps,
  mixerWalletBlocker,
  type MixerDepositPhase,
  type MixerDepositStep,
  type MixerDeposited,
  type MixerWithdrawPhase,
} from "@/lib/mixer-core";

const toError = (cause: unknown) => (cause instanceof Error ? cause : new Error(String(cause)));

/* -------------------------------------------------------------------------- */
/* Deposit                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Runs a deposit: make the note, wait for the user to save it, then the
 * wallet prompts, one click each. The note is made before anything is sent
 * and never changes, so what was backed up is what is deposited. The logic
 * lives in `createMixerDeposit` (framework-free).
 */
export function useMixerDeposit({
  engine,
  pool,
  onSubmitted,
}: {
  engine: MixerEngine;
  /** The pool picked on the form. */
  pool: MixerPool | undefined;
  /** Called with the deposit transaction's hash. For a batch, that is once it is mined. */
  onSubmitted?: (hash: Hash, deposited: MixerDeposited) => void;
}) {
  const config = useConfig();
  // The latest callbacks, for runs that finish after a re-render.
  const latest = useRef({ onSubmitted, refetchAllowance: () => {} });
  latest.current.onSubmitted = onSubmitted;
  const controller = useMemo(
    () =>
      createMixerDeposit(config, engine, {
        onSubmitted: (hash, deposited) => {
          latest.current.refetchAllowance();
          latest.current.onSubmitted?.(hash, deposited);
        },
      }),
    [config, engine],
  );
  const wallet = useMixerWallet();
  const state = useStore(controller);

  const target = state.note?.pool ?? pool;
  const allowance = useQuery(
    mixerAllowanceQueryOptions(config, { pool: target, owner: wallet.address }),
  );
  latest.current.refetchAllowance = () => void allowance.refetch();
  const capabilities = useQuery(
    mixerCapabilitiesQueryOptions(config, {
      pool: target,
      account: wallet.address,
      connected: wallet.connected,
    }),
  );
  const planned = planMixerDeposit({
    pool: target,
    allowance: allowance.data,
    capabilities: capabilities.data,
  });
  const plan = state.frozen ?? planned;
  const phase = mixerDepositPhase(state);

  return {
    phase,
    /** The note being deposited. Undefined before `begin` and after the deposit is sent. */
    note: state.note,
    /** Whether the user confirmed the backup. */
    saved: state.saved,
    setSaved: controller.setSaved,
    /** The wallet prompts the deposit takes. Undefined until the allowance is known. */
    steps: plan?.steps,
    /** The step waiting for a click, or running. */
    step: plan?.steps[state.index],
    /** A wallet prompt is open or a transaction is being mined. */
    busy: state.creating || state.stepPhase !== "ready",
    /** Why the last step didn't go through. Cleared by the next click. */
    problem: state.problem,
    /** Make the note and show it for backup. Sends nothing. */
    begin: () => controller.begin(pool),
    /** Open the wallet for the current step. One click, one prompt. Needs `saved`. */
    send: () => controller.send(planned),
    /** Back to the form. The note is dropped; an approval that was mined stays mined. */
    leave: controller.leave,
  };
}

export type MixerDepositFlow = ReturnType<typeof useMixerDeposit>;

/** The connected wallet, and asking it to switch chains. */
function useMixerWallet() {
  const config = useConfig();
  const controller = useMemo(() => createMixerWallet(config), [config]);
  return { ...useStore(controller), switchChain: controller.switchChain };
}

/** The connected wallet's part of a form: what blocks it on `chainId`, and how to fix that. */
function useWalletGate(chainId: number | undefined) {
  const { chains } = useConfig();
  const wallet = useMixerWallet();
  const [connectOpen, setConnectOpen] = useState(false);
  const blocker =
    chainId === undefined
      ? undefined
      : mixerWalletBlocker({
          address: wallet.address,
          walletChainId: wallet.walletChainId,
          chainId,
          chainName: chains.find((chain) => chain.id === chainId)?.name,
        });
  return {
    address: wallet.address,
    blocker,
    switching: wallet.switching,
    /** Fixes the blocker: opens the wallet picker or asks for the chain switch. */
    fix: (action: "connect" | "switch-chain") => {
      if (action === "connect") {
        setConnectOpen(true);
      } else if (chainId !== undefined) {
        void wallet.switchChain(chainId);
      }
    },
    dialog: <ConnectWalletDialog open={connectOpen} onOpenChange={setConnectOpen} />,
  };
}

const choiceCard =
  "flex min-h-11 cursor-pointer items-center justify-center rounded-lg border px-3 text-sm font-medium transition-colors has-data-checked:border-primary has-data-checked:bg-primary/5 has-data-disabled:cursor-not-allowed has-data-disabled:opacity-60 has-focus-visible:ring-2 has-focus-visible:ring-ring";

const poolKey = (pool: Pick<MixerPool, "chainId" | "address">) => `${pool.chainId}:${pool.address}`;

export type MixerPoolPickerProps = {
  pools: ReadonlyArray<MixerPool>;
  value: MixerPool | undefined;
  onValueChange: (pool: MixerPool) => void;
  disabled?: boolean;
  /** Accessible name of the group. */
  label?: string;
  className?: string;
};

/** The pool amounts as a radio group. One amount per pool: that is what hides a deposit. */
export function MixerPoolPicker({
  pools,
  value,
  onValueChange,
  disabled,
  label = "Amount",
  className,
}: MixerPoolPickerProps) {
  const selected = value && pools.find((pool) => sameMixerPool(pool, value));
  return (
    <Field disabled={disabled} className={cn("flex flex-col gap-1.5", className)}>
      <FieldLabel className="mb-1.5 text-sm font-medium">{label}</FieldLabel>
      <RadioGroup
        value={selected ? poolKey(selected) : ""}
        onValueChange={(next) => {
          const pool = pools.find((candidate) => poolKey(candidate) === next);
          if (pool) {
            onValueChange(pool);
          }
        }}
        disabled={disabled}
        className="grid grid-cols-2 gap-2 sm:grid-cols-3"
      >
        {pools.map((pool) => (
          <label key={poolKey(pool)} className={cn(choiceCard, "tabular-nums")}>
            <Radio value={poolKey(pool)} className="sr-only" />
            {mixerPoolLabel(pool)}
          </label>
        ))}
      </RadioGroup>
    </Field>
  );
}

export type MixerDepositFormProps = {
  engine: MixerEngine;
  /** Chain to deposit on. Defaults to the chain of the engine's first pool. */
  chainId?: number;
  /** Initially picked pool. Defaults to the first on the chain. */
  defaultPool?: MixerPool;
  /** Called with the deposit transaction's hash. It never gets the note. */
  onSubmitted?: (hash: Hash, deposited: MixerDeposited) => void;
  /** Called when the deposit is mined. */
  onConfirmed?: (hash: Hash) => void;
  className?: string;
};

/**
 * Deposit into a pool: pick the amount, save the note, then send. The
 * deposit button stays closed until the note is saved, and it says so.
 */
export function MixerDepositForm({
  engine,
  chainId = engine.pools[0]?.chainId,
  defaultPool,
  onSubmitted,
  onConfirmed,
  className,
}: MixerDepositFormProps) {
  const pools = engine.pools.filter((pool) => pool.chainId === chainId);
  const [pool, setPool] = useState<MixerPool | undefined>(defaultPool ?? pools[0]);
  const [sent, setSent] = useState<{ hash: Hash; chainId: number; label: string }>();
  const config = useConfig();
  const wallet = useWalletGate(pool?.chainId);
  const balance = useQuery(
    tokenBalanceQueryOptions(config, {
      address: wallet.address,
      token: pool?.token,
      chainId: pool?.chainId,
      enabled: Boolean(pool),
    }),
  ).data?.value;

  const flow = useMixerDeposit({
    engine,
    pool,
    onSubmitted: (hash, deposited) => {
      setSent({
        hash,
        chainId: deposited.pool.chainId,
        label: `Deposit ${mixerPoolLabel(deposited.pool)}`,
      });
      onSubmitted?.(hash, deposited);
    },
  });
  const note = flow.note;

  const { label, action: kind } = mixerDepositAction({
    pool,
    walletBlocker: wallet.blocker,
    switching: wallet.switching,
    balance,
    note,
    saved: flow.saved,
    phase: flow.phase,
    busy: flow.busy,
    step: flow.step,
  });
  const action =
    kind === "connect" || kind === "switch-chain"
      ? () => wallet.fix(kind)
      : kind === "begin"
        ? flow.begin
        : kind === "send"
          ? flow.send
          : undefined;
  // What a person confirms before an agent's press sends funds into the pool.
  const agentConfirm =
    kind === "send" && note && (flow.step === "deposit" || flow.step === "batch")
      ? mixerDepositConfirmText(note.pool, flow.step)
      : undefined;

  return (
    <div
      data-slot="mixer-deposit"
      data-phase={flow.phase}
      data-error={flow.problem?.code ?? errorCode(flow.phase)}
      className={cn("flex w-full flex-col gap-3", className)}
    >
      <MixerPoolPicker
        pools={pools}
        value={note?.pool ?? pool}
        onValueChange={setPool}
        // The note is for one pool. Picking another means starting over.
        disabled={Boolean(note) || flow.busy}
      />
      <p className="flex items-center gap-1.5 px-1 text-xs text-muted-foreground">
        <PrivacyBadge privacy="public" />
        The deposit is public. What it hides is which withdrawal belongs to it.
      </p>

      {note && (
        <NoteBackup
          note={note.note}
          saved={flow.saved}
          onSavedChange={flow.setSaved}
          fileName={`note-${mixerPoolLabel(note.pool).replace(" ", "-")}-${note.commitment.slice(2, 10)}.txt`}
        />
      )}

      <div className="flex flex-col gap-2">
        <Button
          size="lg"
          className={cn("h-11 w-full", flow.busy && "disabled:opacity-100")}
          disabled={!action}
          aria-busy={flow.busy || undefined}
          onClick={action}
          data-agent-confirm={agentConfirm}
        >
          {flow.busy && (
            <Loader2Icon aria-hidden className="animate-spin motion-reduce:animate-none" />
          )}
          <MorphText>{label}</MorphText>
        </Button>
        <p className="flex min-h-5 items-center justify-between gap-3 text-xs text-muted-foreground">
          <span role="status">
            {flow.problem?.kind === "cancelled" ? flow.problem.message : ""}
          </span>
          {note && !flow.busy && (
            <Button variant="ghost" size="xs" className="shrink-0 text-xs" onClick={flow.leave}>
              Discard note
            </Button>
          )}
        </p>
        {flow.problem?.kind === "error" && (
          <p role="alert" className="text-sm text-destructive">
            {flow.problem.message}
          </p>
        )}
      </div>

      {sent && (
        <TransactionStatus
          key={sent.hash}
          hash={sent.hash}
          chainId={sent.chainId}
          onConfirmed={() => onConfirmed?.(sent.hash)}
        >
          {sent.label}. Keep the note: it is the only way to withdraw. The longer you wait, the more
          deposits yours hides among.
        </TransactionStatus>
      )}
      {wallet.dialog}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Withdraw                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Reads pasted text as a note and looks its deposit up, once typing pauses.
 * The note stays out of query keys and caches: nothing outlives the hook.
 * The logic lives in `createMixerNoteLookup` (framework-free).
 */
export function useMixerNote(engine: MixerEngine, text: string, { debounce = 300 } = {}) {
  const controller = useMemo(() => createMixerNoteLookup(engine, { debounce }), [engine, debounce]);
  const state = useStore(controller);
  useEffect(() => controller.lookup(text), [controller, text]);
  return { ...mixerNoteView(state, text), refresh: controller.refresh };
}

/**
 * Runs a withdrawal: read the deposits, prove, then send. Through a relayer
 * nothing asks the wallet, and a fee higher than `expected` stops in
 * `review`. From the wallet, the proof stops in `ready` and `send` opens
 * the prompt. The logic lives in `createMixerWithdraw` (framework-free).
 */
export function useMixerWithdraw({
  engine,
  onSubmitted,
}: {
  engine: MixerEngine;
  /** Called with the withdrawal transaction's hash once it is broadcast. */
  onSubmitted?: (hash: Hash, withdrawal: MixerWithdrawal) => void;
}) {
  const config = useConfig();
  // The latest callback, for runs that finish after a re-render.
  const submitted = useRef(onSubmitted);
  submitted.current = onSubmitted;
  const controller = useMemo(
    () =>
      createMixerWithdraw(config, engine, {
        onSubmitted: (hash, withdrawal) => submitted.current?.(hash, withdrawal),
      }),
    [config, engine],
  );
  const state = useStore(controller);
  return {
    ...state,
    /** Why it stopped. `proof` says whether the proof failed, or the send. */
    problem: state.phase === "error" ? state.problem : undefined,
    busy: isMixerWithdrawBusy(state.phase),
    start: controller.start,
    confirm: controller.confirm,
    send: controller.send,
    retry: controller.retry,
    cancel: controller.cancel,
    leave: controller.leave,
  };
}

export type MixerWithdrawFlow = ReturnType<typeof useMixerWithdraw>;

export type MixerProofProgressProps = {
  phase: MixerWithdrawPhase;
  stage?: MixerStage;
  /** Shown when the proof failed. */
  error?: string;
  onCancel?: () => void;
  /** What is being proved, e.g. "Withdraw 0.1 ETH". */
  children?: ReactNode;
  className?: string;
};

/** A withdrawal proof as a list of stages, starting with the read of the pool's deposits. */
export function MixerProofProgress({
  phase,
  stage,
  error,
  onCancel,
  children,
  className,
}: MixerProofProgressProps) {
  const running = phase === "syncing" || phase === "proving";
  const states = mixerStepStates(phase, stage, error !== undefined);
  const heading = mixerProofHeading(phase, states, error !== undefined);
  return (
    <div
      data-slot="mixer-proof-progress"
      data-stage={stage}
      className={cn("flex w-full flex-col gap-3 rounded-xl border p-4 text-sm", className)}
    >
      <div className="flex flex-col gap-1">
        <p role="status" className={cn("font-medium", error !== undefined && "text-destructive")}>
          {heading}
        </p>
        {children && <div className="text-muted-foreground">{children}</div>}
      </div>
      <ol className="flex flex-col gap-2">
        {MIXER_STAGES.map((name) => (
          <ProofStep key={name} state={states[name]} {...mixerStageMeta[name]} />
        ))}
      </ol>
      {error !== undefined && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      {running && onCancel && (
        <div className="flex justify-end border-t pt-3">
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      )}
    </div>
  );
}

/** The time in ms, again every `ms`, so ages written in render stay fresh. */
function useNow(ms: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(timer);
  }, [ms]);
  return now;
}

export type MixerWithdrawFormProps = {
  engine: MixerEngine;
  /** Called with the withdrawal transaction's hash once it is broadcast. */
  onSubmitted?: (hash: Hash, withdrawal: MixerWithdrawal) => void;
  /** Called when the withdrawal is mined. */
  onConfirmed?: (hash: Hash) => void;
  className?: string;
};

/**
 * Withdraw a deposit with its note: paste the note, see the deposit it
 * belongs to, pick who gets the funds and who sends the transaction, then
 * prove and send. Through a relayer no wallet is needed at all.
 */
export function MixerWithdrawForm({
  engine,
  onSubmitted,
  onConfirmed,
  className,
}: MixerWithdrawFormProps) {
  const [noteText, setNoteText] = useState("");
  const [recipientText, setRecipientText] = useState("");
  const [recipient, setRecipient] = useState<Address>();
  const [via, setVia] = useState<MixerWithdrawVia>(engine.relays ? "relayer" : "wallet");
  const now = useNow(60_000);
  const [sent, setSent] = useState<{ hash: Hash; chainId: number; label: string }>();

  const lookup = useMixerNote(engine, noteText);
  const { note, deposit } = lookup;
  const pool = note?.pool;
  const wallet = useWalletGate(via === "wallet" ? pool?.chainId : undefined);

  const quoted = useQuery(mixerQuoteQueryOptions(engine, pool, via));
  const quote = pool ? quoted.data : undefined;

  const flow = useMixerWithdraw({
    engine,
    onSubmitted: (hash, withdrawal) => {
      setSent({
        hash,
        chainId: withdrawal.pool.chainId,
        label: `Withdraw ${mixerPoolLabel(withdrawal.pool)}`,
      });
      // The note is spent once this is mined. Don't leave it on screen.
      setNoteText("");
      onSubmitted?.(hash, withdrawal);
    },
  });
  const running = flow.active !== undefined;
  const amount = pool ? mixerPoolLabel(pool) : "";

  const form = mixerWithdrawAction({
    text: noteText,
    note,
    deposit,
    lookupError: lookup.error,
    lookupLoading: lookup.isLoading,
    recipient,
    via,
    walletBlocker: wallet.blocker,
    switching: wallet.switching,
    quoteFailed: Boolean(quoted.error),
    quote,
  });
  const live = mixerWithdrawRunningAction({
    phase: flow.phase,
    withdrawal: flow.withdrawal,
    problem: flow.problem,
    walletBlocker: wallet.blocker,
    switching: wallet.switching,
  });
  const { label, action: kind } = running ? live : form;
  const action =
    kind === "connect" || kind === "switch-chain"
      ? () => wallet.fix(kind)
      : kind === "refresh"
        ? lookup.refresh
        : kind === "start"
          ? note && recipient && quote
            ? () => flow.start({ note: note.note, recipient, via }, quote)
            : undefined
          : kind === "confirm"
            ? flow.confirm
            : kind === "send"
              ? flow.send
              : kind === "retry"
                ? flow.retry
                : undefined;
  // What a person confirms before an agent's press starts or sends a withdrawal.
  const confirmQuote = flow.withdrawal?.quote ?? quote;
  const agentConfirm =
    (kind === "start" || kind === "send") && pool && recipient && confirmQuote
      ? mixerWithdrawConfirmText({
          pool,
          recipient: flow.withdrawal?.recipient ?? recipient,
          quote: confirmQuote,
          via: flow.withdrawal?.via ?? via,
        })
      : undefined;
  // While a withdrawal runs, the quote it started with; `active` is set exactly then.
  const shownQuote = flow.withdrawal?.quote ?? flow.active?.expected ?? quote;
  const value = (raw: bigint) =>
    pool && (
      <TokenAmount value={raw} decimals={pool.decimals} symbol={pool.symbol} maxDecimals={6} />
    );

  return (
    <div
      data-slot="mixer-withdraw"
      data-phase={flow.phase}
      data-error={flow.problem?.code ?? errorCode(flow.phase)}
      className={cn("flex w-full flex-col gap-3", className)}
    >
      {/* The form never moves. It only stops taking input while a withdrawal runs. */}
      <div
        inert={running}
        className={cn(
          "flex flex-col gap-3 transition-opacity duration-200",
          running && "opacity-60",
        )}
      >
        <Field data-agent-secret="" className="flex flex-col gap-1.5">
          <FieldLabel className="text-sm font-medium">Note</FieldLabel>
          <Textarea
            rows={3}
            // A note must never reach a spell checker, an autofill store or a translator.
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            translate="no"
            data-1p-ignore
            data-lpignore="true"
            placeholder="Paste the note you saved when you deposited"
            value={noteText}
            onValueChange={setNoteText}
            aria-invalid={Boolean(!note && lookup.error) || undefined}
            className="w-full resize-none rounded-lg border bg-transparent p-3 font-mono text-xs break-all outline-none focus-visible:ring-2 focus-visible:ring-ring aria-invalid:border-destructive"
          />
          <p role="status" className="min-h-5 px-1 text-xs text-muted-foreground">
            {!noteText.trim() ? (
              "Whoever has the note can withdraw. Nothing is sent while you paste."
            ) : lookup.error ? (
              <span className="text-destructive">{lookup.error.message}</span>
            ) : !deposit ? (
              <>
                <SkeletonBox
                  width="28ch"
                  height="1em"
                  style={{ display: "inline-block", verticalAlign: "middle" }}
                />
                <span className="sr-only">Looking up the deposit</span>
              </>
            ) : deposit.state === "missing" ? (
              `No ${amount} deposit was found for this note. A new deposit shows up once it is mined.`
            ) : deposit.state === "withdrawn" ? (
              `This ${amount} note was already withdrawn.`
            ) : (
              [
                amount,
                deposit.timestamp !== undefined &&
                  `deposited ${formatMixerAge(now / 1000 - deposit.timestamp)}`,
                deposit.depositsSince !== undefined &&
                  `${deposit.depositsSince.toLocaleString("en-US")} deposits since`,
              ]
                .filter(Boolean)
                .join(" · ")
            )}
          </p>
          {deposit?.state === "deposited" &&
            deposit.depositsSince !== undefined &&
            deposit.depositsSince < MIXER_SMALL_CROWD && (
              <p role="note" className="rounded-lg bg-amber-500/10 p-3 text-xs">
                Few deposits came after yours, so this withdrawal would be easy to link to it.
                Waiting makes it harder.
              </p>
            )}
        </Field>

        <div className="flex flex-col gap-1.5">
          {/* The input names itself for assistive technology. This is the visible label. */}
          <p aria-hidden className="text-sm font-medium">
            Recipient
          </p>
          <AddressInput
            label="Recipient"
            value={recipientText}
            onValueChange={(next) => {
              setRecipientText(next);
              // Never keep sending to an address the field no longer shows.
              setRecipient(undefined);
            }}
            onResolve={(state) => setRecipient(state.address)}
          />
          <p className="px-1 text-xs text-muted-foreground">
            Use an address with no public link to the one that deposited.
          </p>
        </div>

        <Field className="flex flex-col gap-1.5">
          <FieldLabel className="mb-1.5 text-sm font-medium">Sent by</FieldLabel>
          <RadioGroup
            value={via}
            onValueChange={(next) => {
              if (next === "relayer" || next === "wallet") {
                setVia(next);
              }
            }}
            className="grid grid-cols-2 gap-2"
          >
            {(["relayer", "wallet"] as const).map((option) => (
              <label key={option} className={choiceCard}>
                <Radio
                  value={option}
                  disabled={option === "relayer" && !engine.relays}
                  className="sr-only"
                />
                {option === "relayer" ? "A relayer" : "My wallet"}
              </label>
            ))}
          </RadioGroup>
          <p className="min-h-8 px-1 text-xs text-muted-foreground">
            {via === "relayer"
              ? "A relayer sends the transaction and keeps a fee. No wallet is needed, and the recipient needs no gas."
              : "Your wallet sends the transaction and pays the gas in public. Anyone can see that wallet next to the recipient."}
          </p>
        </Field>
      </div>

      <dl
        className={cn(
          "flex flex-col gap-1.5 rounded-xl border p-3 text-sm transition-opacity duration-200",
          !shownQuote && "opacity-50",
        )}
      >
        <div className="flex items-center justify-between gap-3">
          <dt className="text-muted-foreground">{via === "relayer" ? "Relayer fee" : "Fee"}</dt>
          <dd>{shownQuote ? value(shownQuote.fee) : "—"}</dd>
        </div>
        <div className="flex items-center justify-between gap-3">
          <dt className="flex items-center gap-2 text-muted-foreground">
            Recipient gets <PrivacyBadge privacy="public" />
          </dt>
          <dd className="font-medium">{shownQuote ? value(shownQuote.received) : "—"}</dd>
        </div>
      </dl>

      {running && (
        <MixerProofProgress
          phase={flow.phase}
          stage={flow.stage}
          error={flow.problem?.proof ? flow.problem.message : undefined}
          onCancel={flow.cancel}
        >
          {`Withdraw ${amount}`}
        </MixerProofProgress>
      )}

      <div className="flex flex-col gap-2">
        {flow.phase === "review" && (
          <p role="status" className="text-sm">
            The relayer's fee went up while the proof was made. Check the amounts above.
          </p>
        )}
        <Button
          size="lg"
          className={cn("h-11 w-full", flow.busy && "disabled:opacity-100")}
          disabled={!action}
          aria-busy={flow.busy || undefined}
          onClick={action}
          data-agent-confirm={agentConfirm}
        >
          {flow.busy && (
            <Loader2Icon aria-hidden className="animate-spin motion-reduce:animate-none" />
          )}
          <MorphText>{label}</MorphText>
        </Button>
        <p className="flex min-h-5 items-center justify-between gap-3 text-xs text-muted-foreground">
          <span role="status">
            {flow.phase === "cancelled" && flow.withdrawal ? "Cancelled in wallet." : ""}
          </span>
          {running && !flow.busy && (
            <Button variant="ghost" size="xs" className="shrink-0 text-xs" onClick={flow.leave}>
              Back
            </Button>
          )}
        </p>
        {flow.problem && !flow.problem.proof && (
          <p role="alert" className="text-sm text-destructive">
            {flow.problem.message}
          </p>
        )}
        {!running && quoted.error && pool && (
          <p role="alert" className="text-sm text-destructive">
            {toError(quoted.error).message}
          </p>
        )}
      </div>

      {sent && (
        <TransactionStatus
          key={sent.hash}
          hash={sent.hash}
          chainId={sent.chainId}
          onConfirmed={() => onConfirmed?.(sent.hash)}
        >
          {sent.label}
        </TransactionStatus>
      )}
      {wallet.dialog}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Block                                                                      */
/* -------------------------------------------------------------------------- */

export type MixerProps = {
  /** The mixer to use: the mock engine, or one for real pools. */
  engine: MixerEngine;
  /** Chain to deposit on. Defaults to the chain of the engine's first pool. A withdrawal follows its note. */
  chainId?: number;
  /** Initially picked pool. Defaults to the first on the chain. */
  defaultPool?: MixerPool;
  /** The tab shown first. */
  defaultTab?: "deposit" | "withdraw";
  /** Called with the deposit transaction's hash. It never gets the note. */
  onDeposited?: (hash: Hash, deposited: MixerDeposited) => void;
  /** Called with the withdrawal transaction's hash once it is broadcast. */
  onWithdrawn?: (hash: Hash, withdrawal: MixerWithdrawal) => void;
  /** Heading. Pass null to hide. */
  title?: ReactNode;
  className?: string;
};

/**
 * A note-based mixer in two tabs. Deposit: pick one of the pool's fixed
 * amounts, save the note it makes, send. Withdraw: paste the note, pick a
 * recipient, prove in the tab, and send through a relayer or the wallet.
 * The note is the money: it is shown once, gated behind a backup, and never
 * stored or passed to a callback. Both tabs stay mounted, so switching
 * loses nothing.
 */
export function Mixer({
  engine,
  chainId,
  defaultPool,
  defaultTab = "deposit",
  onDeposited,
  onWithdrawn,
  title = "Mixer",
  className,
}: MixerProps) {
  return (
    <div data-slot="mixer" className={cn("flex w-full max-w-md flex-col gap-3", className)}>
      {title && <h3 className="text-lg font-semibold">{title}</h3>}
      <Tabs defaultValue={defaultTab}>
        <TabsList className="w-full">
          <TabsTab value="deposit">Deposit</TabsTab>
          <TabsTab value="withdraw">Withdraw</TabsTab>
        </TabsList>
        <TabsPanel value="deposit" keepMounted>
          <MixerDepositForm
            engine={engine}
            chainId={chainId}
            defaultPool={defaultPool}
            onSubmitted={onDeposited}
          />
        </TabsPanel>
        <TabsPanel value="withdraw" keepMounted>
          <MixerWithdrawForm engine={engine} onSubmitted={onWithdrawn} />
        </TabsPanel>
      </Tabs>
    </div>
  );
}
