// Docs: https://0xui.io/components/ens-profile.md
import { useQuery } from "@tanstack/react-query";
import { AtSignIcon, CodeXmlIcon, GlobeIcon, MailIcon, type LucideIcon } from "lucide-react";
import { Skeleton } from "skullet/react";
import type { Address as AddressType } from "viem";
import { useConfig } from "wagmi";
import { Address } from "@/components/address";
import { AddressAvatar } from "@/components/address-avatar";
import { ensAvatarQueryOptions } from "@/lib/identity";
import {
  ensProfileLinks,
  ensProfilePhase,
  ensProfileQueryOptions,
  type EnsLinkKey,
} from "@/lib/ens-profile-core";
import { cn } from "@/lib/utils";

export {
  defaultEnsRecords,
  ensAvatarQueryOptions,
  ensProfileLinks,
  ensProfileQueryOptions,
  type EnsProfileData,
  type EnsProfilePhase,
} from "@/lib/ens-profile-core";

/**
 * ENS profile for an address (reverse lookup) or a name (forward lookup):
 * name, address, avatar and text records. Reads from mainnet.
 */
export function useEnsProfile({
  address: addressProp,
  name: nameProp,
  records,
}: {
  address?: AddressType;
  name?: string;
  records?: readonly string[];
}) {
  const config = useConfig();
  const profile = useQuery(
    ensProfileQueryOptions(config, { address: addressProp, name: nameProp, records }),
  );
  const name = profile.data?.name;
  const avatar = useQuery(ensAvatarQueryOptions(config, { name }));
  const phase = ensProfilePhase({ name: nameProp }, profile.data, profile.isLoading);

  return {
    name,
    address: profile.data?.address ?? addressProp,
    avatar: avatar.data ?? undefined,
    records: profile.data?.records ?? {},
    isLoading: phase === "loading",
    /** A name was given but has no address, or an address has no primary name. */
    notFound: phase === "not-found",
  };
}

const linkIcons: Record<EnsLinkKey, LucideIcon> = {
  url: GlobeIcon,
  "com.twitter": AtSignIcon,
  "com.github": CodeXmlIcon,
  email: MailIcon,
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
  const links = ensProfileLinks(profile.records);
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

          {links.length > 0 && (
            <ul className="flex flex-col gap-1.5 text-sm">
              {links.map((link) => {
                const Icon = linkIcons[link.key];
                return (
                  <li key={link.key}>
                    <a
                      href={link.href}
                      target={link.key === "email" ? undefined : "_blank"}
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground"
                    >
                      <Icon aria-hidden className="size-4 shrink-0" />
                      <span className="sr-only">{link.label}: </span>
                      {link.text}
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
