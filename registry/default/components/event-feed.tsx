// Docs: https://0xui.io/components/event-feed.md
import { useQuery } from "@tanstack/react-query";
import { Timeline, TimelineDescription, TimelineItem, TimelineTitle } from "@ui-sdk/react/timeline";
import { useMemo, type ReactNode } from "react";
import type { Abi, Address } from "viem";
import { useConfig } from "wagmi";
import { ExplorerLink } from "@/components/explorer-link";
import { useStore } from "@/hooks/use-store";
import {
  createEventWatcher,
  eventFilterKey,
  eventHistoryQueryOptions,
  feedEventId,
  formatEventArg,
  mergeFeedEvents,
  type FeedEvent,
} from "@/lib/event-feed-core";
import { cn } from "@/lib/utils";

export {
  createEventWatcher,
  eventHistoryQueryOptions,
  formatEventArg,
  mergeFeedEvents,
  type EventWatcherState,
  type FeedEvent,
} from "@/lib/event-feed-core";

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

/**
 * Contract events, newest first: optional recent history plus live updates.
 * The logic lives in `createEventWatcher` and `eventHistoryQueryOptions`
 * (framework-free).
 */
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
  const config = useConfig();
  const filterKey = eventFilterKey({ address, eventName, args, chainId });
  const history = useQuery(
    eventHistoryQueryOptions(config, {
      address,
      abi,
      eventName,
      args,
      chainId,
      blocks: historyBlocks,
    }),
  );
  // Keyed by value, so a new `args` object on each render doesn't restart the watch.
  const watcher = useMemo(
    () => createEventWatcher(config, { address, abi, eventName, args, chainId, keep: max * 2 }),
    [config, abi, filterKey, max],
  );
  const live = useStore(watcher);

  const events = useMemo(
    () => mergeFeedEvents([live.events, history.data ?? [], initialEvents ?? []], max),
    [live.events, history.data, initialEvents, max],
  );

  return { events, isLoadingHistory: history.isLoading, historyError: history.error };
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
        <span
          aria-hidden
          className="size-2 animate-pulse rounded-full bg-emerald-500 motion-reduce:animate-none"
        />
        {title && <h3 className="font-semibold">{title}</h3>}
      </header>
      {historyError && (
        <p className="text-xs text-muted-foreground">
          Couldn't load past events. Showing new ones as they arrive.
        </p>
      )}
      <div role="log" aria-live="polite">
        {events.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">
            {isLoadingHistory ? "Loading recent events…" : "Waiting for events…"}
          </p>
        ) : (
          <Timeline
            aria-label={typeof title === "string" ? title : "Live events"}
            className="flex flex-col divide-y"
          >
            {events.map((event) => (
              <TimelineItem
                key={feedEventId(event)}
                className="flex items-start gap-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                {/* The spaces between parts keep the row's text readable in one
                    piece, for screen readers and agents: "Transfer from 0x… value 42". */}
                <div className="min-w-0 flex-1">
                  {renderEvent ? (
                    renderEvent(event)
                  ) : (
                    <>
                      <TimelineTitle className="font-medium">
                        {event.eventName ?? "Event"}
                      </TimelineTitle>{" "}
                      {event.args && (
                        <TimelineDescription>
                          <dl className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                            {Object.entries(event.args).map(([key, value]) => (
                              <div key={key} className="flex gap-1">
                                <dt>{key}</dt>{" "}
                                <dd className="font-mono text-foreground">
                                  {formatEventArg(value)}
                                </dd>{" "}
                              </div>
                            ))}
                          </dl>
                        </TimelineDescription>
                      )}
                    </>
                  )}
                </div>{" "}
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
              </TimelineItem>
            ))}
          </Timeline>
        )}
      </div>
    </section>
  );
}
