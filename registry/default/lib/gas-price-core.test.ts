import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { createTestConfig } from "../../../test/wagmi";
import { gasPriceQueryOptions } from "./gas-price-core";

describe("gasPriceQueryOptions", () => {
  it("reads the gas price on the requested chain without any framework", async () => {
    const config = createTestConfig({ rpc: { eth_gasPrice: "0xba43b7400" } });
    const options = gasPriceQueryOptions(config, { chainId: 11155111, refreshInterval: false });
    expect(options.refetchInterval).toBe(false);
    expect(options.queryKey[1]).toMatchObject({ chainId: 11155111 });
    expect(await new QueryClient().fetchQuery(options)).toBe(50_000_000_000n);
  });
});
