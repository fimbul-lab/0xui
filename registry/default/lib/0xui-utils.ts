import {
  BaseError,
  UserRejectedRequestError,
  formatUnits,
  getAddress,
  isAddress,
  parseUnits,
  type Chain,
} from "viem";

/**
 * Shorten an address for display: `0x1234…abcd`.
 * Valid addresses are checksummed first; anything else is truncated as-is.
 */
export function truncateAddress(
  address: string,
  { start = 6, end = 4 }: { start?: number; end?: number } = {}
) {
  const value = isAddress(address, { strict: false })
    ? getAddress(address)
    : address;
  if (value.length <= start + end + 1) return value;
  return `${value.slice(0, start)}…${value.slice(-end)}`;
}

export type FormatTokenAmountOptions = {
  /** Maximum fraction digits shown. Defaults to 4. */
  maxDecimals?: number;
  /** Use compact notation, e.g. `1.2K`, `3.4M`. */
  compact?: boolean;
  /** BCP 47 locale. Defaults to the runtime locale. */
  locale?: string;
};

/**
 * Format a raw token amount for display without losing precision to floats.
 * Rounds toward zero, so a balance is never shown larger than it is.
 * Non-zero amounts too small to show render as `<0.0001`.
 */
export function formatTokenAmount(
  value: bigint,
  decimals: number,
  { maxDecimals = 4, compact = false, locale }: FormatTokenAmountOptions = {}
) {
  const formatter = new Intl.NumberFormat(locale, {
    maximumFractionDigits: maxDecimals,
    notation: compact ? "compact" : "standard",
    roundingMode: "trunc",
  });
  const decimal = formatUnits(value, decimals) as Intl.StringNumericLiteral;
  const formatted = formatter.format(decimal);

  const isZero = /^-?[0.]+$/.test(decimal);
  const roundsToZero = !/[1-9]/.test(formatted);
  if (!isZero && roundsToZero) {
    const smallest = formatter.format(
      `${value < 0n ? "-" : ""}${10 ** -maxDecimals}` as Intl.StringNumericLiteral
    );
    return value < 0n ? `>${smallest}` : `<${smallest}`;
  }
  return formatted;
}

/**
 * Parse user-typed amount text into a raw token amount.
 *
 * Lenient about formatting: ignores whitespace and currency symbols, accepts
 * `.5`, and accepts both `1,000.5` and `1.000,5`. With a single separator, a
 * comma followed by exactly three digits is a thousands separator; otherwise
 * it is the decimal point. Extra fraction digits beyond `decimals` are
 * truncated. Returns `undefined` for empty or invalid input.
 */
export function parseAmount(input: string, decimals: number) {
  let text = input.replace(/[\s$€£¥_']/g, "");
  if (!text) return undefined;

  const lastComma = text.lastIndexOf(",");
  const lastDot = text.lastIndexOf(".");
  if (lastComma !== -1 && lastDot !== -1) {
    const decimalSeparator = lastComma > lastDot ? "," : ".";
    const groupSeparator = decimalSeparator === "," ? "." : ",";
    text = text.split(groupSeparator).join("").replace(decimalSeparator, ".");
  } else if (lastComma !== -1) {
    const isGrouping =
      text.indexOf(",") !== lastComma || /,\d{3}$/.test(text);
    text = isGrouping ? text.split(",").join("") : text.replace(",", ".");
  }

  if (!/^\d*\.?\d*$/.test(text) || text === ".") return undefined;

  const [whole = "", fraction = ""] = text.split(".");
  const clamped = fraction.slice(0, decimals);
  return parseUnits(`${whole || "0"}${clamped ? `.${clamped}` : ""}`, decimals);
}

export type ExplorerTarget =
  | { address: string; tx?: never; block?: never }
  | { tx: string; address?: never; block?: never }
  | { block: bigint | number; address?: never; tx?: never };

/** Link to an address, transaction or block on the chain's default block explorer. */
export function getExplorerUrl(
  chain: Pick<Chain, "blockExplorers"> | undefined,
  target: ExplorerTarget
) {
  const base = chain?.blockExplorers?.default.url.replace(/\/$/, "");
  if (!base) return undefined;
  if (target.address) return `${base}/address/${target.address}`;
  if (target.tx) return `${base}/tx/${target.tx}`;
  return `${base}/block/${target.block}`;
}

/**
 * True when the user dismissed the wallet prompt. Treat this as a cancelled
 * action, not a failure.
 */
export function isUserRejection(error: unknown) {
  if (!error) return false;
  if (error instanceof BaseError) {
    return Boolean(
      error.walk(
        (e) =>
          e instanceof UserRejectedRequestError ||
          (e as { code?: unknown }).code === UserRejectedRequestError.code
      )
    );
  }
  return (error as { code?: unknown }).code === UserRejectedRequestError.code;
}

/**
 * Turn `ipfs://` and `ar://` URIs (common in token lists and NFT metadata)
 * into HTTP URLs. Other URIs pass through unchanged.
 */
export function resolveUri(uri: string, gateway = "https://ipfs.io/ipfs/") {
  if (uri.startsWith("ipfs://")) return gateway + uri.replace(/^ipfs:\/\/(ipfs\/)?/, "");
  if (uri.startsWith("ar://")) return `https://arweave.net/${uri.slice(5)}`;
  return uri;
}
