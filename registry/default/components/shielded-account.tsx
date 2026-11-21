// Docs: https://0xui.io/components/shielded-account.md
import { Loader2Icon, LockIcon } from "lucide-react";
import { useEffect, useId, useState, type ComponentProps, type ReactNode } from "react";
import { CopyButton } from "@/components/copy-button";
import { PrivacyBadge } from "@/components/privacy-badge";
import { ShieldedAddress } from "@/components/shielded-address";
import { useShieldedAccount, useShieldedEngine } from "@/components/shielded-provider";
import { Button } from "@/components/ui/button";
import { useMounted } from "@/hooks/use-mounted";
import { cn } from "@/lib/utils";

export type ShieldedAccountPhase =
  /** No private account on this device. */
  | "none"
  | "creating"
  /** Created. The recovery phrase is on screen until the user confirms they saved it. */
  | "backup"
  | "importing"
  | "locked"
  | "unlocking"
  | "unlocked";

const toError = (cause: unknown) => (cause instanceof Error ? cause : new Error(String(cause)));

/**
 * Create, import, unlock and lock the private account. The engine keeps the
 * recovery phrase; this hook holds it only between `create` and
 * `confirmBackup`, so it can be shown once.
 */
export function useShieldedAccountFlow() {
  const engine = useShieldedEngine();
  const { status, address } = useShieldedAccount();
  const [busy, setBusy] = useState<"creating" | "importing" | "unlocking">();
  const [mnemonic, setMnemonic] = useState<string>();
  const [error, setError] = useState<Error>();

  const phase: ShieldedAccountPhase = busy ?? (mnemonic !== undefined ? "backup" : status);

  /** Run one engine call. Resolves true when it worked; a failure lands in `error`. */
  const run = async (kind: NonNullable<typeof busy>, action: () => Promise<void>) => {
    setError(undefined);
    setBusy(kind);
    try {
      await action();
      return true;
    } catch (cause) {
      setError(toError(cause));
      return false;
    } finally {
      setBusy(undefined);
    }
  };

  return {
    phase,
    /** Private address, or null unless unlocked. */
    address,
    /** The recovery phrase, only while `phase` is "backup". */
    mnemonic,
    /** Why the last action failed, e.g. a wrong password. Cleared by the next action. */
    error,
    clearError: () => setError(undefined),
    /** Create a new account. Slow: the phase is "creating" for several seconds. */
    create: (password: string) =>
      run("creating", async () => {
        const created = await engine.account.create(password);
        setMnemonic(created.mnemonic);
      }),
    /** The user has saved the phrase. Drops it from memory. */
    confirmBackup: () => setMnemonic(undefined),
    /** Restore an account from its recovery phrase. */
    importAccount: (phrase: string, password: string) =>
      run("importing", () => engine.account.import(phrase, password)),
    unlock: (password: string) => run("unlocking", () => engine.account.unlock(password)),
    lock: () => {
      setMnemonic(undefined);
      setError(undefined);
      engine.account.lock();
    },
  };
}

export const MIN_PASSWORD_LENGTH = 8;

/** Why a new password can't be used yet, as button text, or undefined when it's fine. */
export function passwordBlocker(password: string, confirmation: string) {
  if (!password) return "Enter a password";
  if (password.length < MIN_PASSWORD_LENGTH) return `Use at least ${MIN_PASSWORD_LENGTH} characters`;
  if (password !== confirmation) return "Passwords don't match";
  return undefined;
}

/** The words of a typed recovery phrase, whatever the spacing or casing. */
export function phraseWords(text: string) {
  return text.trim().toLowerCase().split(/\s+/).filter(Boolean);
}

/** Why a typed recovery phrase can't be used yet, or undefined when the word count fits. */
export function phraseBlocker(text: string) {
  const count = phraseWords(text).length;
  if (count === 0) return "Enter your recovery phrase";
  if (count !== 12 && count !== 24) return `Enter all 12 or 24 words (${count} so far)`;
  return undefined;
}

const fieldClass =
  "h-11 w-full rounded-lg border bg-background px-3 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50";

function Field({
  label,
  className,
  ...props
}: Omit<ComponentProps<"input">, "id"> & { label: string }) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <input id={id} className={cn(fieldClass, className)} {...props} />
    </div>
  );
}

