import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createCopier } from "./copy";

describe("createCopier", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("copies and resets after the timeout without any framework", async () => {
    vi.useFakeTimers();
    // Gives jsdom an in-memory clipboard.
    userEvent.setup();
    const copier = createCopier({ timeout: 1000 });
    const seen: Array<boolean> = [];
    const stop = copier.subscribe(() => seen.push(copier.get().copied));

    expect(await copier.copy("0xabc")).toBe(true);
    expect(copier.get().copied).toBe(true);
    vi.advanceTimersByTime(1000);
    expect(seen).toEqual([true, false]);
    stop();

    // jsdom's FileReader, which reading the clipboard uses, needs real timers.
    vi.useRealTimers();
    expect(await navigator.clipboard.readText()).toBe("0xabc");
  });

  it("returns false without a clipboard", async () => {
    expect(navigator.clipboard).toBeUndefined();
    const copier = createCopier();
    expect(await copier.copy("0xabc")).toBe(false);
    expect(copier.get().copied).toBe(false);
  });

  it("stops its timer when the last listener leaves", async () => {
    vi.useFakeTimers();
    userEvent.setup();
    const copier = createCopier({ timeout: 1000 });
    const stop = copier.subscribe(() => {});
    await copier.copy("0xabc");
    stop();
    expect(copier.get().copied).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });
});
