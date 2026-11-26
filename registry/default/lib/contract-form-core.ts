import { readContract } from "@wagmi/core";
import type { Config } from "@wagmi/core";
import { formatEther, getAddress, isAddress, isHex, parseEther, size } from "viem";
import type { Abi, AbiFunction, AbiParameter, Address } from "viem";

export type ParsedAbiInput =
  | { value: unknown; error?: undefined }
  | { value?: undefined; error: string };

function intBounds(type: string) {
  const signed = type.startsWith("int");
  const bits = BigInt(type.replace(/^u?int/, "") || "256");
  return signed
    ? { min: -(2n ** (bits - 1n)), max: 2n ** (bits - 1n) - 1n }
    : { min: 0n, max: 2n ** bits - 1n };
}

/** Turn an already-parsed JSON value into the shape viem expects for `param`. */
function coerce(param: AbiParameter, value: unknown): unknown {
  const array = param.type.match(/^(.*)\[(\d*)\]$/);
  if (array) {
    if (!Array.isArray(value)) throw new Error("Expected a JSON array");
    if (array[2] && value.length !== Number(array[2]))
      throw new Error(`Expected ${array[2]} items`);
    return value.map((item) => coerce({ ...param, type: array[1]! }, item));
  }
  if (param.type === "tuple") {
    const components = (param as { components: ReadonlyArray<AbiParameter> }).components;
    if (Array.isArray(value)) return components.map((c, i) => coerce(c, value[i]));
    if (value && typeof value === "object")
      return Object.fromEntries(
        components.map((c, i) => [
          c.name ?? i,
          coerce(c, (value as Record<string, unknown>)[c.name ?? i]),
        ]),
      );
    throw new Error("Expected a JSON object or array");
  }
  const parsed = parseAbiInput(param, typeof value === "string" ? value : JSON.stringify(value));
  if (parsed.error) throw new Error(parsed.error);
  return parsed.value;
}

/** Arrays and tuples are typed as JSON. */
export function isComplexAbiType(type: string) {
  return type.endsWith("]") || type === "tuple";
}

/**
 * Parse text from a form field into a value for an ABI parameter. Integers
 * become bigints (range-checked), addresses are checksummed, bytes are
 * length-checked, and arrays and tuples are entered as JSON.
 */
export function parseAbiInput(param: AbiParameter, raw: string): ParsedAbiInput {
  const text = raw.trim();
  const type = param.type;
  try {
    if (isComplexAbiType(type)) {
      if (!text) return { error: "Required" };
      return { value: coerce(param, JSON.parse(text)) };
    }
    if (type === "string") return { value: raw };
    if (!text) return { error: "Required" };
    if (/^u?int\d*$/.test(type)) {
      if (!/^-?\d+$/.test(text.replaceAll("_", ""))) return { error: "Whole number" };
      const value = BigInt(text.replaceAll("_", ""));
      const { min, max } = intBounds(type);
      if (value < min || value > max) return { error: `Out of range for ${type}` };
      return { value };
    }
    if (type === "address") {
      if (!isAddress(text, { strict: false })) return { error: "Not an address" };
      if (!isAddress(text)) return { error: "Checksum doesn't match" };
      return { value: getAddress(text) };
    }
    if (type === "bool") {
      if (text === "true") return { value: true };
      if (text === "false") return { value: false };
      return { error: "true or false" };
    }
    if (type.startsWith("bytes")) {
      if (!isHex(text)) return { error: "Hex, starting with 0x" };
      const fixed = type.slice(5);
      if (fixed && size(text) !== Number(fixed)) return { error: `Exactly ${fixed} bytes` };
      return { value: text };
    }
    return { error: `Unsupported type ${type}` };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Invalid JSON" };
  }
}

/** Readable text for a contract return value: bigints as digits, nested values as JSON. */
export function formatAbiValue(value: unknown): string {
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "string" || typeof value === "boolean") return String(value);
  return JSON.stringify(value, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2);
}

/** View and pure functions only read. */
export function isReadFunction(fn: AbiFunction) {
  return fn.stateMutability === "view" || fn.stateMutability === "pure";
}

/** `transfer(address, uint256)`. */
export function functionSignature(fn: AbiFunction) {
  return `${fn.name}(${fn.inputs.map((i) => i.type).join(", ")})`;
}

