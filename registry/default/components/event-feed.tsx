// Docs: https://0xui.io/components/event-feed.md
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState, type ReactNode } from "react";
import { isAddress, type Abi, type Address, type Log } from "viem";
import { usePublicClient, useWatchContractEvent } from "wagmi";
import { ExplorerLink } from "@/components/explorer-link";
import { truncateAddress } from "@/lib/0xui-utils";
import { cn } from "@/lib/utils";

export type FeedEvent = Log & {
  eventName?: string;
  args?: Record<string, unknown> | readonly unknown[];
};

const logId = (log: FeedEvent) => `${log.transactionHash}-${log.logIndex}`;

function newestFirst(a: FeedEvent, b: FeedEvent) {
  const block = Number((b.blockNumber ?? 0n) - (a.blockNumber ?? 0n));
  return block || (b.logIndex ?? 0) - (a.logIndex ?? 0);
}

export type UseEventFeedParameters = {
  address: Address;
  abi: Abi;
  /** Event to follow. Omit for every event in the ABI. */
  eventName?: string;
  /** Indexed-argument filter, e.g. `{ to: myAddress }`. */
  args?: Record<string, unknown>;
  chainId?: number;
  /** Also load events from this many recent blocks. Keep it small: public RPCs cap log ranges. */
  historyBlocks?: number;
  /** Keep at most this many events. */
  max?: number;
  /**
   * Past events from your own source, e.g. an indexer. Shown alongside
   * live events and de-duplicated. Prefer this over `historyBlocks` in
   * production.
   */
  initialEvents?: readonly FeedEvent[];
};

/** Contract events, newest first: optional recent history plus live updates. */
export function useEventFeed({
  address,
  abi,
  eventName,
  args,
  chainId,
  historyBlocks = 0,
  max = 20,
  initialEvents,
}: UseEventFeedParameters) {
  const client = usePublicClient({ chainId });
  const [live, setLive] = useState<FeedEvent[]>([]);

  const history = useQuery({
    queryKey: ["0xui", "event-feed", chainId, address, eventName, args, historyBlocks],
    queryFn: async () => {
      const latest = await client!.getBlockNumber();
      const logs = await client!.getContractEvents({
        address,
        abi,
        eventName,
        args,
        fromBlock: latest - BigInt(historyBlocks) + 1n,
        toBlock: latest,
      });
      return logs as FeedEvent[];
    },
    enabled: Boolean(client) && historyBlocks > 0,
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  });

  useWatchContractEvent({
    address,
    abi,
    eventName,
    args,
    chainId,
    onLogs: (logs: Log[]) => setLive((prev) => [...(logs as FeedEvent[]), ...prev].slice(0, max * 2)),
  });

  const events = useMemo(() => {
    const seen = new Set<string>();
    return [...live, ...(history.data ?? []), ...(initialEvents ?? [])]
      .filter((log) => {
        const id = logId(log);
        if (seen.has(id)) return false;
        seen.add(id);
        return true;
      })
      .sort(newestFirst)
      .slice(0, max);
  }, [live, history.data, initialEvents, max]);

  return { events, isLoadingHistory: history.isLoading, historyError: history.error };
}

/** Short display text for an event argument. */
export function formatEventArg(value: unknown): string {
  if (typeof value === "bigint") return value.toLocaleString();
  if (typeof value === "string" && isAddress(value)) return truncateAddress(value);
  if (typeof value === "string" && value.startsWith("0x") && value.length > 20)
    return truncateAddress(value, { start: 10, end: 6 });
  if (Array.isArray(value)) return `[${value.map(formatEventArg).join(", ")}]`;
  return String(value);
}

export type EventFeedProps = UseEventFeedParameters & {
  /** Custom row content. Defaults to the event name and its arguments. */
  renderEvent?: (event: FeedEvent) => ReactNode;
  title?: ReactNode;
  className?: string;
};

/**
 * Live feed of a contract's events, e.g. Transfers or Swaps, newest first,
 * each linked to its transaction. Announced politely to screen readers as a
 * log.
 */
export function EventFeed({
  renderEvent,
  title = "Live events",
  className,
  ...params
}: EventFeedProps) {
  const { events, isLoadingHistory, historyError } = useEventFeed(params);

  return (
    <section
      data-slot="event-feed"
      aria-label={typeof title === "string" ? title : "Live events"}
      className={cn("flex flex-col gap-2 rounded-2xl border p-4", className)}
    >
      <header className="flex items-center gap-2">
        <span aria-hidden className="size-2 animate-pulse rounded-full bg-emerald-500 motion-reduce:animate-none" />
        {title && <h3 className="font-semibold">{title}</h3>}
      </header>
      {historyError && (
        <p className="text-xs text-muted-foreground">
          Couldn't load past events. Showing new ones as they arrive.
        </p>
      )}
      <ol role="log" aria-live="polite" className="flex flex-col divide-y">
        {events.length === 0 ? (
          <li className="py-4 text-center text-sm text-muted-foreground">
            {isLoadingHistory ? "Loading recent events…" : "Waiting for events…"}
          </li>
        ) : (
          events.map((event) => (
            <li key={logId(event)} className="flex items-start gap-3 py-2 text-sm">
              <div className="min-w-0 flex-1">
                {renderEvent ? (
                  renderEvent(event)
                ) : (
                  <>
                    <span className="font-medium">{event.eventName ?? "Event"}</span>
                    {event.args && (
                      <dl className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                        {Object.entries(event.args).map(([key, value]) => (
                          <div key={key} className="flex gap-1">
                            <dt>{key}</dt>
                            <dd className="font-mono text-foreground">{formatEventArg(value)}</dd>
                          </div>
                        ))}
                      </dl>
                    )}
                  </>
                )}
              </div>
              {event.transactionHash && (
                <ExplorerLink
                  tx={event.transactionHash}
                  chainId={params.chainId}
                  icon={false}
                  className="shrink-0 text-xs text-muted-foreground"
                >
                  {event.blockNumber !== null ? `#${event.blockNumber.toLocaleString()}` : "View"}
                </ExplorerLink>
              )}
            </li>
          ))
        )}
      </ol>
    </section>
  );
}
