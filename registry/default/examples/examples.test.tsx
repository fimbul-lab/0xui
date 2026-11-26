import { readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { ComponentType } from "react";
import { describe, expect, it, vi } from "vitest";
import { createTestConfig, fakeChainRpc, renderWithWagmi } from "../../../test/wagmi";

const root = process.cwd();

const examples = import.meta.glob<{ default: ComponentType }>("./*-demo.tsx", { eager: true });

/** Docs pages that document an API rather than a component, so they have no example. */
const withoutExample = ["shielded-engine"];

type RegistryItem = {
  name: string;
  type: string;
  docs?: string;
  registryDependencies?: Array<string>;
  files: Array<{ path: string; type: string }>;
};
const registry: { items: Array<RegistryItem> } = JSON.parse(
  readFileSync(join(root, "registry.json"), "utf8"),
);

function docsPages(section: "components" | "blocks") {
  return readdirSync(join(root, "src/content/docs", section))
    .filter((file) => file.endsWith(".mdx") && file !== "index.mdx")
    .map((file) => ({ section, name: basename(file, ".mdx") }))
    .filter(({ name }) => !withoutExample.includes(name));
}

/** Answer JSON-RPC from a fake chain, and refuse other requests (token lists, NFT metadata). */
function offlineConfig() {
  const config = createTestConfig({ rpc: fakeChainRpc() });
  const rpcFetch = globalThis.fetch;
  vi.stubGlobal("fetch", (url: string, init?: { body?: string }) =>
    typeof init?.body === "string"
      ? rpcFetch(url, init)
      : Promise.reject(new Error(`Offline: ${url}`)),
  );
  return config;
}

describe("examples", () => {
  it.each(Object.entries(examples))("%s renders", (_, module) => {
    const Example = module.default;
    const { container } = renderWithWagmi(<Example />, { config: offlineConfig() });
    expect(container).not.toBeEmptyDOMElement();
  });

  it.each([...docsPages("components"), ...docsPages("blocks")])(
    "$section/$name has a registry example",
    ({ section, name }) => {
      const item = registry.items.find((i) => i.name === `${name}-demo`);
      expect(item?.type).toBe("registry:example");
      expect(item?.docs).toBe(`Docs: https://0xui.io/${section}/${name}.md`);
      expect(item?.registryDependencies).toContain(`@0xui/${name}`);
      expect(item?.files).toEqual([
        { path: `registry/default/examples/${name}-demo.tsx`, type: "registry:example" },
      ]);
      expect(examples[`./${name}-demo.tsx`]?.default).toBeTypeOf("function");
    },
  );
});
