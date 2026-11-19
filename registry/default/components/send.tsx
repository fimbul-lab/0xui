// Docs: https://0xui.io/blocks/send.md
import { useState, type ReactNode } from "react";
import { erc20Abi, type Address, type Hash, type TransactionReceipt } from "viem";
import { AddressInput, type AddressInputState } from "@/components/address-input";
import { TokenInput, type TokenInputState } from "@/components/token-input";
import { isNativeToken, type Token, type TokenPrices } from "@/components/token-select";
import { TransactionButton } from "@/components/transaction-button";
import { TransactionStatus } from "@/components/transaction-status";
import { cn } from "@/lib/utils";

export type SendDraft = {
  recipient: Address | undefined;
  token: Token;
  amount: bigint | undefined;
};

/**
 * Why the draft can't be sent yet, as button text, or undefined when it's
 * ready. Order matches how people fill in the form.
 */
export function sendBlocker(
  draft: SendDraft,
  { recipientPhase, insufficient }: { recipientPhase: AddressInputState["phase"]; insufficient: boolean }
) {
  if (recipientPhase === "empty") return "Enter a recipient";
  if (recipientPhase === "resolving") return "Looking up name…";
  if (!draft.recipient) return "Enter a valid recipient";
  if (!draft.amount) return "Enter an amount";
  if (insufficient) return `Insufficient ${draft.token.symbol} balance`;
  return undefined;
}

/** The transaction for a draft: a value transfer for the native currency, `transfer` for ERC-20s. */
export function sendRequest(draft: Required<Pick<SendDraft, "recipient" | "amount">> & { token: Token }) {
  return isNativeToken(draft.token)
    ? { transaction: { to: draft.recipient, value: draft.amount } }
    : {
        contract: {
          address: draft.token.address,
          abi: erc20Abi,
          functionName: "transfer" as const,
          args: [draft.recipient, draft.amount] as const,
        },
      };
}

export type SendProps = {
  /** Tokens the user can send. Pass one to lock the token. */
  tokens: readonly Token[];
  /** Initially selected token. Defaults to the first in `tokens`. */
  defaultToken?: Token;
  /** Symbols or addresses for quick picks. */
  popular?: readonly string[];
  /** Prices keyed by `chainId:address`, address or symbol, for the fiat line. */
  prices?: TokenPrices;
  /** Called once the wallet returns a hash. */
  onSubmitted?: (hash: Hash) => void;
  onSuccess?: (receipt: TransactionReceipt) => void;
  /** Heading. Pass null to hide. */
  title?: ReactNode;
  className?: string;
};

/**
 * Send form: recipient (address or ENS), token and amount with balance,
 * and a send button that names whatever is missing. Shows the
 * transaction's status once sent.
 */
export function Send({
  tokens,
  defaultToken,
  popular,
  prices,
  onSubmitted,
  onSuccess,
  title = "Send",
  className,
}: SendProps) {
  const [recipientText, setRecipientText] = useState("");
  const [recipient, setRecipient] = useState<AddressInputState>();
  const [token, setToken] = useState<Token>(defaultToken ?? tokens[0]!);
  const [amountText, setAmountText] = useState("");
  const [amount, setAmount] = useState<TokenInputState>();
  const [hash, setHash] = useState<Hash>();

  const draft: SendDraft = {
    recipient: recipient?.address,
    token,
    amount: amount?.amount,
  };
  const blocker = sendBlocker(draft, {
    recipientPhase: recipient?.phase ?? "empty",
    insufficient: amount?.insufficient ?? false,
  });
  const request =
    !blocker && draft.recipient && draft.amount
      ? sendRequest({ recipient: draft.recipient, amount: draft.amount, token })
      : undefined;

  return (
    <div data-slot="send" className={cn("flex w-full max-w-md flex-col gap-3", className)}>
      {title && <h3 className="text-lg font-semibold">{title}</h3>}
      <AddressInput
        value={recipientText}
        onValueChange={setRecipientText}
        onResolve={setRecipient}
        label="Recipient"
      />
      <TokenInput
        label="Amount"
        value={amountText}
        onValueChange={(next, state) => {
          setAmountText(next);
          setAmount(state);
        }}
        token={token}
        onTokenChange={(next) => {
          setToken(next);
          setAmount(undefined);
          setAmountText("");
        }}
        tokens={tokens.length > 1 ? tokens : undefined}
        popular={popular}
        prices={prices}
      />
      <TransactionButton
        {...request}
        chainId={token.chainId}
        disabledReason={blocker}
        onSubmitted={(h) => {
          setHash(h);
          onSubmitted?.(h);
        }}
        onSuccess={onSuccess}
        hideStatus
        className="w-full [&>button]:h-11 [&>button]:w-full"
      >
        Send {token.symbol}
      </TransactionButton>
      {hash && (
        <TransactionStatus hash={hash} chainId={token.chainId}>
          Send {amountText} {token.symbol}
          {recipient?.ensName ? ` to ${recipient.ensName}` : ""}
        </TransactionStatus>
      )}
    </div>
  );
}
