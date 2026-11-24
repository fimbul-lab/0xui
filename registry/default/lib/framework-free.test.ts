import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// lib/ is the layer a Vue or Svelte port reuses as-is.
const dir = import.meta.dirname;
const reactOnly = /from ["'](react|react-dom|wagmi|@tanstack\/react-query|@ui-sdk\/react)(\/[^"']*)?["']/;
const exempt = new Set(["wagmi-config.ts"]);

describe("lib/", () => {
  const files = readdirSync(dir).filter(
    (f) => /\.tsx?$/.test(f) && !f.includes(".test.") && !exempt.has(f),
  );
  it.each(files)("%s imports no framework", (file) => {
    expect(readFileSync(join(dir, file), "utf8")).not.toMatch(reactOnly);
  });
});
