// Docs: https://0xui.io/components/contract-form.md
import { useMutation } from "@tanstack/react-query";
import {
  Collapsible,
  CollapsiblePanel,
  CollapsibleTrigger,
} from "@ui-sdk/react/collapsible";
import { Field, FieldError, FieldLabel } from "@ui-sdk/react/field";
import { Input } from "@ui-sdk/react/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@ui-sdk/react/select";
import { Textarea } from "@ui-sdk/react/textarea";
import { ChevronDownIcon } from "lucide-react";
import { useMemo, useState } from "react";
import type { Abi, AbiFunction, Address } from "viem";
import { useChainId, useConfig } from "wagmi";
import { MorphText } from "@/components/morph-text";
import { Button } from "@/components/primitives/button";
import { TransactionButton, type ContractRequest } from "@/components/transaction-button";
import {
  contractFunctions,
  formatAbiValue,
  functionCallDraft,
  functionConfirmText,
  functionKind,
  functionSignature,
  initialFunctionValues,
  inputName,
  isComplexAbiType,
  readFunctionMutationOptions,
} from "@/lib/contract-form-core";
import { cn } from "@/lib/utils";

export {
  contractFunctions,
  formatAbiValue,
  functionCallDraft,
  functionConfirmText,
  parseAbiInput,
  readFunctionMutationOptions,
  type FunctionCallDraft,
  type ParsedAbiInput,
} from "@/lib/contract-form-core";

const kindClassName = {
  read: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  payable: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  write: "bg-violet-500/15 text-violet-700 dark:text-violet-300",
};

const controlClassName =
  "rounded-md border bg-background px-2 font-mono text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50 aria-invalid:border-destructive";

export type ContractFunctionProps = {
  address: Address;
  fn: AbiFunction;
  chainId?: number;
  /** Start expanded. */
  defaultOpen?: boolean;
};

