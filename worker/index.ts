// Serves the static docs. Runs before the assets only for page routes (see
// wrangler.jsonc), to answer `Accept: text/markdown` with the page's
// Markdown and to advertise the agent entry points on every page.

import { agentLinks, markdownFor, prefersMarkdown } from "./negotiate";

interface Assets {
  fetch(input: Request | URL | string): Promise<Response>;
}

interface Env {
  ASSETS: Assets;
}

function withHeaders(response: Response, headers: Record<string, string>) {
  const next = new Response(response.body, response);
  for (const [name, value] of Object.entries(headers)) next.headers.set(name, value);
  return next;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const readable = request.method === "GET" || request.method === "HEAD";

    if (readable && prefersMarkdown(request.headers.get("Accept"))) {
      const markdown = await env.ASSETS.fetch(new URL(markdownFor(url.pathname), url));
      // A missing file comes back as the 404 page, so check the type too.
      if (
        markdown.ok &&
        /^text\/(markdown|plain)/.test(markdown.headers.get("Content-Type") ?? "")
      ) {
        return withHeaders(markdown, {
          "Content-Type": "text/markdown; charset=utf-8",
          Vary: "Accept",
          Link: agentLinks,
        });
      }
    }

    const response = await env.ASSETS.fetch(request);
    if (!response.headers.get("Content-Type")?.startsWith("text/html")) return response;
    return withHeaders(response, { Vary: "Accept", Link: agentLinks });
  },
};
