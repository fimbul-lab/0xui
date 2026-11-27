import {
  SegmentedControl as SegmentedControlPrimitive,
  SegmentedControlIndicator as SegmentedControlIndicatorPrimitive,
  SegmentedControlItem as SegmentedControlItemPrimitive,
} from "@ui-sdk/react/segmented-control";
import type { ComponentProps, ReactNode } from "react";
import { withClassName } from "@/lib/class-name";

/** One choice from a few, with an indicator that slides to it. Renders its own indicator. */
function SegmentedControl({
  className,
  children,
  ...props
}: Omit<ComponentProps<typeof SegmentedControlPrimitive>, "children"> & { children?: ReactNode }) {
  return (
    <SegmentedControlPrimitive
      className={withClassName(
        "relative isolate inline-flex w-fit items-center rounded-lg bg-muted p-0.5 text-xs font-medium text-muted-foreground data-disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <SegmentedControlIndicatorPrimitive className="absolute top-(--segmented-control-indicator-top) left-(--segmented-control-indicator-left) -z-10 h-(--segmented-control-indicator-height) w-(--segmented-control-indicator-width) rounded-md bg-background shadow-sm transition-[top,left,width,height] duration-200 data-[activation-direction=none]:transition-none motion-reduce:transition-none dark:bg-input/40" />
      {children}
    </SegmentedControlPrimitive>
  );
}

function SegmentedControlItem({
  className,
  ...props
}: ComponentProps<typeof SegmentedControlItemPrimitive>) {
  return (
    <SegmentedControlItemPrimitive
      className={withClassName(
        "inline-flex min-h-7 cursor-pointer items-center justify-center rounded-md px-2.5 whitespace-nowrap tabular-nums outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 data-checked:text-foreground data-disabled:pointer-events-none",
        className,
      )}
      {...props}
    />
  );
}

export { SegmentedControl, SegmentedControlItem };
