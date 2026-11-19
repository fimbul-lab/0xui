// Docs: https://0xui.io/components/token-select.md
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
import { Skeleton } from "skullet/react";
import { erc20Abi, formatUnits, type Address } from "viem";
import { useBalance, useChainId, useConnection, useReadContracts } from "wagmi";
import {
  ResponsiveDialog,
  type ResponsiveDialogMode,
} from "@/components/responsive-dialog";
import { TokenAmount } from "@/components/token-amount";
import { TokenIcon } from "@/components/token-icon";
import { Button } from "@/components/ui/button";
import { truncateAddress } from "@/lib/0xui-utils";
import { NATIVE_TOKEN_ADDRESS, getTokenPrice, isNativeToken, type TokenInfo, type TokenPrices } from "@/lib/token-list";
import { cn } from "@/lib/utils";

/** A token-list entry (https://tokenlists.org). Same as `TokenInfo`. */
export type Token = TokenInfo;
export { NATIVE_TOKEN_ADDRESS, getTokenPrice, isNativeToken, type TokenPrices };

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
 * Balances for a list of tokens on one chain, for the connected account or
 * `address`. ERC-20 balances are read in one batch. Keys are lowercase
 * token addresses.
 */
export function useTokenBalances(
  tokens: readonly Token[],
  {
    chainId,
    address: addressProp,
    enabled = true,
  }: { chainId?: number; address?: Address; enabled?: boolean } = {}
) {
  const connection = useConnection();
  const address = addressProp ?? connection.address;
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

  const balances = useMemo(() => {
    const map = new Map<string, bigint>();
    if (native.data) map.set(key({ address: NATIVE_TOKEN_ADDRESS }), native.data.value);
    reads.data?.forEach((result, i) => {
      if (result.status === "success") map.set(key(erc20[i]!), result.result as bigint);
    });
    return map;
    // erc20 is derived from tokens.
  }, [native.data, reads.data, tokens]);

  return {
    balances,
    isLoading: native.isLoading || reads.isLoading,
    // Partial results are still useful; only report failure when nothing loaded.
    isError: (native.isError || reads.isError) && balances.size === 0,
  };
}

/**
 * Tokens the user holds first: priced holdings by value, then other
 * holdings in list order, then everything else in list order. Raw amounts
 * aren't compared: a billion airdropped tokens shouldn't outrank 2 ETH.
 */
export function sortByHoldings(
  tokens: readonly Token[],
  balances: ReadonlyMap<string, bigint>,
  prices: TokenPrices = {}
) {
  return tokens
    .map((token, index) => {
      const balance = balances.get(key(token)) ?? 0n;
      const price = getTokenPrice(prices, token);
      const value =
        balance > 0n && price !== undefined
          ? Number(formatUnits(balance, token.decimals)) * price
          : undefined;
      const group = value !== undefined ? 0 : balance > 0n ? 1 : 2;
      return { token, index, value: value ?? 0, group };
    })
    .sort((a, b) => a.group - b.group || b.value - a.value || a.index - b.index)
    .map((t) => t.token);
}

/** Normalize caller-supplied balances to lowercase-address keys. */
function toBalanceMap(balances: ReadonlyMap<string, bigint> | Record<string, bigint>) {
  const entries = balances instanceof Map ? [...balances] : Object.entries(balances);
  return new Map(entries.map(([address, value]) => [address.toLowerCase(), value]));
}

/**
 * Last row of a paginated list: loads the next page when scrolled into
 * view, with a button for keyboard users and browsers without
 * IntersectionObserver.
 */
function LoadMore({
  shown,
  total,
  onLoadMore,
}: {
  shown: number;
  total: number;
  onLoadMore: () => void;
}) {
  const ref = useRef<HTMLLIElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) onLoadMore();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [onLoadMore, shown]);

  return (
    <li ref={ref} className="flex flex-col items-center gap-1 px-2 py-3 text-xs text-muted-foreground">
      <span>
        Showing {shown} of {total}
      </span>
      <button type="button" onClick={onLoadMore} className="rounded-md px-2 py-1 font-medium text-foreground hover:bg-muted">
        Show more
      </button>
    </li>
  );
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
  /** Prices keyed by `chainId:address`, address or symbol. Held tokens are sorted by value when given. */
  prices?: TokenPrices;
  /** The token list is still loading, e.g. `useTokenList(…).isLoading`. */
  isLoading?: boolean;
  /** Rows per page. More load as you scroll, or with "Show more". Keeps 400-token lists fast. */
  pageSize?: number;
  /**
   * Balances from your own source, e.g. an indexer, keyed by token address.
   * When given, nothing is read over RPC.
   */
  balances?: ReadonlyMap<string, bigint> | Record<string, bigint>;
  title?: ReactNode;
  /** `auto` is a bottom drawer on small screens and a dialog otherwise. `dialog` and `drawer` force one. */
  mode?: ResponsiveDialogMode;
};

