// Docs: https://0xui.io/components/address-input.md
import { useQuery } from "@tanstack/react-query";
import { Input, InputGroup } from "@ui-sdk/react/input";
import { ClipboardPasteIcon, EyeOffIcon, Loader2Icon } from "lucide-react";
import { useEffect, useState, type ComponentProps } from "react";
import { useConfig } from "wagmi";
import { AddressAvatar } from "@/components/address-avatar";
import { MorphText } from "@/components/morph-text";
import { Button } from "@/components/primitives/button";
import { Field, FieldDescription, FieldError } from "@/components/primitives/field";
import {
  addressInputMessage,
  addressInputState,
  ensAddressQueryOptions,
  parseAddressInput,
  showAddressError,
  type AddressInputPhase,
  type AddressInputState,
} from "@/lib/address-input-core";
import { ensNameQueryOptions } from "@/lib/identity";
import { cn } from "@/lib/utils";

export type { AddressInputPhase, AddressInputState };

function useDebounced<T>(value: T, delay: number) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

/**
 * Validate an address or resolve an ENS name (on mainnet). Lookups wait for
 * typing to pause. Mixed-case addresses must match their checksum. With
 * `shielded`, private `0zk…` addresses are accepted too and checked against
 * their own checksum; they are never sent to a resolver.
 */
export function useAddressInput(
  value: string,
  { debounce = 300, shielded = false }: { debounce?: number; shielded?: boolean } = {}
): AddressInputState {
  const config = useConfig();
  const input = parseAddressInput(value);
  const name = input.kind === "name" ? input.name : undefined;
  const debouncedName = useDebounced(name, debounce);
  const address = input.kind === "address" ? input.address : undefined;

  const ens = useQuery(ensAddressQueryOptions(config, { name: debouncedName }));
  const reverse = useQuery(ensNameQueryOptions(config, { address }));

  return addressInputState(
    input,
    { ens, nameSettled: debouncedName === name, reverseName: reverse.data },
    { shielded }
  );
}

export type AddressInputProps = Omit<
  ComponentProps<typeof Input>,
  "value" | "defaultValue" | "onChange" | "onValueChange" | "type"
> & {
  value: string;
  /** Called with the text on every change. */
  onValueChange: (value: string) => void;
  /** Called when validation settles on a new result, e.g. an ENS name resolved. Use `state.address` as the recipient. */
  onResolve?: (state: AddressInputState) => void;
  /**
   * Accessible label. Defaults to "Recipient". The field is named
   * "<label> address" and the paste button "Paste into <label>", so neither
   * name holds all of the other's words and two address fields stay apart.
   */
  label?: string;
  /** Show a paste button while the input is empty. */
  showPaste?: boolean;
  /** Also accept private `0zk…` addresses. The result is then in `state.shieldedAddress`. */
  shielded?: boolean;
};

/**
 * Recipient input: takes an address or an ENS name, resolves names as you
 * type, shows the avatar and resolved address, and catches checksum typos.
 * Problems show after the field loses focus, not while typing.
 */
export function AddressInput({
  value,
  onValueChange,
  onResolve,
  label = "Recipient",
  showPaste = true,
  shielded = false,
  placeholder = shielded ? "Address, ENS name or 0zk address" : "Address or ENS name",
  className,
  onBlur,
  ...props
}: AddressInputProps) {
  const [touched, setTouched] = useState(false);
  const state = useAddressInput(value, { shielded });

  // Report each new validation result, including async ENS resolution.
  useEffect(() => {
    onResolve?.(state);
    // Fire on result changes only, not when the caller passes a new callback.
  }, [state.phase, state.address, state.ensName, state.shieldedAddress]);

  const showError = showAddressError(state, touched);
  const message = addressInputMessage(state, value, showError);

  return (
    <Field
      invalid={showError || undefined}
      render={(fieldProps) => (
        <div {...fieldProps} data-slot="address-input" data-phase={state.phase} />
      )}
      className={cn("gap-1.5", className)}
    >
      <InputGroup className="flex h-11 items-center gap-2 rounded-lg border bg-background px-3 focus-within:ring-3 focus-within:ring-ring/50 data-invalid:border-destructive">
        {state.address && <AddressAvatar address={state.address} size={22} />}
        {state.shieldedAddress && (
          <EyeOffIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
        )}
        <Input
          type="text"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          aria-label={/\baddress\b/i.test(label) ? label : `${label} address`}
          placeholder={placeholder}
          value={value}
          onValueChange={(next) => {
            onValueChange(next);
            if (touched) setTouched(false);
          }}
          onBlur={(event) => {
            setTouched(true);
            onBlur?.(event);
          }}
          className="h-full min-w-0 flex-1 bg-transparent font-mono text-sm outline-none placeholder:font-sans"
          {...props}
        />
        {state.phase === "resolving" && (
          <Loader2Icon aria-hidden className="size-4 shrink-0 animate-spin text-muted-foreground" />
        )}
        {showPaste && !value && (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={`Paste into ${label}`}
            onClick={async () => {
              try {
                const text = (await navigator.clipboard.readText()).trim();
                onValueChange(text);
                setTouched(true);
              } catch {
                // Clipboard read denied: the user can still paste with the keyboard.
              }
            }}
            className="text-muted-foreground"
          >
            <ClipboardPasteIcon aria-hidden />
          </Button>
        )}
      </InputGroup>
      {showError ? (
        <FieldError match role="alert" render={<p />} className="min-h-5">
          {message}
        </FieldError>
      ) : (
        <FieldDescription
          role="status"
          className={cn("min-h-5", state.phase === "valid" && value.includes(".") && "font-mono")}
        >
          {/* The hint morphs: "Looking up name…" into the address, or a name
              appearing for a pasted address. Errors are announced as-is. */}
          <MorphText>{message}</MorphText>
        </FieldDescription>
      )}
    </Field>
  );
}
