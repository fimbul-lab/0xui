import { afterEach, describe, expect, it, vi } from "vitest";
import { createCopier } from "./copy";

describe("createCopier", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("copies and resets after the timeout without any framework", async () => {
    vi.useFakeTimers();
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const copier = createCopier({ timeout: 1000 });
    const seen: boolean[] = [];
    const stop = copier.subscribe(() => seen.push(copier.get().copied));

    expect(await copier.copy("0xabc")).toBe(true);
    expect(writeText).toHaveBeenCalledWith("0xabc");
    expect(copier.get().copied).toBe(true);
    vi.advanceTimersByTime(1000);
    expect(seen).toEqual([true, false]);
    stop();
  });

  it("returns false when the clipboard is denied", async () => {
    vi.stubGlobal("navigator", {
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
    });
    const copier = createCopier();
    expect(await copier.copy("0xabc")).toBe(false);
    expect(copier.get().copied).toBe(false);
  });

  it("stops its timer when the last listener leaves", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
    const copier = createCopier({ timeout: 1000 });
    const stop = copier.subscribe(() => {});
    await copier.copy("0xabc");
    stop();
    expect(copier.get().copied).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });
});
