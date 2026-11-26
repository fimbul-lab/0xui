// Docs: https://0xui.io/components/shielded-account.md
import { Checkbox, CheckboxIndicator } from "@ui-sdk/react/checkbox";
import { Field, FieldLabel } from "@ui-sdk/react/field";
import { Input } from "@ui-sdk/react/input";
import { Textarea } from "@ui-sdk/react/textarea";
import { CheckIcon, Loader2Icon, LockIcon } from "lucide-react";
import { useEffect, useMemo, useState, type ComponentProps, type ReactNode } from "react";
import { CopyButton } from "@/components/copy-button";
import { PrivacyBadge } from "@/components/privacy-badge";
import { Button } from "@/components/primitives/button";
import { ShieldedAddress } from "@/components/shielded-address";
import { useShieldedEngine, useShieldedStore } from "@/components/shielded-provider";
import { useMounted } from "@/hooks/use-mounted";
import {
  MIN_PASSWORD_LENGTH,
  SERVER_ACCOUNT_FLOW,
  createShieldedAccountFlow,
  passwordBlocker,
  phraseBlocker,
  phraseWords,
  type ShieldedAccountPhase,
} from "@/lib/shielded-account-core";
import { cn } from "@/lib/utils";

export {
  MIN_PASSWORD_LENGTH,
  passwordBlocker,
  phraseBlocker,
  phraseWords,
  type ShieldedAccountPhase,
};

/**
 * Create, import, unlock and lock the private account. The engine keeps the
 * recovery phrase; this hook holds it only between `create` and
 * `confirmBackup`, so it can be shown once. The logic lives in
 * `createShieldedAccountFlow` (framework-free).
 */
export function useShieldedAccountFlow() {
  const engine = useShieldedEngine();
  const flow = useMemo(() => createShieldedAccountFlow(engine), [engine]);
  const state = useShieldedStore(flow, SERVER_ACCOUNT_FLOW);
  return {
    ...state,
    clearError: flow.clearError,
    create: flow.create,
    confirmBackup: flow.confirmBackup,
    importAccount: flow.importAccount,
    unlock: flow.unlock,
    lock: flow.lock,
  };
}

const fieldClass =
  "h-11 w-full rounded-lg border bg-background px-3 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50";

function TextField({
  label,
  invalid,
  className,
  ...props
}: Omit<ComponentProps<typeof Input>, "id"> & { label: string; invalid?: boolean }) {
  return (
    <Field invalid={invalid} className="flex flex-col gap-1.5">
      <FieldLabel className="text-sm font-medium">{label}</FieldLabel>
      <Input className={cn(fieldClass, className)} {...props} />
    </Field>
  );
}

function SubmitButton({
  blocker,
  busy,
  busyLabel,
  agentConfirm,
  children,
}: {
  /** Names what is missing. The button is disabled and shows this. */
  blocker: string | undefined;
  busy: boolean;
  busyLabel: string;
  /** What a browser agent must ask a person before pressing it, as `data-agent-confirm`. */
  agentConfirm: string;
  children: ReactNode;
}) {
  return (
    <Button
      type="submit"
      size="lg"
      className="h-11 w-full"
      disabled={busy || blocker !== undefined}
      aria-busy={busy || undefined}
      data-agent-confirm={agentConfirm}
    >
      {busy && <Loader2Icon aria-hidden className="animate-spin motion-reduce:animate-none" />}
      {busy ? busyLabel : (blocker ?? children)}
    </Button>
  );
}

function FormError({ error }: { error: Error | undefined }) {
  if (!error) return null;
  return (
    <p role="alert" className="text-sm text-destructive">
      {error.message}
    </p>
  );
}

type FormProps = {
  /** Disables the form and shows progress on the button. */
  busy?: boolean;
  /** Shown under the fields. */
  error?: Error;
  className?: string;
};

export type ShieldedAccountCreateFormProps = FormProps & {
  onCreate: (password: string) => void;
};

