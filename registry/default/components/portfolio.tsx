// Docs: https://0xui.io/blocks/portfolio.md
import {
  Collapsible,
  CollapsiblePanel,
  CollapsibleTrigger,
} from "@ui-sdk/react/collapsible";
import {
  Timeline,
  TimelineDescription,
  TimelineItem,
  TimelineTitle,
} from "@ui-sdk/react/timeline";
import { ChevronDownIcon } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { Skeleton, SkeletonBox } from "skullet/react";
import type { Address } from "viem";
import { useChainId, useConnection } from "wagmi";
import { MorphText } from "@/components/morph-text";
import { Button } from "@/components/primitives/button";
import { TokenAmount } from "@/components/token-amount";
import { TokenIcon } from "@/components/token-icon";
import { useTokenBalances, type Token } from "@/components/token-select";
import {
  normalizeBalances,
  portfolioPhase,
  summarizePortfolio,
  type HiddenReason,
  type PortfolioBalances,
  type PortfolioFilters,
  type PortfolioHolding,
  type PortfolioRow,
} from "@/lib/portfolio-core";
import type { TokenPrices } from "@/lib/token-list";
import { cn } from "@/lib/utils";

export {
  hiddenReason,
  portfolioPhase,
  summarizePortfolio,
  type HiddenReason,
  type PortfolioFilters,
  type PortfolioHolding,
  type PortfolioPhase,
  type PortfolioRow,
  type PortfolioSummary,
} from "@/lib/portfolio-core";

/**
 * Holdings for a token list, valued with `prices` and sorted by value, then
 * by amount for tokens without a price. Likely spam, unpriced tokens and
 * dust go to `hidden` rather than `rows`, so the total isn't inflated and
 * nothing is lost: show them on request. The logic lives in
 * `summarizePortfolio` (framework-free).
 *
 * Pass `holdings` when your indexer returns tokens with their own metadata.
 * Tokens on the list keep the list's metadata. The rest are hidden as
 * `unlisted` unless `showUnlisted` is set.
 */
export function usePortfolio({
  tokens = noTokens,
  prices,
  address,
  chainId: chainIdProp,
  hideZero = true,
  balances: balancesProp,
  holdings,
  isSpam,
  showUnlisted,
  hideUnpriced,
  minValue,
}: {
  tokens?: readonly Token[];
  prices?: TokenPrices;
  address?: Address;
  chainId?: number;
  hideZero?: boolean;
  /** Balances from your own source (e.g. an indexer), keyed by token address. Skips RPC reads. */
  balances?: PortfolioBalances;
  /** Holdings from your own source, each with its token's metadata. Skips RPC reads and wins over `balances`. */
  holdings?: readonly PortfolioHolding[];
} & PortfolioFilters) {
  const currentChainId = useChainId();
  const chainId = chainIdProp ?? currentChainId;
  const onChain = useMemo(() => tokens.filter((t) => t.chainId === chainId), [tokens, chainId]);
  const external = Boolean(balancesProp || holdings);
  const rpc = useTokenBalances(onChain, { chainId, address, enabled: !external });
  const balances = useMemo(
    () => (balancesProp ? normalizeBalances(balancesProp) : rpc.balances),
    [balancesProp, rpc.balances],
  );

  const summary = useMemo(
    () =>
      summarizePortfolio({
        tokens: onChain,
        chainId,
        balances,
        holdings,
        prices,
        hideZero,
        isSpam,
        showUnlisted,
        hideUnpriced,
        minValue,
      }),
    [onChain, chainId, balances, holdings, prices, hideZero, isSpam, showUnlisted, hideUnpriced, minValue],
  );

  return {
    ...summary,
    isLoading: !external && rpc.isLoading,
    isError: !external && rpc.isError,
  };
}

const noTokens: readonly Token[] = [];
const noHoldings: readonly PortfolioHolding[] = [];

export type PortfolioProps = PortfolioFilters & {
  /** Tokens to show. With `holdings`, the allowlist: holdings off it are hidden unless `showUnlisted`. */
  tokens?: readonly Token[];
  /** Prices keyed by `chainId:address`, address or symbol. Tokens without one are hidden by default. */
  prices?: TokenPrices;
  /** Whose holdings. Defaults to the connected account. */
  address?: Address;
  chainId?: number;
  /** Hide tokens with a zero balance. */
  hideZero?: boolean;
  currency?: string;
  /** BCP 47 locale for amounts and values. Defaults to the runtime locale; set it when rendering on a server. */
  locale?: string;
  /** Balances from your own source, e.g. an indexer. See usePortfolio. */
  balances?: ReadonlyMap<string, bigint> | Record<string, bigint>;
  /** Holdings from your own source, each with its token's metadata. See usePortfolio. */
  holdings?: readonly PortfolioHolding[];
  /**
   * Your own `balances` or `holdings` are still loading, e.g. `query.isLoading`.
   * Shows the skeleton and skips RPC reads. Set over data you already have
   * (a refetch), the skeleton takes that data's exact shape.
   */
  isLoading?: boolean;
  /** Rows per page, with "Show more" for the rest. */
  pageSize?: number;
  title?: ReactNode;
  className?: string;
};

