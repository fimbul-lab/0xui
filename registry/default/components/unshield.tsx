// Docs: https://0xui.io/blocks/unshield.md
import { useQuery } from "@tanstack/react-query";
import { Loader2Icon } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { formatUnits, parseUnits, zeroAddress, type Address, type Hash } from "viem";
import { useConnection } from "wagmi";
import { AddressInput } from "@/components/address-input";
import { MorphText } from "@/components/morph-text";
import { PrivacyBadge } from "@/components/privacy-badge";
import { ProofProgress, useProof } from "@/components/proof-progress";
import { useShieldedBalance } from "@/components/shielded-balance";
import { useShieldedAccount, useShieldedEngine } from "@/components/shielded-provider";
import { formatFeePercent } from "@/components/shield";
import { TokenAmount } from "@/components/token-amount";
import { TokenInput } from "@/components/token-input";
import type { Token, TokenPrices } from "@/components/token-select";
import { TransactionStatus } from "@/components/transaction-status";
import { Button } from "@/components/ui/button";
import { agentConfirmText, errorCode } from "@/lib/0xui-utils";
import type {
  PrivateQuote,
  ProvedOperation,
  ShieldedAccountStatus,
  UnshieldDraft,
} from "@/lib/shielded-engine";
import { cn } from "@/lib/utils";

/** What the block is doing. No phase waits on a wallet: an unshield has no wallet prompt. */
export type UnshieldPhase =
  | "idle"
  /** The proof is being made in this tab. */
  | "proving"
  /** The proof is ready, but its fee is higher than the one shown. Waiting for a yes. */
  | "review"
  /** The proof is on its way to the network. */
  | "submitting"
  | "cancelled"
  | "error";

function useDebounced<T>(value: T, delay: number) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

/** An unshield before its recipient is known. Enough to ask the price. */
export type UnshieldAmount = Pick<UnshieldDraft, "chainId" | "token" | "amount">;

/**
 * Fee and amount received for an unshield, from the engine. Waits for typing
 * to pause. The price does not depend on the recipient, so it can be shown
 * before one is entered. `quote` is undefined while it doesn't match.
 */
