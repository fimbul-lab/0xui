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
    timeout: 60_000,
    // Fail rather than wait for a password nobody will type.
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });

/**
 * Last commit date of every file in the repo. A shallow clone (Cloudflare's
 * build, most CI) only knows the newest commit, which would date every file
 * today, so the rest of the history is fetched first. Empty if that fails or
 * there is no git: no date is better than a wrong one.
 */
function commitDates() {
  /** @type {Map<string, string>} */
  const dates = new Map();
  let log = "";
  try {
    const shallow = () => git("rev-parse", "--is-shallow-repository").trim() === "true";
    if (shallow()) {
      try {
        git("fetch", "--unshallow", "--quiet");
      } catch {
        // Checked below.
      }
      if (shallow()) return dates;
    }
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
  new URL(url).pathname.replaceAll(/^\/|\/$/g, "") || "index";

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
