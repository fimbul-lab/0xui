import {
  Slider as SliderPrimitive,
  SliderControl as SliderControlPrimitive,
  SliderIndicator as SliderIndicatorPrimitive,
  SliderThumb as SliderThumbPrimitive,
  SliderTrack as SliderTrackPrimitive,
  SliderValue as SliderValuePrimitive,
} from "@ui-sdk/react/slider";
import type { ComponentProps } from "react";
import { withClassName } from "@/lib/class-name";

function Slider({ className, ...props }: ComponentProps<typeof SliderPrimitive>) {
  return (
    <SliderPrimitive
      className={withClassName("flex w-full flex-col gap-3 data-disabled:opacity-50", className)}
      {...props}
    />
  );
}

function SliderValue({ className, ...props }: ComponentProps<typeof SliderValuePrimitive>) {
  return <SliderValuePrimitive className={withClassName("tabular-nums", className)} {...props} />;
}

function SliderControl({ className, ...props }: ComponentProps<typeof SliderControlPrimitive>) {
  return (
    <SliderControlPrimitive
      className={withClassName("flex w-full touch-none items-center py-2 select-none", className)}
      {...props}
    />
  );
}

function SliderTrack({ className, ...props }: ComponentProps<typeof SliderTrackPrimitive>) {
  return (
    <SliderTrackPrimitive
      className={withClassName(
        "relative h-1.5 w-full rounded-full bg-muted select-none",
        className,
      )}
      {...props}
    />
  );
}

function SliderIndicator({ className, ...props }: ComponentProps<typeof SliderIndicatorPrimitive>) {
  return (
    <SliderIndicatorPrimitive
      className={withClassName("h-full rounded-full bg-foreground select-none", className)}
      {...props}
    />
  );
}

function SliderThumb({ className, ...props }: ComponentProps<typeof SliderThumbPrimitive>) {
  return (
    <SliderThumbPrimitive
      className={withClassName(
        "size-5 rounded-full border-2 border-background bg-foreground shadow select-none has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50 data-disabled:pointer-events-none",
        className,
      )}
      {...props}
    />
  );
}

export { Slider, SliderControl, SliderIndicator, SliderThumb, SliderTrack, SliderValue };
