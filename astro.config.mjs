// @ts-check
import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";
import react from "@astrojs/react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

// https://astro.build/config
export default defineConfig({
  integrations: [
    react(),
    starlight({
      title: "0xui",
      social: [
        {
          icon: "github",
          label: "GitHub",
          href: "https://github.com/Matsfjeldstad/0xui",
        },
      ],
      sidebar: [
        {
          label: "Guides",
          items: [
            // Each item here is one entry in the navigation menu.
            { label: "Example Guide", slug: "guides/example" },
          ],
        },
        {
          label: "Reference",
          items: [{ autogenerate: { directory: "reference" } }],
        },
      ],
      customCss: ["./src/styles/global.css"],
    }),
  ],
  vite: {
    plugins: [tailwindcss()],
    resolve: {
      alias: {
        "@": fileURLToPath(new URL("./src", import.meta.url)),
        "@registry": fileURLToPath(new URL("./registry", import.meta.url)),
      },
    },
  },
});