function ShowMore({
  remaining,
  what,
  onClick,
}: {
  remaining: number;
  /** Read out after "Show more", so the two lists' buttons have names of their own. */
  what: string;
  onClick: () => void;
}) {
  return (
    <Button
      variant="ghost"
      onClick={onClick}
      className="h-auto self-center rounded-md px-3 py-1.5 dark:hover:bg-muted"
    >
      {/* One run of text, so the button lays out as "Show more (5)". */}
      <span>
        Show more <span className="sr-only">{what}</span> ({remaining})
      </span>
    </Button>
  );
}

/** SkeletonBox is a block by default. This one sits in a line of text. */
const inlineBox = { display: "inline-block", verticalAlign: "middle" } as const;

/** Stand-in rows the loading skeleton is measured from. Never shown as text. */
const sampleRow = (index: number, name: string, balance: bigint, value: number): PortfolioRow => ({
  token: {
    chainId: 0,
    address: `0x${String(index).padStart(40, "0")}`,
    name,
    symbol: "TKN",
    decimals: 18,
  },
  balance,
  value,
});
const sampleRows = [
  sampleRow(1, "Sample token", 1_234_500_000_000_000_000n, 3210.55),
  sampleRow(2, "Another token", 250_000_000_000_000_000_000n, 250.1),
  sampleRow(3, "Third one", 4_200_000_000_000_000_000n, 42.07),
];

function Holding({
  row,
  money,
  locale,
  note,
}: {
  row: PortfolioRow;
  money: Intl.NumberFormat;
  locale?: string;
  note?: string;
}) {
  const { token, balance, value } = row;
  // The spaces between parts are for the row's text, which screen readers and
  // agents read in one piece: "Ether 2 ETH $6,000.00". Flex layout drops them.
  return (
    <TimelineItem
      data-hidden={row.hidden}
      className="flex items-center gap-3 rounded-sm py-2 outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
    >
      {/* Spam logos can be offensive or link to scams: letters only. */}
      <TokenIcon symbol={token.symbol} src={row.hidden === "spam" ? undefined : token.logoURI} size={32} />
      {/* Focused with the arrow keys, a row reads as its title, the token and
          amount, then its description, the value. */}
      <TimelineTitle className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-medium">{token.name}</span>{" "}
        <TokenAmount
          value={balance}
          decimals={token.decimals}
          symbol={token.symbol}
          locale={locale}
          className="truncate text-xs text-muted-foreground"
        />
      </TimelineTitle>{" "}
      <TimelineDescription className="flex shrink-0 flex-col items-end text-sm tabular-nums">
        {value === undefined ? <span className="text-muted-foreground">—</span> : money.format(value)}{" "}
        {note && <span className="text-xs text-muted-foreground">{note}</span>}
      </TimelineDescription>
    </TimelineItem>
  );
}

/**
 * Token holdings list: total value on top, then one row per token with
 * amount and value, largest first. Likely spam, tokens without a price and
 * dust are collapsed under "Hidden tokens", out of the total. Shows a skeleton
 * measured from sample rows while loading and an empty state when there's nothing to show.
 */
