// Docs: https://0xui.io/components/token-select.md
import { useQuery } from "@tanstack/react-query";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
  CommandStatus,
} from "@ui-sdk/react/command";
import { ChevronDownIcon, SearchIcon } from "lucide-react";
import { useEffect, useMemo, useState, type ComponentProps, type ReactNode } from "react";
import { Skeleton } from "skullet/react";
import type { Address } from "viem";
import { useChainId, useConfig, useConnection } from "wagmi";
import { Button } from "@/components/primitives/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/primitives/dialog";
import { TokenAmount } from "@/components/token-amount";
import { TokenIcon } from "@/components/token-icon";
import { truncateAddress } from "@/lib/0xui-utils";
import {
  NATIVE_TOKEN_ADDRESS,
  getTokenPrice,
  isNativeToken,
  type TokenInfo,
  type TokenPrices,
} from "@/lib/token-list";
import {
  filterTokens,
  mergeTokenBalances,
  quickPickTokens,
  readRecentTokens,
  saveRecentToken,
  sortByHoldings,
  toBalanceMap,
  tokenBalancesQueryOptions,
  tokenKey as key,
} from "@/lib/token-select-core";
import { cn } from "@/lib/utils";

/** A token-list entry (https://tokenlists.org). Same as `TokenInfo`. */
export type Token = TokenInfo;
export {
  NATIVE_TOKEN_ADDRESS,
  filterTokens,
  getTokenPrice,
  isNativeToken,
  sortByHoldings,
  type TokenPrices,
};

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
  }: { chainId?: number; address?: Address; enabled?: boolean } = {},
) {
  const config = useConfig();
  const connection = useConnection();
  const address = addressProp ?? connection.address;
  const options = tokenBalancesQueryOptions(config, tokens, { chainId, address, enabled });
  const native = useQuery(options.native);
  const reads = useQuery(options.erc20);

  const balances = useMemo(
    () => mergeTokenBalances(tokens, native.data, reads.data),
    [tokens, native.data, reads.data],
  );

  return {
    balances,
    isLoading: native.isLoading || reads.isLoading,
    // Partial results are still useful; only report failure when nothing loaded.
    isError: (native.isError || reads.isError) && balances.size === 0,
  };
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
  /** Rows per page. More load as you scroll or arrow to the end, or with "Show more". Keeps 400-token lists fast. */
  pageSize?: number;
  /**
   * Balances from your own source, e.g. an indexer, keyed by token address.
   * When given, nothing is read over RPC.
   */
  balances?: ReadonlyMap<string, bigint> | Record<string, bigint>;
  title?: ReactNode;
  /** `auto` is a bottom sheet on small touch screens and a dialog otherwise. `dialog` and `drawer` force one. */
  mode?: "auto" | "dialog" | "drawer";
};

const presentations = { auto: "auto", dialog: "dialog", drawer: "sheet" } as const;

/** Stand-in rows the loading skeleton is measured from. Never shown as text. */
const sampleTokens: Token[] = [
  "Sample token",
  "Another one",
  "Third token name",
  "Fourth",
  "Fifth token",
  "Sixth one",
].map((name, index) => ({
  chainId: 0,
  address: `0x${String(index + 1).padStart(40, "0")}`,
  name,
  symbol: "TKN",
  decimals: 18,
}));

const rowClassName = "flex min-h-12 w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left";

function TokenRowContent({
  token,
  balance,
  showAddress = false,
}: {
  token: Token;
  balance?: bigint;
  /** Show the contract address next to the name, for address searches. */
  showAddress?: boolean;
}) {
  return (
    <>
      {/* The spaces between parts keep the row's name "USDC USD Coin" rather
          than "USDCUSD Coin", for screen readers and agents. */}
      <TokenIcon symbol={token.symbol} src={token.logoURI} size={32} decorative />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-medium">{token.symbol}</span>{" "}
        <span className="truncate text-xs text-muted-foreground">
          {token.name}
          {!isNativeToken(token) && showAddress && <> · {truncateAddress(token.address)}</>}
        </span>
      </span>{" "}
      {balance !== undefined && balance > 0n && (
        <TokenAmount value={balance} decimals={token.decimals} compact className="text-sm" />
      )}
    </>
  );
}