/** Choose a password for a new private account. */
export function ShieldedAccountCreateForm({
  onCreate,
  busy = false,
  error,
  className,
}: ShieldedAccountCreateFormProps) {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const blocker = passwordBlocker(password, confirmation);

  return (
    <form
      className={cn("flex flex-col gap-3", className)}
      onSubmit={(event) => {
        event.preventDefault();
        if (!blocker && !busy) onCreate(password);
      }}
    >
      {/* "New password", not "Password": a label inside another ("Confirm
          password") can't be told apart by an agent naming it. */}
      <TextField
        label="New password"
        type="password"
        autoComplete="new-password"
        value={password}
        disabled={busy}
        onValueChange={setPassword}
      />
      <TextField
        label="Confirm password"
        type="password"
        autoComplete="new-password"
        value={confirmation}
        disabled={busy}
        onValueChange={setConfirmation}
      />
      <p className="text-sm text-muted-foreground">
        The password encrypts the account on this device. It can't be reset.
      </p>
      <FormError error={error} />
      <SubmitButton
        blocker={blocker}
        busy={busy}
        busyLabel="Creating account…"
        agentConfirm="Creates a new private account on this device, locked with the password entered here"
      >
        Create private account
      </SubmitButton>
      <p role="status" className="text-sm text-muted-foreground empty:hidden">
        {busy ? "This takes a few seconds." : ""}
      </p>
    </form>
  );
}

export type ShieldedAccountImportFormProps = FormProps & {
  onImport: (phrase: string, password: string) => void;
};

/** Restore a private account from its recovery phrase and choose a password for this device. */
export function ShieldedAccountImportForm({
  onImport,
  busy = false,
  error,
  className,
}: ShieldedAccountImportFormProps) {
  const [phrase, setPhrase] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const blocker = phraseBlocker(phrase) ?? passwordBlocker(password, confirmation);

  return (
    <form
      className={cn("flex flex-col gap-3", className)}
      onSubmit={(event) => {
        event.preventDefault();
        if (!blocker && !busy) onImport(phraseWords(phrase).join(" "), password);
      }}
    >
      {/* An agent may paste the phrase in, but never read it back. */}
      <Field data-agent-secret="" className="flex flex-col gap-1.5">
        <FieldLabel className="text-sm font-medium">Recovery phrase</FieldLabel>
        <Textarea
          rows={3}
          // A recovery phrase must never reach a spell checker, an
          // autocomplete store or a password manager.
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="none"
          spellCheck={false}
          data-1p-ignore
          data-lpignore="true"
          placeholder="12 or 24 words, separated by spaces"
          value={phrase}
          disabled={busy}
          onValueChange={setPhrase}
          className={cn(fieldClass, "h-auto resize-none py-2.5 font-mono placeholder:font-sans")}
        />
      </Field>
      <TextField
        label="New password"
        type="password"
        autoComplete="new-password"
        value={password}
        disabled={busy}
        onValueChange={setPassword}
      />
      <TextField
        label="Confirm password"
        type="password"
        autoComplete="new-password"
        value={confirmation}
        disabled={busy}
        onValueChange={setConfirmation}
      />
      <FormError error={error} />
      <SubmitButton
        blocker={blocker}
        busy={busy}
        busyLabel="Importing account…"
        agentConfirm="Restores the private account from the recovery phrase entered here and keeps it on this device, locked with the new password"
      >
        Import private account
      </SubmitButton>
      <p role="status" className="text-sm text-muted-foreground empty:hidden">
        {busy ? "This takes a few seconds." : ""}
      </p>
    </form>
  );
}

export type ShieldedAccountUnlockFormProps = FormProps & {
  onUnlock: (password: string) => void;
};

