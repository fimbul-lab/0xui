// Docs: https://0xui.io/components/copy-button.md
import { CheckIcon, CopyIcon } from "lucide-react";
import type { ComponentProps, ComponentType } from "react";
import { Button } from "@/components/primitives/button";
import { withClassName } from "@/lib/class-name";
import { useCopy } from "@/hooks/use-copy";
import { cn } from "@/lib/utils";

type IconComponent = ComponentType<{ className?: string }>;

export type CopyButtonProps = Omit<
  ComponentProps<typeof Button>,
  "value" | "onClick" | "children"
> & {
  /** Text written to the clipboard. */
  value: string;
  /**
   * Accessible label, naming what it copies, e.g. "Copy recovery code".
   * Defaults to "Copy address" for an address, "Copy hash" for a 32-byte
   * hash, otherwise "Copy". Keep it unique on the page: screen readers and
   * browser agents find the button by it.
   */
  label?: string;
  /** How long the copied state lasts, in ms. */
  timeout?: number;
  /** Called after a successful copy. */
  onCopy?: (value: string) => void;
  /** Custom copy icon. Pass false to hide. */
  copyIcon?: IconComponent | false;
  /** Custom icon shown after copying. Pass false to hide. */
  copiedIcon?: IconComponent | false;
};

/** The default label: what `value` looks like it is. */
export function copyLabel(value: string) {
  if (/^0x[0-9a-fA-F]{40}$/.test(value)) return "Copy address";
  if (/^0x[0-9a-fA-F]{64}$/.test(value)) return "Copy hash";
  return "Copy";
}

/**
 * Icon button that copies `value` and confirms with a checkmark.
 * The confirmation is also announced to screen readers.
 */
export function CopyButton({
  value,
  label: labelProp,
  timeout,
  onCopy,
  copyIcon,
  copiedIcon,
  variant = "ghost",
  size = "icon-xs",
  className,
  ...props
}: CopyButtonProps) {
  const { copied, copy } = useCopy({ timeout });
  const label = labelProp ?? copyLabel(value);
  const Copy = copyIcon === false ? null : (copyIcon ?? CopyIcon);
  const Copied = copiedIcon === false ? null : (copiedIcon ?? CheckIcon);
  const Icon = copied ? Copied : Copy;

  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      aria-label={label}
      title={label}
      data-copied={copied || undefined}
      onClick={async () => {
        if (await copy(value)) onCopy?.(value);
      }}
      // Grow the hit area past the small visual size.
      className={withClassName("relative after:absolute after:-inset-2", className)}
      {...props}
    >
      {Icon && <Icon className={cn(copied && "text-emerald-500")} />}
      <span role="status" className="sr-only">
        {copied ? "Copied" : ""}
      </span>
    </Button>
  );
}
