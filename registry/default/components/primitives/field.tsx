import {
  Field as FieldPrimitive,
  FieldDescription as FieldDescriptionPrimitive,
  FieldError as FieldErrorPrimitive,
  FieldGroup as FieldGroupPrimitive,
  FieldLabel as FieldLabelPrimitive,
  FieldLegend as FieldLegendPrimitive,
  FieldSet as FieldSetPrimitive,
  useFieldControl,
} from "@ui-sdk/react/field";
import type { ComponentProps } from "react";
import { withClassName } from "@/lib/class-name";

function Field({ className, ...props }: ComponentProps<typeof FieldPrimitive>) {
  return (
    <FieldPrimitive
      className={withClassName("group/field flex w-full flex-col gap-2", className)}
      {...props}
    />
  );
}

function FieldLabel({ className, ...props }: ComponentProps<typeof FieldLabelPrimitive>) {
  return (
    <FieldLabelPrimitive
      className={withClassName(
        "flex w-fit items-center gap-2 text-sm leading-snug font-medium select-none data-disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

function FieldDescription({ className, ...props }: ComponentProps<typeof FieldDescriptionPrimitive>) {
  return (
    <FieldDescriptionPrimitive
      className={withClassName("text-sm leading-normal font-normal text-muted-foreground", className)}
      {...props}
    />
  );
}

function FieldError({ className, ...props }: ComponentProps<typeof FieldErrorPrimitive>) {
  return (
    <FieldErrorPrimitive
      className={withClassName("text-sm font-normal text-destructive", className)}
      {...props}
    />
  );
}

function FieldSet({ className, ...props }: ComponentProps<typeof FieldSetPrimitive>) {
  return (
    <FieldSetPrimitive
      className={withClassName("flex flex-col gap-4 data-disabled:opacity-50", className)}
      {...props}
    />
  );
}

function FieldLegend({ className, ...props }: ComponentProps<typeof FieldLegendPrimitive>) {
  return (
    <FieldLegendPrimitive
      className={withClassName("mb-1 text-base font-medium", className)}
      {...props}
    />
  );
}

function FieldGroup({ className, ...props }: ComponentProps<typeof FieldGroupPrimitive>) {
  return (
    <FieldGroupPrimitive
      className={withClassName("flex w-full flex-col gap-5", className)}
      {...props}
    />
  );
}

export {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
  useFieldControl,
};
