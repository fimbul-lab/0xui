import { cn } from "@/lib/utils";

type StateClassName<S> = string | ((state: S) => string | undefined) | undefined;

/** Puts a part's base classes under the caller's, which may be a function of the part's state. */
export function withClassName<S>(base: string, className: StateClassName<S>) {
  return (state: S) => cn(base, typeof className === "function" ? className(state) : className);
}
