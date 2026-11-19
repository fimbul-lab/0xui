import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import registry from "../../registry.json";
import {
  docSections,
  llmsTxt,
  markdownPath,
  mdxToMarkdown,
  pageMarkdown,
  type DocPage,
} from "./agent-docs";

const root = join(process.cwd(), "src/content/docs");

function loadDocs(): DocPage[] {
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

test("the overview pages list every page in their section", () => {
  const components = pageMarkdown(
    docs.find((doc) => doc.id === "components")!,
    docs,
    registry.items,
  );
  for (const doc of docs.filter((doc) => doc.id.startsWith("components/"))) {
    expect(components).toContain(`(https://0xui.io/${doc.id}.md)`);
  }
});

test("llms.txt links every page and every registry item", () => {
  const text = llmsTxt(docs, registry.items);
  for (const doc of docs) expect(text).toContain(`(https://0xui.io/${doc.id}.md)`);
  for (const item of registry.items.filter((item) => item.type !== "registry:example")) {
    expect(text.includes(`/${item.name}.md)`) || text.includes(`/r/${item.name}.json)`)).toBe(true);
  }
});

test("every page is in a section, once", () => {
  const ids = docSections(docs).flatMap((section) => section.pages.map((page) => page.id));
  expect(ids.toSorted()).toEqual(docs.map((doc) => doc.id).toSorted());
});

test("the skill names every component and block", () => {
  const skill = readFileSync(join(process.cwd(), "skills/0xui/SKILL.md"), "utf8");
  const names = docs
    .filter((doc) => /^(components|blocks)\//.test(doc.id))
    .map((doc) => doc.id.split("/")[1]);
  expect(names.filter((name) => !skill.includes(`\`${name}\``))).toEqual([]);
});

test("markdownPath covers docs pages only", () => {
  expect(markdownPath("components/balance")).toBe("/components/balance.md");
  expect(markdownPath("blocks")).toBe("/blocks.md");
  expect(markdownPath("index")).toBeUndefined();
  expect(markdownPath("404")).toBeUndefined();
});
