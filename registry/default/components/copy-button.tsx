// Docs: https://0xui.io/components/copy-button.md
import { CheckIcon, CopyIcon } from "lucide-react";
import type { ComponentProps, ComponentType } from "react";
import { Button } from "@/components/ui/button";
import { useCopy } from "@/hooks/use-copy";
import { cn } from "@/lib/utils";

type IconComponent = ComponentType<{ className?: string }>;

export type CopyButtonProps = Omit<
  ComponentProps<typeof Button>,
  "value" | "onClick" | "children"
> & {
  /** Text written to the clipboard. */
  value: string;
  /** Accessible label. Defaults to "Copy". Use something specific, e.g. "Copy address". */
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

/**
 * Icon button that copies `value` and confirms with a checkmark.
 * The confirmation is also announced to screen readers.
 */
export function CopyButton({
  value,
  label = "Copy",
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
      className={cn(
        // Grow the hit area past the small visual size.
        "relative after:absolute after:-inset-2",
        className
      )}
      {...props}
    >
      {Icon && <Icon className={cn(copied && "text-emerald-500")} />}
      <span role="status" className="sr-only">
        {copied ? "Copied" : ""}
      </span>
    </Button>
  );
}
