// Docs: https://0xui.io/components/note-backup.md
import { Checkbox, CheckboxIndicator } from "@ui-sdk/react/checkbox";
import { CheckIcon, DownloadIcon } from "lucide-react";
import { useState, type ReactNode } from "react";
import { CopyButton } from "@/components/copy-button";
import { Button } from "@/components/primitives/button";
import { cn } from "@/lib/utils";

/**
 * Save text as a file, from a click. Returns false where the browser can't.
 * The text never leaves the device: the file is made in memory.
 */
export function downloadTextFile(fileName: string, text: string) {
  try {
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    link.click();
    // The download has its own copy by the next task.
    setTimeout(() => URL.revokeObjectURL(url));
    return true;
  } catch {
    return false;
  }
}

export type NoteBackupProps = {
  /** The secret to back up. */
  note: string;
  /** Whether the user has confirmed the backup. */
  saved: boolean;
  onSavedChange: (saved: boolean) => void;
  /** Name of the downloaded file. Must not contain the note. */
  fileName?: string;
  /** Heading. Pass null to hide. */
  title?: ReactNode;
  /** What losing the note means. */
  description?: ReactNode;
  /** Text next to the checkbox. */
  confirmLabel?: ReactNode;
  className?: string;
};

/**
 * Shows a secret note once, for backup before anything is sent: hidden
 * until asked for, with copy and download, and a checkbox the user has to
 * tick. The checkbox stays closed until the note has been revealed, copied
 * or downloaded. The note is never put in an attribute or in storage.
 */
export function NoteBackup({
  note,
  saved,
  onSavedChange,
  fileName = "note-backup.txt",
  title = "Save your note",
  description = "This note is the only way to withdraw the deposit. Anyone who has it can take the funds, and nobody can restore it if you lose it.",
  confirmLabel = "I saved my note somewhere safe",
  className,
}: NoteBackupProps) {
  const [revealed, setRevealed] = useState(false);
  /** The note left the screen some way: revealed, copied or downloaded. */
  const [taken, setTaken] = useState(false);
  const [downloadFailed, setDownloadFailed] = useState(false);

  return (
    // The note is the money: an agent never reads it or confirms the backup.
    <div
      data-agent-hidden=""
      data-slot="note-backup"
      data-saved={saved || undefined}
      className={cn("flex w-full flex-col gap-3 rounded-xl border p-4 text-sm", className)}
    >
      {(title || description) && (
        <div className="flex flex-col gap-1">
          {title && <p className="font-medium">{title}</p>}
          {description && <p className="text-muted-foreground">{description}</p>}
        </div>
      )}

      <div className="relative rounded-lg border bg-muted/40 p-3">
        <p
          // A hidden note is hidden from assistive technology and selection too.
          aria-hidden={!revealed || undefined}
          aria-label={revealed ? "Your note" : undefined}
          translate="no"
          className={cn("font-mono text-xs break-all", !revealed && "blur-sm select-none")}
        >
          {revealed ? note : "•".repeat(Math.min(note.length, 160))}
        </p>
        {!revealed && (
          <div className="absolute inset-0 flex items-center justify-center">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setRevealed(true);
                setTaken(true);
              }}
            >
              Reveal note
            </Button>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            const ok = downloadTextFile(fileName, `${note}\n`);
            setDownloadFailed(!ok);
            if (ok) setTaken(true);
          }}
        >
          <DownloadIcon aria-hidden />
          Download backup
        </Button>
        <span className="flex items-center gap-1 text-muted-foreground">
          <CopyButton value={note} label="Copy note" onCopy={() => setTaken(true)} />
          Copy
        </span>
      </div>
      <p className="text-xs text-muted-foreground">
        {downloadFailed
          ? "The download did not start. Reveal the note and write it down, or copy it."
          : "Copying puts the note on your clipboard, where other apps can read it."}
      </p>

      <label className="flex min-h-11 items-center gap-2">
        <Checkbox
          checked={saved}
          disabled={!taken}
          onCheckedChange={(checked) => onSavedChange(checked === true)}
          className="flex size-4 shrink-0 items-center justify-center rounded-[4px] border border-input outline-none focus-visible:ring-3 focus-visible:ring-ring/50 data-checked:border-primary data-checked:bg-primary data-checked:text-primary-foreground data-disabled:opacity-50"
        >
          <CheckboxIndicator>
            <CheckIcon aria-hidden className="size-3.5" />
          </CheckboxIndicator>
        </Checkbox>
        {confirmLabel}
      </label>
    </div>
  );
}
