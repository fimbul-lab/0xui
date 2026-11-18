import { EyeIcon, EyeOffIcon } from "lucide-react";
import type { ComponentProps, ComponentType, ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Who can see a value or an action on-chain. */
export type Privacy = "public" | "private";

type IconComponent = ComponentType<{ className?: string }>;

/** Default label, explanation and icon for each side. */
export const privacyMeta: Record<
  Privacy,
  { label: string; description: string; icon: IconComponent }
> = {
  private: {
    label: "Private",
    description: "Not visible on-chain.",
    icon: EyeOffIcon,
  },
  public: {
    label: "Public",
    description: "Visible on-chain to anyone.",
    icon: EyeIcon,
  },
};

export type PrivacyBadgeProps = Omit<ComponentProps<"span">, "children"> & {
  /** Whether the thing it marks is visible on-chain. */
  privacy: Privacy;
  /** "badge" for a chip, "inline" for running text. */
  variant?: "badge" | "inline";
  /** Label. Defaults to "Private" or "Public". */
  children?: ReactNode;
  /** Hide the label visually. It stays available to screen readers. */
  iconOnly?: boolean;
  /** Custom icon. Pass false to hide. */
  icon?: IconComponent | false;
};

/**
 * Marks a value or an action as public or private. Private is filled and
 * public is outlined, so the two differ by more than color. The tooltip
 * says what that means.
 */
export function PrivacyBadge({
  privacy,
  variant = "badge",
  children,
  iconOnly = false,
  icon,
  title,
  className,
  ...props
}: PrivacyBadgeProps) {
  const meta = privacyMeta[privacy];
  const Icon = icon === false ? null : (icon ?? meta.icon);

  return (
    <span
      data-slot="privacy-badge"
      data-privacy={privacy}
      title={title ?? meta.description}
      className={cn(
        "inline-flex items-center gap-1 align-middle text-xs font-medium whitespace-nowrap",
        variant === "badge" && "rounded-full border px-2 py-0.5",
        variant === "badge" && iconOnly && "p-1",
        variant === "badge" && privacy === "private" && "border-transparent bg-primary text-primary-foreground",
        variant === "badge" && privacy === "public" && "text-muted-foreground",
        variant === "inline" && privacy === "public" && "text-muted-foreground",
        className
      )}
      {...props}
    >
      {Icon && <Icon aria-hidden className="size-3 shrink-0" />}
      <span className={cn(iconOnly && "sr-only")}>{children ?? meta.label}</span>
    </span>
  );
}
