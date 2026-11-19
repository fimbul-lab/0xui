// Markdown versions of the docs for agents: one file per page, /llms.txt and
// /llms-full.txt. Pure functions, so the endpoints in src/pages and the tests
// share them.

import { gettingStarted, groupComponents, unlistedPages } from "../docs-nav.mjs";

export const site = "https://0xui.io";

export interface DocPage {
  /** Content collection id, like `components/balance`. A section's overview is `components`. */
  id: string;
  title: string;
  description: string;
  /** Raw MDX. */
  body: string;
}

export interface DocSection {
  title: string;
  blurb?: string;
  pages: DocPage[];
}

/** URL of a page's Markdown, like `https://0xui.io/components/balance.md`. */
export function markdownUrl(id: string) {
  return `${site}/${id}.md`;
}

/** Site path of a docs page's Markdown, or undefined for pages without one, like the landing page. */
export function markdownPath(id: string) {
  return /^(getting-started|components|blocks)(\/[a-z0-9-]+)?$/.test(id) ? `/${id}.md` : undefined;
}

/** Every listed page except the landing page, in sidebar order. Unlisted pages are left out. */
export function docSections(docs: DocPage[]): DocSection[] {
  const byId = new Map(docs.map((doc) => [doc.id, doc]));
  const pick = (ids: string[]) =>
    ids.map((id) => byId.get(id)).filter((doc): doc is DocPage => Boolean(doc));
  const names = (section: string) =>
    docs
      .filter((doc) => doc.id.startsWith(`${section}/`) && !unlistedPages.has(doc.id))
      .map((doc) => doc.id.slice(section.length + 1));

  return [
    { title: "Getting started", pages: pick(gettingStarted.map((item) => item.slug)) },
    {
      title: "Blocks",
      pages: pick([
        "blocks",
        ...names("blocks")
          .sort()
          .map((name) => `blocks/${name}`),
      ]),
    },
    { title: "Components", pages: pick(["components"]) },
    ...groupComponents(names("components")).map((group) => ({
      title: `Components: ${group.label}`,
      blurb: group.blurb,
      pages: pick(group.items.map((name) => `components/${name}`)),
    })),
  ];
}

const runner = "npx shadcn@latest";

/** The `shadcn add` command for one or more registry items. */
export function installCommand(names: string[]) {
  return `${runner} add ${names.map((name) => `@0xui/${name}`).join(" ")}`;
}

const asideLabels: Record<string, string> = {
  note: "Note",
  tip: "Tip",
  caution: "Caution",
  danger: "Danger",
};

function attribute(tag: string, name: string) {
  return tag.match(new RegExp(`${name}="([^"]*)"`))?.[1];
}

