import { defineConfig } from "vitest/config";
import { registryResolver } from "./scripts/registry-resolver.mjs";

export default defineConfig({
  plugins: [registryResolver()],
  // tsconfig inherits `jsx: preserve` from Astro; compile JSX for tests.
  oxc: { jsx: { runtime: "automatic" } },
  test: {
    environment: "jsdom",
    setupFiles: ["./test/setup.ts"],
    include: ["registry/**/*.test.{ts,tsx}"],
  },
});