/** How a function changes state: a badge for its card. */
export function functionKind(fn: AbiFunction): "read" | "payable" | "write" {
  return isReadFunction(fn) ? "read" : fn.stateMutability === "payable" ? "payable" : "write";
}

/** The ABI's functions, optionally only `functions` (in that order) and only reads or writes. */
export function contractFunctions(
  abi: Abi,
  {
    functions,
    show = "all",
  }: { functions?: ReadonlyArray<string>; show?: "all" | "read" | "write" } = {},
) {
  const all = abi.filter((item): item is AbiFunction => item.type === "function");
  const picked = functions
    ? functions.flatMap((name) => all.filter((fn) => fn.name === name))
    : all;
  return picked.filter((fn) =>
    show === "read" ? isReadFunction(fn) : show === "write" ? !isReadFunction(fn) : true,
  );
}

/** The text a fresh form starts with, one entry per input. */
export function initialFunctionValues(fn: AbiFunction) {
  return fn.inputs.map((input) => (input.type === "bool" ? "false" : ""));
}

export type FunctionCallDraft = {
  /** Parsed values, one per input. */
  args: Array<unknown>;
  /** Why each input is invalid, or undefined. */
  errors: Array<string | undefined>;
  /** The ETH value in wei, undefined when blank, null when it doesn't parse. */
  value: bigint | undefined | null;
  /** What to fix before calling, as button text, or undefined when ready. */
  blocker: string | undefined;
};

/** Parse a function's form: its inputs and, for payable functions, the ETH value. */
export function functionCallDraft(
  fn: AbiFunction,
  values: ReadonlyArray<string>,
  ethValue = "",
): FunctionCallDraft {
  const parsed = fn.inputs.map((input, i) => parseAbiInput(input, values[i] ?? ""));
  const firstError = parsed.findIndex((p) => p.error);
  let value: bigint | undefined | null;
  if (fn.stateMutability === "payable" && ethValue.trim()) {
    try {
      value = parseEther(ethValue.trim());
    } catch {
      value = null;
    }
  }
  const blocker =
    firstError >= 0
      ? `Check ${fn.inputs[firstError]!.name || `argument ${firstError + 1}`}`
      : value === null
        ? "Check the ETH value"
        : undefined;
  return { args: parsed.map((p) => p.value), errors: parsed.map((p) => p.error), value, blocker };
}

/** A parameter's name in the form, or its position when the ABI leaves it unnamed. */
export function inputName(input: AbiParameter, index: number) {
  return input.name || `arg${index}`;
}

/** One argument on one line, for a confirmation: bigints as digits, nested values as compact JSON. */
function formatArgInline(value: unknown) {
  if (typeof value === "bigint" || typeof value === "string" || typeof value === "boolean")
    return String(value);
  return JSON.stringify(value, (_, v) => (typeof v === "bigint" ? v.toString() : v));
}

/**
 * What a person confirms before an agent's write goes to the wallet: the
 * function with every argument, the contract, the network and any ETH sent.
 * Set as the write button's `data-agent-confirm`.
 */
export function functionConfirmText(
  fn: AbiFunction,
  draft: Pick<FunctionCallDraft, "args" | "value">,
  {
    address,
    chainName,
    nativeSymbol = "ETH",
  }: { address: Address; chainName?: string; nativeSymbol?: string },
) {
  const args = fn.inputs
    .map((input, i) => `${inputName(input, i)}: ${formatArgInline(draft.args[i])}`)
    .join(", ");
  const value = draft.value ? ` and sends ${formatEther(draft.value)} ${nativeSymbol}` : "";
  const on = chainName ? ` on ${chainName}` : "";
  return `Calls ${fn.name}(${args}) on contract ${address}${on}${value}, from your wallet`;
}

/**
 * TanStack mutation options that read a view function with the given
 * arguments. Reads run on request, so this is a mutation, not a query.
 */
export function readFunctionMutationOptions(
  config: Config,
  { address, fn, chainId }: { address: Address; fn: AbiFunction; chainId?: number },
) {
  return {
    mutationKey: ["0xui", "contract-read", chainId, address, functionSignature(fn)] as const,
    mutationFn: (args: ReadonlyArray<unknown>) =>
      readContract(config, {
        address,
        abi: [fn],
        functionName: fn.name,
        args,
        chainId,
      } as Parameters<typeof readContract>[1]) as Promise<unknown>,
  };
}
