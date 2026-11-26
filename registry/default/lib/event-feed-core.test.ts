import { encodeAbiParameters, encodeEventTopics, erc20Abi } from "viem";
import type { Hash } from "viem";
import { describe, expect, it, vi } from "vitest";
import { createTestConfig, fakeChainRpc, fakeTxHash, testAccounts } from "../../../test/wagmi";
import {
  createEventWatcher,
  eventFilterKey,
  eventHistoryQueryOptions,
  mergeFeedEvents,
} from "./event-feed-core";
import type { FeedEvent } from "./event-feed-core";

const usdc = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const rpcLog = {
  address: usdc,
  topics: encodeEventTopics({
    abi: erc20Abi,
    eventName: "Transfer",
    args: { from: testAccounts[0], to: testAccounts[1] },
  }),
  data: encodeAbiParameters([{ type: "uint256" }], [5n]),
  blockNumber: "0x65",
  blockHash: `0x${"33".repeat(32)}`,
  transactionHash: fakeTxHash,
  transactionIndex: "0x0",
  logIndex: "0x0",
  removed: false,
};

const event = (hash: Hash, blockNumber: bigint, logIndex = 0) =>
  ({ transactionHash: hash, blockNumber, logIndex }) as FeedEvent;

describe("event-feed", () => {
  it("merges sources newest first, without duplicates", () => {
    const a = event(`0x${"01".repeat(32)}`, 10n);
    const b = event(`0x${"02".repeat(32)}`, 12n);
    const c = event(`0x${"02".repeat(32)}`, 12n, 1);
    expect(
      mergeFeedEvents(
        [
          [a, b],
          [b, c],
        ],
        10,
      ),
    ).toEqual([c, b, a]);
    expect(mergeFeedEvents([[a, b, c]], 2)).toEqual([c, b]);
  });

  it("keys filters by value, bigints included", () => {
    expect(eventFilterKey({ address: usdc, args: { value: 1n } })).toBe(
      eventFilterKey({ address: usdc, args: { value: 1n } }),
    );
  });

  it("loads recent history", async () => {
    const getLogs = vi.fn(() => [rpcLog]);
    const config = createTestConfig({ rpc: { ...fakeChainRpc(), eth_getLogs: getLogs } });
    const options = eventHistoryQueryOptions(config, {
      address: usdc,
      abi: erc20Abi,
      eventName: "Transfer",
      blocks: 10,
    });
    const logs = await options.queryFn();

    expect(logs[0]).toMatchObject({ eventName: "Transfer", args: { value: 5n } });
    expect(getLogs).toHaveBeenCalledOnce();
    expect(
      eventHistoryQueryOptions(config, { address: usdc, abi: erc20Abi, blocks: 0 }).enabled,
    ).toBe(false);
  });

  it("watches new events only while subscribed", async () => {
    let delivered = false;
    const config = createTestConfig({
      rpc: {
        ...fakeChainRpc(),
        eth_newFilter: "0x1",
        eth_uninstallFilter: true,
        eth_getFilterChanges: () => (delivered ? [] : ((delivered = true), [rpcLog])),
      },
    });
    const watcher = createEventWatcher(config, {
      address: usdc,
      abi: erc20Abi,
      eventName: "Transfer",
    });
    const stop = watcher.subscribe(() => {});

    await vi.waitFor(() => expect(watcher.get().events).toHaveLength(1), { timeout: 3000 });
    expect(watcher.get().events[0]).toMatchObject({
      eventName: "Transfer",
      args: { to: testAccounts[1] },
    });
    stop();
    watcher.clear();
    expect(watcher.get().events).toEqual([]);
  });
});
