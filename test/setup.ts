import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { detachClipboardStubFromView } from "@testing-library/user-event/dist/esm/utils/dataTransfer/Clipboard.js";
import { afterAll, afterEach, beforeAll } from "vitest";
import { installMatchMedia, resetMedia } from "./media";
import { server } from "./msw";

beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterAll(() => server.close());

afterEach(() => {
  cleanup();
  server.resetHandlers();
  resetMedia();
  // userEvent.setup() gives navigator.clipboard an in-memory clipboard, which
  // jsdom lacks. Take it away so each test starts without one.
  detachClipboardStubFromView(window);
  localStorage.clear();
  // ui-sdk's screen reader announcer lives on <body>, outside what cleanup() unmounts.
  document.querySelectorAll("[data-ui-sdk-announcer]").forEach((el) => el.remove());
});

// Base UI (floating-ui) and React use these browser APIs that jsdom does not implement.
// oxlint-disable-next-line landmines/no-test-doubles -- jsdom lacks ResizeObserver
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
Element.prototype.scrollIntoView ??= () => {};
Element.prototype.hasPointerCapture ??= () => false;
Element.prototype.releasePointerCapture ??= () => {};
installMatchMedia();

declare global {
  var __UI_SDK_STRICT__: boolean | undefined;
}
globalThis.__UI_SDK_STRICT__ = true;

// ui-sdk popups use the top layer and these element APIs; jsdom lacks them or
// has them without the parts that matter, so assign rather than `??=`.
HTMLElement.prototype.showPopover = function () {};
HTMLElement.prototype.hidePopover = function () {};
Element.prototype.getAnimations = () => [];
Element.prototype.scrollIntoView = function () {};
Element.prototype.checkVisibility = () => true;
Element.prototype.getClientRects = () => [] as unknown as DOMRectList;
document.elementFromPoint = () => null;
document.elementsFromPoint = () => [];
document.head.append(
  Object.assign(document.createElement("style"), {
    textContent: "[popover] { display: block !important }",
  }),
);
// ui-sdk's sheet tracks its snap points with it.
// oxlint-disable-next-line landmines/no-test-doubles -- jsdom lacks IntersectionObserver
globalThis.IntersectionObserver ??= class {
  root = null;
  rootMargin = "";
  thresholds = [];
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
} as unknown as typeof IntersectionObserver;
