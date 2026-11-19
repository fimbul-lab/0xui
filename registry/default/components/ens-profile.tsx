// Docs: https://0xui.io/components/ens-profile.md
import { useQuery } from "@tanstack/react-query";
import { AtSignIcon, CodeXmlIcon, GlobeIcon, MailIcon, type LucideIcon } from "lucide-react";
import { Skeleton } from "skullet/react";
import type { Address as AddressType } from "viem";
import { normalize } from "viem/ens";
import { useEnsAddress, useEnsAvatar, useEnsName, usePublicClient } from "wagmi";
import { mainnet } from "wagmi/chains";
import { Address } from "@/components/address";
import { AddressAvatar } from "@/components/address-avatar";
import { cn } from "@/lib/utils";

/** Text records read by default. */
export const defaultEnsRecords = ["description", "url", "com.twitter", "com.github", "email"] as const;

/**
 * ENS profile for an address (reverse lookup) or a name (forward lookup):
 * name, address, avatar and text records. Reads from mainnet.
 */
export function useEnsProfile({
  address: addressProp,
  name: nameProp,
  records = defaultEnsRecords,
}: {
  address?: AddressType;
  name?: string;
  records?: readonly string[];
}) {
  const client = usePublicClient({ chainId: mainnet.id });
  const reverse = useEnsName({
    address: addressProp,
    chainId: mainnet.id,
    query: { enabled: Boolean(addressProp) && !nameProp },
  });
  const name = nameProp ? safeNormalize(nameProp) : (reverse.data ?? undefined);
  const forward = useEnsAddress({
    name,
    chainId: mainnet.id,
    query: { enabled: Boolean(nameProp && name) },
  });
  const address = addressProp ?? forward.data ?? undefined;
  const avatar = useEnsAvatar({ name, chainId: mainnet.id, query: { enabled: Boolean(name) } });
  const texts = useQuery({
    queryKey: ["0xui", "ens-texts", name, records],
    queryFn: async () => {
      const values = await Promise.all(
        records.map((key) => client!.getEnsText({ name: name!, key }).catch(() => null))
      );
      return Object.fromEntries(records.map((key, i) => [key, values[i] ?? undefined])) as Record<
        string,
        string | undefined
      >;
    },
    enabled: Boolean(name && client),
    staleTime: 5 * 60_000,
  });

  const isLoading = reverse.isLoading || forward.isLoading || (Boolean(name) && texts.isLoading);
  return {
    name,
    address,
    avatar: avatar.data ?? undefined,
    records: texts.data ?? {},
    isLoading,
    /** A name was given but has no address, or an address has no primary name. */
    notFound: !isLoading && (nameProp ? !address : !name),
  };
}

function safeNormalize(name: string) {
  try {
    return normalize(name);
  } catch {
    return undefined;
  }
}

const links: Record<string, { icon: LucideIcon; label: string; href: (v: string) => string; text?: (v: string) => string }> = {
  url: { icon: GlobeIcon, label: "Website", href: (v) => (/^https?:\/\//.test(v) ? v : `https://${v}`), text: (v) => v.replace(/^https?:\/\//, "").replace(/\/$/, "") },
  "com.twitter": { icon: AtSignIcon, label: "X", href: (v) => `https://x.com/${v.replace(/^@/, "")}`, text: (v) => `@${v.replace(/^@/, "")}` },
  "com.github": { icon: CodeXmlIcon, label: "GitHub", href: (v) => `https://github.com/${v}` },
  email: { icon: MailIcon, label: "Email", href: (v) => `mailto:${v}` },
};

/** Stand-in the loading skeleton is measured from. Never shown as text. */
const sampleProfile = {
  name: "sample-name.eth",
  address: "0x0000000000000000000000000000000000000001",
  avatar: undefined,
} as const;

export type EnsProfileProps = {
  /** Look up the primary name of this address. */
  address?: AddressType;
  /** Or look up this name directly. */
  name?: string;
  /** Text records to read. Known ones (url, com.twitter, com.github, email) render as links. */
  records?: readonly string[];
  className?: string;
};

/**
 * Profile card for an ENS name: avatar, name, address with copy, bio and
 * links from text records. Falls back to the address alone when there's no
 * primary name.
 */
export function EnsProfile({ address, name, records, className }: EnsProfileProps) {
  const profile = useEnsProfile({ address, name, records });
  const phase = profile.isLoading ? "loading" : profile.notFound ? "not-found" : "ready";
  const linkKeys = Object.keys(links).filter((key) => profile.records[key]);
  // While loading, the header is drawn from a stand-in and measured into a skeleton.
  const shown =
    phase === "loading" ? { ...sampleProfile, address: profile.address ?? sampleProfile.address } : profile;

  return (
    <article
      data-slot="ens-profile"
      data-phase={phase}
      className={cn("w-full max-w-sm rounded-2xl border p-5", className)}
    >
      <Skeleton loading={phase === "loading"} label="Loading ENS profile">
        <div className="flex flex-col gap-4">
          <header className="flex items-center gap-3">
            {shown.address && <AddressAvatar address={shown.address} src={shown.avatar} size={56} />}
            <div className="flex min-w-0 flex-col gap-0.5">
              <h3 className="truncate text-lg font-semibold">{shown.name ?? "No ENS name"}</h3>
              {shown.address && (
                <Address address={shown.address} ens={false} className="text-sm text-muted-foreground" />
              )}
            </div>
          </header>

          {phase === "not-found" && name && (
            <p className="text-sm text-muted-foreground">{name} doesn't point to an address.</p>
          )}

          {profile.records.description && <p className="text-sm">{profile.records.description}</p>}

          {linkKeys.length > 0 && (
            <ul className="flex flex-col gap-1.5 text-sm">
              {linkKeys.map((key) => {
                const link = links[key]!;
                const value = profile.records[key]!;
                const Icon = link.icon;
                return (
                  <li key={key}>
                    <a
                      href={link.href(value)}
                      target={key === "email" ? undefined : "_blank"}
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground"
                    >
                      <Icon aria-hidden className="size-4 shrink-0" />
                      <span className="sr-only">{link.label}: </span>
                      {link.text ? link.text(value) : value}
                    </a>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </Skeleton>
    </article>
  );
}
