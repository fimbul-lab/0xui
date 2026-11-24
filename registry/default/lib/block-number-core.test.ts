import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { createTestConfig } from "../../../test/wagmi";
import {
  blockNumberPhase,
  blockNumberQueryOptions,
  watchBlockNumberQuery,
} from "./block-number-core";

describe("blockNumberQueryOptions", () => {
  it("reads the latest block without any framework", async () => {
    const config = createTestConfig({ rpc: { eth_blockNumber: "0x1406f40" } });
    const client = new QueryClient();
    expect(await client.fetchQuery(blockNumberQueryOptions(config))).toBe(21_000_000n);
  });

  it("keeps the cache on the newest block while watched", async () => {
    let block = 100;
    const config = createTestConfig({ rpc: { eth_blockNumber: () => `0x${(block++).toString(16)}` } });
    const client = new QueryClient();
    const { queryKey } = blockNumberQueryOptions(config);
    const stop = watchBlockNumberQuery(config, client);

    await expect
      .poll(() => client.getQueryData<bigint>(queryKey))
      .toBeGreaterThanOrEqual(101n);
    stop();
  });

  it("names the phase", () => {
    expect(blockNumberPhase({ isError: true, isPending: true })).toBe("error");
    expect(blockNumberPhase({ isError: false, isPending: true })).toBe("loading");
    expect(blockNumberPhase({ isError: false, isPending: false })).toBe("live");
  });
});
