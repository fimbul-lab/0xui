// Draws the README banners.
//
//   bun run readme:banner             write every banner
//   bun run readme:banner frames c    also write a contact sheet of banner c
//
// The banner in use goes to .github/banner.svg. The others are kept beside
// their README in ./variants, ready to swap in: move the README to the repo
// root, point its <img> at .github/banner.svg, and change `use` below.
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { bannerA } from "./banner-a";
import { bannerB } from "./banner-b";
import { bannerC } from "./banner-c";

const use = "c";

const path = (relative: string) => fileURLToPath(new URL(relative, import.meta.url));

const banners = {
  a: {
    out: path("./variants/a-hero/banner.svg"),
    make: bannerA,
    times: [0.2, 1.5, 2.75, 3.3, 4.9, 6, 7.4, 9.3, 11.5, 13.1],
  },
  b: {
    out: path("./variants/b-states/banner.svg"),
    make: bannerB,
    times: [0.5, 2.2, 3.6, 5.4, 7.4, 9.5, 11.2, 12.6, 14.2, 15.6],
  },
  c: {
    out: path("./variants/c-decode/banner.svg"),
    make: bannerC,
    times: [0.1, 0.6, 1.1, 1.6, 2.2, 3, 4, 6, 9, 11.6],
  },
} satisfies Record<string, { out: string; make: () => string; times: Array<number> }>;
banners[use].out = path("../../.github/banner.svg");

/** Stops every animation at `t` seconds, to look at one frame. */
function freeze(source: string, t: number): string {
  return source.replace(
    "</style>",
    `*{animation-delay:-${t}s!important;animation-play-state:paused!important}</style>`,
  );
}

const image = (source: string) =>
  `data:image/svg+xml;base64,${Buffer.from(source).toString("base64")}`;

const [mode, only] = process.argv.slice(2);

for (const [key, { out, make, times }] of Object.entries(banners)) {
  if (only && only !== key) {
    continue;
  }
  const source = make();
  writeFileSync(out, source);
  console.log(`${key}  ${(source.length / 1024).toFixed(1)} kB  ${out}`);

  if (mode === "frames") {
    // Frames as <img>, the way GitHub loads the banner, plus the still frame
    // people with reduced motion get.
    const cells = times.map(
      (t) =>
        `<figure><img src="${image(freeze(source, t))}"><figcaption>${t}s</figcaption></figure>`,
    );
    const still = source.replace("prefers-reduced-motion:no-preference", "min-width:99999px");
    cells.push(
      `<figure><img src="${image(still)}"><figcaption>still (reduced motion)</figcaption></figure>`,
    );
    const dir = `${tmpdir()}/0xui-readme-banner`;
    mkdirSync(dir, { recursive: true });
    const sheet = `${dir}/${key}.html`;
    writeFileSync(
      sheet,
      `<!doctype html><meta charset="utf-8"><style>body{margin:0;padding:16px;background:#0d1117;display:grid;grid-template-columns:1fr 1fr;gap:12px;font:12px ui-monospace,monospace;color:#8b949e}figure{margin:0}img{width:100%;display:block}</style>${cells.join("")}`,
    );
    console.log(`   frames  ${sheet}`);
  }
}
