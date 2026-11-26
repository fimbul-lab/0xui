// WebMCP tools for the docs site, so a browser's agent reads the docs through
// calls instead of scraping pages. https://webmachinelearning.github.io/webmcp/

type Fetch = (url: string) => Promise<Response>;

interface Tool {
  name: string;
  title: string;
  description: string;
  inputSchema: object;
  annotations: { readOnlyHint: boolean };
  execute: (input: Record<string, unknown>) => Promise<unknown>;
}

interface ModelContext {
  registerTool(tool: Tool, options?: { signal?: AbortSignal }): Promise<void>;
}

interface PagefindResult {
  data(): Promise<{ url: string; excerpt: string; meta: { title?: string } }>;
}

interface Pagefind {
  search(query: string): Promise<{ results: Array<PagefindResult> }>;
}

export interface DocsToolsOptions {
  fetch?: Fetch;
  /** Starlight's full-text index. Missing in `astro dev`, which falls back to titles. */
  pagefind?: () => Promise<Pagefind | undefined>;
}

interface IndexEntry {
  title: string;
  /** Like `components/balance`. */
  id: string;
  description: string;
}

const stripTags = (html: string) =>
  html
    .replaceAll(/<[^>]+>/g, "")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'");

/** The page id in a docs or Markdown URL, like `components/balance`. */
function pageId(url: string) {
  return new URL(url, "https://0xui.io").pathname.replaceAll(/^\/|\/$|\.md$/g, "");
}

export function docsTools({
  fetch: get = (url) => fetch(url),
  pagefind = loadPagefind,
}: DocsToolsOptions = {}): Array<Tool> {
  const read = async (url: string) => {
    const response = await get(url);
    if (!response.ok) throw new Error(`${url} returned ${response.status}.`);
    return response.text();
  };

  let index: Promise<Array<IndexEntry>> | undefined;
  const pages = () =>
    (index ??= read("/llms.txt").then((text) =>
      [...text.matchAll(/^- \[([^\]]+)\]\(([^)]+\.md)\): ?(.*)$/gm)].map(
        ([, title, url, description]) => ({ title, id: pageId(url), description }),
      ),
    ));

  async function resolve(page: string) {
    const wanted = pageId(page.trim()).toLowerCase();
    const all = await pages();
    return (
      all.find((entry) => entry.id === wanted) ??
      all.find((entry) => entry.id.split("/").pop() === wanted) ??
      all.find((entry) => entry.title.toLowerCase() === wanted.replaceAll("-", " "))
    );
  }

  return [
    {
      name: "list_docs",
      title: "List 0xui docs",
      description:
        "Lists every page of the 0xui docs (web3 React components on wagmi, viem and ui-sdk, installed with the shadcn CLI) with a one-line description, grouped like the sidebar, plus setup instructions. Returns Markdown. Call it first when you don't know which component fits.",
      inputSchema: { type: "object", properties: {} },
      annotations: { readOnlyHint: true },
      execute: () => read("/llms.txt"),
    },
    {
      name: "search_docs",
      title: "Search 0xui docs",
      description:
        'Full-text search over the 0xui docs, like "approve before swap" or "ENS avatar". Returns the best matching pages with an excerpt and the page id to pass to get_doc.',
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "What to look for." },
          limit: { type: "number", description: "Most results to return. Defaults to 5." },
        },
        required: ["query"],
      },
      annotations: { readOnlyHint: true },
      async execute(input) {
        const query = String(input.query ?? "").trim();
        const limit = Math.min(Math.max(Number(input.limit) || 5, 1), 20);
        if (!query) throw new Error("Pass a query.");

        const search = await pagefind().catch(() => undefined);
        if (search) {
          const { results } = await search.search(query);
          return Promise.all(
            results.slice(0, limit).map(async (result) => {
              const data = await result.data();
              return {
                page: pageId(data.url),
                title: data.meta.title ?? "",
                excerpt: stripTags(data.excerpt),
              };
            }),
          );
        }

        const words = query.toLowerCase().split(/\s+/);
        return (await pages())
          .map((entry) => {
            const haystack = `${entry.id} ${entry.title} ${entry.description}`.toLowerCase();
            return { entry, score: words.filter((word) => haystack.includes(word)).length };
          })
          .filter(({ score }) => score > 0)
          .sort((a, b) => b.score - a.score)
          .slice(0, limit)
          .map(({ entry }) => ({
            page: entry.id,
            title: entry.title,
            excerpt: entry.description,
          }));
      },
    },
    {
      name: "get_doc",
      title: "Read a 0xui docs page",
      description:
        'Returns one 0xui docs page as Markdown: what it does, the install command, usage, examples, data-phase states and props. Takes a page id from list_docs or search_docs ("components/balance"), a bare name ("balance", "swap", "installation") or a docs URL.',
      inputSchema: {
        type: "object",
        properties: { page: { type: "string", description: "Page id, name or URL." } },
        required: ["page"],
      },
      annotations: { readOnlyHint: true },
      async execute(input) {
        const page = String(input.page ?? "");
        const entry = await resolve(page);
        if (!entry) {
          const ids = (await pages()).map((candidate) => candidate.id).join(", ");
          throw new Error(`No page called "${page}". Pages: ${ids}.`);
        }
        return read(`/${entry.id}.md`);
      },
    },
    {
      name: "get_registry_item",
      title: "Get a 0xui registry item",
      description:
        'Returns what `npx shadcn@latest add @0xui/<name>` installs for one item, like "balance" or "wagmi-config": the npm dependencies, the 0xui items it pulls in, and the full source of every file. Use it to see exactly what a component does or to install it by hand.',
      inputSchema: {
        type: "object",
        properties: { name: { type: "string", description: "Registry item name." } },
        required: ["name"],
      },
      annotations: { readOnlyHint: true },
      async execute(input) {
        const name = String(input.name ?? "")
          .trim()
          .replace(/^@0xui\//, "");
        if (!/^[a-z0-9-]+$/.test(name)) throw new Error(`"${name}" isn't a registry item name.`);
        const item = JSON.parse(await read(`/r/${name}.json`));
        return { install: `npx shadcn@latest add @0xui/${name}`, ...item };
      },
    },
  ];
}

async function loadPagefind() {
  const url = "/pagefind/pagefind.js";
  return (await import(/* @vite-ignore */ url)) as Pagefind;
}

/** Registers the docs tools with the browser. Does nothing without WebMCP. */
export function registerDocsTools(options?: DocsToolsOptions) {
  const scope = globalThis as { document?: { modelContext?: ModelContext } };
  const context =
    scope.document?.modelContext ??
    (globalThis as { navigator?: { modelContext?: ModelContext } }).navigator?.modelContext;
  const controller = new AbortController();
  if (!context) return () => {};

  for (const tool of docsTools(options)) {
    // Early builds of navigator.modelContext returned synchronously. A refused
    // tool leaves the rest registered, with nothing to recover.
    // oxlint-disable-next-line landmines/no-silent-catch
    Promise.resolve()
      .then(() => context.registerTool(tool, { signal: controller.signal }))
      .catch(() => {});
  }
  return () => controller.abort();
}
