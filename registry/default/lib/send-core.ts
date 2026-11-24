import { erc20Abi, formatUnits, type Address } from "viem";
import { isNativeToken, type TokenInfo } from "@/lib/token-list";

export type SendDraft = {
  recipient: Address | undefined;
  token: TokenInfo;
  amount: bigint | undefined;
};

/** Where the recipient field stands, as AddressInput reports it. */
export type SendRecipientPhase =
  | "empty"
  | "incomplete"
  | "resolving"
  | "valid"
  | "invalid"
  | "not-found";

/**
 * Why the draft can't be sent yet, as button text, or undefined when it's
 * ready. Order matches how people fill in the form.
 */
export function sendBlocker(
  draft: SendDraft,
  { recipientPhase, insufficient }: { recipientPhase: SendRecipientPhase; insufficient: boolean },
) {
  if (recipientPhase === "empty") return "Enter a recipient";
  if (recipientPhase === "resolving") return "Looking up name…";
  if (!draft.recipient) return "Enter a valid recipient";
  if (!draft.amount) return "Enter an amount";
  if (insufficient) return `Insufficient ${draft.token.symbol} balance`;
  return undefined;
}

/** The transaction for a draft: a value transfer for the native currency, `transfer` for ERC-20s. */
export function sendRequest(
  draft: Required<Pick<SendDraft, "recipient" | "amount">> & { token: TokenInfo },
) {
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

/**
 * What a person confirms before an agent's Send goes to the wallet: the
 * exact amount, the full recipient address (and its name, if one was typed)
 * and the network. Set as the button's `data-agent-confirm`.
 */
export function sendConfirmText({
  amount,
  token,
  recipient,
  ensName,
  chainName,
}: {
  amount: bigint;
  token: Pick<TokenInfo, "symbol" | "decimals">;
  recipient: Address;
  ensName?: string;
  chainName?: string;
}) {
  const to = ensName ? `${ensName} (${recipient})` : recipient;
  const on = chainName ? ` on ${chainName}` : "";
  return `Sends ${formatUnits(amount, token.decimals)} ${token.symbol} from your wallet to ${to}${on}`;
}
