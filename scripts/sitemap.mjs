// Options for @astrojs/sitemap: which pages are listed, and when each last
// changed.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { unlistedPages } from "../src/docs-nav.mjs";

const root = new URL("..", import.meta.url);

const git = (/** @type {string[]} */ ...args) =>
  execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "ignore"],
  });

/**
 * Last commit date of every file in the repo. Empty without git, and in a
 * shallow clone (most CI), where every file would get the newest commit's
 * date: no date is better than a wrong one.
 */
function commitDates() {
  /** @type {Map<string, string>} */
  const dates = new Map();
  let log = "";
  try {
    if (git("rev-parse", "--is-shallow-repository").trim() === "true") return dates;
    log = git("log", "--format=@%cI", "--name-only");
  } catch {
    return dates;
  }
  let date = "";
  for (const line of log.split("\n")) {
    if (line.startsWith("@")) date = line.slice(1);
    else if (line && !dates.has(line)) dates.set(line, date);
  }
  return dates;
}

/** Docs id of a page URL, like `components/balance`. The landing page is `index`. */
const idOf = (/** @type {string} */ url) =>
  new URL(url).pathname.replace(/^\/|\/$/g, "") || "index";

export function sitemapOptions() {
  const dates = commitDates();
  /** @type {{ items: { name: string; files?: { path: string }[] }[] }} */
  const registry = JSON.parse(readFileSync(new URL("registry.json", root), "utf8"));

  /** The files a page is made from: its text and, for a component, its source and demo. */
  const sources = (/** @type {string} */ id) => {
    const [section, name] = id.split("/");
    // A section overview is `components/index.mdx`, any other page `components/balance.mdx`.
    const files = [`src/content/docs/${id}.mdx`, `src/content/docs/${id}/index.mdx`];
    if (name && (section === "components" || section === "blocks")) {
      const item = registry.items.find((entry) => entry.name === name);
      files.push(`src/demos/${name}.tsx`, ...(item?.files ?? []).map((file) => file.path));
    }
    return files;
  };

  return {
    // The shielded preview is unlisted (src/docs-nav.mjs) and noindex
    // (src/route-middleware.ts).
    filter: (/** @type {string} */ page) => !unlistedPages.has(idOf(page)),
    serialize: (/** @type {import("@astrojs/sitemap").SitemapItem} */ item) => {
      const changed = sources(idOf(item.url))
        .map((file) => dates.get(file))
        .filter((date) => date !== undefined)
        .map((date) => new Date(date).toISOString())
        .sort();
      const lastmod = changed.at(-1);
      return lastmod ? { ...item, lastmod } : item;
    },
  };
}
