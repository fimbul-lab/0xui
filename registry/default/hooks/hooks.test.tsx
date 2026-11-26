import { act, renderHook } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
  });

  it("copies and resets after the timeout", async () => {
    vi.useFakeTimers();
    // Gives jsdom an in-memory clipboard.
    userEvent.setup();
    const { result } = renderHook(() => useCopy({ timeout: 1000 }));

    await act(async () => {
      expect(await result.current.copy("0xabc")).toBe(true);
    });
    expect(result.current.copied).toBe(true);

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(result.current.copied).toBe(false);

    // jsdom's FileReader, which reading the clipboard uses, needs real timers.
    vi.useRealTimers();
    expect(await navigator.clipboard.readText()).toBe("0xabc");
  });

  it("returns false without a clipboard", async () => {
    expect(navigator.clipboard).toBeUndefined();
    const { result } = renderHook(() => useCopy());

    await act(async () => {
      expect(await result.current.copy("0xabc")).toBe(false);
    });
    expect(result.current.copied).toBe(false);
  });
});
