import {
  Dialog,
  DialogBackdrop as DialogBackdropPrimitive,
  DialogClose,
  DialogContent as DialogContentPrimitive,
  DialogDescription as DialogDescriptionPrimitive,
  DialogTitle as DialogTitlePrimitive,
  DialogTrigger,
  createDialogController,
} from "@ui-sdk/react/dialog";
import { XIcon } from "lucide-react";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";
import { Button } from "./button";
import { withClassName } from "@/lib/class-name";

function DialogBackdrop({ className, ...props }: ComponentProps<typeof DialogBackdropPrimitive>) {
  return (
    <DialogBackdropPrimitive
      className={withClassName(
        "fixed inset-0 isolate bg-black/10 transition-opacity duration-100 supports-backdrop-filter:backdrop-blur-xs data-starting-style:opacity-0 data-ending-style:opacity-0 motion-reduce:transition-none",
        className,
      )}
      {...props}
    />
  );
}

// A sheet positions and moves itself, so the centering only applies to the dialog presentation.
const contentClassName =
  "grid gap-4 bg-popover p-4 text-sm text-popover-foreground ring-1 ring-foreground/10 outline-none " +
  "data-[presentation=dialog]:fixed data-[presentation=dialog]:top-1/2 data-[presentation=dialog]:left-1/2 data-[presentation=dialog]:w-full data-[presentation=dialog]:max-w-[calc(100%-2rem)] data-[presentation=dialog]:-translate-1/2 data-[presentation=dialog]:rounded-xl sm:data-[presentation=dialog]:max-w-sm " +
  "data-[presentation=dialog]:transition-[opacity,scale] data-[presentation=dialog]:duration-100 data-[presentation=dialog]:data-starting-style:scale-95 data-[presentation=dialog]:data-starting-style:opacity-0 data-[presentation=dialog]:data-ending-style:scale-95 data-[presentation=dialog]:data-ending-style:opacity-0 motion-reduce:transition-none " +
  "data-[presentation=sheet]:mx-auto data-[presentation=sheet]:max-h-[85dvh] data-[presentation=sheet]:w-full data-[presentation=sheet]:overflow-y-auto data-[presentation=sheet]:rounded-t-xl data-[presentation=sheet]:pb-[max(1rem,env(safe-area-inset-bottom))]";

function DialogContent({
  className,
  children,
  showCloseButton = true,
  closeLabel = "Close",
  backdrop = true,
  ...props
}: ComponentProps<typeof DialogContentPrimitive> & {
  /** Show an icon button that closes the dialog. */
  showCloseButton?: boolean;
  /**
   * Accessible name of the close button. Name it after the dialog, e.g.
   * "Close wallet picker", so it stays unique for screen readers and agents
   * when other buttons on the page say "Close".
   */
  closeLabel?: string;
  /** Dim the page behind the dialog. */
  backdrop?: boolean;
}) {
  return (
    <>
      {backdrop && <DialogBackdrop />}
      <DialogContentPrimitive className={withClassName(contentClassName, className)} {...props}>
        {(state) => (
          <>
            {typeof children === "function" ? children(state) : children}
            {showCloseButton && (
              <DialogClose
                aria-label={closeLabel}
                render={<Button variant="ghost" size="icon-sm" className="absolute top-2 right-2" />}
              >
                <XIcon aria-hidden />
              </DialogClose>
            )}
          </>
        )}
      </DialogContentPrimitive>
    </>
  );
}

function DialogHeader({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("flex flex-col gap-2", className)} {...props} />;
}

function DialogFooter({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "-mx-4 -mb-4 flex flex-col-reverse gap-2 rounded-b-xl border-t bg-muted/50 p-4 sm:flex-row sm:justify-end",
        className,
      )}
      {...props}
    />
  );
}

function DialogTitle({ className, ...props }: ComponentProps<typeof DialogTitlePrimitive>) {
  return (
    <DialogTitlePrimitive
      className={withClassName("text-base leading-none font-medium", className)}
      {...props}
    />
  );
}

function DialogDescription({ className, ...props }: ComponentProps<typeof DialogDescriptionPrimitive>) {
  return (
    <DialogDescriptionPrimitive
      className={withClassName(
        "text-sm text-muted-foreground *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground",
        className,
      )}
      {...props}
    />
  );
}

export {
  Dialog,
  DialogBackdrop,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  createDialogController,
};