/** Enter the password of the private account on this device. */
export function ShieldedAccountUnlockForm({
  onUnlock,
  busy = false,
  error,
  className,
}: ShieldedAccountUnlockFormProps) {
  const [password, setPassword] = useState("");

  return (
    <form
      className={cn("flex flex-col gap-3", className)}
      onSubmit={(event) => {
        event.preventDefault();
        if (password && !busy) onUnlock(password);
      }}
    >
      <TextField
        label="Password"
        type="password"
        autoComplete="current-password"
        value={password}
        disabled={busy}
        invalid={error ? true : undefined}
        onValueChange={setPassword}
      />
      <FormError error={error} />
      <SubmitButton
        blocker={password ? undefined : "Enter your password"}
        busy={busy}
        busyLabel="Unlocking…"
        agentConfirm="Unlocks your private account on this device with the password entered here"
      >
        Unlock
      </SubmitButton>
    </form>
  );
}

export type RecoveryPhraseProps = {
  /** The phrase, words separated by spaces. */
  mnemonic: string;
  /** Called when the user confirms they saved it. */
  onConfirm: () => void;
  className?: string;
};

/**
 * Shows a recovery phrase once. The words are hidden until the user asks
 * for them, and the way forward stays closed until they confirm they saved
 * the phrase.
 */
export function RecoveryPhrase({ mnemonic, onConfirm, className }: RecoveryPhraseProps) {
  const [revealed, setRevealed] = useState(false);
  const [saved, setSaved] = useState(false);
  const words = mnemonic.split(" ");

  return (
    // Agents never see the phrase, and saving it is the person's to confirm.
    <div data-agent-hidden="" className={cn("flex flex-col gap-3 text-sm", className)}>
      <div className="flex flex-col gap-1">
        <p className="font-medium">Save your recovery phrase</p>
        <p className="text-muted-foreground">
          These {words.length} words are the only way to restore this account. Anyone who has them
          can spend its funds. They are shown once.
        </p>
      </div>

      <div className="relative rounded-lg border p-3">
        <ol
          // Hidden words are hidden from assistive technology and selection too.
          aria-hidden={!revealed || undefined}
          className={cn(
            "grid grid-cols-2 gap-x-4 gap-y-1.5 font-mono sm:grid-cols-3",
            !revealed && "blur-sm select-none",
          )}
        >
          {words.map((word, index) => (
            <li key={index} className="flex gap-2">
              <span className="w-5 text-right text-muted-foreground tabular-nums select-none">
                {index + 1}
              </span>
              {revealed ? word : "•••••"}
            </li>
          ))}
        </ol>
        {!revealed && (
          <div className="absolute inset-0 flex items-center justify-center">
            <Button variant="outline" size="sm" onClick={() => setRevealed(true)}>
              Reveal phrase
            </Button>
          </div>
        )}
      </div>

      {revealed && (
        <p className="flex items-center gap-1 text-muted-foreground">
          <CopyButton value={mnemonic} label="Copy recovery phrase" />
          Copying puts the phrase on your clipboard, where other apps can read it.
        </p>
      )}

      <label className="flex min-h-11 items-center gap-2">
        <Checkbox
          checked={saved}
          disabled={!revealed}
          onCheckedChange={(checked) => setSaved(checked === true)}
          className="flex size-4 shrink-0 items-center justify-center rounded-[4px] border border-input outline-none focus-visible:ring-3 focus-visible:ring-ring/50 data-checked:border-primary data-checked:bg-primary data-checked:text-primary-foreground data-disabled:opacity-50"
        >
          <CheckboxIndicator>
            <CheckIcon aria-hidden className="size-3.5" />
          </CheckboxIndicator>
        </Checkbox>
        I saved my recovery phrase somewhere safe
      </label>

      <Button size="lg" className="h-11 w-full" disabled={!saved} onClick={onConfirm}>
        {!revealed ? "Reveal the phrase first" : saved ? "Continue" : "Confirm you saved it"}
      </Button>
    </div>
  );
}

export type ShieldedAccountSummaryProps = {
  /** The account's private address. */
  address: string;
  onLock: () => void;
  className?: string;
};

