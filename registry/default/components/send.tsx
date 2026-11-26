// Docs: https://0xui.io/blocks/send.md
import { useState } from "react";
import type { ReactNode } from "react";
import type { Hash, TransactionReceipt } from "viem";
import { useConfig } from "wagmi";
import { AddressInput } from "@/components/address-input";
import type { AddressInputState } from "@/components/address-input";
import { TokenInput } from "@/components/token-input";
import type { TokenInputState } from "@/components/token-input";
import type { Token, TokenPrices } from "@/components/token-select";
import { TransactionButton } from "@/components/transaction-button";
import { TransactionStatus } from "@/components/transaction-status";
import { sendBlocker, sendConfirmText, sendRequest } from "@/lib/send-core";
import type { SendDraft } from "@/lib/send-core";
import { cn } from "@/lib/utils";

export {
  sendBlocker,
  sendConfirmText,
  sendRequest,
  type SendDraft,
  type SendRecipientPhase,
} from "@/lib/send-core";

export type SendProps = {
  /** Tokens the user can send. Pass one to lock the token. */
  tokens: ReadonlyArray<Token>;
  /** Initially selected token. Defaults to the first in `tokens`. */
  defaultToken?: Token;
  /** Symbols or addresses for quick picks. */
  popular?: ReadonlyArray<string>;
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
  const [token, setToken] = useState<Token>(() => {
    const initial = defaultToken ?? tokens[0];
    if (!initial) {
      throw new Error("Send needs at least one token.");
    }
    return initial;
  });
  const [amountText, setAmountText] = useState("");
  const [amount, setAmount] = useState<TokenInputState>();
  const [hash, setHash] = useState<Hash>();
  const { chains } = useConfig();

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
  // What a person confirms before an agent's press reaches the wallet.
  const agentConfirm =
    request && draft.recipient && draft.amount
      ? sendConfirmText({
          amount: draft.amount,
          token,
          recipient: draft.recipient,
          ensName: recipient?.ensName,
          chainName: chains.find((c) => c.id === token.chainId)?.name,
        })
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
        agentConfirm={agentConfirm}
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
