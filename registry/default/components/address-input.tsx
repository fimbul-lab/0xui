import { ClipboardPasteIcon, EyeOffIcon, Loader2Icon } from "lucide-react";
import {
  useEffect,
  useId,
  useState,
  type ComponentProps,
} from "react";
import { getAddress, isAddress, type Address } from "viem";
import { normalize } from "viem/ens";
import { useEnsAddress, useEnsName } from "wagmi";
import { mainnet } from "wagmi/chains";
import { AddressAvatar } from "@/components/address-avatar";
import { MorphText } from "@/components/morph-text";
import {
  SHIELDED_ADDRESS_LENGTH,
  SHIELDED_ADDRESS_PREFIX,
  isShieldedAddress,
  truncateAddress,
} from "@/lib/0xui-utils";
import { cn } from "@/lib/utils";

export type AddressInputPhase =
  | "empty"
  | "incomplete"
  | "resolving"
  | "valid"
  | "invalid"
  | "not-found";

export type AddressInputState = {
  phase: AddressInputPhase;
  /** Checksummed address once the input is a valid address or a resolved ENS name. */
  address: Address | undefined;
  /** ENS name typed or found for the address. */
  ensName: string | undefined;
  /** The private (`0zk…`) address, when the input is one and `shielded` is on. `address` is then undefined. */
  shieldedAddress: string | undefined;
  /** Why the input is invalid, for display. */
  error: string | undefined;
};

function useDebounced<T>(value: T, delay: number) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

function normalizeName(value: string) {
  try {
    return normalize(value);
  } catch {
    return undefined;
  }
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
) {
  const text = value.trim();
  const looksLikeAddress = /^0x[0-9a-fA-F]*$/.test(text);
  // An ENS name may start with "0zk" too; a private address never has a dot.
  const looksShielded =
    text.toLowerCase().startsWith(SHIELDED_ADDRESS_PREFIX) && !text.includes(".");
  const isName = !looksLikeAddress && !looksShielded && text.includes(".");
  const name = isName ? normalizeName(text) : undefined;
  const debouncedName = useDebounced(name, debounce);
  const nameSettled = debouncedName === name;

  const ens = useEnsAddress({
    name: debouncedName,
    chainId: mainnet.id,
    query: { enabled: Boolean(debouncedName) },
  });
  const validAddress = looksLikeAddress && isAddress(text) ? getAddress(text) : undefined;
  const reverse = useEnsName({
    address: validAddress,
    chainId: mainnet.id,
    query: { enabled: Boolean(validAddress) },
  });

  const state = ((): AddressInputState => {
    const base = {
      address: undefined,
      ensName: undefined,
      shieldedAddress: undefined,
      error: undefined,
    };
    if (!text) return { ...base, phase: "empty" };
    if (looksShielded) {
      if (!shielded)
        return { ...base, phase: "invalid", error: "Private (0zk) addresses can't be used here." };
      if (isShieldedAddress(text)) return { ...base, phase: "valid", shieldedAddress: text };
      if (text.length < SHIELDED_ADDRESS_LENGTH)
        return {
          ...base,
          phase: "incomplete",
          error: `Enter the full ${SHIELDED_ADDRESS_LENGTH}-character private address.`,
        };
      if (text.length > SHIELDED_ADDRESS_LENGTH)
        return { ...base, phase: "invalid", error: "Private address is too long." };
      return {
        ...base,
        phase: "invalid",
        error: "Checksum doesn't match. Check the private address for typos.",
      };
    }
    if (looksLikeAddress) {
      if (validAddress)
        return { ...base, phase: "valid", address: validAddress, ensName: reverse.data ?? undefined };
      if (text.length === 42)
        return { ...base, phase: "invalid", error: "Checksum doesn't match. Check the address for typos." };
      if (text.length > 42) return { ...base, phase: "invalid", error: "Address is too long." };
      return { ...base, phase: "incomplete", error: "Enter a full 42-character address." };
    }
    if (isName) {
      if (!name) return { ...base, phase: "invalid", error: "Not a valid ENS name." };
      if (!nameSettled || ens.isPending) return { ...base, phase: "resolving", ensName: name };
      if (ens.isError) return { ...base, phase: "invalid", ensName: name, error: "Couldn't look up this name. Try again." };
      if (!ens.data) return { ...base, phase: "not-found", ensName: name, error: `No address found for ${name}.` };
      return { ...base, phase: "valid", address: ens.data, ensName: name };
    }
    return {
      ...base,
      phase: "incomplete",
      error: shielded
        ? "Enter an address (0x…), an ENS name or a private address (0zk…)."
        : "Enter an address (0x…) or ENS name.",
    };
  })();

  return state;
}

