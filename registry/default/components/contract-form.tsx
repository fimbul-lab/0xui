import { useMutation } from "@tanstack/react-query";
import { useId, useMemo, useState } from "react";
import {
  getAddress,
  isAddress,
  isHex,
  parseEther,
  size,
  type Abi,
  type AbiFunction,
  type AbiParameter,
  type Address,
} from "viem";
import { usePublicClient } from "wagmi";
import { TransactionButton, type ContractRequest } from "@/components/transaction-button";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Parsed = { value: unknown; error?: undefined } | { value?: undefined; error: string };

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
    if (array[2] && value.length !== Number(array[2])) throw new Error(`Expected ${array[2]} items`);
    return value.map((item) => coerce({ ...param, type: array[1]! }, item));
  }
  if (param.type === "tuple") {
    const components = (param as { components: readonly AbiParameter[] }).components;
    if (Array.isArray(value)) return components.map((c, i) => coerce(c, value[i]));
    if (value && typeof value === "object")
      return Object.fromEntries(
        components.map((c, i) => [c.name ?? i, coerce(c, (value as Record<string, unknown>)[c.name ?? i])])
      );
    throw new Error("Expected a JSON object or array");
  }
  const parsed = parseAbiInput(param, typeof value === "string" ? value : JSON.stringify(value));
  if (parsed.error) throw new Error(parsed.error);
  return parsed.value;
}

/**
 * Parse text from a form field into a value for an ABI parameter. Integers
 * become bigints (range-checked), addresses are checksummed, bytes are
 * length-checked, and arrays and tuples are entered as JSON.
 */
export function parseAbiInput(param: AbiParameter, raw: string): Parsed {
  const text = raw.trim();
  const type = param.type;
  try {
    if (type.endsWith("]") || type === "tuple") {
      if (!text) return { error: "Required" };
      return { value: coerce(param, JSON.parse(text)) };
    }
    if (type === "string") return { value: raw };
    if (!text) return { error: "Required" };
    if (/^u?int\d*$/.test(type)) {
      if (!/^-?\d+$/.test(text.replace(/_/g, ""))) return { error: "Whole number" };
      const value = BigInt(text.replace(/_/g, ""));
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
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Invalid JSON" };
  }
}

/** Readable text for a contract return value: bigints as digits, nested values as JSON. */
export function formatAbiValue(value: unknown): string {
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "string" || typeof value === "boolean") return String(value);
  return JSON.stringify(
    value,
    (_, v) => (typeof v === "bigint" ? v.toString() : v),
    2
  );
}

const isRead = (fn: AbiFunction) =>
  fn.stateMutability === "view" || fn.stateMutability === "pure";

function signature(fn: AbiFunction) {
  return `${fn.name}(${fn.inputs.map((i) => i.type).join(", ")})`;
}

export type ContractFunctionProps = {
  address: Address;
  fn: AbiFunction;
  chainId?: number;
  /** Start expanded. */
  defaultOpen?: boolean;
};