/** The unlocked account in one line: a private badge, its address, and a lock button. */
export function ShieldedAccountSummary({
  address,
  onLock,
  className,
}: ShieldedAccountSummaryProps) {
  return (
    <div className={cn("flex items-center justify-between gap-2 text-sm", className)}>
      <span className="flex min-w-0 items-center gap-2">
        <PrivacyBadge privacy="private" iconOnly />
        <ShieldedAddress address={address} />
      </span>
      <Button
        variant="ghost"
        size="sm"
        onClick={onLock}
        data-agent-confirm="Locks your private account. Unlocking it again takes its password"
      >
        <LockIcon aria-hidden />
        Lock <span className="sr-only">private account</span>
      </Button>
    </div>
  );
}

export type ShieldedAccountProps = {
  /**
   * Rendered once the account is unlocked, in place of the summary. Use it
   * to gate the private part of your app behind the account.
   */
  children?: ReactNode;
  /** Called when the account becomes usable: unlocked, imported, or created and backed up. */
  onUnlocked?: (address: string) => void;
  className?: string;
};

/**
 * The private account, whatever state it is in: create one or import a
 * recovery phrase, save the phrase, unlock with a password, lock again.
 * Creation takes seconds and says so. Renders `children` once unlocked.
 */
export function ShieldedAccount({ children, onUnlocked, className }: ShieldedAccountProps) {
  const mounted = useMounted();
  const account = useShieldedAccountFlow();
  const [mode, setMode] = useState<"create" | "import">("create");
  const { phase, address, error } = account;
  // An error belongs to the form it happened in.
  const switchTo = (next: typeof mode) => {
    account.clearError();
    setMode(next);
  };

  useEffect(() => {
    if (phase === "unlocked" && address) onUnlocked?.(address);
    // Only reaching "unlocked" should fire the callback.
  }, [phase, address]);

  // The account lives in the browser. Render nothing on the server, so a
  // locked account never flashes the "create" form while hydrating.
  if (!mounted) return null;

  if (phase === "unlocked" && children !== undefined) return <>{children}</>;

  const importing = phase === "importing" || (phase === "none" && mode === "import");

  return (
    <div
      data-slot="shielded-account"
      data-phase={phase}
      className={cn("flex w-full max-w-sm flex-col gap-4 rounded-xl border p-4", className)}
    >
      {phase === "unlocked" ? (
        address && <ShieldedAccountSummary address={address} onLock={account.lock} />
      ) : phase === "backup" ? (
        <RecoveryPhrase mnemonic={account.mnemonic!} onConfirm={account.confirmBackup} />
      ) : phase === "locked" || phase === "unlocking" ? (
        <>
          <Heading title="Unlock your private account">
            It is stored encrypted on this device.
          </Heading>
          <ShieldedAccountUnlockForm
            onUnlock={account.unlock}
            busy={phase === "unlocking"}
            error={error}
          />
        </>
      ) : importing ? (
        <>
          <Heading title="Import a private account">
            Enter its recovery phrase and choose a password for this device.
          </Heading>
          <ShieldedAccountImportForm
            onImport={account.importAccount}
            busy={phase === "importing"}
            error={error}
          />
          <SwitchMode disabled={phase === "importing"} onClick={() => switchTo("create")}>
            Create a new account instead
          </SwitchMode>
        </>
      ) : (
        <>
          <Heading title="Create a private account">
            It holds your shielded balance and is separate from your wallet.
          </Heading>
          <ShieldedAccountCreateForm
            onCreate={account.create}
            busy={phase === "creating"}
            error={error}
          />
          <SwitchMode disabled={phase === "creating"} onClick={() => switchTo("import")}>
            Import a recovery phrase instead
          </SwitchMode>
        </>
      )}
    </div>
  );
}

function Heading({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <p className="font-medium">{title}</p>
      <p className="text-sm text-muted-foreground">{children}</p>
    </div>
  );
}

function SwitchMode(props: ComponentProps<typeof Button>) {
  return <Button variant="link" size="sm" className="self-center" {...props} />;
}