export function useUnshieldQuote(draft: UnshieldAmount | undefined, { debounce = 300 } = {}) {
  const engine = useShieldedEngine();
  const amount = useDebounced(draft?.amount, debounce);
  const settled = amount === draft?.amount;
  const query = useQuery({
    queryKey: ["0xui", "unshield-quote", engine.id, draft?.chainId, draft?.token, amount?.toString()],
    queryFn: () =>
      engine.quote({ kind: "unshield", ...draft!, amount: amount!, recipient: zeroAddress }),
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

const toError = (cause: unknown) => (cause instanceof Error ? cause : new Error(String(cause)));

/**
 * Runs an unshield: prove, then submit. Nothing asks the wallet.
 *
 * The proof commits to its own fee, which can differ from the one quoted
 * while typing. A fee that is no higher is submitted at once. A higher one
 * stops in `review` until `confirm` is called.
 */
export function useUnshieldFlow({
  onSubmitted,
}: {
  /** Called with the transaction's hash once it is broadcast. */
  onSubmitted?: (hash: Hash, operation: ProvedOperation) => void;
} = {}) {
  const engine = useShieldedEngine();
  const proof = useProof();
  const [active, setActive] = useState<{ draft: UnshieldDraft; expected: PrivateQuote }>();
  const [review, setReview] = useState<ProvedOperation>();
  const [submitting, setSubmitting] = useState(false);
  const [failure, setFailure] = useState<Error>();

  // Bumped whenever the flow is left. Work from an older run stops when it notices.
  const run = useRef(0);
  useEffect(() => () => void run.current++, []);
  // The latest callback, for runs that finish after a re-render.
  const submitted = useRef(onSubmitted);
  submitted.current = onSubmitted;

  const submit = async (operation: ProvedOperation, id: number) => {
    setReview(undefined);
    setSubmitting(true);
    try {
      const { hash } = await engine.submit(operation);
      if (run.current !== id) return;
      setActive(undefined);
      proof.reset();
      submitted.current?.(hash, operation);
    } catch (cause) {
      if (run.current === id) setFailure(toError(cause));
    } finally {
      if (run.current === id) setSubmitting(false);
    }
  };

  const start = async (draft: UnshieldDraft, expected: PrivateQuote) => {
    const id = ++run.current;
    setActive({ draft, expected });
    setReview(undefined);
    setFailure(undefined);
    const operation = await proof.prove(draft);
    if (!operation || run.current !== id) return;
    if (operation.quote.fee > expected.fee) setReview(operation);
    else await submit(operation, id);
  };

  const error = failure ?? proof.error;
  const phase: UnshieldPhase = submitting
    ? "submitting"
    : review
      ? "review"
      : failure || proof.phase === "error"
        ? "error"
        : proof.isProving
          ? "proving"
          : proof.phase === "cancelled"
            ? "cancelled"
            : "idle";

  return {
    phase,
    /** The unshield in progress, frozen at `start`. Undefined while on the form. */
    active,
    /** The proof's own state, for ProofProgress. */
    proof: { phase: proof.phase, stage: proof.stage, error: proof.error },
    /** The proved operation waiting for a yes, when its fee went up. */
    review,
    /** Why it stopped. Set when `phase` is "error". */
    error: phase === "error" ? error : undefined,
    /** The proof is running or being sent. */
    busy: phase === "proving" || phase === "submitting",
    /** Prove `draft` and submit it. `expected` is the quote on screen. */
    start: (draft: UnshieldDraft, expected: PrivateQuote) => void start(draft, expected),
    /** Accept the higher fee and submit. */
    confirm: () => {
      if (review) void submit(review, run.current);
    },
    /** Prove again after an error or a cancel. */
    retry: () => {
      if (active && !submitting) void start(active.draft, active.expected);
    },
    /** Stop the proof. */
    cancel: proof.cancel,
    /** Back to the form. A proof that was not submitted is dropped. */
    leave: () => {
      run.current++;
      proof.reset();
      setActive(undefined);
      setReview(undefined);
      setSubmitting(false);
      setFailure(undefined);
    },
  };
}

export type UnshieldFlow = ReturnType<typeof useUnshieldFlow>;

/**
 * Why the unshield can't start yet, as button text, or undefined when it
 * can. Order matches how people get there: account, token, amount, balance,
 * recipient.
 */
export function unshieldBlocker({
  accountStatus,
  token,
  amount,
  spendable,
  recipient,
}: {
  accountStatus: ShieldedAccountStatus;
  token: Pick<Token, "symbol"> | undefined;
  amount: bigint | undefined;
  /** The token's spendable private balance. Undefined until the first scan finishes. */
  spendable: bigint | undefined;
  recipient: Address | undefined;
}) {
  if (accountStatus === "none") return "Create a private account first";
  if (accountStatus === "locked") return "Unlock your private account";
  if (!token) return "Select a token";
  if (!amount) return "Enter an amount";
  if (spendable === undefined) return "Scanning private balance…";
  if (amount > spendable) return `Insufficient private ${token.symbol}`;
  if (!recipient) return "Enter a recipient";
  return undefined;
}

type TokenLabel = Pick<Token, "symbol" | "decimals">;

export type UnshieldQuoteRowsProps = {
  /** Leave undefined to hold the space with placeholders. */
  quote: PrivateQuote | undefined;
  /** Amount the quote is for. */
  amount: bigint | undefined;
  token: TokenLabel | undefined;
  className?: string;
};

/** Fee and what the recipient gets: what the user agrees to before the proof. */
export function UnshieldQuoteRows({ quote, amount, token, className }: UnshieldQuoteRowsProps) {
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
          Recipient gets <PrivacyBadge privacy="public" />
        </dt>
        <dd className="font-medium">{quote ? value(quote.received) : "—"}</dd>
      </div>
    </dl>
  );
}

function parseAmount(text: string, decimals: number) {
  try {
    return text ? parseUnits(text, decimals) : undefined;
  } catch {
    return undefined;
  }
}

export type UnshieldProps = {
  /** Tokens the user can unshield. Only those on `chainId` are offered. */
  tokens: readonly Token[];
  /** Chain to unshield on. */
  chainId: number;
  /** Initially selected token. Defaults to the first on `chainId`. */
  defaultToken?: Token;
  /** Symbols or addresses for quick picks. */
  popular?: readonly string[];
  /** Prices keyed by `chainId:address`, address or symbol, for the fiat line. */
  prices?: TokenPrices;
  /** Called with the transaction's hash once it is broadcast. */
  onSubmitted?: (hash: Hash, draft: UnshieldDraft) => void;
  /** Called when the transaction is mined. The block has already asked the engine to scan. */
  onConfirmed?: (hash: Hash) => void;
  /** Heading. Pass null to hide. */
  title?: ReactNode;
  className?: string;
};

/**
 * Unshield form: move a token from the private balance to a public address.
 * Shows the private balance, the fee and what the recipient gets, then makes
 * the proof in the tab, stage by stage, and submits it. No wallet prompt and
 * no connected wallet needed: the engine sends it. If the proof's fee comes
 * out higher than the one shown, it asks before sending. Afterwards it
 * follows the transaction and has the engine scan once it is mined. The
 * button names whatever is missing.
 */
export function Unshield({
  tokens,
  chainId,
  defaultToken,
  popular,
  prices,
  onSubmitted,
  onConfirmed,
  title = "Unshield",
  className,
}: UnshieldProps) {
  const engine = useShieldedEngine();
  const account = useShieldedAccount();
  const connection = useConnection();
  const onChain = tokens.filter((t) => t.chainId === chainId);

  const [token, setToken] = useState<Token | undefined>(defaultToken ?? onChain[0]);
  const [amountText, setAmountText] = useState("");
  const [recipientText, setRecipientText] = useState("");
  const [recipient, setRecipient] = useState<Address>();
  /** The unshield being followed after it was sent. */
  const [sent, setSent] = useState<{ hash: Hash; label: string }>();
  // What was typed and picked when the unshield started.
  const started = useRef<{ amountText: string; token: Token }>(undefined);

  const balance = useShieldedBalance({ chainId, token: token?.address ?? zeroAddress });
  const spendable = token ? balance.spendable : undefined;
  const amount = token ? parseAmount(amountText, token.decimals) : undefined;

  const blocker = unshieldBlocker({
    accountStatus: account.status,
    token,
    amount,
    spendable,
    recipient,
  });
  // The price is asked as soon as the amount fits, before the recipient is in.
  const priced =
    token && amount && spendable !== undefined && amount <= spendable
      ? { chainId, token: token.address, amount }
      : undefined;
  const { quote, isLoading: quoting, error: quoteError } = useUnshieldQuote(priced);

  const flow = useUnshieldFlow({
    onSubmitted: (hash, operation) => {
      const from = started.current!;
      setSent({ hash, label: `Unshield ${from.amountText} ${from.token.symbol}` });
      setAmountText("");
      onSubmitted?.(hash, operation.draft);
    },
  });
  const running = flow.active !== undefined;
  const shown = started.current;

  let label: string;
  let action: (() => void) | undefined;
  if (blocker) {
    label = blocker;
  } else if (quoteError) {
    label = "Can't unshield this amount";
  } else if (quoting || !quote) {
    label = "Fetching quote…";
  } else {
    label = `Unshield ${token!.symbol}`;
    action = () => {
      started.current = { amountText, token: token! };
      flow.start({ kind: "unshield", ...priced!, recipient: recipient! }, quote);
    };
  }

  const runningLabel =
    flow.phase === "submitting"
      ? "Sending…"
      : flow.phase === "review"
        ? "Unshield at the new fee"
        : flow.phase === "proving"
          ? "Generating proof…"
          : "Try again";

  return (
    <div
      data-slot="unshield"
      data-phase={flow.phase}
      data-error={errorCode(flow.phase, flow.error)}
      className={cn("flex w-full max-w-md flex-col gap-3", className)}
    >
      {title && <h3 className="text-lg font-semibold">{title}</h3>}

      {/* The form never moves. It only stops taking input while an unshield runs. */}
      <div
        inert={running}
        className={cn(
          "flex flex-col gap-3 transition-opacity duration-200",
          running && "opacity-60",
        )}
      >
        <div className="flex flex-col gap-1.5">
          <TokenInput
            label="Amount to unshield"
            value={amountText}
            onValueChange={setAmountText}
            token={token}
            onTokenChange={(next) => {
              setToken(next);
              setAmountText("");
            }}
            tokens={onChain.length > 1 ? onChain : undefined}
            popular={popular}
            prices={prices}
            // The wallet's balance is not what is being spent.
            checkBalance={false}
          />
          <p className="flex min-h-5 items-center justify-between gap-3 px-1 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <PrivacyBadge privacy="private" />
              {token && spendable !== undefined ? (
                <span>
                  <TokenAmount
                    value={spendable}
                    decimals={token.decimals}
                    symbol={token.symbol}
                    maxDecimals={6}
                  />{" "}
                  spendable
                </span>
              ) : (
                <span>{account.status === "unlocked" ? "Scanning…" : "Locked"}</span>
              )}
            </span>
            {token && Boolean(spendable) && (
              <button
                type="button"
                className="font-medium text-foreground underline-offset-4 hover:underline"
                onClick={() => setAmountText(formatUnits(spendable!, token.decimals))}
              >
                Max
              </button>
            )}
          </p>
        </div>

        <div className="flex flex-col gap-1.5">
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
          {connection.address && !recipientText && (
            <button
              type="button"
              className="self-start px-1 text-xs font-medium underline-offset-4 hover:underline"
              onClick={() => setRecipientText(connection.address!)}
            >
              Use my wallet
            </button>
          )}
        </div>
      </div>

      <UnshieldQuoteRows
        quote={flow.review?.quote ?? (running ? flow.active!.expected : quote)}
        amount={running ? flow.active!.draft.amount : priced?.amount}
        token={running ? shown?.token : token}
        // Space is held for the quote, so nothing below shifts as it arrives.
        className={cn("transition-opacity duration-200", !running && !quote && "opacity-50")}
      />

      {running && (
        <ProofProgress
          phase={flow.review || flow.phase === "submitting" ? "done" : flow.proof.phase}
          stage={flow.proof.stage}
          error={flow.proof.error}
          onCancel={flow.cancel}
        >
          {shown && `Unshield ${shown.amountText} ${shown.token.symbol}`}
        </ProofProgress>
      )}

      <div className="flex flex-col gap-2">
        {flow.phase === "review" && (
          <p role="status" className="text-sm">
            The fee went up while the proof was made. Check the amounts above.
          </p>
        )}
        <Button
          size="lg"
          className={cn("h-11 w-full", flow.busy && "disabled:opacity-100")}
          disabled={running ? flow.busy : !action}
          aria-busy={flow.busy || undefined}
          onClick={running ? (flow.phase === "review" ? flow.confirm : flow.retry) : action}
          data-agent-confirm={
            !running && action
              ? agentConfirmText(label, "moves funds out of your private balance")
              : undefined
          }
        >
          {flow.busy && (
            <Loader2Icon aria-hidden className="animate-spin motion-reduce:animate-none" />
          )}
          <MorphText>{running ? runningLabel : label}</MorphText>
        </Button>
        <p className="flex min-h-5 items-center justify-between gap-3 text-xs text-muted-foreground">
          <span>No wallet prompt. The proof is made in this tab.</span>
          {running && flow.phase !== "submitting" && flow.phase !== "proving" && (
            <button
              type="button"
              className="shrink-0 font-medium text-foreground underline-offset-4 hover:underline"
              onClick={flow.leave}
            >
              Back
            </button>
          )}
        </p>
        {/* A proof error is already in the progress card. This is a failed send. */}
        {flow.error && flow.proof.phase !== "error" && (
          <p role="alert" className="text-sm text-destructive">
            {flow.error.message}
          </p>
        )}
        {!running && quoteError && (
          <p role="alert" className="text-sm text-destructive">
            {quoteError.message}
          </p>
        )}
      </div>

      {sent && (
        <TransactionStatus
          key={sent.hash}
          hash={sent.hash}
          chainId={chainId}
          onConfirmed={() => {
            // The private balance only changes once a scan sees the transaction.
            void engine.sync(chainId);
            onConfirmed?.(sent.hash);
          }}
        >
          {sent.label}
        </TransactionStatus>
      )}
    </div>
  );
}
