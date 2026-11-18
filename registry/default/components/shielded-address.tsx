import { CopyButton } from "@/components/copy-button";
import { cn } from "@/lib/utils";

export type ShieldedAddressTruncate = { start?: number; end?: number };

/**
 * Shorten a private address for display: `0zk1qyk9n…x8w3ld`.
 *
 * Keeps more of the start than a public address does, because the first
 * five characters of a `0zk` address are the same for everyone.
 */
export function truncateShieldedAddress(
  address: string,
  { start = 9, end = 6 }: ShieldedAddressTruncate = {}
) {
  if (address.length <= start + end + 1) return address;
  return `${address.slice(0, start)}…${address.slice(-end)}`;
}

export type ShieldedAddressProps = {
  /** The private address, e.g. a 127-character Railgun `0zk…` address. */
  address: string;
  /** "inline" for running text, "pill" for a bordered chip. */
  variant?: "inline" | "pill";
  /** Show a copy button. It always copies the full address. */
  copyable?: boolean;
  /** Characters kept at the start and end. Pass false to show the whole address, wrapped. */
  truncate?: ShieldedAddressTruncate | false;
  className?: string;
};

/**
 * A private address: truncated, with the full address on hover, for screen
 * readers and on copy. Private addresses are too long to compare by eye, so
 * the copy button is on by default.
 */
export function ShieldedAddress({
  address,
  variant = "inline",
  copyable = true,
  truncate,
  className,
}: ShieldedAddressProps) {
  const full = truncate === false;

  return (
    <span
      data-slot="shielded-address"
      className={cn(
        "inline-flex min-w-0 items-center gap-1 align-middle",
        variant === "pill" && "border px-2.5 py-0.5 text-sm",
        variant === "pill" && (full ? "rounded-xl" : "rounded-full"),
        className
      )}
    >
      {full ? (
        <span className="min-w-0 font-mono break-all">{address}</span>
      ) : (
        <span title={address} className="truncate font-mono">
          <span aria-hidden>{truncateShieldedAddress(address, truncate)}</span>
          <span className="sr-only">{address}</span>
        </span>
      )}
      {copyable && (
        <CopyButton value={address} label="Copy private address" className="shrink-0" />
      )}
    </span>
  );
}
