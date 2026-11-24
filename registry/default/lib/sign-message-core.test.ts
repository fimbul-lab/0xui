import { connect } from "@wagmi/core";
import type { Address } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { describe, expect, it, vi } from "vitest";
import { createTestConfig } from "../../../test/wagmi";
import { createMessageSigner, type SignPhase } from "./sign-message-core";

const signer = privateKeyToAccount(generatePrivateKey());
const signingConfig = (sign = signer) =>
  createTestConfig({
    accounts: [signer.address],
    rpc: {
      eth_sign: ([, raw]: [Address, `0x${string}`]) => sign.signMessage({ message: { raw } }),
    },
  });

describe("createMessageSigner", () => {
  it("signs and verifies without any framework", async () => {
    const config = signingConfig();
    await connect(config, { connector: config.connectors[0]! });
    const flow = createMessageSigner(config);
    const phases: SignPhase[] = [];
    const stop = flow.subscribe(() => phases.push(flow.get().phase));
    const onSigned = vi.fn();

    const signature = await flow.sign({ message: "hello" }, { verify: true, onSigned });
    expect(signature).toMatch(/^0x[0-9a-f]{130}$/);
    expect(onSigned).toHaveBeenCalledWith(signature);
    expect([...new Set(phases)]).toEqual(["signing", "verifying", "signed"]);
    expect(flow.get()).toMatchObject({ signature, address: signer.address });
    flow.reset();
    expect(flow.get()).toMatchObject({ phase: "idle", signature: undefined });
    stop();
  });

  it("flags a signature from another account", async () => {
    const config = signingConfig(privateKeyToAccount(generatePrivateKey()));
    await connect(config, { connector: config.connectors[0]! });
    const flow = createMessageSigner(config);

    await flow.sign({ message: "hello" }, { verify: true });
    expect(flow.get().phase).toBe("invalid");
  });

  it("reports a wallet rejection as cancelled", async () => {
    const config = createTestConfig({ features: { signMessageError: true } });
    await connect(config, { connector: config.connectors[0]! });
    const flow = createMessageSigner(config);

    expect(await flow.sign({ message: "hello" })).toBeUndefined();
    expect(flow.get().phase).toBe("cancelled");
  });

  it("does nothing without a wallet", async () => {
    const flow = createMessageSigner(createTestConfig());
    expect(await flow.sign({ message: "hello" })).toBeUndefined();
    expect(flow.get()).toMatchObject({ phase: "idle", address: undefined });
  });
});