/** One ABI function as a form: an input per parameter, then Read or a TransactionButton. */
export function ContractFunction({ address, fn, chainId, defaultOpen = false }: ContractFunctionProps) {
  const config = useConfig();
  const currentChainId = useChainId();
  const [values, setValues] = useState<string[]>(() => initialFunctionValues(fn));
  const [ethValue, setEthValue] = useState("");
  const [touched, setTouched] = useState(false);

  const draft = functionCallDraft(fn, values, ethValue);
  const kind = functionKind(fn);
  const read = useMutation(readFunctionMutationOptions(config, { address, fn, chainId }));
  const setValue = (i: number, next: string) =>
    setValues((v) => v.map((x, j) => (j === i ? next : x)));

  return (
    <div data-slot="contract-function" className="rounded-xl border">
      <Collapsible defaultOpen={defaultOpen} className="group">
        <CollapsibleTrigger className="flex w-full cursor-pointer items-center gap-2 rounded-xl px-4 py-3 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
          {/* The spaces between parts keep the trigger's name readable: "write transfer(…) → bool". */}
          <span className={cn("rounded px-1.5 py-0.5 text-xs font-medium", kindClassName[kind])}>
            {kind}
          </span>{" "}
          <code className="truncate font-mono">{functionSignature(fn)}</code>{" "}
          {fn.outputs.length > 0 && (
            <span className="ml-auto shrink-0 font-mono text-xs text-muted-foreground">
              → {fn.outputs.map((o) => o.type).join(", ")}
            </span>
          )}
          <ChevronDownIcon
            aria-hidden
            className={cn(
              "size-4 shrink-0 text-muted-foreground transition-transform group-data-open:rotate-180",
              fn.outputs.length === 0 && "ml-auto",
            )}
          />
        </CollapsibleTrigger>
        <CollapsiblePanel>
          <form
            className="flex flex-col gap-3 border-t px-4 py-3"
            onSubmit={(e) => {
              e.preventDefault();
              setTouched(true);
              if (kind === "read" && !draft.blocker) read.mutate(draft.args);
            }}
          >
            {fn.inputs.map((input, i) => {
              const error = touched || values[i] ? draft.errors[i] : undefined;
              return (
                // Inputs are positional; a parameter's name can be empty or repeated.
                <Field key={i} invalid={error ? true : undefined} className="flex flex-col gap-1">
                  <FieldLabel className="text-xs text-muted-foreground">
                    {/* Several functions share a page: "transfer: to address". */}
                    <span className="sr-only">{fn.name}:</span> {inputName(input, i)}{" "}
                    <code className="font-mono">{input.type}</code>
                  </FieldLabel>
                  {input.type === "bool" ? (
                    <Select
                      items={["false", "true"]}
                      value={values[i]}
                      onValueChange={(next) => setValue(i, next ?? "false")}
                    >
                      <SelectTrigger className={cn(controlClassName, "flex h-9 items-center justify-between")}>
                        <SelectValue />
                        <ChevronDownIcon aria-hidden className="size-4 text-muted-foreground" />
                      </SelectTrigger>
                      <SelectContent className="min-w-(--anchor-width) rounded-md bg-popover p-1 text-sm text-popover-foreground shadow-md ring-1 ring-foreground/10 transition-opacity duration-100 outline-none data-starting-style:opacity-0 data-ending-style:opacity-0 motion-reduce:transition-none">
                        {["false", "true"].map((option) => (
                          <SelectItem
                            key={option}
                            value={option}
                            className="cursor-default rounded-sm px-2 py-1.5 font-mono outline-none data-highlighted:bg-accent data-highlighted:text-accent-foreground aria-selected:font-medium"
                          >
                            {option}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : isComplexAbiType(input.type) ? (
                    <Textarea
                      rows={3}
                      spellCheck={false}
                      placeholder={input.type === "tuple" ? '{ "field": "value" }' : '["…"]'}
                      value={values[i]}
                      onValueChange={(next) => setValue(i, next)}
                      className={cn(controlClassName, "py-1.5")}
                    />
                  ) : (
                    <Input
                      type="text"
                      spellCheck={false}
                      autoComplete="off"
                      inputMode={/int/.test(input.type) ? "numeric" : undefined}
                      placeholder={input.type}
                      value={values[i]}
                      onValueChange={(next) => setValue(i, next)}
                      className={cn(controlClassName, "h-9")}
                    />
                  )}
                  {error && (
                    <FieldError match className="text-xs text-destructive">
                      {error}
                    </FieldError>
                  )}
                </Field>
              );
            })}

            {kind === "payable" && (
              <Field invalid={draft.value === null ? true : undefined} className="flex flex-col gap-1">
                <FieldLabel className="text-xs text-muted-foreground">
                  <span className="sr-only">{fn.name}:</span> Value <code className="font-mono">ETH</code>
                </FieldLabel>
                <Input
                  type="text"
                  inputMode="decimal"
                  placeholder="0"
                  value={ethValue}
                  onValueChange={setEthValue}
                  className={cn(controlClassName, "h-9")}
                />
              </Field>
            )}

            {kind === "read" ? (
              <>
                <Button
                  type="submit"
                  variant="outline"
                  size="sm"
                  className="self-start"
                  disabled={read.isPending}
                  focusableWhenDisabled
                >
                  <MorphText>{read.isPending ? "Reading…" : "Read"}</MorphText>
                  {/* Every read function has this button, and the card's trigger
                      holds "read balanceOf" too: "Read balanceOf from the contract". */}
                  {" "}
                  <span className="sr-only">{fn.name} from the contract</span>
                </Button>
                {read.isSuccess && <ReadResult name={fn.name} value={formatAbiValue(read.data)} />}
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
                  draft.blocker
                    ? undefined
                    : // The ABI is only known at runtime, so wagmi can't type-check this call.
                      ({
                        address,
                        abi: [fn],
                        functionName: fn.name,
                        args: draft.args,
                        value: draft.value ?? undefined,
                      } as ContractRequest)
                }
                disabledReason={
                  draft.blocker &&
                  (touched || values.some((v) => v.trim()) ? draft.blocker : "Fill in the fields")
                }
                agentConfirm={
                  draft.blocker
                    ? undefined
                    : functionConfirmText(fn, draft, {
                        address,
                        chainName: config.chains.find((c) => c.id === (chainId ?? currentChainId))?.name,
                      })
                }
                size="sm"
                className="self-start"
              >
                {/* The card's trigger also holds the name: "Call transfer" sets the button apart. */}
                <span className="sr-only">Call</span> {fn.name}
              </TransactionButton>
            )}
          </form>
        </CollapsiblePanel>
      </Collapsible>
    </div>
  );
}

/**
 * A read's return value. A read-only field rather than plain text, so a
 * browser agent can read it too.
 */
function ReadResult({ name, value }: { name: string; value: string }) {
  return (
    <Field className="flex flex-col">
      <FieldLabel className="sr-only">{name} result</FieldLabel>
      <Textarea
        readOnly
        wrap="off"
        spellCheck={false}
        rows={value.split("\n").length}
        value={value}
        className="w-full resize-none overflow-auto rounded-lg bg-muted/50 p-3 font-mono text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      />
    </Field>
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
  const fns = useMemo(() => contractFunctions(abi, { functions, show }), [abi, functions, show]);

  return (
    <div data-slot="contract-form" className={cn("flex flex-col gap-2", className)}>
      {fns.length === 0 ? (
        <p className="text-sm text-muted-foreground">No matching functions in this ABI.</p>
      ) : (
        fns.map((fn, i) => (
          <ContractFunction key={`${functionSignature(fn)}-${i}`} address={address} fn={fn} chainId={chainId} />
        ))
      )}
    </div>
  );
}
