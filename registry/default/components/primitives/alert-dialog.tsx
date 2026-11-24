import {
  AlertDialog,
  AlertDialogBackdrop as AlertDialogBackdropPrimitive,
  AlertDialogClose,
  AlertDialogContent as AlertDialogContentPrimitive,
  AlertDialogDescription as AlertDialogDescriptionPrimitive,
  AlertDialogTitle as AlertDialogTitlePrimitive,
  AlertDialogTrigger,
  createAlertDialogController,
  createConfirm,
} from "@ui-sdk/react/alert-dialog";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";
import { withClassName } from "@/lib/class-name";

function AlertDialogBackdrop({
  className,
  ...props
}: ComponentProps<typeof AlertDialogBackdropPrimitive>) {
  return (
    <AlertDialogBackdropPrimitive
      className={withClassName(
        "fixed inset-0 isolate bg-black/10 transition-opacity duration-100 supports-backdrop-filter:backdrop-blur-xs data-starting-style:opacity-0 data-ending-style:opacity-0 motion-reduce:transition-none",
        className,
      )}
      {...props}
    />
  );
}

// Matches primitives/dialog in its dialog presentation: an alert dialog never becomes a sheet.
const contentClassName =
  "fixed top-1/2 left-1/2 grid w-full max-w-[calc(100%-2rem)] -translate-1/2 gap-4 rounded-xl bg-popover p-4 text-sm text-popover-foreground ring-1 ring-foreground/10 outline-none sm:max-w-sm " +
  "transition-[opacity,scale] duration-100 data-starting-style:scale-95 data-starting-style:opacity-0 data-ending-style:scale-95 data-ending-style:opacity-0 motion-reduce:transition-none";

function AlertDialogContent({
  className,
  backdrop = true,
  ...props
}: ComponentProps<typeof AlertDialogContentPrimitive> & {
  /** Dim the page behind the dialog. */
  backdrop?: boolean;
}) {
  return (
    <>
      {backdrop && <AlertDialogBackdrop />}
      <AlertDialogContentPrimitive
        className={withClassName(contentClassName, className)}
        {...props}
      />
    </>
  );
}

function AlertDialogHeader({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("flex flex-col gap-2", className)} {...props} />;
}

function AlertDialogFooter({ className, ...props }: ComponentProps<"div">) {
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

function AlertDialogTitle({
  className,
  ...props
}: ComponentProps<typeof AlertDialogTitlePrimitive>) {
  return (
    <AlertDialogTitlePrimitive
      className={withClassName("text-base leading-none font-medium", className)}
      {...props}
    />
  );
}

function AlertDialogDescription({
  className,
  ...props
}: ComponentProps<typeof AlertDialogDescriptionPrimitive>) {
  return (
    <AlertDialogDescriptionPrimitive
      className={withClassName("text-sm text-muted-foreground", className)}
      {...props}
    />
  );
}

export {
  AlertDialog,
  AlertDialogBackdrop,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
  createAlertDialogController,
  createConfirm,
};
