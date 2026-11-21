// Docs: https://0xui.io/blocks/unshield.md
import { useQuery } from "@tanstack/react-query";
import { Loader2Icon } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { formatUnits, zeroAddress, type Address, type Hash } from "viem";
import { useConnection } from "wagmi";
import { AddressInput } from "@/components/address-input";
import { MorphText } from "@/components/morph-text";
import { Button } from "@/components/primitives/button";
import { PrivacyBadge } from "@/components/privacy-badge";
import { ProofProgress } from "@/components/proof-progress";
import { useShieldedBalance } from "@/components/shielded-balance";
import { useShieldedAccount, useShieldedEngine } from "@/components/shielded-provider";
import { TokenAmount } from "@/components/token-amount";
import { TokenInput } from "@/components/token-input";
import type { Token, TokenPrices } from "@/components/token-select";
import { TransactionStatus } from "@/components/transaction-status";
import { useStore } from "@/hooks/use-store";
import { errorCode } from "@/lib/0xui-utils";
import { formatFeePercent } from "@/lib/shield-core";
import type { PrivateQuote, ProvedOperation, UnshieldDraft } from "@/lib/shielded-engine";
import {
  createUnshieldFlow,
  parseUnshieldAmount,
  unshieldBlocker,
  unshieldConfirmText,
  unshieldFormAction,
  unshieldPhase,
  unshieldQuoteQueryOptions,
  unshieldRunningLabel,
  type UnshieldAmount,
} from "@/lib/unshield-core";
import { cn } from "@/lib/utils";

export {
  createUnshieldFlow,
  unshieldBlocker,
  unshieldConfirmText,
  unshieldQuoteQueryOptions,
  type UnshieldAmount,
  type UnshieldPhase,
} from "@/lib/unshield-core";

function useDebounced<T>(value: T, delay: number) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

/**
 * Fee and amount received for an unshield, from the engine. Waits for typing
 * to pause. The price does not depend on the recipient, so it can be shown
 * before one is entered. `quote` is undefined while it doesn't match.
 */
export function useUnshieldQuote(draft: UnshieldAmount | undefined, { debounce = 300 } = {}) {
  const engine = useShieldedEngine();
  const amount = useDebounced(draft?.amount, debounce);
  const settled = amount === draft?.amount;
  const query = useQuery(
    unshieldQuoteQueryOptions(engine, draft && amount !== undefined ? { ...draft, amount } : undefined, {
      enabled: settled,
    }),
  );
  return {
    quote: draft && settled ? query.data : undefined,
    isLoading: Boolean(draft) && (!settled || query.isPending),
    error: draft && settled ? query.error : null,
  };
}

/**
 * Runs an unshield: prove, then submit. Nothing asks the wallet. A proof
 * whose fee is higher than the one shown stops in `review` until `confirm`.
 * The logic lives in `createUnshieldFlow` (framework-free).
 */
export function useUnshieldFlow({
  onSubmitted,
}: {
  /** Called with the transaction's hash once it is broadcast. */
  onSubmitted?: (hash: Hash, operation: ProvedOperation) => void;
} = {}) {
  const engine = useShieldedEngine();
  // The latest callback, for runs that finish after a re-render.
  const submitted = useRef(onSubmitted);
  submitted.current = onSubmitted;
  const controller = useMemo(
    () =>
      createUnshieldFlow(engine, {
        onSubmitted: (hash, operation) => submitted.current?.(hash, operation),
      }),
    [engine],
  );
  const state = useStore(controller);
  const phase = unshieldPhase(state);
  const error = state.failure ?? state.proof.error;

  return {
    phase,
    /** The unshield in progress, frozen at `start`. Undefined while on the form. */
    active: state.active,
    /** The proof's own state, for ProofProgress. */
    proof: { phase: state.proof.phase, stage: state.proof.stage, error: state.proof.error },
    /** The proved operation waiting for a yes, when its fee went up. */
    review: state.review,
    /** Why it stopped. Set when `phase` is "error". */
    error: phase === "error" ? error : undefined,
    /** The proof is running or being sent. */
    busy: phase === "proving" || phase === "submitting",
    start: controller.start,
    confirm: controller.confirm,
    retry: controller.retry,
    cancel: controller.cancel,
    leave: controller.leave,
  };
}

export type UnshieldFlow = ReturnType<typeof useUnshieldFlow>;

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
  const amount = token ? parseUnshieldAmount(amountText, token.decimals) : undefined;

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

  const form = unshieldFormAction({
    blocker,
    quoteFailed: Boolean(quoteError),
    quoting,
    quoted: Boolean(quote),
    symbol: token?.symbol,
  });
  const action =
    form.ready && quote
      ? () => {
          started.current = { amountText, token: token! };
          flow.start({ kind: "unshield", ...priced!, recipient: recipient! }, quote);
        }
      : undefined;
  // What a person confirms before an agent's press starts the unshield.
  const agentConfirm =
    action && quote && token && amount && recipient
      ? unshieldConfirmText({ amount, token, quote, recipient })
      : undefined;

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
              <Button
                variant="ghost"
                size="xs"
                className="px-1 text-xs text-primary"
                onClick={() => setAmountText(formatUnits(spendable!, token.decimals))}
              >
                Max
              </Button>
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
            <Button
              variant="ghost"
              size="xs"
              className="self-start px-1 text-xs"
              onClick={() => setRecipientText(connection.address!)}
            >
              Use my wallet
            </Button>
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
          data-agent-confirm={running ? undefined : agentConfirm}
        >
          {flow.busy && (
            <Loader2Icon aria-hidden className="animate-spin motion-reduce:animate-none" />
          )}
          <MorphText>{running ? unshieldRunningLabel(flow.phase) : form.label}</MorphText>
        </Button>
        <p className="flex min-h-5 items-center justify-between gap-3 text-xs text-muted-foreground">
          <span>No wallet prompt. The proof is made in this tab.</span>
          {running && flow.phase !== "submitting" && flow.phase !== "proving" && (
            <Button variant="ghost" size="xs" className="shrink-0 text-xs" onClick={flow.leave}>
              Back
            </Button>
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
