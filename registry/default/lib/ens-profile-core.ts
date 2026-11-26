import { getEnsAddress, getEnsName, getEnsText, type Config } from "@wagmi/core";
import type { Address } from "viem";
import { mainnet } from "viem/chains";
import { normalize } from "viem/ens";

/** Text records read by default. */
export const defaultEnsRecords = [
  "description",
  "url",
  "com.twitter",
  "com.github",
  "email",
] as const;

/** The normalized form of an ENS name, or undefined when it isn't a valid one. */
export function safeNormalize(name: string) {
  try {
    return normalize(name);
  } catch {
    return undefined;
  }
}

export type EnsProfileParameters = {
  /** Look up the primary name of this address. */
  address?: Address;
  /** Or look up this name directly. */
  name?: string;
  /** Text records to read. */
  records?: ReadonlyArray<string>;
};

export type EnsProfileData = {
  name: string | undefined;
  address: Address | undefined;
  records: Record<string, string | undefined>;
};

/**
 * TanStack query options for an ENS profile on mainnet: the name (reverse
 * lookup) or address (forward lookup), and text records. Lookups that fail
 * count as not found.
 */
export function ensProfileQueryOptions(
  config: Config,
  { address, name, records = defaultEnsRecords }: EnsProfileParameters,
) {
  const normalized = name ? safeNormalize(name) : undefined;
  const chainId = mainnet.id;
  return {
    queryKey: ["0xui", "ens-profile", address, name, records] as const,
    queryFn: async (): Promise<EnsProfileData> => {
      const ensName = name
        ? normalized
        : address
          ? ((await getEnsName(config, { address, chainId }).catch(() => null)) ?? undefined)
          : undefined;
      const resolved =
        address ??
        (ensName
          ? ((await getEnsAddress(config, { name: ensName, chainId }).catch(() => null)) ??
            undefined)
          : undefined);
      const values = ensName
        ? await Promise.all(
            records.map((key) =>
              getEnsText(config, { name: ensName, key, chainId }).catch(() => null),
            ),
          )
        : [];
      return {
        name: ensName,
        address: resolved,
        records: Object.fromEntries(records.map((key, i) => [key, values[i] ?? undefined])),
      };
    },
    enabled: Boolean(address || name),
    staleTime: 5 * 60_000,
  };
}

export { ensAvatarQueryOptions } from "@/lib/identity";

export type EnsProfilePhase = "loading" | "not-found" | "ready";

/** A name that points nowhere, or an address without a primary name, is not found. */
export function ensProfilePhase(
  { name }: Pick<EnsProfileParameters, "name">,
  data: EnsProfileData | undefined,
  isLoading: boolean,
): EnsProfilePhase {
  if (isLoading) return "loading";
  return (name ? !data?.address : !data?.name) ? "not-found" : "ready";
}

export type EnsLinkKey = "url" | "com.twitter" | "com.github" | "email";

export type EnsLink = { key: EnsLinkKey; label: string; href: string; text: string };

const linkFormats: Record<
  EnsLinkKey,
  { label: string; href: (v: string) => string; text?: (v: string) => string }
> = {
  url: {
    label: "Website",
    href: (v) => (/^https?:\/\//.test(v) ? v : `https://${v}`),
    text: (v) => v.replace(/^https?:\/\//, "").replace(/\/$/, ""),
  },
  "com.twitter": {
    label: "X",
    href: (v) => `https://x.com/${v.replace(/^@/, "")}`,
    text: (v) => `@${v.replace(/^@/, "")}`,
  },
  "com.github": { label: "GitHub", href: (v) => `https://github.com/${v}` },
  email: { label: "Email", href: (v) => `mailto:${v}` },
};

/** The records that render as links (url, com.twitter, com.github, email), in that order. */
export function ensProfileLinks(records: Record<string, string | undefined>): Array<EnsLink> {
  return (Object.keys(linkFormats) as Array<EnsLinkKey>).flatMap((key) => {
    const value = records[key];
    if (!value) return [];
    const format = linkFormats[key];
    return [
      { key, label: format.label, href: format.href(value), text: format.text?.(value) ?? value },
    ];
  });
}
