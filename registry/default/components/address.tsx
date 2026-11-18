import { getAddress, type Address as AddressType } from "viem";
import { useEnsName } from "wagmi";
import { mainnet } from "wagmi/chains";
import { CopyButton } from "@/components/copy-button";
import { ExplorerLink } from "@/components/explorer-link";
import { MorphText } from "@/components/morph-text";
import { truncateAddress } from "@/lib/0xui-utils";
import { cn } from "@/lib/utils";

export type AddressProps = {
  address: AddressType;
  /** Show the ENS name instead of the address when one resolves. Requires mainnet in your wagmi config. */
  ens?: boolean;
  /** Name to show instead of the address. Skips the ENS lookup. */
  name?: string;
  /** "inline" for running text, "pill" for a bordered chip. */
  variant?: "inline" | "pill";
  /** Show a copy button. */
  copyable?: boolean;
  /** Link the address to the block explorer of the current chain. */
  explorer?: boolean;
  /** Characters kept at the start and end when truncating. */
  truncate?: { start?: number; end?: number };
  className?: string;
};

/** Display name for an address: an explicit name, its ENS name, or the truncated address. */
export function useAddressName(
  address: AddressType,
  { ens = true, name }: { ens?: boolean; name?: string } = {}
) {
  const { data: ensName, isLoading } = useEnsName({
    address,
    chainId: mainnet.id,
    query: { enabled: ens && !name },
  });
  const checksummed = getAddress(address);
  const resolved = name ?? ensName ?? undefined;
  return { name: resolved, checksummed, isLoading };
}

/**
 * Address display: ENS name or checksummed `0x1234…abcd`, with copy and
 * explorer link. The full address is always available on hover and to
 * screen readers.
 */
export function Address({
  address,
  ens = true,
  name: nameProp,
  variant = "inline",
  copyable = true,
  explorer = false,
  truncate,
  className,
}: AddressProps) {
  const { name, checksummed } = useAddressName(address, {
    ens,
    name: nameProp,
  });
  const text = name ?? truncateAddress(checksummed, truncate);

  const label = (
    <span
      title={checksummed}
      className={cn(!name && "font-mono tabular-nums", "truncate")}
    >
      {/* Morphs from the address to the ENS name when it resolves. */}
      <span aria-hidden>
        <MorphText>{text}</MorphText>
      </span>
      <span className="sr-only">{name ? `${name}, ${checksummed}` : checksummed}</span>
    </span>
  );

  return (
    <span
      data-slot="address"
      className={cn(
        "inline-flex min-w-0 items-center gap-1 align-middle",
        variant === "pill" && "rounded-full border px-2.5 py-0.5 text-sm",
        className
      )}
    >
      {explorer ? (
        <ExplorerLink address={checksummed} icon={false} className="min-w-0">
          {label}
        </ExplorerLink>
      ) : (
        label
      )}
      {copyable && <CopyButton value={checksummed} label="Copy address" />}
    </span>
  );
}
