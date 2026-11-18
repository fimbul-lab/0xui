import type { ReactNode } from "react";
import { TextMorph, type TextMorphProps } from "torph/react";

export type MorphTextProps = Omit<TextMorphProps, "children" | "as"> & {
  /**
   * Text to show. Strings and numbers, alone or mixed like `Approve {symbol}`,
   * animate from the old value to the new one. Children that hold an element
   * render as-is.
   */
  children?: ReactNode;
};

// torph animates with the Web Animations API and throws without it. jsdom
// doesn't implement it, so tests render plain text instead.
const noWebAnimations =
  typeof Element !== "undefined" && typeof Element.prototype.getAnimations !== "function";

/** The text of plain children, or undefined when they hold an element. */
function textOf(node: ReactNode): string | undefined {
  if (typeof node === "string") return node;
  if (typeof node === "number" || typeof node === "bigint") return String(node);
  if (node == null || typeof node === "boolean") return "";
  if (!Array.isArray(node)) return undefined;
  let text = "";
  for (const child of node) {
    const part = textOf(child);
    if (part === undefined) return undefined;
    text += part;
  }
  return text;
}

/**
 * Text that morphs when it changes: shared characters slide to their new
 * place, and digits roll by place value. Screen readers get the plain text.
 * Honors `prefers-reduced-motion`. Pass `disabled` to turn the animation off.
 */
export function MorphText({ children, className, style, ...options }: MorphTextProps) {
  // A lone number stays a number, so torph formats it with `locale` and `decimals`.
  const text = typeof children === "number" ? children : textOf(children);
  if (text === undefined) return <>{children}</>;

  if (noWebAnimations) {
    return (
      <span className={className} style={style}>
        {text}
      </span>
    );
  }

  return (
    <TextMorph className={className} style={style} {...options}>
      {text}
    </TextMorph>
  );
}
