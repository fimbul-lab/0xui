import { onTestFinished } from "vitest";

export type RegisteredTool = {
  name: string;
  execute: (input: object) => Promise<unknown>;
};

/**
 * WebMCP (`document.modelContext`), which jsdom lacks, for the rest of the
 * test. Like a browser, it keeps each registered tool until its signal aborts.
 */
export function provideModelContext() {
  const tools = new Map<string, RegisteredTool>();
  const signals: Array<AbortSignal> = [];
  const waiting: Array<{ count: number; resolve: () => void }> = [];
  const modelContext = {
    async registerTool(tool: RegisteredTool, { signal }: { signal: AbortSignal }) {
      tools.set(tool.name, tool);
      signals.push(signal);
      signal.addEventListener("abort", () => tools.delete(tool.name));
      for (const waiter of waiting) {
        if (signals.length >= waiter.count) {
          waiter.resolve();
        }
      }
    },
  };
  // oxlint-disable-next-line landmines/no-test-doubles -- jsdom lacks WebMCP (document.modelContext)
  Object.defineProperty(document, "modelContext", { value: modelContext, configurable: true });
  onTestFinished(() => {
    // oxlint-disable-next-line landmines/no-test-doubles -- removes the WebMCP added above
    delete (document as { modelContext?: unknown }).modelContext;
  });

  return {
    /** Tools registered and not yet unregistered, by name. */
    tools,
    /** The signal of every registration so far. */
    signals,
    /** Resolves once `count` tools have registered. */
    registered(count: number) {
      const { promise, resolve } = Promise.withResolvers<void>();
      waiting.push({ count, resolve });
      if (signals.length >= count) {
        resolve();
      }
      return promise;
    },
  };
}
