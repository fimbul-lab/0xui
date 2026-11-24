// Docs: https://0xui.io/components/address-avatar.md
import { useQuery } from "@tanstack/react-query";
import type { Address } from "viem";
import { useConfig } from "wagmi";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/primitives/avatar";
import { addressGradient, ensAvatarQueryOptions, ensNameQueryOptions } from "@/lib/identity";
import { cn } from "@/lib/utils";

export { addressGradient };

export type AddressAvatarProps = {
  address: Address;
  /** Look up the ENS avatar on mainnet. Requires mainnet in your wagmi config. */
  ens?: boolean;
  /** Image URL to use instead of the ENS avatar. */
  src?: string;
  /** Diameter in px. */
  size?: number;
  className?: string;
};

/** Resolve the ENS avatar URL for an address. */
export function useAddressAvatar(address: Address, { enabled = true } = {}) {
  const config = useConfig();
  const { data: name } = useQuery(ensNameQueryOptions(config, { address, enabled }));
  const { data: avatar } = useQuery(ensAvatarQueryOptions(config, { name, enabled }));
  return { name: name ?? undefined, avatar: avatar ?? undefined };
}

/**
 * Round avatar for an address: the ENS avatar when one exists, otherwise a
 * gradient derived from the address.
 */
export function AddressAvatar({
  address,
  ens = true,
  src,
  size = 24,
  className,
}: AddressAvatarProps) {
  const { avatar } = useAddressAvatar(address, { enabled: ens && !src });
  const image = src ?? avatar;

  return (
    <Avatar
      aria-hidden
      className={cn("shrink-0", className)}
      style={{ width: size, height: size }}
    >
      {image && <AvatarImage src={image} alt="" />}
      <AvatarFallback style={{ background: addressGradient(address) }} />
    </Avatar>
  );
}