export type AddressInputProps = Omit<
  ComponentProps<"input">,
  "value" | "onChange" | "type"
> & {
  value: string;
  /** Called with the text on every change. */
  onValueChange: (value: string) => void;
  /** Called when validation settles on a new result, e.g. an ENS name resolved. Use `state.address` as the recipient. */
  onResolve?: (state: AddressInputState) => void;
  /** Accessible label. Defaults to "Recipient". */
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
  id,
  onBlur,
  ...props
}: AddressInputProps) {
  const fallbackId = useId();
  const inputId = id ?? fallbackId;
  const messageId = `${inputId}-message`;
  const [touched, setTouched] = useState(false);
  const state = useAddressInput(value, { shielded });

  // Report each new validation result, including async ENS resolution.
  useEffect(() => {
    onResolve?.(state);
    // Fire on result changes only, not when the caller passes a new callback.
  }, [state.phase, state.address, state.ensName, state.shieldedAddress]);

  const showError =
    state.error !== undefined &&
    (state.phase === "not-found" || (touched && state.phase !== "resolving"));

  const message =
    state.shieldedAddress
      ? // Start and end, so a pasted address can be checked against its source.
        `Private address ${truncateAddress(state.shieldedAddress, { start: 9, end: 6 })}`
      : state.phase === "valid" && state.ensName && value.includes(".")
      ? truncateAddress(state.address!)
      : state.phase === "valid" && state.ensName
        ? state.ensName
        : state.phase === "resolving"
          ? `Looking up ${state.ensName}…`
          : showError
            ? state.error
            : undefined;

  return (
    <div
      data-slot="address-input"
      data-phase={state.phase}
      className={cn("flex flex-col gap-1.5", className)}
    >
      <div
        className={cn(
          "flex h-11 items-center gap-2 rounded-lg border bg-background px-3 focus-within:ring-3 focus-within:ring-ring/50",
          showError && "border-destructive"
        )}
      >
        {state.address && <AddressAvatar address={state.address} size={22} />}
        {state.shieldedAddress && (
          <EyeOffIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
        )}
        <input
          id={inputId}
          type="text"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          aria-label={label}
          aria-invalid={showError || undefined}
          aria-describedby={message ? messageId : undefined}
          placeholder={placeholder}
          value={value}
          onChange={(e) => {
            onValueChange(e.target.value);
            if (touched) setTouched(false);
          }}
          onBlur={(e) => {
            setTouched(true);
            onBlur?.(e);
          }}
          className="h-full min-w-0 flex-1 bg-transparent font-mono text-sm outline-none placeholder:font-sans"
          {...props}
        />
        {state.phase === "resolving" && (
          <Loader2Icon aria-hidden className="size-4 shrink-0 animate-spin text-muted-foreground" />
        )}
        {showPaste && !value && (
          <button
            type="button"
            aria-label="Paste address"
            onClick={async () => {
              try {
                const text = (await navigator.clipboard.readText()).trim();
                onValueChange(text);
                setTouched(true);
              } catch {
                // Clipboard read denied: the user can still paste with the keyboard.
              }
            }}
            className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <ClipboardPasteIcon className="size-4" />
          </button>
        )}
      </div>
      <p
        id={messageId}
        role={showError ? "alert" : "status"}
        className={cn(
          "min-h-5 text-sm",
          showError ? "text-destructive" : "text-muted-foreground",
          state.phase === "valid" && value.includes(".") && "font-mono"
        )}
      >
        {/* The hint morphs: "Looking up name…" into the address, or a name
            appearing for a pasted address. Errors are announced as-is. */}
        {showError ? message : <MorphText>{message}</MorphText>}
      </p>
    </div>
  );
}
