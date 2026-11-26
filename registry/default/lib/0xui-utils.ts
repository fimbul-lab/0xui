import {
  BaseError,
  UserRejectedRequestError,
  formatUnits,
  getAddress,
  isAddress,
  parseUnits,
} from "viem";
import type { Chain } from "viem";

/**
 * Shorten an address for display: `0x1234…abcd`.
 * Valid addresses are checksummed first; anything else is truncated as-is.
 */
export function truncateAddress(
  address: string,
  { start = 6, end = 4 }: { start?: number; end?: number } = {},
) {
  const value = isAddress(address, { strict: false }) ? getAddress(address) : address;
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
  { maxDecimals = 4, compact = false, locale }: FormatTokenAmountOptions = {},
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
      `${value < 0n ? "-" : ""}${10 ** -maxDecimals}` as Intl.StringNumericLiteral,
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
    const isGrouping = text.indexOf(",") !== lastComma || /,\d{3}$/.test(text);
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
  target: ExplorerTarget,
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
          (e as { code?: unknown }).code === UserRejectedRequestError.code,
      ),
    );
  }
  return (error as { code?: unknown }).code === UserRejectedRequestError.code;
}

/**
 * Why an action failed, as one stable word. Components set it as `data-error`
 * next to `data-phase`, so tests, styles and browser agents can tell a
 * cancelled prompt from a revert or a wrong network without reading the message.
 */
export type ErrorCode =
  | "user-rejected"
  | "reverted"
  | "insufficient-funds"
  | "wrong-chain"
  | "no-wallet"
  | "unsupported"
  | "network"
  | "unknown";

const errorNames: Array<[ErrorCode, Array<string>]> = [
  ["reverted", ["ContractFunctionRevertedError", "ExecutionRevertedError"]],
  ["insufficient-funds", ["InsufficientFundsError"]],
  [
    "wrong-chain",
    [
      "ChainMismatchError",
      "ConnectorChainMismatchError",
      "ChainNotConfiguredError",
      "SwitchChainNotSupportedError",
    ],
  ],
  ["no-wallet", ["ProviderNotFoundError", "ConnectorNotFoundError", "ConnectorNotConnectedError"]],
  ["unsupported", ["MethodNotSupportedRpcError", "UnsupportedProviderMethodError"]],
  [
    "network",
    ["HttpRequestError", "TimeoutError", "WebSocketRequestError", "LimitExceededRpcError"],
  ],
];

/** The `data-error` for a component in `phase` that failed with `error`. */
export function errorCode(phase: string, error?: unknown): ErrorCode | undefined {
  if (phase === "cancelled") return "user-rejected";
  if (phase === "reverted") return "reverted";
  if (phase !== "error") return undefined;
  if (!error) return "unknown";
  if (isUserRejection(error)) return "user-rejected";

  // viem and wagmi errors each chain their causes; walk them by name, since
  // wagmi's errors don't extend viem's BaseError.
  const names = new Set<string>();
  for (let e: unknown = error, depth = 0; e && depth < 10; depth++) {
    names.add((e as { name?: string }).name ?? "");
    if (/insufficient funds/i.test((e as { message?: string }).message ?? "")) {
      return "insufficient-funds";
    }
    e = (e as { cause?: unknown }).cause;
  }
  return errorNames.find(([, list]) => list.some((name) => names.has(name)))?.[0] ?? "unknown";
}

/**
 * Text for `data-agent-confirm`, which browser agents read as "a person must
 * approve this first". Leads with the button's label when it's plain text.
 */
export function agentConfirmText(label: unknown, effect: string) {
  if (typeof label === "string" && label.trim()) return `${label.trim()}: ${effect}`;
  return effect.charAt(0).toUpperCase() + effect.slice(1);
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

const BECH32_CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
const BECH32M_CONSTANT = 0x2bc830a3;
const BECH32_GENERATORS = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];

function bech32Polymod(values: ReadonlyArray<number>) {
  let checksum = 1;
  for (const value of values) {
    const top = checksum >>> 25;
    checksum = ((checksum & 0x1ffffff) << 5) ^ value;
    for (let i = 0; i < 5; i++) {
      if ((top >>> i) & 1) checksum ^= BECH32_GENERATORS[i]!;
    }
  }
  return checksum;
}

function bech32PrefixWords(prefix: string) {
  const codes = Array.from(prefix, (char) => char.charCodeAt(0));
  return [...codes.map((code) => code >>> 5), 0, ...codes.map((code) => code & 31)];
}

/**
 * Encode 5-bit words as a bech32m string (BIP-350): prefix, `1`, the words,
 * then a six-character checksum.
 */
export function encodeBech32m(prefix: string, words: ReadonlyArray<number>) {
  const polymod =
    bech32Polymod([...bech32PrefixWords(prefix), ...words, 0, 0, 0, 0, 0, 0]) ^ BECH32M_CONSTANT;
  const checksum = Array.from({ length: 6 }, (_, i) => (polymod >>> (5 * (5 - i))) & 31);
  return `${prefix}1${[...words, ...checksum].map((word) => BECH32_CHARSET[word]).join("")}`;
}

/** Prefix and length of a private (shielded) address, as Railgun encodes them. */
export const SHIELDED_ADDRESS_PREFIX = "0zk";
export const SHIELDED_ADDRESS_LENGTH = 127;

/**
 * True for a well-formed private address: `0zk1…`, 127 characters, lower
 * case, with a matching bech32m checksum. One mistyped or missing character
 * fails the checksum. Like a checksummed 0x address, it says nothing about
 * who holds the keys.
 */
export function isShieldedAddress(value: string) {
  if (value.length !== SHIELDED_ADDRESS_LENGTH) return false;
  if (!value.startsWith(`${SHIELDED_ADDRESS_PREFIX}1`)) return false;
  const words = Array.from(value.slice(SHIELDED_ADDRESS_PREFIX.length + 1), (char) =>
    BECH32_CHARSET.indexOf(char),
  );
  if (words.includes(-1)) return false;
  return (
    bech32Polymod([...bech32PrefixWords(SHIELDED_ADDRESS_PREFIX), ...words]) === BECH32M_CONSTANT
  );
}
