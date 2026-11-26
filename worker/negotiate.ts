export const agentLinks = [
  '</llms.txt>; rel="describedby"; type="text/plain"',
  '</.well-known/agent-skills/index.json>; rel="agent-skills"; type="application/json"',
  '</sitemap-index.xml>; rel="sitemap"; type="application/xml"',
].join(", ");

function quality(accept: string, type: string) {
  for (const part of accept.toLowerCase().split(",")) {
    const [range, ...params] = part.trim().split(";");
    if (range.trim() !== type) {
      continue;
    }
    const q = params.map((param) => param.trim()).find((param) => param.startsWith("q="));
    return q ? Number(q.slice(2)) || 0 : 1;
  }
  return 0;
}

/** True when the client ranks Markdown above HTML, like an agent sending `Accept: text/markdown`. */
export function prefersMarkdown(accept: string | null) {
  if (!accept) {
    return false;
  }
  const markdown = quality(accept, "text/markdown");
  return markdown > 0 && markdown >= quality(accept, "text/html");
}

/** The Markdown file for a page path: `/components/balance/` → `/components/balance.md`, `/` → `/llms.txt`. */
export function markdownFor(pathname: string) {
  const path = pathname.replace(/\/+$/, "");
  return path ? `${path}.md` : "/llms.txt";
}
