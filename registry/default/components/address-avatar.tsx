import type { Address } from "viem";
import { normalize } from "viem/ens";
import { useEnsAvatar, useEnsName } from "wagmi";
import { mainnet } from "wagmi/chains";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

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

/** Resolve the ENS avatar URL for an address. */
export function useAddressAvatar(address: Address, { enabled = true } = {}) {
  const { data: name } = useEnsName({
    address,
    chainId: mainnet.id,
    query: { enabled },
  });
  const { data: avatar } = useEnsAvatar({
    name: name ? normalize(name) : undefined,
    chainId: mainnet.id,
    query: { enabled: enabled && Boolean(name) },
  });
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
