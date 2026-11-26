// Social cards (og:image), one per page, drawn as SVG from the same helpers
// and palette as the README banner. src/pages/og/[...slug].png.ts turns them
// into PNGs at build time.

import {
  c,
  icon,
  icons,
  mark,
  measure,
  oklch,
  rect,
  runs,
  svg,
  text,
} from "../../scripts/readme/lib";
import type { TextOptions } from "../../scripts/readme/lib";
import { groupOf, listedComponents, unlistedPages } from "../docs-nav.mjs";
import { installCommand } from "./agent-docs";
import { ogSize } from "./seo";

const { width: W, height: H } = ogSize;
/** Margin on every side. Cards are cropped and scaled down, so keep it wide. */
const M = 72;

export interface OgPage {
  /** Content collection id, like `components/balance`. The landing page is `index`. */
  id: string;
  title: string;
  description: string;
  /** Whether `shadcn add` installs this page's component or block. */
  installable?: boolean;
}

const escape = (value: string) =>
  value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

/** Greedy word wrap to `width`, at most `max` lines. The last line ends in "…" if cut. */
function wrap(str: string, width: number, max: number, o: TextOptions): Array<string> {
  const lines: Array<string> = [];
  let line = "";
  for (const word of str.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (!line || measure(next, o) <= width) line = next;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  if (lines.length <= max) return lines;

  let last = lines[max - 1];
  while (last && measure(`${last}…`, o) > width) last = last.replace(/\s*\S+$/, "");
  return [...lines.slice(0, max - 1), `${last.replace(/[.,;:]$/, "")}…`];
}

/** `wrap`, then narrowed until the lines are about the same length, so none ends in an orphan. */
function balance(str: string, width: number, max: number, o: TextOptions): Array<string> {
  let lines = wrap(str, width, max, o);
  for (let narrower = width - 20; narrower > width / 2; narrower -= 20) {
    const next = wrap(str, narrower, max, o);
    if (next.length !== lines.length || next.at(-1)?.endsWith("…")) break;
    lines = next;
  }
  return lines;
}

/** The mark and wordmark, top left, and the domain, top right. */
function header(domain: boolean): string {
  const word = { family: "mono" as const, size: 34, weight: 600, tracking: -0.02 };
  const height = 40;
  const markW = (58 / 73.4667) * height;
  const baseline = M + 32;
  return [
    mark(M, baseline - 0.71 * word.size - 8, height),
    runs([["0x", { fill: c.gray3 }], ["ui"]], { ...word, x: M + markW + 14, y: baseline }).svg,
    domain
      ? text("0xui.io", {
          family: "mono",
          size: 22,
          tracking: 0.02,
          fill: c.gray4,
          x: W - M,
          y: baseline - 3,
          anchor: "end",
        })
      : "",
  ].join("");
}

/** The mark, large and barely there, bleeding off the right edge. */
function watermark(): string {
  const height = 560;
  return mark(W - 330, (H - height) / 2 + 26, height, { fill: oklch(0.172) });
}

/** Where the page sits in the docs, like "Components / Wallet". */
function eyebrow(id: string): Array<string> {
  const [section, name] = id.split("/");
  if (id === "shielded") return ["Preview"];
  if (!name) return ["Overview"];
  if (section === "getting-started") return ["Getting started"];
  if (section === "blocks") return unlistedPages.has(id) ? ["Blocks", "Preview"] : ["Blocks"];
  if (section === "components") return ["Components", groupOf(name) ?? "Preview"];
  return ["Docs"];
}

/** The card for a docs page: where it is, its title, its description, how to install it. */
function pageCard(page: OgPage): string {
  const name = page.id.split("/")[1];
  const install = page.installable && name;
  // A page with no install command has its address at the bottom instead.
  const out: Array<string> = [watermark(), header(Boolean(install))];
  let y = H - M;

  // Bottom up, so the text block always sits on the same line.
  if (install) {
    const command = { family: "mono" as const, size: 25, fill: c.gray1 };
    const height = 64;
    const prompt = measure("$ ", command);
    const width = 26 + prompt + measure(installCommand([name]), command) + 26 + 26 + 22;
    const top = y - height;
    const baseline = top + height / 2 + 8.5;
    out.push(
      rect(M, top, Math.round(width), height, { r: 14, fill: c.surface, stroke: c.lineStrong }),
      text("$", { ...command, x: M + 26, y: baseline, fill: c.gray4 }),
      text(installCommand([name]), { ...command, x: M + 26 + prompt, y: baseline }),
      icon(icons.copy, M + width - 22 - 24, top + (height - 24) / 2, 24, { stroke: c.gray4 }),
    );
    y = top - 44;
  } else {
    const path = page.id === "index" ? "" : `/${page.id}/`;
    out.push(
      runs([["0xui.io", { fill: c.gray3 }], [path]], {
        family: "mono",
        size: 25,
        fill: c.gray4,
        x: M,
        y: y - 8,
      }).svg,
    );
    y -= 76;
  }

  const body = { size: 31, fill: c.gray3 };
  const lines = balance(page.description, 960, 3, body);
  const leading = 44;
  lines.forEach((line, i) => {
    out.push(text(line, { ...body, x: M, y: y - (lines.length - 1 - i) * leading }));
  });
  y -= lines.length * leading + 22;

  // One line if it fits at a size that still reads as a title, else two.
  const heading = { weight: 600, tracking: -0.035, fill: c.white };
  const room = W - M * 2;
  let size = 92;
  while (size > 68 && measure(page.title, { ...heading, size }) > room) size -= 2;
  const titleLines = wrap(page.title, room, 2, { ...heading, size });
  titleLines.forEach((line, i) => {
    out.push(
      text(line, {
        ...heading,
        size,
        x: M - size * 0.04,
        y: y - (titleLines.length - 1 - i) * size * 1.04,
      }),
    );
  });
  y -= titleLines.length * size * 1.04 - size * 0.3 + 26;

  const crumb = { family: "mono" as const, size: 22, tracking: 0.03, fill: c.gray3 };
  const parts = eyebrow(page.id).flatMap<[string, TextOptions?]>((part, i) =>
    i ? [[" / ", { fill: c.gray5 }], [part]] : [[part]],
  );
  out.push(
    `<circle cx="${M + 5}" cy="${y - 7.5}" r="5" fill="${c.accent}"/>`,
    runs(parts, { ...crumb, x: M + 24, y }).svg,
  );

  return out.join("\n");
}

/** The landing page card: the README banner's still frame, at card size. */
function homeCard(): string {
  const out: Array<string> = [];
  const label = { family: "mono" as const, size: 21, tracking: 0.02, fill: c.gray3 };
  const top = M + 14;

  // Corners: the chain's pulse.
  const gas = "0.928 gwei";
  const gasW = measure(gas, label) + label.tracking * label.size * gas.length;
  out.push(
    `<circle cx="${M + 5}" cy="${top - 7}" r="5" fill="${c.accent}"/>`,
    runs([["block ", { fill: c.gray4 }], ["24,117,342"]], { ...label, x: M + 24, y: top }).svg,
    text(gas, { ...label, x: W - M, y: top, anchor: "end" }),
    icon(icons.fuel, W - M - gasW - 34, top - 19, 22, { stroke: c.gray4 }),
  );

  // The wordmark.
  const big = { family: "mono" as const, size: 184, weight: 600, tracking: -0.02 };
  const advance = measure("0", big) + big.tracking * big.size;
  const cap = 0.71 * big.size;
  const markH = cap + 12;
  const markW = (58 / 73.4667) * markH;
  const gap = 40;
  const left = (W - (markW + gap + advance * 4)) / 2;
  const base = 318;
  out.push(
    mark(left, base - cap - 6, markH),
    runs([["0x", { fill: c.gray3 }], ["ui"]], { ...big, x: left + markW + gap, y: base }).svg,
  );

  out.push(
    text("Web3 components you own.", {
      family: "mono",
      size: 33,
      weight: 500,
      x: W / 2,
      y: 410,
      anchor: "middle",
    }),
    text("React components for wallets, tokens and transactions.", {
      size: 27,
      fill: c.gray3,
      x: W / 2,
      y: 460,
      anchor: "middle",
    }),
  );

  // Every component, running off both edges.
  const rowY = 536;
  const name = { family: "mono" as const, size: 21, fill: c.gray3 };
  const parts: Array<[string, TextOptions?]> = [];
  for (const item of listedComponents) parts.push([item], ["   /   ", { fill: c.gray5 }]);
  const fade = `<linearGradient id="fade" x1="0" x2="1" y1="0" y2="0"><stop offset="0" stop-color="${c.bg}"/><stop offset="1" stop-color="${c.bg}" stop-opacity="0"/></linearGradient>`;
  out.push(
    `<defs>${fade}</defs>`,
    `<path d="M0 ${rowY + 0.5}H${W}" stroke="${c.line}"/>`,
    runs(parts, { ...name, x: M, y: rowY + (H - rowY) / 2 + 7 }).svg,
    rect(0, rowY + 1, 170, H - rowY - 1, { fill: "url(#fade)" }),
    `<g transform="translate(${W} 0) scale(-1 1)">${rect(0, rowY + 1, 170, H - rowY - 1, { fill: "url(#fade)" })}</g>`,
  );

  return out.join("\n");
}

/** The card for a page, as an SVG string, 1200×630. */
export function ogCard(page: OgPage): string {
  const home = page.id === "index";
  return svg({
    width: W,
    height: H,
    radius: 0,
    border: false,
    title: escape(home ? "0xui: Web3 components you own." : `${page.title} | 0xui`),
    desc: escape(page.description),
    css: "",
    body: home ? homeCard() : pageCard(page),
  });
}
