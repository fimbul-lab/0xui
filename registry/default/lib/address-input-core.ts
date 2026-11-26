import type { Config } from "@wagmi/core";
import { getEnsAddressQueryOptions, hashFn } from "@wagmi/core/query";
import { getAddress, isAddress } from "viem";
import type { Address } from "viem";
import { mainnet } from "viem/chains";
import { normalize } from "viem/ens";
import {
  SHIELDED_ADDRESS_LENGTH,
  SHIELDED_ADDRESS_PREFIX,
  isShieldedAddress,
  truncateAddress,
} from "@/lib/0xui-utils";

export type AddressInputPhase =
  | "empty"
  | "incomplete"
  | "resolving"
  | "valid"
  | "invalid"
  | "not-found";

export type AddressInputState = {
  phase: AddressInputPhase;
  /** Checksummed address once the input is a valid address or a resolved ENS name. */
  address: Address | undefined;
  /** ENS name typed or found for the address. */
  ensName: string | undefined;
  /** The private (`0zk…`) address, when the input is one and `shielded` is on. `address` is then undefined. */
  shieldedAddress: string | undefined;
  /** Why the input is invalid, for display. */
  error: string | undefined;
};

/** What the text in an address input is, before any lookup. */
export type AddressInputKind =
  | { kind: "empty" }
  | { kind: "shielded"; text: string }
  | { kind: "address"; text: string; address: Address | undefined }
  /** `name` is undefined when the text isn't a valid ENS name. */
  | { kind: "name"; name: string | undefined }
  | { kind: "other" };

function normalizeName(value: string) {
  try {
    return normalize(value);
  } catch {
    return undefined;
  }
}

/** Sort the text into an address, a private address, an ENS name or neither. Mixed case must match the checksum. */
export function parseAddressInput(value: string): AddressInputKind {
  const text = value.trim();
  if (!text) {
    return { kind: "empty" };
  }
  if (/^0x[0-9a-fA-F]*$/.test(text)) {
    return { kind: "address", text, address: isAddress(text) ? getAddress(text) : undefined };
  }
  // An ENS name may start with "0zk" too; a private address never has a dot.
  if (text.toLowerCase().startsWith(SHIELDED_ADDRESS_PREFIX) && !text.includes(".")) {
    return { kind: "shielded", text };
  }
  if (text.includes(".")) {
    return { kind: "name", name: normalizeName(text) };
  }
  return { kind: "other" };
}

/** TanStack Query options resolving an ENS name to its address on mainnet. Needs mainnet in the wagmi config. */
export function ensAddressQueryOptions(
  config: Config,
  { name, enabled = true }: { name: string | undefined; enabled?: boolean },
) {
  return {
    ...getEnsAddressQueryOptions(config, { name, chainId: mainnet.id, query: { enabled } }),
    queryKeyHashFn: hashFn,
  };
}

export type AddressLookups = {
  /** Forward lookup of the typed name, once typing has paused on it. */
  ens: { data: Address | null | undefined; isPending: boolean; isError: boolean };
  /** True while the name being looked up is still the one typed. */
  nameSettled: boolean;
  /** Primary ENS name of a typed address. */
  reverseName: string | null | undefined;
};

const base = {
  address: undefined,
  ensName: undefined,
  shieldedAddress: undefined,
  error: undefined,
} as const;

/** The validation result for parsed input and its ENS lookups. With `shielded`, private `0zk…` addresses are accepted. */
export function addressInputState(
  input: AddressInputKind,
  { ens, nameSettled, reverseName }: AddressLookups,
  { shielded = false }: { shielded?: boolean } = {},
): AddressInputState {
  switch (input.kind) {
    case "empty":
      return { ...base, phase: "empty" };
    case "shielded": {
      const { text } = input;
      if (!shielded) {
        return { ...base, phase: "invalid", error: "Private (0zk) addresses can't be used here." };
      }
      if (isShieldedAddress(text)) {
        return { ...base, phase: "valid", shieldedAddress: text };
      }
      if (text.length < SHIELDED_ADDRESS_LENGTH) {
        return {
          ...base,
          phase: "incomplete",
          error: `Enter the full ${SHIELDED_ADDRESS_LENGTH}-character private address.`,
        };
      }
      if (text.length > SHIELDED_ADDRESS_LENGTH) {
        return { ...base, phase: "invalid", error: "Private address is too long." };
      }
      return {
        ...base,
        phase: "invalid",
        error: "Checksum doesn't match. Check the private address for typos.",
      };
    }
    case "address": {
      const { text, address } = input;
      if (address) {
        return { ...base, phase: "valid", address, ensName: reverseName ?? undefined };
      }
      if (text.length === 42) {
        return {
          ...base,
          phase: "invalid",
          error: "Checksum doesn't match. Check the address for typos.",
        };
      }
      if (text.length > 42) {
        return { ...base, phase: "invalid", error: "Address is too long." };
      }
      return { ...base, phase: "incomplete", error: "Enter a full 42-character address." };
    }
    case "name": {
      const { name } = input;
      if (!name) {
        return { ...base, phase: "invalid", error: "Not a valid ENS name." };
      }
      if (!nameSettled || ens.isPending) {
        return { ...base, phase: "resolving", ensName: name };
      }
      if (ens.isError) {
        return {
          ...base,
          phase: "invalid",
          ensName: name,
          error: "Couldn't look up this name. Try again.",
        };
      }
      if (!ens.data) {
        return {
          ...base,
          phase: "not-found",
          ensName: name,
          error: `No address found for ${name}.`,
        };
      }
      return { ...base, phase: "valid", address: ens.data, ensName: name };
    }
    case "other":
      return {
        ...base,
        phase: "incomplete",
        error: shielded
          ? "Enter an address (0x…), an ENS name or a private address (0zk…)."
          : "Enter an address (0x…) or ENS name.",
      };
  }
}

/** Show the error once the field was left, or right away for a name with no address. */
export function showAddressError(state: AddressInputState, touched: boolean) {
  return (
    state.error !== undefined &&
    (state.phase === "not-found" || (touched && state.phase !== "resolving"))
  );
}

/** The line under the input: the resolved address or name, the lookup in progress, or the error. */
export function addressInputMessage(state: AddressInputState, value: string, showError: boolean) {
  if (state.shieldedAddress)
  // Start and end, so a pasted address can be checked against its source.
  {
    return `Private address ${truncateAddress(state.shieldedAddress, { start: 9, end: 6 })}`;
  }
  if (state.phase === "valid" && state.ensName) {
    return value.includes(".") ? truncateAddress(state.address!) : state.ensName;
  }
  if (state.phase === "resolving") {
    return `Looking up ${state.ensName}…`;
  }
  return showError ? state.error : undefined;
}
