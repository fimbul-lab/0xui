import { useCallback, useSyncExternalStore, type KeyboardEventHandler, type ReactNode } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";

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
    [query]
  );
  return useSyncExternalStore(
    subscribe,
    () => typeof window.matchMedia === "function" && window.matchMedia(query).matches,
    () => false
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
   * `auto` is a bottom drawer on small screens and a centered dialog on
   * larger ones. `dialog` and `drawer` force one.
   */
  mode?: ResponsiveDialogMode;
  /** Media query that picks the drawer in `auto` mode. */
  drawerQuery?: string;
  /** Class for the dialog panel. The drawer sizes itself. */
  className?: string;
  onKeyDown?: KeyboardEventHandler<HTMLDivElement>;
  "data-phase"?: string;
  children: ReactNode;
};

/**
 * A dialog that becomes a bottom drawer on small screens, where a centered
 * panel is out of thumb reach. Same title, description and content either
 * way. Switching between the two keeps `open`, but remounts the content.
 */
export function ResponsiveDialog({
  open,
  onOpenChange,
  title,
  description,
  mode = "auto",
  drawerQuery = "(max-width: 639px)",
  className,
  onKeyDown,
  "data-phase": phase,
  children,
}: ResponsiveDialogProps) {
  const small = useMediaQuery(drawerQuery);
  const drawer = mode === "drawer" || (mode === "auto" && small);

  if (drawer) {
    return (
      <Drawer open={open} onOpenChange={onOpenChange} showSwipeHandle>
        <DrawerContent data-phase={phase} onKeyDown={onKeyDown}>
          <DrawerHeader>
            <DrawerTitle>{title}</DrawerTitle>
            <DrawerDescription className="sr-only">{description}</DrawerDescription>
          </DrawerHeader>
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
            {children}
          </div>
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={className} data-phase={phase} onKeyDown={onKeyDown}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="sr-only">{description}</DialogDescription>
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}
