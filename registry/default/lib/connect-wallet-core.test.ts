import type { Connector } from "@wagmi/core";
import { describe, expect, it } from "vitest";
import { createTestConfig } from "../../../test/wagmi";
import { createConnectWallet, walletOptions } from "./connect-wallet-core";

const connector = (id: string, extra: Partial<Connector> = {}) =>
  ({ id, name: id, uid: id, ...extra }) as Connector;

describe("walletOptions", () => {
  it("puts the recent wallet first, then installed ones, and drops a duplicate injected", () => {
    const options = walletOptions(
      [
        connector("injected"),
        connector("walletConnect"),
        connector("io.rabby", { rdns: "io.rabby" }),
        connector("io.metamask", { rdns: "io.metamask" }),
      ],
      "io.metamask",
    );
    expect(options.map((o) => o.id)).toEqual(["io.metamask", "io.rabby", "walletConnect"]);
    expect(options[0]).toMatchObject({ recent: true, installed: true });
  });

  it("names a lone injected connector", () => {
    expect(walletOptions([connector("injected")])[0]!.name).toBe("Browser wallet");
  });
});

describe("createConnectWallet", () => {
  it("connects without any framework", async () => {
    const config = createTestConfig();
    const controller = createConnectWallet(config);
    const phases: string[] = [];
    const stop = controller.subscribe(() => phases.push(controller.get().phase));
    const [wallet] = controller.get().wallets;

    expect(wallet!.name).toBe("Mock Connector");
    expect(await controller.connect(wallet!)).toBe(true);
    expect(phases).toContain("connecting");
    expect(controller.get()).toMatchObject({ phase: "idle", pendingId: undefined });
    expect(config.state.status).toBe("connected");
    stop();
  });

  it("reports a rejection as cancelled", async () => {
    const config = createTestConfig({ features: { connectError: true } });
    const controller = createConnectWallet(config);

    expect(await controller.connect(controller.get().wallets[0]!)).toBe(false);
    expect(controller.get().phase).toBe("cancelled");
    controller.reset();
    expect(controller.get()).toMatchObject({ phase: "idle", error: null });
  });

  it("reports other failures as errors", async () => {
    const config = createTestConfig({ features: { connectError: new Error("Wallet is locked") } });
    const controller = createConnectWallet(config);

    await controller.connect(controller.get().wallets[0]!);
    expect(controller.get().phase).toBe("error");
    expect(controller.get().error?.message).toContain("Wallet is locked");
  });
});
