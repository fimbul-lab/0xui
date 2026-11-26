import { describe, expect, test, vi } from "vitest";
import { docsTools, registerDocsTools } from "./webmcp";
import type { DocsToolsOptions } from "./webmcp";

const llms = `# 0xui

## Components: Tokens

- [Balance](https://0xui.io/components/balance.md): Native or ERC-20 balance.
- [Token Input](https://0xui.io/components/token-input.md): Swap panel with amount and token picker.

## Blocks

- [Swap](https://0xui.io/blocks/swap.md): Swap form with quotes and an approval step.
`;

const files: Record<string, string> = {
  "/llms.txt": llms,
  "/components/balance.md": "# Balance",
  "/blocks/swap.md": "# Swap",
  "/r/balance.json": JSON.stringify({ name: "balance", dependencies: ["wagmi"] }),
};

const fetch = vi.fn(async (url: string) =>
  url in files ? new Response(files[url]) : new Response("Not found", { status: 404 }),
);

function tool(name: string, pagefind?: DocsToolsOptions["pagefind"]) {
  const found = docsTools({ fetch, pagefind: pagefind ?? (async () => undefined) }).find(
    (candidate) => candidate.name === name,
  );
  if (!found) {
    throw new Error(`No tool ${name}`);
  }
  return found;
}

describe("get_doc", () => {
  test.each([
    "balance",
    "components/balance",
    "https://0xui.io/components/balance/",
    "/components/balance.md",
    "Balance",
  ])("finds the page from %s", async (page) => {
    expect(await tool("get_doc").execute({ page })).toBe("# Balance");
  });

  test("lists the pages when nothing matches", async () => {
    await expect(tool("get_doc").execute({ page: "nope" })).rejects.toThrow(
      'No page called "nope". Pages: components/balance, components/token-input, blocks/swap.',
    );
  });
});

describe("search_docs", () => {
  test("uses Pagefind when it's there", async () => {
    const pagefind = async () => ({
      search: async () => ({
        results: [
          {
            data: async () => ({
              url: "/blocks/swap/",
              excerpt: "an <mark>approval</mark> step &amp; quotes",
              meta: { title: "Swap" },
            }),
          },
        ],
      }),
    });
    expect(await tool("search_docs", pagefind).execute({ query: "approval" })).toEqual([
      { page: "blocks/swap", title: "Swap", excerpt: "an approval step & quotes" },
    ]);
  });

  test("falls back to titles and descriptions", async () => {
    expect(await tool("search_docs").execute({ query: "token picker" })).toEqual([
      {
        page: "components/token-input",
        title: "Token Input",
        excerpt: "Swap panel with amount and token picker.",
      },
    ]);
  });
});

test("get_registry_item adds the install command", async () => {
  expect(await tool("get_registry_item").execute({ name: "@0xui/balance" })).toEqual({
    install: "npx shadcn@latest add @0xui/balance",
    name: "balance",
    dependencies: ["wagmi"],
  });
  await expect(tool("get_registry_item").execute({ name: "../secrets" })).rejects.toThrow();
});

test("every tool is read-only with a valid name", () => {
  for (const candidate of docsTools({ fetch })) {
    expect(candidate.name).toMatch(/^[A-Za-z0-9_.-]{1,128}$/);
    expect(candidate.annotations.readOnlyHint).toBe(true);
  }
});

test("registers with document.modelContext and unregisters on abort", async () => {
  const signals: Array<AbortSignal> = [];
  const allRegistered = Promise.withResolvers<void>();
  const registerTool = vi.fn(async (_tool: unknown, options: { signal: AbortSignal }) => {
    signals.push(options.signal);
    if (signals.length === 4) {
      allRegistered.resolve();
    }
  });
  Object.defineProperty(document, "modelContext", { value: { registerTool }, configurable: true });

  const unregister = registerDocsTools({ fetch });
  await allRegistered.promise;
  expect(registerTool).toHaveBeenCalledTimes(4);
  unregister();
  expect(signals.every((signal) => signal.aborted)).toBe(true);

  delete (document as { modelContext?: unknown }).modelContext;
});

test("does nothing without WebMCP", () => {
  expect(() => registerDocsTools({ fetch })()).not.toThrow();
});
