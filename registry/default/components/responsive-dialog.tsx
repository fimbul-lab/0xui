// Docs: https://0xui.io/components/responsive-dialog.md
import { useCallback, useSyncExternalStore } from "react";
import type { KeyboardEventHandler, ReactNode } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/primitives/dialog";

/**
 * Whether a media query matches, kept up to date. False on the server and
 * where `matchMedia` is missing, such as jsdom.
 */
export function useMediaQuery(query: string) {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (typeof window.matchMedia !== "function") return () => {};
      const media = window.matchMedia(query);
      media.addEventListener("change", onChange);
      return () => media.removeEventListener("change", onChange);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => typeof window.matchMedia === "function" && window.matchMedia(query).matches,
    () => false,
  );
}

export type ResponsiveDialogMode = "auto" | "dialog" | "drawer";

export type ResponsiveDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  /** What the dialog is for. Read by screen readers, not shown. */
  description: ReactNode;
  /**
   * `auto` is a bottom sheet on small touch screens and a centered dialog
   * elsewhere, decided each time it opens. `dialog` and `drawer` force one.
   */
  mode?: ResponsiveDialogMode;
  /**
   * Media query that picks the sheet in `auto` mode, in place of the small
   * touch screen check. A change applies from the next open.
   */
  drawerQuery?: string;
  /** Accessible name of the close button, e.g. "Close send form". Defaults to "Close". */
  closeLabel?: string;
  /** Class for the panel, in both presentations. Style `data-presentation="dialog"` or `"sheet"` to target one. */
  className?: string;
  onKeyDown?: KeyboardEventHandler<HTMLDivElement>;
  "data-phase"?: string;
  "data-error"?: string;
  children: ReactNode;
};

const presentations = { auto: "auto", dialog: "dialog", drawer: "sheet" } as const;

/**
 * A dialog that becomes a bottom sheet on small touch screens, where a
 * centered panel is out of thumb reach. Same title, description and content
 * either way; a sheet can be swiped down to close.
 */
export function ResponsiveDialog({
  open,
  onOpenChange,
  title,
  description,
  mode = "auto",
  drawerQuery,
  closeLabel,
  className,
  onKeyDown,
  "data-phase": phase,
  "data-error": error,
  children,
}: ResponsiveDialogProps) {
  const matches = useMediaQuery(drawerQuery ?? "not all");
  const presentation =
    mode === "auto" && drawerQuery ? (matches ? "sheet" : "dialog") : presentations[mode];

  return (
    <Dialog open={open} onOpenChange={onOpenChange} presentation={presentation}>
      <DialogContent
        className={className}
        closeLabel={closeLabel}
        data-phase={phase}
        data-error={error}
        onKeyDown={onKeyDown}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="sr-only">{description}</DialogDescription>
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}
