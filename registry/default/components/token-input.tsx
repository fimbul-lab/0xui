// Docs: https://0xui.io/components/token-input.md
import { useId, type ReactNode } from "react";
import { formatUnits } from "viem";
import {
  AmountInput,
  getAmountState,
  type AmountState,
} from "@/components/amount-input";
import { useTokenBalance } from "@/components/balance";
import { MorphText } from "@/components/morph-text";
import { TokenAmount, formatFiat } from "@/components/token-amount";
import {
  TokenSelect,
  getTokenPrice,
  isNativeToken,
  type Token,
  type TokenPrices,
} from "@/components/token-select";
import { cn } from "@/lib/utils";

export type TokenInputState = AmountState & {
  /** True when the amount is above the connected account's balance. */
  insufficient: boolean;
  /** Connected account's balance of the selected token, once loaded. */
  balance: bigint | undefined;
};

export type TokenInputProps = {
  /** Label above the panel, e.g. "You pay". */
  label?: ReactNode;
  /** Decimal string amount. */
  value: string;
  onValueChange: (value: string, state: TokenInputState) => void;
  /** Selected token. */
  token?: Token;
  onTokenChange?: (token: Token) => void;
  /** Tokens for the picker. Omit to lock the token. */
  tokens?: readonly Token[];
  /** Symbols or addresses shown as quick picks in the token picker. */
  popular?: readonly string[];
  /** Price of one token, for the fiat line. Defaults to the token's entry in `prices`. */
  price?: number;
  /** Prices keyed by `chainId:address`, address or symbol: the fiat line, and sorting held tokens in the picker by value. */
  prices?: TokenPrices;
  currency?: string;
  /** Check the amount against the balance and offer Max. Turn off for "you receive" panels. */
  checkBalance?: boolean;
  /** Make the amount read-only, e.g. for a quoted output. */
  readOnly?: boolean;
  className?: string;
};

/**
 * Token amount panel: label, big amount input, token picker, fiat value,
 * balance with Max, and an "Insufficient balance" state. The building block
 * of swap and send forms.
 */
export function TokenInput({
  label,
  value,
  onValueChange,
  token,
  onTokenChange,
  tokens,
  popular,
  price: priceProp,
  prices,
  currency,
  checkBalance = true,
  readOnly = false,
  className,
}: TokenInputProps) {
  const id = useId();
  const price = priceProp ?? (token ? getTokenPrice(prices, token) : undefined);
  const decimals = token?.decimals ?? 18;
  const { value: balance } = useTokenBalance({
    token: token && !isNativeToken(token) ? token.address : undefined,
    chainId: token?.chainId,
    enabled: Boolean(token) && checkBalance,
  });
  const max = checkBalance && token ? balance : undefined;

  const stateFor = (next: string): TokenInputState => {
    const state = getAmountState(next, decimals, max);
    return { ...state, insufficient: state.exceedsMax, balance: max };
  };
  const current = stateFor(value);

  const fiat =
    price !== undefined && current.amount !== undefined
      ? formatFiat(current.amount, decimals, price, { currency })
      : undefined;

  return (
    <div
      data-slot="token-input"
      data-insufficient={current.insufficient || undefined}
      className={cn(
        "flex flex-col gap-2 rounded-2xl border bg-muted/30 p-4 focus-within:border-ring",
        current.insufficient && "border-destructive/60",
        className
      )}
    >
      {label && (
        <label htmlFor={id} className="text-sm text-muted-foreground">
          {label}
        </label>
      )}
      <div className="flex items-center gap-3">
        <AmountInput
          id={id}
          value={value}
          onValueChange={(next) => onValueChange(next, stateFor(next))}
          decimals={decimals}
          max={max}
          showMax={false}
          readOnly={readOnly}
          label={typeof label === "string" ? label : "Amount"}
          className="flex-1"
        />
        {tokens && onTokenChange ? (
          <TokenSelect
            tokens={tokens}
            value={token}
            onValueChange={onTokenChange}
            chainId={token?.chainId}
            popular={popular}
            prices={prices}
            className="shrink-0"
          />
        ) : (
          token && (
            <span className="inline-flex h-10 shrink-0 items-center rounded-full border px-4 text-sm font-semibold">
              {token.symbol}
            </span>
          )
        )}
      </div>
      <div className="flex min-h-5 items-center justify-between gap-2 text-sm text-muted-foreground">
        <span className="tabular-nums">
          <MorphText>{fiat}</MorphText>
        </span>
        {current.insufficient ? (
          <span role="alert" className="text-destructive">
            Insufficient {token?.symbol} balance
          </span>
        ) : (
          max !== undefined &&
          token && (
            <span className="flex items-center gap-1">
              Balance:
              <TokenAmount value={max} decimals={decimals} animate />
              {!readOnly && max > 0n && (
                <button
                  type="button"
                  onClick={() => {
                    const next = formatUnits(max, decimals);
                    onValueChange(next, stateFor(next));
                  }}
                  className="rounded px-1 font-medium text-primary hover:bg-muted"
                >
                  Max
                </button>
              )}
            </span>
          )
        )}
      </div>
    </div>
  );
}
