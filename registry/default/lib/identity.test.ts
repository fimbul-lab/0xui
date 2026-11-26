import { describe, expect, it } from "vitest";
import { createTestConfig } from "../../../test/wagmi";
import { addressDisplay, ensAvatarQueryOptions, ensNameQueryOptions } from "./identity";

const vitalik = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";

describe("identity", () => {
  it("shows a name, or the checksummed address truncated", () => {
    expect(addressDisplay(`0x${vitalik.slice(2).toLowerCase()}`)).toEqual({
      checksummed: vitalik,
      text: "0xd8dA…6045",
      label: vitalik,
    });
    expect(addressDisplay(vitalik, { name: "vitalik.eth" })).toMatchObject({
      text: "vitalik.eth",
      label: `vitalik.eth, ${vitalik}`,
    });
  });

  it("reads ENS on mainnet, and waits for a name before the avatar", () => {
    const config = createTestConfig();
    expect(ensNameQueryOptions(config, { address: vitalik }).queryKey[1]).toMatchObject({
      chainId: 1,
    });
    expect(ensNameQueryOptions(config, { address: vitalik, enabled: false }).enabled).toBe(false);
    expect(ensAvatarQueryOptions(config, { name: undefined }).enabled).toBe(false);
    expect(ensAvatarQueryOptions(config, { name: "Vitalik.eth" }).queryKey[1]).toMatchObject({
      name: "vitalik.eth",
    });
  });
});
