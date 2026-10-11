import { ChevronDownIcon, SearchIcon } from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { erc20Abi, formatUnits, isAddressEqual, type Address } from "viem";
import { useBalance, useChainId, useConnection, useReadContracts } from "wagmi";
import { TokenAmount } from "@/components/token-amount";
import { TokenIcon } from "@/components/token-icon";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { truncateAddress } from "@/lib/0xui-utils";
import { cn } from "@/lib/utils";

/** A token in the Uniswap token list format. */
export type Token = {
  chainId: number;
  address: Address;
  symbol: string;
  name: string;
  decimals: number;
  logoURI?: string;
};

/** Placeholder address for a chain's native currency in token lists. */
export const NATIVE_TOKEN_ADDRESS =
  "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE" as const;

export function isNativeToken(token: Pick<Token, "address">) {
  return isAddressEqual(token.address, NATIVE_TOKEN_ADDRESS);
}

const key = (token: Pick<Token, "address">) => token.address.toLowerCase();

/**
 * Search tokens by symbol, name or exact address. Symbol prefix matches
 * rank first, then other symbol matches, then name matches.
 */
export function filterTokens(tokens: readonly Token[], query: string) {
  const q = query.trim().toLowerCase();
  if (!q) return [...tokens];
  if (/^0x[0-9a-f]{40}$/.test(q)) return tokens.filter((t) => key(t) === q);
  const rank = (t: Token) => {
    const symbol = t.symbol.toLowerCase();
    if (symbol === q) return 0;
    if (symbol.startsWith(q)) return 1;
    if (symbol.includes(q)) return 2;
    if (t.name.toLowerCase().includes(q)) return 3;
    return -1;
  };
  return tokens
    .map((token) => ({ token, rank: rank(token) }))
    .filter((t) => t.rank >= 0)
    .sort((a, b) => a.rank - b.rank)
    .map((t) => t.token);
}

/**
 * Balances of the connected account for a list of tokens on one chain.
 * ERC-20 balances are read in one batch. Keys are lowercase addresses.
 */
export function useTokenBalances(
  tokens: readonly Token[],
  { chainId, enabled = true }: { chainId?: number; enabled?: boolean } = {}
) {
  const { address } = useConnection();
  const erc20 = tokens.filter((t) => !isNativeToken(t));
  const hasNative = tokens.some(isNativeToken);

  const native = useBalance({
    address,
    chainId,
    query: { enabled: enabled && Boolean(address) && hasNative },
  });
  const reads = useReadContracts({
    contracts: erc20.map((token) => ({
      address: token.address,
      abi: erc20Abi,
      functionName: "balanceOf" as const,
      args: [address!] as const,
      chainId,
    })),
    query: { enabled: enabled && Boolean(address) && erc20.length > 0 },
  });

  return useMemo(() => {
    const balances = new Map<string, bigint>();
    if (native.data) balances.set(key({ address: NATIVE_TOKEN_ADDRESS }), native.data.value);
    reads.data?.forEach((result, i) => {
      if (result.status === "success") balances.set(key(erc20[i]!), result.result as bigint);
    });
    return balances;
    // erc20 is derived from tokens.
  }, [native.data, reads.data, tokens]);
}

const RECENT_LIMIT = 4;
const recentKey = (chainId: number) => `0xui:recent-tokens:${chainId}`;

function readRecent(chainId: number): string[] {
  try {
    return JSON.parse(localStorage.getItem(recentKey(chainId)) ?? "[]");
  } catch {
    return [];
  }
}

function saveRecent(chainId: number, token: Token) {
  try {
    const next = [key(token), ...readRecent(chainId).filter((a) => a !== key(token))];
    localStorage.setItem(recentKey(chainId), JSON.stringify(next.slice(0, RECENT_LIMIT)));
  } catch {
    // Storage blocked: recents are a convenience.
  }
}

export type TokenSelectDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Tokens to choose from. Only those on `chainId` are shown. */
  tokens: readonly Token[];
  /** Called with the chosen token. The dialog closes itself. */
  onValueChange: (token: Token) => void;
  /** Currently selected token, marked in the list. */
  value?: Token;
  /** Chain to list tokens for. Defaults to the current chain. */
  chainId?: number;
  /** Symbols or addresses shown as quick-pick chips. */
  popular?: readonly string[];
  /** Read and show the connected account's balances. */
  showBalances?: boolean;
  title?: ReactNode;
};

