import { statSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const extensions = ["", ".ts", ".tsx", "/index.ts", "/index.tsx"];

/**
 * Resolves `@/…` imports the way an installed component sees them.
 *
 * Registry source imports `@/lib/0xui-utils`, `@/hooks/use-mounted`, … — the
 * paths they will have in a user's app after `shadcn add`. In this repo those
 * files live in `registry/default/`, while docs-only code (shadcn ui
 * primitives, `cn`) lives in `src/`. Try the registry first, then `src/`.
 * Mirrors the `@/*` fallback list in tsconfig.json.
 *
 * @returns {import("vite").Plugin}
 */
export function registryResolver() {
  return {
    name: "0xui:registry-resolver",
    enforce: "pre",
    resolveId(id) {
      if (!id.startsWith("@/")) return null;
      const [rest, query] = id.slice(2).split("?");
      for (const dir of ["registry/default/", "src/"]) {
        for (const ext of extensions) {
          const file = `${root}${dir}${rest}${ext}`;
          if (statSync(file, { throwIfNoEntry: false })?.isFile()) {
            return query ? `${file}?${query}` : file;
          }
        }
      }
      return null;
    },
  };
}