function SubmitButton({
  blocker,
  busy,
  busyLabel,
  children,
}: {
  /** Names what is missing. The button is disabled and shows this. */
  blocker: string | undefined;
  busy: boolean;
  busyLabel: string;
  children: ReactNode;
}) {
  return (
    <Button
      type="submit"
      size="lg"
      className="h-11 w-full"
      disabled={busy || blocker !== undefined}
      aria-busy={busy || undefined}
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
      <Field
        label="Password"
        type="password"
        autoComplete="new-password"
        value={password}
        disabled={busy}
        onChange={(event) => setPassword(event.target.value)}
      />
      <Field
        label="Confirm password"
        type="password"
        autoComplete="new-password"
        value={confirmation}
        disabled={busy}
        onChange={(event) => setConfirmation(event.target.value)}
      />
      <p className="text-sm text-muted-foreground">
        The password encrypts the account on this device. It can't be reset.
      </p>
      <FormError error={error} />
      <SubmitButton blocker={blocker} busy={busy} busyLabel="Creating account…">
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
  const phraseId = useId();
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
      <div className="flex flex-col gap-1.5">
        <label htmlFor={phraseId} className="text-sm font-medium">
          Recovery phrase
        </label>
        <textarea
          id={phraseId}
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
          onChange={(event) => setPhrase(event.target.value)}
          className={cn(fieldClass, "h-auto resize-none py-2.5 font-mono placeholder:font-sans")}
        />
      </div>
      <Field
        label="New password"
        type="password"
        autoComplete="new-password"
        value={password}
        disabled={busy}
        onChange={(event) => setPassword(event.target.value)}
      />
      <Field
        label="Confirm password"
        type="password"
        autoComplete="new-password"
        value={confirmation}
        disabled={busy}
        onChange={(event) => setConfirmation(event.target.value)}
      />
      <FormError error={error} />
      <SubmitButton blocker={blocker} busy={busy} busyLabel="Importing account…">
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
      <Field
        label="Password"
        type="password"
        autoComplete="current-password"
        value={password}
        disabled={busy}
        aria-invalid={error ? true : undefined}
        onChange={(event) => setPassword(event.target.value)}
      />
      <FormError error={error} />
      <SubmitButton
        blocker={password ? undefined : "Enter your password"}
        busy={busy}
        busyLabel="Unlocking…"
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
  const checkboxId = useId();
  const [revealed, setRevealed] = useState(false);
  const [saved, setSaved] = useState(false);
  const words = mnemonic.split(" ");

  return (
    <div className={cn("flex flex-col gap-3 text-sm", className)}>
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
            !revealed && "blur-sm select-none"
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

      <label htmlFor={checkboxId} className="flex min-h-11 items-center gap-2">
        <input
          id={checkboxId}
          type="checkbox"
          checked={saved}
          disabled={!revealed}
          onChange={(event) => setSaved(event.target.checked)}
          className="size-4 accent-primary"
        />
        I saved my recovery phrase somewhere safe
      </label>

      <Button size="lg" className="h-11 w-full" disabled={!saved} onClick={onConfirm}>
        {!revealed ? "Reveal the phrase first" : saved ? "Continue" : "Confirm you saved it"}
      </Button>
    </div>
  );
}

export type ShieldedAccountSummaryProps = {
  /** The account's private address. Leave out for a protocol that has none. */
  address?: string | null;
  onLock: () => void;
  className?: string;
};

/** The unlocked account in one line: a private badge, its address if it has one, and a lock button. */
export function ShieldedAccountSummary({ address, onLock, className }: ShieldedAccountSummaryProps) {
  return (
    <div className={cn("flex items-center justify-between gap-2 text-sm", className)}>
      <span className="flex min-w-0 items-center gap-2">
        <PrivacyBadge privacy="private" iconOnly />
        {address ? <ShieldedAddress address={address} /> : "Private account"}
      </span>
      <Button variant="ghost" size="sm" onClick={onLock}>
        <LockIcon aria-hidden />
        Lock
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
  /**
   * Called when the account becomes usable: unlocked, imported, or created
   * and backed up. `address` is null for a protocol with no private address.
   */
  onUnlocked?: (address: string | null) => void;
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
    if (phase === "unlocked") onUnlocked?.(address);
    // Only reaching "unlocked" should fire the callback.
  }, [phase]);

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
        <ShieldedAccountSummary address={address} onLock={account.lock} />
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
