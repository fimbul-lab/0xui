import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { createTestConfig, ensResolveRpc, testAccounts } from "../../../test/wagmi";
import {
  addressInputMessage,
  addressInputState,
  ensAddressQueryOptions,
  parseAddressInput,
} from "./address-input-core";
import type { AddressLookups } from "./address-input-core";

const vitalik = testAccounts[0];
const idle: AddressLookups = {
  ens: { data: undefined, isPending: true, isError: false },
  nameSettled: true,
  reverseName: undefined,
};

describe("parseAddressInput", () => {
  it("sorts text into its kind", () => {
    expect(parseAddressInput("  ")).toEqual({ kind: "empty" });
    expect(parseAddressInput(vitalik.toLowerCase())).toEqual({
      kind: "address",
      text: vitalik.toLowerCase(),
      address: vitalik,
    });
    expect(parseAddressInput("0x12")).toMatchObject({ kind: "address", address: undefined });
    expect(parseAddressInput("Vitalik.eth")).toEqual({ kind: "name", name: "vitalik.eth" });
    expect(parseAddressInput("0zk1abc")).toEqual({ kind: "shielded", text: "0zk1abc" });
    expect(parseAddressInput("0zk.eth")).toEqual({ kind: "name", name: "0zk.eth" });
    expect(parseAddressInput("hello")).toEqual({ kind: "other" });
  });
});

describe("addressInputState", () => {
  it("catches a checksum typo", () => {
    const typo = vitalik.replace("dA6", "Da6");
    expect(addressInputState(parseAddressInput(typo), idle)).toMatchObject({
      phase: "invalid",
      error: "Checksum doesn't match. Check the address for typos.",
    });
  });

  it("waits for typing to pause before a name resolves", () => {
    const name = parseAddressInput("vitalik.eth");
    expect(addressInputState(name, { ...idle, nameSettled: false }).phase).toBe("resolving");
    const resolved = addressInputState(name, {
      ...idle,
      ens: { data: vitalik, isPending: false, isError: false },
    });
    expect(resolved).toMatchObject({ phase: "valid", address: vitalik, ensName: "vitalik.eth" });
    expect(addressInputMessage(resolved, "vitalik.eth", false)).toBe("0xd8dA…6045");
  });

  it("turns private addresses down unless they're allowed", () => {
    expect(addressInputState(parseAddressInput("0zk1abc"), idle).phase).toBe("invalid");
    expect(addressInputState(parseAddressInput("0zk1abc"), idle, { shielded: true }).phase).toBe(
      "incomplete",
    );
  });
});

describe("ensAddressQueryOptions", () => {
  it("resolves a name without React", async () => {
    const config = createTestConfig({
      rpc: { eth_call: ensResolveRpc({ "vitalik.eth": vitalik }) },
    });
    const client = new QueryClient();
    expect(await client.fetchQuery(ensAddressQueryOptions(config, { name: "vitalik.eth" }))).toBe(
      vitalik,
    );
  });
});