/** The token picker on its own. Use it to open the picker from your own trigger. */
export function TokenSelectDialog({
  open,
  onOpenChange,
  tokens: allTokens,
  onValueChange,
  value,
  chainId: chainIdProp,
  popular = [],
  showBalances = true,
  title = "Select a token",
}: TokenSelectDialogProps) {
  const currentChainId = useChainId();
  const chainId = chainIdProp ?? currentChainId;
  const [query, setQuery] = useState("");
  const [recent, setRecent] = useState<string[]>([]);
  const listRef = useRef<HTMLUListElement>(null);

  const tokens = useMemo(
    () => allTokens.filter((t) => t.chainId === chainId),
    [allTokens, chainId]
  );
  const balances = useTokenBalances(tokens, { chainId, enabled: open && showBalances });

  useEffect(() => {
    if (open) {
      setQuery("");
      setRecent(readRecent(chainId));
    }
  }, [open, chainId]);

  const results = useMemo(() => {
    const matches = filterTokens(tokens, query);
    if (query) return matches;
    // Tokens the user holds first, largest first.
    const held = (t: Token) => {
      const balance = balances.get(key(t));
      return balance ? Number(formatUnits(balance, t.decimals)) : 0;
    };
    return matches
      .map((token, index) => ({ token, index, held: held(token) }))
      .sort((a, b) => b.held - a.held || a.index - b.index)
      .map((t) => t.token);
  }, [tokens, query, balances]);

  const chips = useMemo(() => {
    const wanted = [...recent, ...popular.map((p) => p.toLowerCase())];
    const picked: Token[] = [];
    for (const w of wanted) {
      const token = tokens.find((t) => key(t) === w || t.symbol.toLowerCase() === w);
      if (token && !picked.includes(token)) picked.push(token);
    }
    return picked.slice(0, 6);
  }, [recent, popular, tokens]);

  const select = (token: Token) => {
    saveRecent(chainId, token);
    onValueChange(token);
    onOpenChange(false);
  };

  // Arrow keys move between the search field and the rows.
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const rows = Array.from(listRef.current?.querySelectorAll("button") ?? []);
    if (rows.length === 0) return;
    event.preventDefault();
    const index = rows.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      event.key === "ArrowDown"
        ? rows[Math.min(index + 1, rows.length - 1)]
        : index <= 0
          ? undefined
          : rows[index - 1];
    if (next) next.focus();
    else (event.currentTarget.querySelector("input") as HTMLInputElement | null)?.focus();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[min(36rem,85vh)] flex-col sm:max-w-md" onKeyDown={onKeyDown}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="sr-only">
            Search by name, symbol or address.
          </DialogDescription>
        </DialogHeader>

        <label className="flex items-center gap-2 rounded-lg border px-3 focus-within:ring-3 focus-within:ring-ring/50">
          <SearchIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
          <input
            type="search"
            autoComplete="off"
            spellCheck={false}
            aria-label="Search tokens"
            placeholder="Search name, symbol or address"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="h-10 w-full bg-transparent text-sm outline-none"
          />
        </label>

        {!query && chips.length > 0 && (
          <div role="group" aria-label="Quick picks" className="flex flex-wrap gap-2">
            {chips.map((token) => (
              <button
                key={key(token)}
                type="button"
                onClick={() => select(token)}
                className="flex items-center gap-1.5 rounded-full border py-1 pr-3 pl-1 text-sm hover:bg-muted"
              >
                <TokenIcon symbol={token.symbol} src={token.logoURI} size={20} />
                {token.symbol}
              </button>
            ))}
          </div>
        )}

        {results.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No tokens match “{query}”.
          </p>
        ) : (
          <ul ref={listRef} aria-label="Tokens" className="-mx-2 flex min-h-0 flex-col gap-0.5 overflow-y-auto">
            {results.map((token) => {
              const balance = balances.get(key(token));
              const selected = value !== undefined && key(value) === key(token);
              return (
                <li key={key(token)}>
                  <button
                    type="button"
                    aria-current={selected || undefined}
                    onClick={() => select(token)}
                    className={cn(
                      "flex min-h-12 w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left outline-none",
                      "hover:bg-muted focus-visible:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50",
                      selected && "bg-muted"
                    )}
                  >
                    <TokenIcon symbol={token.symbol} src={token.logoURI} size={32} />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-sm font-medium">{token.symbol}</span>
                      <span className="truncate text-xs text-muted-foreground">
                        {token.name}
                        {!isNativeToken(token) && query.startsWith("0x") && (
                          <> · {truncateAddress(token.address)}</>
                        )}
                      </span>
                    </span>
                    {balance !== undefined && balance > 0n && (
                      <TokenAmount
                        value={balance}
                        decimals={token.decimals}
                        compact
                        className="text-sm"
                      />
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}

export type TokenSelectProps = Omit<
  TokenSelectDialogProps,
  "open" | "onOpenChange"
> &
  Omit<ComponentProps<typeof Button>, "value" | "onClick" | "title"> & {
    /** Trigger text when nothing is selected. */
    placeholder?: string;
  };

/** Token pill that opens a searchable token picker. */
export function TokenSelect({
  tokens,
  onValueChange,
  value,
  chainId,
  popular,
  showBalances,
  title,
  placeholder = "Select token",
  className,
  variant = "outline",
  ...buttonProps
}: TokenSelectProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        type="button"
        variant={variant}
        aria-haspopup="dialog"
        aria-label={value ? `${value.symbol}, change token` : placeholder}
        onClick={() => setOpen(true)}
        className={cn("h-10 gap-2 rounded-full pr-3", value && "pl-1.5", className)}
        {...buttonProps}
      >
        {value && <TokenIcon symbol={value.symbol} src={value.logoURI} size={28} />}
        <span className="font-semibold">{value ? value.symbol : placeholder}</span>
        <ChevronDownIcon aria-hidden className="size-4 opacity-60" />
      </Button>
      <TokenSelectDialog
        open={open}
        onOpenChange={setOpen}
        tokens={tokens}
        onValueChange={onValueChange}
        value={value}
        chainId={chainId}
        popular={popular}
        showBalances={showBalances}
        title={title}
      />
    </>
  );
}
