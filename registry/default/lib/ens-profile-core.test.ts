import { describe, expect, it } from "vitest";
import { createTestConfig, ensResolveRpc, testAccounts } from "../../../test/wagmi";
import { ensProfileLinks, ensProfilePhase, ensProfileQueryOptions } from "./ens-profile-core";

describe("ens-profile", () => {
  it("resolves a name to its address and records", async () => {
    const config = createTestConfig({
      rpc: {
        eth_call: ensResolveRpc(
          { "vitalik.eth": testAccounts[0] },
          { "vitalik.eth": { description: "hi", url: "vitalik.ca" } },
        ),
      },
    });
    const options = ensProfileQueryOptions(config, { name: "Vitalik.eth", records: ["description", "url"] });
    const data = await options.queryFn();

    expect(data).toEqual({
      name: "vitalik.eth",
      address: testAccounts[0],
      records: { description: "hi", url: "vitalik.ca" },
    });
    expect(ensProfilePhase({ name: "Vitalik.eth" }, data, false)).toBe("ready");
  });

  it("is not found when a name points nowhere", async () => {
    const config = createTestConfig({ rpc: { eth_call: ensResolveRpc({}) } });
    const data = await ensProfileQueryOptions(config, { name: "nobody.eth", records: [] }).queryFn();
    expect(data.address).toBeUndefined();
    expect(ensProfilePhase({ name: "nobody.eth" }, data, false)).toBe("not-found");
    expect(ensProfileQueryOptions(config, {}).enabled).toBe(false);
  });

  it("turns known records into links", () => {
    expect(ensProfileLinks({ email: "a@b.c", "com.twitter": "@vitalik", description: "bio" })).toEqual([
      { key: "com.twitter", label: "X", href: "https://x.com/vitalik", text: "@vitalik" },
      { key: "email", label: "Email", href: "mailto:a@b.c", text: "a@b.c" },
    ]);
  });
});