export function Portfolio({
  tokens,
  prices,
  address: addressProp,
  chainId,
  hideZero = true,
  currency = "USD",
  locale,
  balances,
  holdings,
  isLoading: isLoadingProp = false,
  isSpam,
  showUnlisted,
  hideUnpriced,
  minValue = 0.5,
  pageSize = 10,
  title = "Portfolio",
  className,
}: PortfolioProps) {
  const [visible, setVisible] = useState(pageSize);
  const [hiddenVisible, setHiddenVisible] = useState(pageSize);
  const { address: connected } = useConnection();
  const address = addressProp ?? connected;
  const { rows, hidden, total, unpriced, isLoading, isError } = usePortfolio({
    tokens,
    prices,
    address,
    chainId,
    hideZero,
    balances,
    // Your own data is on its way: don't fall back to RPC reads meanwhile.
    holdings: holdings ?? (isLoadingProp && !balances ? noHoldings : undefined),
    isSpam,
    showUnlisted,
    hideUnpriced,
    minValue,
  });
  const money = new Intl.NumberFormat(locale, { style: "currency", currency });
  const notes: Record<HiddenReason, string> = {
    spam: "Likely spam",
    unlisted: "Not on the token list",
    unpriced: "No price",
    dust: `Under ${money.format(minValue)}`,
  };
  const phase = portfolioPhase({
    loadingProp: isLoadingProp,
    hasSource: Boolean(address || balances || holdings),
    isLoading,
    isError,
    count: rows.length + hidden.length,
  });
  // The skeleton is measured from what will be shown: the real rows when they
  // are already known (your own data, a refetch), sample rows otherwise.
  const known = rows.length > 0 || hidden.length > 0;
  const listRows = phase === "loading" && !known ? sampleRows : rows.slice(0, visible);

  return (
    <section
      data-slot="portfolio"
      data-phase={phase}
      aria-label={typeof title === "string" ? title : "Portfolio"}
      className={cn("flex flex-col gap-3 rounded-2xl border p-4", className)}
    >
      <header className="flex items-baseline justify-between gap-2">
        {title && <h3 className="font-semibold">{title}</h3>}
        {phase === "loading" && (
          <span className="text-2xl font-semibold">
            {/* About the width of "$1,234.56". */}
            <SkeletonBox width="9ch" height="1em" style={inlineBox} />
          </span>
        )}
        {phase === "ready" && (
          <span className="text-2xl font-semibold tabular-nums">
            <MorphText>{money.format(total)}</MorphText>
            {unpriced > 0 && <span className="sr-only">, plus {unpriced} tokens without a price</span>}
          </span>
        )}
      </header>

      {phase === "idle" && (
        <p className="py-6 text-center text-sm text-muted-foreground">Connect a wallet to see its tokens.</p>
      )}
      {phase === "error" && (
        <p role="alert" className="py-6 text-center text-sm text-destructive">
          Couldn't load balances. Check your connection and try again.
        </p>
      )}
      {phase === "empty" && (
        <p className="py-6 text-center text-sm text-muted-foreground">No tokens from this list in this wallet.</p>
      )}

      {/* One tree for loading and ready: while loading it is measured into a
          skeleton, so the content arrives exactly where its skeleton was. */}
      {(phase === "loading" || phase === "ready") && (
        <Skeleton loading={phase === "loading"} label="Loading tokens">
          <div className="flex flex-col gap-3">
            {phase === "ready" && rows.length === 0 && (
              <p className="py-4 text-center text-sm text-muted-foreground">Every token in this wallet is hidden.</p>
            )}
            {listRows.length > 0 && (
              // A list with arrow keys between rows, and rows an agent can find by text.
              <Timeline aria-label="Token holdings" className="flex flex-col">
                {listRows.map((row) => (
                  <Holding
                    key={`${row.token.chainId}-${row.token.address}`}
                    row={row}
                    money={money}
                    locale={locale}
                  />
                ))}
              </Timeline>
            )}
            {rows.length > visible && (
              <ShowMore
                remaining={rows.length - visible}
                what="holdings"
                onClick={() => setVisible((v) => v + pageSize)}
              />
            )}

            {hidden.length > 0 && (
              <Collapsible className="group/hidden flex flex-col border-t pt-2">
                <CollapsibleTrigger className="flex items-center justify-between rounded-md py-1.5 text-sm text-muted-foreground hover:text-foreground">
                  Hidden tokens ({hidden.length})
                  <ChevronDownIcon
                    aria-hidden
                    className="size-4 transition-transform group-data-open/hidden:rotate-180"
                  />
                </CollapsibleTrigger>
                <CollapsiblePanel className="flex flex-col">
                  <Timeline aria-label="Hidden holdings" className="flex flex-col opacity-80">
                    {hidden.slice(0, hiddenVisible).map((row) => (
                      <Holding
                        key={`${row.token.chainId}-${row.token.address}`}
                        row={row}
                        money={money}
                        locale={locale}
                        note={notes[row.hidden!]}
                      />
                    ))}
                  </Timeline>
                  {hidden.length > hiddenVisible && (
                    <ShowMore
                      remaining={hidden.length - hiddenVisible}
                      what="hidden tokens"
                      onClick={() => setHiddenVisible((v) => v + pageSize)}
                    />
                  )}
                </CollapsiblePanel>
              </Collapsible>
            )}
          </div>
        </Skeleton>
      )}
    </section>
  );
}
