import cloudflare from "@cloudflare/oxlint-config";
import recommended from "@interfere/landmines/configs/recommended.json" with { type: "json" };
import { defineConfig } from "oxlint";
import type { OxlintConfig } from "oxlint";

// JSON imports widen "error" to string, so restate landmines' recommended
// config, which sets every rule to "error".
const landmines: OxlintConfig = {
  jsPlugins: recommended.jsPlugins,
  rules: Object.fromEntries(Object.keys(recommended.rules).map((rule) => [rule, "error"])),
};

const tests = ["**/*.test.ts", "**/*.test.tsx", "test/**"];

export default defineConfig({
  extends: [cloudflare, landmines],
  env: cloudflare.env,
  ignorePatterns: [...cloudflare.ignorePatterns, ".agents/**", "public/r/**"],
  categories: {
    correctness: "error",
  },
  options: {
    typeAware: true,
  },
  rules: {
    // Temporarily off while adopting @cloudflare/oxlint-config. Each gets its own
    // commit: fixed and turned on, or kept off with the reason.
    "quality/no-array-filter-map": "off",
    "quality/no-chained-type-assertions": "off",
    "quality/no-known-value-widening": "off",
    "quality/no-object-parameters": "off",
    "quality/no-unknown-returns": "off",
    "quality/no-unsafe-dictionary-type": "off",
    "typescript/no-explicit-any": "off",
    "typescript/no-misused-promises": "off",
    "typescript/no-non-null-assertion": "off",
    "typescript/no-unnecessary-type-assertion": "off",
    "typescript/no-unsafe-argument": "off",
    "typescript/no-unsafe-assignment": "off",
    "typescript/no-unsafe-call": "off",
    "typescript/no-unsafe-member-access": "off",
    "typescript/no-unsafe-return": "off",
    "typescript/no-unsafe-type-assertion": "off",
    "typescript/use-unknown-in-catch-callback-variable": "off",
    "unicorn/consistent-function-scoping": "off",
    // Temporarily off: the test rewrite onto real implementations turns it on.
    "landmines/no-test-doubles": "off",
    // Stores and cores are closures that never use `this`.
    "typescript/unbound-method": "off",
    // `[...listeners]` snapshots a set before calling listeners that may unsubscribe.
    "unicorn/no-useless-spread": "off",
    // Components use `role="status"` on purpose.
    "jsx-a11y/prefer-tag-over-role": "off",
    "jsx-a11y/label-has-associated-control": [
      "error",
      { controlComponents: ["Checkbox", "Switch", "Radio"] },
    ],
    // Skullet reads `skullet-block` to draw an element as one skeleton block.
    "react/no-unknown-property": ["error", { ignore: ["skullet-block"] }],
    // A stray `console.log` is the slip; demos and tests report problems on purpose.
    "no-console": ["error", { allow: ["error", "warn"] }],
    // Quotes and apostrophes in JSX text render as written, and TypeScript already
    // rejects a bare `>` or `}`. oxlint's version can't narrow `forbid` to those.
    "react/no-unescaped-entities": "off",
    "typescript/no-base-to-string": "warn",
    "typescript/restrict-template-expressions": "warn",
    "react-hooks/exhaustive-deps": "warn",
    "react/refs": "warn",
    "react/set-state-in-effect": "warn",
    "react/use-memo": "warn",
  },
  overrides: [
    {
      files: tests,
      rules: {
        "typescript/no-misused-spread": "off",
        "typescript/no-redundant-type-constituents": "off",
        "typescript/require-array-sort-compare": "off",
        // Vitest takes a message as the second argument.
        "vitest/valid-expect": ["error", { maxArgs: 2 }],
        "vitest/no-standalone-expect": [
          "error",
          { additionalTestBlockFunctions: ["beforeEach", "afterEach"] },
        ],
        "vitest/no-conditional-expect": "off",
        "vitest/expect-expect": "off",
        "vitest/require-mock-type-parameters": "off",
        "vitest/require-to-throw-message": "off",
      },
    },
    {
      // Astro components get `Astro` and `Fragment` as globals.
      files: ["**/*.astro"],
      env: { astro: true },
    },
    {
      // CLIs: the console is their output.
      files: ["scripts/**"],
      rules: {
        "no-console": "off",
      },
    },
  ],
});