/** One ABI function as a form: an input per parameter, then Read or a TransactionButton. */
export function ContractFunction({ address, fn, chainId, defaultOpen = false }: ContractFunctionProps) {
  const id = useId();
  const client = usePublicClient({ chainId });
  const [values, setValues] = useState<string[]>(() => fn.inputs.map((i) => (i.type === "bool" ? "false" : "")));
  const [ethValue, setEthValue] = useState("");
  const [touched, setTouched] = useState(false);

  const parsed = fn.inputs.map((input, i) => parseAbiInput(input, values[i] ?? ""));
  const args = parsed.map((p) => p.value);
  const firstError = parsed.findIndex((p) => p.error);
  const payable = fn.stateMutability === "payable";
  const value = (() => {
    if (!payable || !ethValue.trim()) return undefined;
    try {
      return parseEther(ethValue.trim());
    } catch {
      return null;
    }
  })();

  const read = useMutation({
    mutationFn: () =>
      client!.readContract({ address, abi: [fn], functionName: fn.name, args }),
  });

  const blocker =
    firstError >= 0
      ? `Check ${fn.inputs[firstError]!.name || `argument ${firstError + 1}`}`
      : value === null
        ? "Check the ETH value"
        : undefined;

  return (
    <details
      data-slot="contract-function"
      open={defaultOpen || undefined}
      className="group rounded-xl border"
    >
      <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm">
        <span
          className={cn(
            "rounded px-1.5 py-0.5 text-xs font-medium",
            isRead(fn) ? "bg-sky-500/15 text-sky-700 dark:text-sky-300" : payable ? "bg-amber-500/15 text-amber-700 dark:text-amber-300" : "bg-violet-500/15 text-violet-700 dark:text-violet-300"
          )}
        >
          {isRead(fn) ? "read" : payable ? "payable" : "write"}
        </span>
        <code className="truncate font-mono">{signature(fn)}</code>
        {fn.outputs.length > 0 && (
          <span className="ml-auto shrink-0 font-mono text-xs text-muted-foreground">
            → {fn.outputs.map((o) => o.type).join(", ")}
          </span>
        )}
      </summary>
      <form
        className="flex flex-col gap-3 border-t px-4 py-3"
        onSubmit={(e) => {
          e.preventDefault();
          setTouched(true);
          if (isRead(fn) && !blocker) read.mutate();
        }}
      >
        {fn.inputs.map((input, i) => {
          const fieldId = `${id}-${i}`;
          const error = touched || values[i] ? parsed[i]!.error : undefined;
          const complex = input.type.endsWith("]") || input.type === "tuple";
          return (
            <div key={i} className="flex flex-col gap-1">
              <label htmlFor={fieldId} className="text-xs text-muted-foreground">
                {input.name || `arg${i}`} <code className="font-mono">{input.type}</code>
              </label>
              {input.type === "bool" ? (
                <select
                  id={fieldId}
                  value={values[i]}
                  onChange={(e) => setValues((v) => v.map((x, j) => (j === i ? e.target.value : x)))}
                  className="h-9 rounded-md border bg-background px-2 text-sm"
                >
                  <option value="false">false</option>
                  <option value="true">true</option>
                </select>
              ) : complex ? (
                <textarea
                  id={fieldId}
                  rows={3}
                  spellCheck={false}
                  placeholder={input.type === "tuple" ? '{ "field": "value" }' : '["…"]'}
                  aria-invalid={Boolean(error) || undefined}
                  value={values[i]}
                  onChange={(e) => setValues((v) => v.map((x, j) => (j === i ? e.target.value : x)))}
                  className="rounded-md border bg-background px-2 py-1.5 font-mono text-sm aria-invalid:border-destructive"
                />
              ) : (
                <input
                  id={fieldId}
                  type="text"
                  spellCheck={false}
                  autoComplete="off"
                  inputMode={/int/.test(input.type) ? "numeric" : undefined}
                  placeholder={input.type}
                  aria-invalid={Boolean(error) || undefined}
                  value={values[i]}
                  onChange={(e) => setValues((v) => v.map((x, j) => (j === i ? e.target.value : x)))}
                  className="h-9 rounded-md border bg-background px-2 font-mono text-sm aria-invalid:border-destructive"
                />
              )}
              {error && <span className="text-xs text-destructive">{error}</span>}
            </div>
          );
        })}

        {payable && (
          <div className="flex flex-col gap-1">
            <label htmlFor={`${id}-value`} className="text-xs text-muted-foreground">
              Value <code className="font-mono">ETH</code>
            </label>
            <input
              id={`${id}-value`}
              type="text"
              inputMode="decimal"
              placeholder="0"
              aria-invalid={value === null || undefined}
              value={ethValue}
              onChange={(e) => setEthValue(e.target.value)}
              className="h-9 rounded-md border bg-background px-2 font-mono text-sm aria-invalid:border-destructive"
            />
          </div>
        )}

        {isRead(fn) ? (
          <>
            <Button type="submit" variant="outline" size="sm" className="self-start" disabled={read.isPending}>
              {read.isPending ? "Reading…" : "Read"}
            </Button>
            {read.isSuccess && (
              <pre aria-label="Result" className="overflow-auto rounded-lg bg-muted/50 p-3 font-mono text-xs">
                {formatAbiValue(read.data)}
              </pre>
            )}
            {read.isError && (
              <p role="alert" className="text-sm text-destructive">
                {(read.error as { shortMessage?: string }).shortMessage ?? read.error.message}
              </p>
            )}
          </>
        ) : (
          <TransactionButton
            chainId={chainId}
            contract={
              blocker
                ? undefined
                : // The ABI is only known at runtime, so wagmi can't type-check this call.
                  ({ address, abi: [fn], functionName: fn.name, args, value: value ?? undefined } as ContractRequest)
            }
            disabledReason={
              blocker && (touched || values.some((v) => v.trim()) ? blocker : "Fill in the fields")
            }
            size="sm"
            className="self-start"
          >
            {fn.name}
          </TransactionButton>
        )}
      </form>
    </details>
  );
}

export type ContractFormProps = {
  address: Address;
  abi: Abi;
  chainId?: number;
  /** Only these function names, in this order. */
  functions?: readonly string[];
  /** Show read functions, write functions, or both. */
  show?: "all" | "read" | "write";
  className?: string;
};

/**
 * Interactive forms for a contract, generated from its ABI: one card per
 * function with typed inputs, Read for view functions, and a
 * TransactionButton for writes. Handy for admin panels, debugging, and
 * agent-built tools.
 */
export function ContractForm({ address, abi, chainId, functions, show = "all", className }: ContractFormProps) {
  const fns = useMemo(() => {
    const all = abi.filter((item): item is AbiFunction => item.type === "function");
    const picked = functions
      ? functions.flatMap((name) => all.filter((fn) => fn.name === name))
      : all;
    return picked.filter((fn) => (show === "read" ? isRead(fn) : show === "write" ? !isRead(fn) : true));
  }, [abi, functions, show]);

  return (
    <div data-slot="contract-form" className={cn("flex flex-col gap-2", className)}>
      {fns.length === 0 ? (
        <p className="text-sm text-muted-foreground">No matching functions in this ABI.</p>
      ) : (
        fns.map((fn, i) => (
          <ContractFunction key={`${signature(fn)}-${i}`} address={address} fn={fn} chainId={chainId} />
        ))
      )}
    </div>
  );
}
