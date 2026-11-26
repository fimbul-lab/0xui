import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import registry from "../../registry.json";
import { isUnlistedItem, unlistedPages } from "../docs-nav.mjs";
import { docSections, llmsTxt, markdownPath, mdxToMarkdown, pageMarkdown } from "./agent-docs";
import type { DocPage } from "./agent-docs";

const root = join(process.cwd(), "src/content/docs");

function loadDocs(): Array<DocPage> {
  return ["getting-started", "components", "blocks"].flatMap((section) =>
    readdirSync(join(root, section))
      .filter((file) => file.endsWith(".mdx"))
      .map((file) => {
        const body = readFileSync(join(root, section, file), "utf8");
        const name = file.replace(/\.mdx$/, "");
        return {
          id: name === "index" ? section : `${section}/${name}`,
          title: body.match(/^title: (.*)$/m)![1],
          description: body.match(/^description: (.*)$/m)?.[1] ?? "",
          body,
        };
      }),
  );
}

const docs = loadDocs();
const listed = docs.filter((doc) => !unlistedPages.has(doc.id));
const unlisted = docs.filter((doc) => unlistedPages.has(doc.id));

/** Lines outside code fences. */
function prose(markdown: string) {
  let fenced = false;
  return markdown.split("\n").filter((line) => {
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced;
      return false;
    }
    return !fenced;
  });
}

describe("mdxToMarkdown", () => {
  test("turns Install into a shadcn command, single or several", () => {
    const markdown = mdxToMarkdown(
      `<Install name="balance" />\n\n<Install\n  name={[\n    "wagmi-config",\n    "wallet-button",\n  ]}\n/>`,
    );
    expect(markdown).toBe(
      "```bash\nnpx shadcn@latest add @0xui/balance\n```\n\n```bash\nnpx shadcn@latest add @0xui/wagmi-config @0xui/wallet-button\n```",
    );
  });

  test("drops imports and previews, keeps code that looks like JSX", () => {
    const markdown = mdxToMarkdown(
      [
        "---",
        "title: X",
        "---",
        'import { Default } from "@/demos/x";',
        "",
        "<Preview>",
        "  <Default client:load />",
        "</Preview>",
        "",
        "```tsx",
        'import { Balance } from "@/components/balance";',
        "<Balance />",
        "```",
      ].join("\n"),
    );
    expect(markdown).toBe(
      '```tsx\nimport { Balance } from "@/components/balance";\n<Balance />\n```',
    );
  });

  test("turns an Aside into a blockquote and docs links into Markdown URLs", () => {
    const markdown = mdxToMarkdown(
      '<Aside type="tip" title="In production">\nSee [indexed data](/getting-started/indexed-data/#option-2).\n</Aside>',
    );
    expect(markdown).toBe(
      "> **Tip: In production**\n>\n> See [indexed data](https://0xui.io/getting-started/indexed-data.md#option-2).",
    );
  });

  test.each(docs.map((doc) => [doc.id, doc] as const))("%s has no MDX left", (_, doc) => {
    const lines = prose(pageMarkdown(doc, docs, registry.items));
    expect(lines.filter((line) => /^\s*<\/?[A-Z]/.test(line))).toEqual([]);
    expect(lines.filter((line) => /^(import|export) /.test(line))).toEqual([]);
  });
});

test("the overview pages list every listed page in their section, and no unlisted one", () => {
  for (const section of ["components", "blocks"]) {
    const overview = pageMarkdown(
      docs.find((doc) => doc.id === section)!,
      docs,
      registry.items,
    );
    for (const doc of docs.filter((doc) => doc.id.startsWith(`${section}/`))) {
      const link = `(https://0xui.io/${doc.id}.md)`;
      expect(overview.includes(link), link).toBe(!unlistedPages.has(doc.id));
    }
  }
});

test("llms.txt links every listed page and registry item, and no unlisted one", () => {
  const text = llmsTxt(docs, registry.items);
  for (const doc of listed) expect(text).toContain(`(https://0xui.io/${doc.id}.md)`);
  for (const doc of unlisted) expect(text).not.toContain(`/${doc.id}.md)`);
  const unlistedNames = new Set(unlisted.map((doc) => doc.id.split("/")[1]));
  for (const item of registry.items.filter(
    (item) => item.type !== "registry:example" && !unlistedNames.has(item.name),
  )) {
    expect(text.includes(`/${item.name}.md)`) || text.includes(`/r/${item.name}.json)`)).toBe(true);
  }
});

test("every listed page is in a section, once", () => {
  const ids = docSections(docs).flatMap((section) => section.pages.map((page) => page.id));
  expect(ids.toSorted()).toEqual(listed.map((doc) => doc.id).toSorted());
});

test("every unlisted page exists", () => {
  const ids = new Set(docs.map((doc) => doc.id));
  expect([...unlistedPages].filter((id) => id !== "shielded" && !ids.has(id))).toEqual([]);
});

test("the skill names every listed component and block, and no unlisted one", () => {
  const skill = readFileSync(join(process.cwd(), "skills/0xui/SKILL.md"), "utf8");
  const names = (pages: Array<DocPage>) =>
    pages.filter((doc) => /^(components|blocks)\//.test(doc.id)).map((doc) => doc.id.split("/")[1]);
  expect(names(listed).filter((name) => !skill.includes(`\`${name}\``))).toEqual([]);
  expect(names(unlisted).filter((name) => skill.includes(`\`${name}\``))).toEqual([]);
});

test("the registry index leaves out the unlisted items and their examples, and nothing else", () => {
  const names = (pages: Array<DocPage>) =>
    pages.filter((doc) => /^(components|blocks)\//.test(doc.id)).map((doc) => doc.id.split("/")[1]);
  const hidden = new Set(names(unlisted).flatMap((name) => [name, `${name}-demo`]));
  const items = registry.items.map((item) => item.name);
  expect(items.filter(isUnlistedItem)).toEqual(items.filter((name) => hidden.has(name)));
  expect(names(unlisted).filter((name) => !items.includes(name))).toEqual([]);
});

test("markdownPath covers docs pages only", () => {
  expect(markdownPath("components/balance")).toBe("/components/balance.md");
  expect(markdownPath("blocks")).toBe("/blocks.md");
  expect(markdownPath("index")).toBeUndefined();
  expect(markdownPath("404")).toBeUndefined();
});
