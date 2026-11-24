import type { Config } from "@wagmi/core";
import { getEnsAvatarQueryOptions, getEnsNameQueryOptions, hashFn } from "@wagmi/core/query";
import { getAddress, type Address } from "viem";
import { mainnet } from "viem/chains";
import { normalize } from "viem/ens";
import { truncateAddress } from "@/lib/0xui-utils";

/** TanStack Query options for an address's primary ENS name, read on mainnet. Needs mainnet in the wagmi config. */
export function ensNameQueryOptions(
  config: Config,
  { address, enabled = true }: { address: Address | undefined; enabled?: boolean },
) {
  return {
    ...getEnsNameQueryOptions(config, {
      address,
      chainId: mainnet.id,
      query: { enabled },
    }),
    queryKeyHashFn: hashFn,
  };
}

/** TanStack Query options for an ENS name's avatar URL, read on mainnet. Disabled until `name` is set. */
export function ensAvatarQueryOptions(
  config: Config,
  { name, enabled = true }: { name: string | null | undefined; enabled?: boolean },
) {
  return {
    ...getEnsAvatarQueryOptions(config, {
      name: name ? normalize(name) : undefined,
      chainId: mainnet.id,
      query: { enabled },
    }),
    queryKeyHashFn: hashFn,
  };
}

/**
 * What to show for an address: `name` when there is one, else the
 * checksummed address truncated. `label` is the full text for screen readers.
 */
export function addressDisplay(
  address: Address,
  { name, truncate }: { name?: string; truncate?: { start?: number; end?: number } } = {},
) {
  const checksummed = getAddress(address);
  return {
    checksummed,
    text: name ?? truncateAddress(checksummed, truncate),
    label: name ? `${name}, ${checksummed}` : checksummed,
  };
}

/**
 * Deterministic two-color gradient for an address, so the same address
 * always gets the same placeholder.
 */
export function addressGradient(address: string) {
  const hex = address.toLowerCase().replace(/^0x/, "").padEnd(12, "0");
  const from = parseInt(hex.slice(0, 6), 16) % 360;
  const to = (from + 40 + (parseInt(hex.slice(6, 12), 16) % 120)) % 360;
  return `linear-gradient(135deg, oklch(0.75 0.15 ${from}), oklch(0.55 0.2 ${to}))`;
}