/** Turns a docs link like `/components/token-amount/#props` into its Markdown URL. */
function rewriteLinks(line: string) {
  return line.replace(
    /\]\(\/((?:getting-started|components|blocks)(?:\/[a-z0-9-]+)?)\/?(#[^)]*)?\)/g,
    (_, id: string, hash = "") => `](${markdownUrl(id)}${hash})`,
  );
}

/**
 * Turns a page's MDX into plain Markdown. Interactive previews are dropped,
 * `<Install>` becomes a shell command, `<Aside>` a blockquote, and
 * `<ComponentIndex>` the list `index` returns for its section.
 */
export function mdxToMarkdown(mdx: string, index: (section: string) => string = () => "") {
  const lines = mdx.replace(/^---\n[\s\S]*?\n---\n/, "").split("\n");
  const out: string[] = [];
  let fence: string | undefined;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const marker = line.match(/^\s*(`{3,}|~{3,})/)?.[1];

    if (fence) {
      out.push(line);
      if (marker && marker[0] === fence[0] && marker.length >= fence.length) fence = undefined;
      continue;
    }
    if (marker) {
      fence = marker;
      out.push(line);
      continue;
    }
    if (/^(import|export) /.test(line)) continue;

    const name = line.match(/^\s*<([A-Z][A-Za-z.]*)/)?.[1];
    if (!name) {
      out.push(rewriteLinks(line));
      continue;
    }

    // The opening tag can span lines, like `<Install name={[ … ]} />`.
    let open = line;
    while (!/>\s*$/.test(open) && i + 1 < lines.length) open += `\n${lines[++i]}`;
    const selfClosing = /\/>\s*$/.test(open);
    const children: string[] = [];
    if (!selfClosing && !open.includes(`</${name}>`)) {
      while (i + 1 < lines.length && !lines[i + 1].includes(`</${name}>`)) {
        children.push(lines[++i]);
      }
      i++;
    }

    if (name === "Install") {
      const names = [...open.matchAll(/"([a-z0-9-]+)"/g)].map((match) => match[1]);
      out.push("```bash", installCommand(names), "```");
    } else if (name === "Aside") {
      const type = attribute(open, "type") ?? "note";
      const title = attribute(open, "title");
      const label = asideLabels[type] ?? "Note";
      out.push(`> **${title ? `${label}: ${title}` : label}**`, ">");
      for (const child of children) out.push(`> ${rewriteLinks(child.trim())}`.trimEnd());
    } else if (name === "ComponentIndex") {
      out.push(index(attribute(open, "section") ?? ""));
    }
    // Anything else, like <Preview>, is an interactive demo with nothing to read.
  }

  return out
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function pageList(pages: DocPage[]) {
  return pages
    .map((page) => `- [${page.title}](${markdownUrl(page.id)}): ${page.description}`)
    .join("\n");
}

/** The list a `<ComponentIndex section>` renders, as Markdown. */
export function sectionIndex(docs: DocPage[], section: string) {
  return docSections(docs)
    .filter((group) =>
      section === "components"
        ? group.title.startsWith("Components: ")
        : group.title.toLowerCase() === section,
    )
    .map((group) => {
      const pages = group.pages.filter((page) => page.id.includes("/"));
      const heading =
        section === "components" ? `## ${group.title.slice("Components: ".length)}\n\n` : "";
      const blurb = group.blurb ? `${group.blurb}\n\n` : "";
      return `${heading}${blurb}${pageList(pages)}`;
    })
    .join("\n\n");
}

export interface RegistryItem {
  name: string;
  type: string;
  description?: string;
  files?: { path: string }[];
}

/** One page as a standalone Markdown document. */
export function pageMarkdown(page: DocPage, docs: DocPage[], registry: RegistryItem[]) {
  const [section, name] = page.id.split("/");
  const item =
    section === "components" || section === "blocks"
      ? registry.find((entry) => entry.name === name)
      : undefined;
  const source = item?.files?.[0]?.path;
  const links = item
    ? [
        `Install: \`${installCommand([item.name])}\``,
        `Registry JSON: ${site}/r/${item.name}.json`,
        source && `Source: https://github.com/fimbul-lab/0xui/blob/main/${source}`,
      ].filter(Boolean)
    : [];

  return [
    `# ${page.title}`,
    page.description && `> ${page.description}`,
    links.length ? links.map((link) => `- ${link}`).join("\n") : "",
    mdxToMarkdown(page.body, (sectionName) => sectionIndex(docs, sectionName)),
  ]
    .filter(Boolean)
    .join("\n\n")
    .concat("\n");
}

const intro = `0xui is a [shadcn registry](https://ui.shadcn.com/docs/registry) of web3 React components. Components are copied into the app as source, built on wagmi, viem, Base UI and Tailwind CSS v4. Every component handles the states real wallets produce (pending, cancelled in wallet, wrong network, error) and exports its hook, so the logic works with your own UI.

To install, the project needs shadcn with the Base UI flavor (\`npx shadcn@latest init --base base\`; Radix isn't supported) and this in \`components.json\`:

\`\`\`json
{ "registries": { "@0xui": "${site}/r/{name}.json" } }
\`\`\`

Then \`${installCommand(["<name>"])}\`. Start with \`@0xui/wagmi-config\` when the app has no \`WagmiProvider\` yet. Without a terminal, add \`--overwrite\`: otherwise the CLI can stop at an overwrite question, exit 0 and leave the install half done.

Every page below is Markdown. Append \`.md\` to any docs URL for its Markdown, read everything at once at ${site}/llms-full.txt, or install the agent skill: \`npx skills add ${site}\`.`;

/** `/llms.txt`, as https://llmstxt.org describes it. */
export function llmsTxt(docs: DocPage[], registry: RegistryItem[]) {
  const documented = new Set(docs.map((doc) => doc.id.split("/")[1]));
  const extras = registry.filter(
    (item) => !documented.has(item.name) && item.type !== "registry:example",
  );

  return [
    "# 0xui",
    "> Copy-paste web3 React components built on wagmi, viem, Base UI and Tailwind, installed with the shadcn CLI.",
    intro,
    ...docSections(docs).map(
      (section) =>
        `## ${section.title}\n\n${section.blurb ? `${section.blurb}\n\n` : ""}${pageList(section.pages)}`,
    ),
    `## Registry\n\nItems without a docs page. Other components install them as dependencies.\n\n${extras
      .map((item) => `- [${item.name}](${site}/r/${item.name}.json): ${item.description ?? ""}`)
      .join("\n")}`,
    `## Examples\n\nEvery component and block has a runnable example: \`${installCommand(["<name>-demo"])}\`, or read it at ${site}/r/<name>-demo.json. The shadcn MCP server finds them by name.`,
    `## Optional\n\n- [Full docs](${site}/llms-full.txt): every page above in one file.\n- [Registry index](${site}/r/registry.json): every item with its dependencies.\n- [Agent skill](${site}/.well-known/agent-skills/0xui/SKILL.md): how to build with 0xui.`,
  ]
    .join("\n\n")
    .concat("\n");
}

/** `/llms-full.txt`: every page, in sidebar order. */
export function llmsFullTxt(docs: DocPage[], registry: RegistryItem[]) {
  const pages = docSections(docs).flatMap((section) => section.pages);
  return [
    "# 0xui",
    `> Copy-paste web3 React components built on wagmi, viem, Base UI and Tailwind. Every page of the docs at ${site}, as Markdown.`,
    ...pages.map((page) =>
      pageMarkdown(page, docs, registry)
        .trim()
        .replace(/^# .*/, (heading) => `${heading}\n\nSource: ${markdownUrl(page.id)}`),
    ),
  ]
    .join("\n\n---\n\n")
    .concat("\n");
}
