import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, test } from "vitest";
import registry from "../../registry.json";
import { componentName, extractProps } from "./props";
import type { ComponentDoc, PropDoc } from "./props";

const docsRoot = join(process.cwd(), "src/content/docs");

interface Row {
  /** A cell can name several props, like `open` / `onOpenChange`. */
  names: Array<string>;
  /** The Default cell, when the table has one. */
  default?: string;
}

interface PropsSection {
  page: string;
  rows: Array<Row>;
  /** Prop names an "Also accepts …" sentence lists, like the Token Amount formatting props. */
  accepts: Array<string>;
  /** Normalized text of those sentences, to tell which inherited props they cover. */
  acceptsText: string;
}

const normalize = (text: string) => text.toLowerCase().replaceAll(/[^a-z0-9]/g, "");
const backticked = (text: string) => [...text.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
// Splits on pipes that aren't escaped, like the one in `"a" \| "b"`.
const cells = (line: string) =>
  line
    .split(/(?<!\\)\|/)
    .slice(1, -1)
    .map((cell) => cell.trim());

function propsSection(page: string, body: string): PropsSection | undefined {
  const section = body.match(/^## Props\n([\s\S]*?)(?=^## |(?![\s\S]))/m)?.[1];
  if (!section || !/^\| Prop +\|/m.test(section)) return undefined;
  const lines = section.split("\n");
  const [header, , ...table] = lines.filter((line) => line.startsWith("|"));
  const defaultColumn = cells(header).indexOf("Default");
  const rows = table.map((line) => {
    const row = cells(line);
    return {
      names: backticked(row[0]),
      default: defaultColumn === -1 ? undefined : row[defaultColumn],
    };
  });
  const sentences = lines
    .filter((line) => !line.startsWith("|"))
    .join(" ")
    .split(/(?<=\.)\s+/)
    .filter((sentence) => /\baccepts\b/i.test(sentence))
    // "Also accepts all `<a>` props except `href`": the names after "except" are not props.
    .map((sentence) => sentence.split(/\bexcept\b/)[0]);
  const accepts = sentences.flatMap(backticked).filter((name) => /^[a-z][A-Za-z0-9]*$/.test(name));
  return { page, rows, accepts, acceptsText: normalize(sentences.join(" ")) };
}

const sections = ["components", "blocks"].flatMap((dir) =>
  readdirSync(join(docsRoot, dir))
    .filter((file) => file.endsWith(".mdx"))
    .flatMap((file) => {
      const body = readFileSync(join(docsRoot, dir, file), "utf8");
      return propsSection(file.replace(/\.mdx$/, ""), body) ?? [];
    }),
);

/**
 * Props the docs should mention: declared in 0xui code, and neither in the
 * table nor covered by an "Also accepts" sentence naming them or where they
 * come from. Props from npm packages (ui-sdk, torph) and DOM attributes are
 * documented by reference, and `className` on the root is a convention.
 */
function undocumented(section: PropsSection, props: Array<PropDoc>) {
  const listed = new Set([...section.rows.flatMap((row) => row.names), ...section.accepts]);
  return props
    .filter((prop) => !listed.has(prop.name) && prop.name !== "className")
    .filter((prop) => !prop.package && !prop.attribute)
    .filter((prop) => !prop.from || !section.acceptsText.includes(normalize(prop.from)))
    .map((prop) => prop.name);
}

const literal = /^(["'\d[{-]|true$|false$|null$)/;
const sameValue = (a: string, b: string) =>
  a.replaceAll("'", '"').replaceAll(/\s/g, "") === b.replaceAll("'", '"').replaceAll(/\s/g, "");

/** Rows whose Default cell is a literal, like `"auto"`, that the code's default disagrees with. */
function defaultMismatches(section: PropsSection, props: Array<PropDoc>) {
  return section.rows.flatMap((row) => {
    const documented = row.default?.match(/^`([^`]+)`$/)?.[1];
    if (row.names.length !== 1 || !documented) return [];
    const code = props.find((prop) => prop.name === row.names[0])?.default;
    if (!code || !literal.test(code) || sameValue(code, documented)) return [];
    return [`${row.names[0]} is ${documented} in the docs, ${code} in code`];
  });
}

const docs = new Map<string, ComponentDoc | undefined>();
const report: Array<string> = [];

beforeAll(() => {
  for (const { page } of sections) {
    const item = registry.items.find((i) => i.name === page);
    docs.set(page, item && extractProps(item));
  }
}, 60_000);

describe("docs Props tables", () => {
  test("finds the tables", () => {
    expect(sections.length).toBeGreaterThan(20);
  });

  test.each(sections.map((s) => [s.page, s] as const))(
    "%s lists only real props",
    (page, section) => {
      const doc = docs.get(page);
      expect(doc, `no exported ${componentName(page)} for ${page}`).toBeDefined();
      const names = new Set(doc!.props.map((prop) => prop.name));
      const stale = [...section.rows.flatMap((row) => row.names), ...section.accepts].filter(
        (name) => !names.has(name),
      );
      expect(stale, `${page}.mdx documents props ${componentName(page)} doesn't have`).toEqual([]);

      const missing = undocumented(section, doc!.props);
      if (missing.length) report.push(`  ${page}: not documented: ${missing.join(", ")}`);
      for (const mismatch of defaultMismatches(section, doc!.props)) {
        report.push(`  ${page}: ${mismatch}`);
      }
    },
  );

  // Runs after the tables: a soft list, since some props are internal plumbing.
  test("reports props the tables leave out", () => {
    if (report.length) console.warn(`Props tables that may be incomplete:\n${report.join("\n")}`);
  });
});
