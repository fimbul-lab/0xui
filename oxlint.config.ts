import recommended from "@interfere/landmines/configs/recommended.json" with { type: "json" };
import { defineConfig, type OxlintConfig } from "oxlint";

// JSON imports widen "error" to string, so restate landmines' recommended
// config, which sets every rule to "error".
const landmines: OxlintConfig = {
  jsPlugins: recommended.jsPlugins,
  rules: Object.fromEntries(Object.keys(recommended.rules).map((rule) => [rule, "error"])),
};

const tests = ["**/*.test.ts", "**/*.test.tsx", "test/**"];

export default defineConfig({
  extends: [landmines],
  plugins: ["typescript", "unicorn", "oxc", "react", "jsx-a11y", "vitest"],
  env: { builtin: true, browser: true },
  ignorePatterns: [".agents/**", "public/r/**"],
  categories: {
    correctness: "error",
  },
  options: {
    typeAware: true,
  },
  rules: {
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
  ],
});