const noop = () => {};

/** Stand-in rows the loading skeleton is measured from. Never shown as text. */
const sampleTokens: Token[] = ["Sample token", "Another one", "Third token name", "Fourth", "Fifth token", "Sixth one"].map(
  (name, index) => ({
    chainId: 0,
    address: `0x${String(index + 1).padStart(40, "0")}`,
    name,
    symbol: "TKN",
    decimals: 18,
  })
);

/** One row of the token list. */
function TokenRow({
  token,
  balance,
  selected = false,
  showAddress = false,
  onSelect,
}: {
  token: Token;
  balance?: bigint;
  selected?: boolean;
  /** Show the contract address next to the name, for address searches. */
  showAddress?: boolean;
  onSelect: (token: Token) => void;
}) {
  return (
    <li>
      <button
        type="button"
        aria-current={selected || undefined}
        onClick={() => onSelect(token)}
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
            {!isNativeToken(token) && showAddress && <> · {truncateAddress(token.address)}</>}
          </span>
        </span>
        {balance !== undefined && balance > 0n && (
          <TokenAmount value={balance} decimals={token.decimals} compact className="text-sm" />
        )}
      </button>
    </li>
  );
}

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
  prices,
  isLoading = false,
  pageSize = 50,
  balances: balancesProp,
  title = "Select a token",
  mode,
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
  const rpc = useTokenBalances(tokens, {
    chainId,
    enabled: open && showBalances && !balancesProp,
  });
  const balances = useMemo(
    () => (balancesProp ? toBalanceMap(balancesProp) : rpc.balances),
    [balancesProp, rpc.balances]
  );
  const [visible, setVisible] = useState(pageSize);

  useEffect(() => {
    if (open) {
      setQuery("");
      setRecent(readRecent(chainId));
    }
  }, [open, chainId]);

  // Back to the first page whenever the results change.
  useEffect(() => setVisible(pageSize), [query, open, pageSize]);

  const results = useMemo(() => {
    const matches = filterTokens(tokens, query);
    if (query) return matches;
    return sortByHoldings(matches, balances, prices);
  }, [tokens, query, balances, prices]);

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
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description="Search by name, symbol or address."
      mode={mode}
      className="flex max-h-[min(36rem,85vh)] flex-col sm:max-w-md"
      onKeyDown={onKeyDown}
    >

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

        {results.length === 0 && !isLoading ? (
          <p role="status" className="py-6 text-center text-sm text-muted-foreground">
            {query ? `No tokens match “${query}”.` : "No tokens on this network."}
          </p>
        ) : (
          <div className="-mx-2 flex min-h-0 flex-col gap-0.5 overflow-y-auto">
            {results.length > 0 && (
              <ul ref={listRef} aria-label="Tokens" className="flex shrink-0 flex-col gap-0.5">
                {results.slice(0, visible).map((token) => (
                  <TokenRow
                    key={key(token)}
                    token={token}
                    balance={balances.get(key(token))}
                    selected={value !== undefined && key(value) === key(token)}
                    showAddress={query.startsWith("0x")}
                    onSelect={select}
                  />
                ))}
                {results.length > visible && (
                  <LoadMore
                    shown={visible}
                    total={results.length}
                    onLoadMore={() => setVisible((v) => v + pageSize)}
                  />
                )}
              </ul>
            )}
            {/* While the list downloads: sample rows, measured into a skeleton
                the shape of real ones, under whatever is already known (the
                native currency, usually). */}
            {isLoading && (
              <>
                <p role="status" className="sr-only">
                  Loading tokens…
                </p>
                <Skeleton loading className="shrink-0">
                  <ul className="flex flex-col gap-0.5">
                    {sampleTokens.map((token) => (
                      <TokenRow key={key(token)} token={token} onSelect={noop} />
                    ))}
                  </ul>
                </Skeleton>
              </>
            )}
          </div>
        )}
    </ResponsiveDialog>
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
  prices,
  isLoading,
  pageSize,
  balances,
  title,
  mode,
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
        // A logo sits close to the pill's edge; bare text needs more room on the curve.
        className={cn("h-10 gap-2 rounded-full pr-3", value ? "pl-1.5" : "pl-4", className)}
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
        prices={prices}
        isLoading={isLoading}
        pageSize={pageSize}
        balances={balances}
        title={title}
        mode={mode}
      />
    </>
  );
}