function TokenPicker({
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
  mode = "auto",
}: TokenSelectDialogProps) {
  const currentChainId = useChainId();
  const chainId = chainIdProp ?? currentChainId;
  const [query, setQuery] = useState("");
  const [recent, setRecent] = useState<string[]>([]);
  const [visible, setVisible] = useState(pageSize);

  const tokens = useMemo(
    () => allTokens.filter((t) => t.chainId === chainId),
    [allTokens, chainId],
  );
  const rpc = useTokenBalances(tokens, {
    chainId,
    enabled: open && showBalances && !balancesProp,
  });
  const balances = useMemo(
    () => (balancesProp ? toBalanceMap(balancesProp) : rpc.balances),
    [balancesProp, rpc.balances],
  );

  useEffect(() => {
    if (open) {
      setQuery("");
      setRecent(readRecentTokens(chainId));
    }
  }, [open, chainId]);

  // Back to the first page whenever the results change.
  useEffect(() => setVisible(pageSize), [query, open, pageSize]);

  const results = useMemo(() => {
    const matches = filterTokens(tokens, query);
    if (query) return matches;
    return sortByHoldings(matches, balances, prices);
  }, [tokens, query, balances, prices]);

  // Each row's value is its symbol, so an agent picks "USDC" by name with
  // the command's `run`. A symbol two tokens share also carries the address.
  const itemValue = useMemo(() => {
    const counts = new Map<string, number>();
    for (const token of tokens) counts.set(token.symbol, (counts.get(token.symbol) ?? 0) + 1);
    return (token: Token) =>
      counts.get(token.symbol) === 1 ? token.symbol : `${token.symbol} ${key(token)}`;
  }, [tokens]);

  const chips = useMemo(() => quickPickTokens(tokens, recent, popular), [recent, popular, tokens]);
  const hasMore = results.length > visible;
  const loadMore = () => setVisible((v) => v + pageSize);

  const select = (token: Token) => {
    saveRecentToken(chainId, token);
    onValueChange(token);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange} presentation={presentations[mode]}>
      <DialogContent
        closeLabel="Close token picker"
        className="flex max-h-[min(36rem,85vh)] flex-col sm:data-[presentation=dialog]:max-w-md"
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="sr-only">
            Search by name, symbol or address.
          </DialogDescription>
        </DialogHeader>

        <Command
          query={query}
          onQueryChange={(next) => setQuery(next)}
          filter={false}
          status={isLoading ? "loading" : "idle"}
          onLoadMore={hasMore ? loadMore : undefined}
          className="flex min-h-0 flex-1 flex-col gap-4"
        >
          <div className="flex items-center gap-2 rounded-lg border px-3 has-[input:focus-visible]:ring-3 has-[input:focus-visible]:ring-ring/50">
            <SearchIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
            <CommandInput
              aria-label="Search tokens"
              placeholder="Search name, symbol or address"
              className="h-10 w-full bg-transparent text-sm outline-none"
            />
          </div>

          {!query && chips.length > 0 && (
            <div role="group" aria-label="Quick picks" className="flex flex-wrap gap-2">
              {chips.map((token) => (
                <Button
                  key={key(token)}
                  type="button"
                  variant="outline"
                  onClick={() => select(token)}
                  className="h-auto gap-1.5 rounded-full py-1 pr-3 pl-1 font-normal"
                >
                  <TokenIcon symbol={token.symbol} src={token.logoURI} size={20} decorative />
                  {token.symbol}
                </Button>
              ))}
            </div>
          )}

          <CommandEmpty className="py-6 text-center text-sm text-muted-foreground not-data-empty:hidden data-loading:hidden">
            {query ? `No tokens match “${query}”.` : "No tokens on this network."}
          </CommandEmpty>

          <div className="-mx-2 flex min-h-0 flex-col gap-0.5 overflow-y-auto">
            <CommandList aria-label="Tokens" className="flex shrink-0 flex-col gap-0.5">
              {results.slice(0, visible).map((token) => (
                <CommandItem
                  key={key(token)}
                  value={itemValue(token)}
                  label={token.symbol}
                  onSelect={() => select(token)}
                  aria-current={(value !== undefined && key(value) === key(token)) || undefined}
                  className={cn(
                    rowClassName,
                    "cursor-pointer aria-[current]:bg-muted data-highlighted:bg-accent",
                  )}
                >
                  <TokenRowContent
                    token={token}
                    balance={balances.get(key(token))}
                    showAddress={query.startsWith("0x")}
                  />
                </CommandItem>
              ))}
            </CommandList>
            {hasMore && (
              <div className="flex flex-col items-center gap-1 px-2 py-3 text-xs text-muted-foreground">
                <span>
                  Showing {visible} of {results.length}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  aria-label="Show more tokens"
                  onClick={loadMore}
                >
                  Show more
                </Button>
              </div>
            )}
            {/* Sample rows measured into a skeleton the shape of real ones, under
                the tokens already known (usually the native currency). */}
            {isLoading && (
              <>
                <CommandStatus className="sr-only">Loading tokens…</CommandStatus>
                <Skeleton loading className="shrink-0">
                  <div aria-hidden className="flex flex-col gap-0.5">
                    {sampleTokens.map((token) => (
                      <div key={key(token)} className={rowClassName}>
                        <TokenRowContent token={token} />
                      </div>
                    ))}
                  </div>
                </Skeleton>
              </>
            )}
          </div>
        </Command>
      </DialogContent>
    </Dialog>
  );
}

/** The token picker on its own. Use it to open the picker from your own trigger. */
export function TokenSelectDialog(props: TokenSelectDialogProps) {
  return <TokenPicker {...props} />;
}

export type TokenSelectProps = Omit<TokenSelectDialogProps, "open" | "onOpenChange"> &
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

  // A plain button that opens a controlled dialog, rather than a dialog
  // trigger: an agent then finds one "Select token" control, not a button and
  // a dialog under the same name. Opening it shows the "Search tokens" list.
  return (
    <>
      <Button
        type="button"
        variant={variant}
        aria-haspopup="dialog"
        aria-expanded={open}
        // A logo sits close to the pill's edge; bare text needs more room on the curve.
        className={cn("h-10 gap-2 rounded-full pr-3", value ? "pl-1.5" : "pl-4", className)}
        {...buttonProps}
        aria-label={
          buttonProps["aria-label"] ?? (value ? `${value.symbol}, change token` : placeholder)
        }
        onClick={() => setOpen(true)}
      >
        {value && <TokenIcon symbol={value.symbol} src={value.logoURI} size={28} decorative />}
        <span className="font-semibold">{value ? value.symbol : placeholder}</span>
        <ChevronDownIcon aria-hidden className="size-4 opacity-60" />
      </Button>
      <TokenPicker
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
