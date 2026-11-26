import { getBlockNumber, getContractEvents, watchContractEvent } from "@wagmi/core";
import type { Config } from "@wagmi/core";
import { hashFn } from "@wagmi/core/query";
import { isAddress } from "viem";
import type { Abi, Address, Log } from "viem";
import { createStore } from "@/lib/0xui-store";
import { truncateAddress } from "@/lib/0xui-utils";

export type FeedEvent = Log & {
  eventName?: string;
  args?: Record<string, unknown> | ReadonlyArray<unknown>;
};

export type EventFeedFilter = {
  address: Address;
  abi: Abi;
  /** Event to follow. Omit for every event in the ABI. */
  eventName?: string;
  /** Indexed-argument filter, e.g. `{ to: myAddress }`. */
  args?: Record<string, unknown>;
  chainId?: number;
};

/** Unique per log: its transaction and its place in it. */
export function feedEventId(log: FeedEvent) {
  return `${log.transactionHash}-${log.logIndex}`;
}

function newestFirst(a: FeedEvent, b: FeedEvent) {
  const block = Number((b.blockNumber ?? 0n) - (a.blockNumber ?? 0n));
  return block || (b.logIndex ?? 0) - (a.logIndex ?? 0);
}

/** Events from several sources, de-duplicated, newest first, at most `max`. */
export function mergeFeedEvents(sources: ReadonlyArray<ReadonlyArray<FeedEvent>>, max: number) {
  const seen = new Set<string>();
  return sources
    .flat()
    .filter((log) => {
      const id = feedEventId(log);
      if (seen.has(id)) {
        return false;
      }
      seen.add(id);
      return true;
    })
    .sort(newestFirst)
    .slice(0, max);
}

/** Short display text for an event argument. */
export function formatEventArg(value: unknown): string {
  if (typeof value === "bigint") {
    return value.toLocaleString();
  }
  if (typeof value === "string" && isAddress(value)) {
    return truncateAddress(value);
  }
  if (typeof value === "string" && value.startsWith("0x") && value.length > 20) {
    return truncateAddress(value, { start: 10, end: 6 });
  }
  if (Array.isArray(value)) {
    return `[${value.map(formatEventArg).join(", ")}]`;
  }
  return String(value);
}

/** A string that changes only when the filter does, for memo keys. Arguments may be bigints. */
export function eventFilterKey({
  address,
  eventName,
  args,
  chainId,
}: Omit<EventFeedFilter, "abi">) {
  return hashFn([address, eventName, args, chainId]);
}

/**
 * TanStack query options for a contract's events in the last `blocks`
 * blocks. Keep `blocks` small: public RPCs cap log ranges.
 */
export function eventHistoryQueryOptions(
  config: Config,
  { blocks, ...filter }: EventFeedFilter & { blocks: number },
) {
  const { address, abi, eventName, args, chainId } = filter;
  return {
    queryKey: ["0xui", "event-feed", chainId, address, eventName, args, blocks] as const,
    // Indexed arguments can be bigints, which the default hash can't serialize.
    queryKeyHashFn: hashFn,
    queryFn: async () => {
      const latest = await getBlockNumber(config, { chainId });
      const logs = await getContractEvents(config, {
        address,
        abi,
        eventName,
        args,
        chainId,
        fromBlock: latest - BigInt(blocks) + 1n,
        toBlock: latest,
      });
      return logs as Array<FeedEvent>;
    },
    enabled: blocks > 0,
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  };
}

export type EventWatcherState = {
  /** Events received since watching started, latest batch first. */
  events: ReadonlyArray<FeedEvent>;
};

export type EventWatcher = {
  get(): EventWatcherState;
  subscribe(listener: () => void): () => void;
  /** Forget the events received so far. */
  clear(): void;
};

/**
 * Watches a contract for new events while something subscribes, keeping up
 * to `keep` of them. Framework-free.
 */
export function createEventWatcher(
  config: Config,
  { keep = 40, ...filter }: EventFeedFilter & { keep?: number },
): EventWatcher {
  const store = createStore<EventWatcherState>({ events: [] }, (store) =>
    watchContractEvent(config, {
      address: filter.address,
      abi: filter.abi,
      eventName: filter.eventName,
      args: filter.args,
      chainId: filter.chainId,
      onLogs: (logs: ReadonlyArray<Log>) =>
        store.set(({ events }) => ({
          events: [...logs, ...events].slice(0, keep),
        })),
    }),
  );
  return {
    get: store.get,
    subscribe: store.subscribe,
    clear: () => store.set({ events: [] }),
  };
}
