// @ts-check
import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";
import react from "@astrojs/react";
import tailwindcss from "@tailwindcss/vite";
import { registryResolver } from "./scripts/registry-resolver.mjs";
import { readdirSync } from "node:fs";
import { gettingStarted, groupComponents } from "./src/docs-nav.mjs";

const componentGroups = groupComponents(
  readdirSync(new URL("./src/content/docs/components", import.meta.url))
    .filter((file) => file.endsWith(".mdx") && file !== "index.mdx")
    .map((file) => file.replace(/\.mdx$/, "")),
);

// https://astro.build/config
export default defineConfig({
  site: "https://0xui.dev",
  integrations: [
    react(),
    starlight({
      title: "0xui",
      description: "Copy-paste web3 React components built on wagmi, viem, Base UI and Tailwind.",
      social: [
        {
          icon: "github",
          label: "GitHub",
          href: "https://github.com/Matsfjeldstad/0xui",
        },
      ],
      sidebar: [
        {
          label: "Getting started",
          items: gettingStarted,
        },
        {
          label: "Blocks",
          items: [{ autogenerate: { directory: "blocks" } }],
        },
        // Components, by what they are for. See src/docs-nav.mjs.
        { label: "Components", link: "/components/" },
        ...componentGroups.map((group) => ({
          label: group.label,
          items: group.items.map((name) => `components/${name}`),
        })),
      ],
      components: {
        Head: "./src/components/docs/Head.astro",
        Header: "./src/components/docs/Header.astro",
        Hero: "./src/components/docs/Hero.astro",
        PageTitle: "./src/components/docs/PageTitle.astro",
        SiteTitle: "./src/components/docs/SiteTitle.astro",
        Sidebar: "./src/components/docs/Sidebar.astro",
        ThemeSelect: "./src/components/docs/ThemeToggle.astro",
      },
      expressiveCode: {
        themes: ["vesper", "github-light-default"],
        styleOverrides: {
          borderRadius: "0.625rem",
          borderColor: "var(--docs-line)",
          borderWidth: "1px",
          codeBackground: "var(--docs-code-bg)",
          codeFontFamily: "var(--__sl-font-mono)",
          codeFontSize: "0.8125rem",
          codeLineHeight: "1.7",
          codePaddingBlock: "0.875rem",
          codePaddingInline: "1rem",
          uiFontFamily: "var(--__sl-font-mono)",
          uiFontSize: "0.75rem",
          frames: {
            frameBoxShadowCssValue: "none",
            editorBackground: "var(--docs-code-bg)",
            editorTabBarBackground: "var(--docs-code-bg)",
            editorTabBarBorderBottomColor: "var(--docs-line)",
            editorActiveTabBackground: "transparent",
            editorActiveTabBorderColor: "transparent",
            editorActiveTabIndicatorTopColor: "transparent",
            editorActiveTabIndicatorBottomColor: "transparent",
            editorActiveTabForeground: "var(--sl-color-gray-3)",
            terminalBackground: "var(--docs-code-bg)",
            terminalTitlebarBackground: "var(--docs-code-bg)",
            terminalTitlebarBorderBottomColor: "transparent",
            terminalTitlebarDotsOpacity: "0",
            inlineButtonBackground: "var(--sl-color-gray-5)",
            inlineButtonBorder: "var(--docs-line-strong)",
            inlineButtonForeground: "var(--sl-color-gray-2)",
          },
        },
      },
      customCss: [
        "@fontsource-variable/geist",
        "@fontsource-variable/geist-mono",
        "./src/styles/global.css",
        "./src/styles/docs.css",
      ],
    }),
  ],
  vite: {
    plugins: [registryResolver(), tailwindcss()],
  },
});
