// Takes the unlisted items (src/docs-nav.mjs) out of the built registry index,
// public/r/registry.json. Run after `shadcn build`.
//
// The index is what `shadcn search @0xui` and the shadcn MCP server list.
// Each item's own file, public/r/<name>.json, stays, so an unlisted item still
// installs by name or URL.
import { readFileSync, writeFileSync } from "node:fs";
import { isUnlistedItem } from "../src/docs-nav.mjs";

const file = new URL("../public/r/registry.json", import.meta.url);
const index = JSON.parse(readFileSync(file, "utf8"));
const items = index.items.filter((item) => !isUnlistedItem(item.name));

writeFileSync(file, `${JSON.stringify({ ...index, items }, null, 2)}\n`);
const unlisted = index.items.length - items.length;
console.log(`Registry index: ${items.length} listed, ${unlisted} unlisted.`);
