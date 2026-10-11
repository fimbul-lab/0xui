import { act, renderHook } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useCopy } from "./use-copy";
import { useMounted } from "./use-mounted";

describe("useMounted", () => {
  it("is false on the server", () => {
    function Probe() {
      return <>{String(useMounted())}</>;
    }
    expect(renderToString(<Probe />)).toBe("false");
  });

  it("is true in the browser", () => {
    expect(renderHook(() => useMounted()).result.current).toBe(true);
  });
});

describe("useCopy", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("copies and resets after the timeout", async () => {
    vi.useFakeTimers();
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const { result } = renderHook(() => useCopy({ timeout: 1000 }));

    await act(async () => {
      expect(await result.current.copy("0xabc")).toBe(true);
    });
    expect(writeText).toHaveBeenCalledWith("0xabc");
    expect(result.current.copied).toBe(true);

    act(() => vi.advanceTimersByTime(1000));
    expect(result.current.copied).toBe(false);
  });

  it("returns false when the clipboard is denied", async () => {
    vi.stubGlobal("navigator", {
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
    });
    const { result } = renderHook(() => useCopy());

    await act(async () => {
      expect(await result.current.copy("0xabc")).toBe(false);
    });
    expect(result.current.copied).toBe(false);
  });
});
