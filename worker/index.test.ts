import { describe, expect, test } from "vitest";
import worker from "./index";
import { agentLinks, markdownFor, prefersMarkdown } from "./negotiate";

const files: Record<string, [string, string]> = {
  "/components/balance/": ["<h1>Balance</h1>", "text/html; charset=utf-8"],
  "/components/balance.md": ["# Balance", "text/markdown"],
  "/llms.txt": ["# 0xui", "text/plain"],
  "/404.html": ["<h1>Not found</h1>", "text/html"],
};

const env = {
  ASSETS: {
    async fetch(input: Request | URL | string) {
      const url = typeof input === "object" && "url" in input ? input.url : input;
      const path = new URL(url).pathname;
      const [body, type] = files[path] ?? files["/404.html"];
      return new Response(body, {
        status: path in files ? 200 : 404,
        headers: { "Content-Type": type },
      });
    },
  },
};

const get = (path: string, accept?: string) =>
  worker.fetch(
    new Request(`https://0xui.io${path}`, { headers: accept ? { Accept: accept } : {} }),
    env,
  );

describe("prefersMarkdown", () => {
  test.each([
    ["text/markdown", true],
    ["text/markdown, text/html;q=0.9", true],
    ["text/html, text/markdown;q=0.5", false],
    ["text/html,application/xhtml+xml,*/*;q=0.8", false],
    [null, false],
  ])("%s → %s", (accept, expected) => {
    expect(prefersMarkdown(accept)).toBe(expected);
  });
});

test("markdownFor maps page paths to their Markdown", () => {
  expect(markdownFor("/components/balance/")).toBe("/components/balance.md");
  expect(markdownFor("/components/balance")).toBe("/components/balance.md");
  expect(markdownFor("/")).toBe("/llms.txt");
});

describe("worker", () => {
  test("answers an agent with the page's Markdown", async () => {
    const response = await get("/components/balance/", "text/markdown");
    expect(await response.text()).toBe("# Balance");
    expect(response.headers.get("Content-Type")).toBe("text/markdown; charset=utf-8");
    expect(response.headers.get("Vary")).toBe("Accept");
  });

  test("redirects www to the bare domain, keeping the path and query", async () => {
    const response = await worker.fetch(
      new Request("http://www.0xui.io/components/balance/?tab=props"),
      env,
    );
    expect(response.status).toBe(301);
    expect(response.headers.get("Location")).toBe("https://0xui.io/components/balance/?tab=props");
  });

  test("answers the home page with llms.txt", async () => {
    expect(await (await get("/", "text/markdown")).text()).toBe("# 0xui");
  });

  test("serves HTML to browsers, with the agent links", async () => {
    const response = await get("/components/balance/", "text/html,*/*;q=0.8");
    expect(await response.text()).toBe("<h1>Balance</h1>");
    expect(response.headers.get("Link")).toBe(agentLinks);
    expect(response.headers.get("Vary")).toBe("Accept");
  });

  test("falls back to the HTML when a page has no Markdown", async () => {
    const response = await get("/nope/", "text/markdown");
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("<h1>Not found</h1>");
  });
});
