// @ts-check
import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";
import react from "@astrojs/react";
import tailwindcss from "@tailwindcss/vite";
import { registryResolver } from "./scripts/registry-resolver.mjs";

// https://astro.build/config
export default defineConfig({
  integrations: [
    react(),
    starlight({
      title: "0xui",
      description:
        "Copy-paste web3 React components built on wagmi, viem, Base UI and Tailwind.",
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
          items: [
            { label: "Installation", slug: "getting-started/installation" },
            { label: "Conventions", slug: "getting-started/conventions" },
          ],
        },
        {
          label: "Components",
          items: [{ autogenerate: { directory: "components" } }],
        },
      ],
      customCss: ["./src/styles/global.css"],
    }),
  ],
  vite: {
    plugins: [registryResolver(), tailwindcss()],
  },
});
