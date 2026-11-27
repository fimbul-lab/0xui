import {
  Popover,
  PopoverClose,
  PopoverContent as PopoverContentPrimitive,
  PopoverDescription as PopoverDescriptionPrimitive,
  PopoverTitle as PopoverTitlePrimitive,
  PopoverTrigger,
  createPopoverController,
} from "@ui-sdk/react/popover";
import type { ComponentProps } from "react";
import { withClassName } from "@/lib/class-name";

function PopoverContent({
  className,
  sideOffset = 4,
  ...props
}: ComponentProps<typeof PopoverContentPrimitive>) {
  return (
    <PopoverContentPrimitive
      sideOffset={sideOffset}
      className={withClassName(
        "flex w-72 origin-(--transform-origin) flex-col gap-2.5 rounded-lg bg-popover p-2.5 text-sm text-popover-foreground shadow-md ring-1 ring-foreground/10 outline-hidden transition-[opacity,scale] duration-100 data-starting-style:scale-95 data-starting-style:opacity-0 data-ending-style:scale-95 data-ending-style:opacity-0 motion-reduce:transition-none data-[presentation=sheet]:w-full data-[presentation=sheet]:rounded-b-none data-[presentation=sheet]:p-4 data-[presentation=sheet]:pb-[max(1rem,env(safe-area-inset-bottom))]",
        className,
      )}
      {...props}
    />
  );
}

function PopoverTitle({ className, ...props }: ComponentProps<typeof PopoverTitlePrimitive>) {
  return (
    <PopoverTitlePrimitive className={withClassName("text-sm font-medium", className)} {...props} />
  );
}

function PopoverDescription({
  className,
  ...props
}: ComponentProps<typeof PopoverDescriptionPrimitive>) {
  return (
    <PopoverDescriptionPrimitive
      className={withClassName("text-muted-foreground", className)}
      {...props}
    />
  );
}

export {
  Popover,
  PopoverClose,
  PopoverContent,
  PopoverDescription,
  PopoverTitle,
  PopoverTrigger,
  createPopoverController,
};
