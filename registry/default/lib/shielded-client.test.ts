import { describe, expect, it } from "vitest";
import { createMockShieldedEngine } from "./mock-shielded-engine";
import { createShieldedClient } from "./shielded-client";

describe("createShieldedClient", () => {
  it("follows the account without any framework, and keeps its snapshot stable", async () => {
    const engine = createMockShieldedEngine({ speed: Infinity });
    const client = createShieldedClient(engine);
    const first = client.account.get();
    expect(first).toEqual({ status: "locked", address: null });
    expect(client.account.get()).toBe(first);

    let changes = 0;
    const stop = client.account.subscribe(() => changes++);
    await engine.account.unlock("password");
    expect(changes).toBeGreaterThan(0);
    expect(client.account.get().status).toBe("unlocked");
    expect(client.account.get().address).toHaveLength(127);
    stop();
  });

  it("selects one piece of engine state", async () => {
    const engine = createMockShieldedEngine({ speed: Infinity });
    const client = createShieldedClient(engine);
    const synced = client.select("sync", (e) => e.getSync(1).status);
    expect(synced.get()).toBe("idle");
    await engine.account.unlock("password");
    await engine.sync(1);
    expect(synced.get()).toBe("synced");
  });
});
