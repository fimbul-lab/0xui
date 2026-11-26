// Shared helpers for the README banners and the social cards (src/lib/og.ts).
//
// Text is outlined to paths from the Geist variable fonts the docs site uses,
// so a banner renders the same on GitHub (where an <img> SVG cannot load
// fonts) as it does on 0xui.io, and a card renders without installed fonts.
import { createRequire } from "node:module";
import * as fontkit from "fontkit";

// Resolved like an import rather than by relative path, so this also works
// from the bundle Astro builds the social card endpoint into.
const require = createRequire(import.meta.url);
const files = {
  sans: require.resolve("@fontsource-variable/geist/files/geist-latin-wght-normal.woff2"),
  mono: require.resolve("@fontsource-variable/geist-mono/files/geist-mono-latin-wght-normal.woff2"),
};

type Family = keyof typeof files;
const base: Record<string, any> = {};
const instances: Record<string, any> = {};

function font(family: Family, weight: number) {
  const key = `${family}-${weight}`;
  if (!instances[key]) {
    base[family] ??= fontkit.openSync(files[family]);
    instances[key] = base[family].getVariation({ wght: weight });
  }
  return instances[key];
}

// ── Colour ────────────────────────────────────────────────────────────────

/** oklch() to an sRGB hex string, so the SVG does not depend on oklch support. */
export function oklch(l: number, c = 0, h = 0): string {
  const a = c * Math.cos((h * Math.PI) / 180);
  const b = c * Math.sin((h * Math.PI) / 180);
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const lin = [
    4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
    -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
    -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
  ];
  return (
    "#" +
    lin
      .map((v) => {
        const x = Math.min(1, Math.max(0, v));
        const srgb = x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055;
        return Math.round(srgb * 255)
          .toString(16)
          .padStart(2, "0");
      })
      .join("")
  );
}

/** The docs palette, from src/styles/docs.css and global.css (dark theme). */
export const c = {
  bg: oklch(0.145),
  surface: oklch(0.178),
  surface2: oklch(0.225),
  card: oklch(0.205),
  white: oklch(0.985),
  gray1: oklch(0.93),
  gray2: oklch(0.82),
  gray3: oklch(0.66),
  gray4: oklch(0.46),
  gray5: oklch(0.28),
  gray6: oklch(0.2),
  accent: oklch(0.88, 0.2, 130),
  accentInk: oklch(0.22, 0.06, 130),
  destructive: oklch(0.704, 0.191, 22.216),
  line: "rgba(255,255,255,0.09)",
  lineStrong: "rgba(255,255,255,0.16)",
};

export const EASE = "cubic-bezier(0.2,0,0,1)";

// ── Text ──────────────────────────────────────────────────────────────────

export type TextOptions = {
  x?: number;
  y?: number;
  size?: number;
  family?: Family;
  weight?: number;
  /** Letter spacing in em. */
  tracking?: number;
  fill?: string;
  anchor?: "start" | "middle" | "end";
  opacity?: number;
};

const r = (n: number) => Math.round(n * 10) / 10;
const r3 = (n: number) => Math.round(n * 1000) / 1000;

function layout(str: string, o: TextOptions) {
  const { size = 16, family = "sans", weight = 400, tracking = 0 } = o;
  const f = font(family, weight);
  const scale = size / f.unitsPerEm;
  const run = f.layout(str);
  let pen = 0;
  const glyphs = run.glyphs.map((glyph: any, i: number) => {
    const at = pen;
    pen += run.positions[i].xAdvance * scale + tracking * size;
    return { glyph, at };
  });
  // Tracking trails every glyph in CSS; drop it after the last for measuring.
  return { glyphs, width: pen - tracking * size, scale };
}

export function measure(str: string, o: TextOptions = {}): number {
  return layout(str, o).width;
}

// Each glyph outline is written once, in font units, and every use of it is a
// <use>. A banner repeats the same few dozen glyphs hundreds of times.
const glyphDefs = new Map<string, { id: string; d: string }>();

function glyphId(family: Family, weight: number, glyph: any): string | undefined {
  const key = `${family}-${weight}-${glyph.id}`;
  const known = glyphDefs.get(key);
  if (known) {
    return known.id;
  }
  let d = "";
  for (const { command, args } of glyph.path.commands) {
    const p = args.map((v: number) => Math.round(v));
    if (command === "moveTo") {
      d += `M${p}`;
    } else if (command === "lineTo") {
      d += `L${p}`;
    } else if (command === "quadraticCurveTo") {
      d += `Q${p}`;
    } else if (command === "bezierCurveTo") {
      d += `C${p}`;
    } else if (command === "closePath") {
      d += "Z";
    }
  }
  if (!d) {
    return undefined;
  }
  const id = `g${glyphDefs.size.toString(36)}`;
  glyphDefs.set(key, { id, d });
  return id;
}

/** The glyph outlines used since the last call, as <defs> content. */
function takeGlyphDefs(): string {
  const defs = [...glyphDefs.values()].map(({ id, d }) => `<path id="${id}" d="${d}"/>`).join("");
  glyphDefs.clear();
  return defs;
}

/** A string, positioned so (x, y) is the start of its baseline. */
export function text(str: string, o: TextOptions = {}): string {
  const {
    x = 0,
    y = 0,
    anchor = "start",
    fill = c.white,
    opacity,
    family = "sans",
    weight = 400,
  } = o;
  const { glyphs, width, scale } = layout(str, o);
  const ox = anchor === "middle" ? x - width / 2 : anchor === "end" ? x - width : x;
  let uses = "";
  for (const { glyph, at } of glyphs) {
    const id = glyphId(family, weight, glyph);
    if (!id) {
      continue;
    }
    const dx = Math.round(at / scale);
    uses += `<use href="#${id}"${dx ? ` x="${dx}"` : ""}/>`;
  }
  const k = Math.round(scale * 1e5) / 1e5;
  return `<g transform="translate(${r(ox)} ${r(y)}) scale(${k} ${-k})" fill="${fill}"${opacity === undefined ? "" : ` opacity="${opacity}"`}>${uses}</g>`;
}

/** Several runs on one baseline, each with its own style. Returns the end x. */
export function runs(
  parts: Array<[string, TextOptions?]>,
  o: TextOptions & { gap?: number } = {},
): { svg: string; width: number } {
  let x = o.x ?? 0;
  const start = x;
  let svg = "";
  for (const [str, own] of parts) {
    const opts = { ...o, ...own, x, anchor: "start" as const };
    svg += text(str, opts);
    x += measure(str, opts) + (opts.tracking ?? 0) * (opts.size ?? 16) + (o.gap ?? 0);
  }
  return { svg, width: x - start };
}

// ── Animation ─────────────────────────────────────────────────────────────

/**
 * Collects keyframes and rules for one banner. Every animation shares the
 * loop length, so the whole banner stays in step.
 *
 * Animations only run inside `prefers-reduced-motion: no-preference`. Without
 * them an element shows its base style, so mark the frame you want as the
 * still image with `still: true` and the rest stay hidden.
 */
export class Timeline {
  private n = 0;
  private motion: Array<string> = [];
  private stillCss: Array<string> = [];
  constructor(
    readonly duration: number,
    readonly prefix: string,
  ) {}

  private pct(t: number) {
    return `${r3((Math.min(Math.max(t, 0), this.duration) / this.duration) * 100)}%`;
  }

  /**
   * Keyframes from [time, declarations, easing?] stops. The easing applies
   * from that stop to the next.
   */
  track(
    stops: Array<[number, string, string?]>,
    o: { still?: string; extra?: string } = {},
  ): string {
    const name = `${this.prefix}${(this.n++).toString(36)}`;
    const sorted = [...stops].sort((a, b) => a[0] - b[0]);
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    if (first[0] > 0) {
      sorted.unshift([0, first[1], undefined]);
    }
    if (last[0] < this.duration) {
      sorted.push([this.duration, last[1], undefined]);
    }
    const frames = sorted
      .map(
        ([t, decl, ease]) =>
          `${this.pct(t)}{${decl}${ease ? `;animation-timing-function:${ease}` : ""}}`,
      )
      .join("");
    this.motion.push(
      `@keyframes ${name}{${frames}}.${name}{animation:${name} ${this.duration}s linear infinite;${o.extra ?? ""}}`,
    );
    if (o.still) {
      this.stillCss.push(`.${name}{${o.still}}`);
    }
    return name;
  }

  /**
   * Visible between `from` and `to`. Slides in from `dy` below (or `dx` to the
   * side) and fades. Hidden in the still frame unless `still` is set.
   */
  show(
    from: number,
    to: number,
    o: {
      dy?: number;
      dx?: number;
      in?: number;
      out?: number;
      still?: boolean;
      scale?: number;
      outDy?: number;
    } = {},
  ): string {
    const { dy = 0, dx = 0, still = false, scale, outDy = 0 } = o;
    const dIn = o.in ?? 0.35;
    const dOut = o.out ?? 0.2;
    const off = `opacity:0;transform:translate(${dx}px,${dy}px)${scale ? ` scale(${scale})` : ""}`;
    const on = `opacity:1;transform:translate(0,0)${scale ? " scale(1)" : ""}`;
    const gone = `opacity:0;transform:translate(0,${outDy}px)${scale ? " scale(1)" : ""}`;
    // A change shorter than this is a cut: hold with steps() rather than
    // two stops so close they could round to the same percentage.
    const cut = 0.011;
    const hold = "steps(1,end)";
    const stops: Array<[number, string, string?]> = [];
    if (from <= 0) {
      stops.push([0, on]);
    } else if (dIn <= cut) {
      stops.push([0, off, hold], [from, on]);
    } else {
      stops.push([0, off], [from, off, EASE], [from + dIn, on]);
    }
    if (to < this.duration) {
      if (dOut <= cut) {
        stops[stops.length - 1][2] = hold;
        stops.push([to, gone]);
      } else {
        stops.push([to, on, "ease-in"], [Math.min(to + dOut, this.duration), gone]);
      }
    }
    return this.track(stops, {
      still: still ? "opacity:1" : "opacity:0",
      extra: "transform-box:fill-box;transform-origin:center;",
    });
  }

  /** Extra rules that only apply while animating. */
  rule(css: string) {
    this.motion.push(css);
  }

  css(): string {
    return (
      this.stillCss.join("") +
      `@media (prefers-reduced-motion:no-preference){${this.motion.join("")}}`
    );
  }
}

// ── Shapes ────────────────────────────────────────────────────────────────

export function rect(
  x: number,
  y: number,
  w: number,
  h: number,
  o: { r?: number; fill?: string; stroke?: string; sw?: number; cls?: string; extra?: string } = {},
): string {
  const { r: radius = 0, fill = "none", stroke, sw = 1, cls, extra = "" } = o;
  return `<rect${cls ? ` class="${cls}"` : ""} x="${x}" y="${y}" width="${w}" height="${h}" rx="${radius}" fill="${fill}"${stroke ? ` stroke="${stroke}" stroke-width="${sw}"` : ""} ${extra}/>`;
}

export const group = (inner: string, attrs = "") => `<g ${attrs}>${inner}</g>`;

/** A 24-unit lucide-style icon, stroked in the current colour. */
export function icon(
  paths: string,
  x: number,
  y: number,
  size: number,
  o: { stroke?: string; sw?: number; cls?: string } = {},
): string {
  const { stroke = c.gray3, sw = 2, cls } = o;
  const s = size / 24;
  return `<g transform="translate(${x} ${y}) scale(${r3(s)})"><g${cls ? ` class="${cls}"` : ""} fill="none" stroke="${stroke}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">${paths}</g></g>`;
}

export const icons = {
  check: `<path d="M20 6 9 17l-5-5"/>`,
  copy: `<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>`,
  chevronDown: `<path d="m6 9 6 6 6-6"/>`,
  arrowUpDown: `<path d="m21 16-4 4-4-4"/><path d="M17 20V4"/><path d="m3 8 4-4 4 4"/><path d="M7 4v16"/>`,
  loader: `<path d="M21 12a9 9 0 1 1-6.219-8.56"/>`,
  arrowRight: `<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>`,
  fuel: `<path d="M3 22h12"/><path d="M4 9h10"/><path d="M14 22V4a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v18"/><path d="M14 13h2a2 2 0 0 1 2 2v2a2 2 0 0 0 2 2a2 2 0 0 0 2-2V9.83a2 2 0 0 0-.59-1.42L18 5"/>`,
  x: `<path d="M18 6 6 18"/><path d="m6 6 12 12"/>`,
};

/** The 0xui mark (src/assets/logo-mark.svg), 58×74 units. */
export const MARK_FRAME =
  "M43.3934 0C44.4596 0 45.2059 0.314859 45.8456 0.944572L56.8272 11.02C57.5735 11.6497 58 12.4893 58 13.6438V59.8229C58 60.8724 57.5735 61.817 56.8272 62.4467L45.8456 72.5221C45.2059 73.1518 44.3529 73.4667 43.3934 73.4667H14.6066C13.6471 73.4667 12.7941 73.1518 12.1544 72.5221L1.17279 62.4467C0.426471 61.817 0 60.8724 0 59.8229V13.6438C0 12.6992 0.426471 11.6497 1.17279 11.02L12.1544 0.944572C12.7941 0.314859 13.5404 0 14.6066 0H43.3934ZM13.3272 53.9455C13.3272 54.5752 13.5404 55.1 13.9669 55.5198L18.9779 60.2427C19.4044 60.6625 19.8309 60.8724 20.4706 60.8724H37.5294C38.0625 60.8724 38.489 60.7674 39.0221 60.2427L44.0331 55.5198C44.4596 55.1 44.7794 54.5752 44.7794 53.9455V19.4162C44.7794 18.7865 44.5662 18.3667 44.0331 17.8419L39.0221 13.224C38.5956 12.8042 38.0625 12.5943 37.5294 12.5943H20.4706C19.9375 12.5943 19.4044 12.8042 18.9779 13.224L14.0735 17.8419C13.6471 18.2617 13.3272 18.7865 13.3272 19.4162V53.9455Z";
export const MARK_STAR =
  "M18.1689 40.8937C17.9477 40.5251 18.0214 40.0826 18.3901 39.8614L19.7173 39.1241C20.086 38.9029 20.1598 38.9029 20.5284 38.7554L24.2153 37.2069C24.5102 37.1332 24.5102 36.6908 24.2153 36.617L20.5284 35.0686C20.2335 34.9211 20.0123 34.8474 19.7911 34.6999L18.3901 33.9625C18.0214 33.7413 17.9477 33.2989 18.1689 32.9302L20.0123 29.7595C20.2335 29.3909 20.6022 29.2434 20.9709 29.4646L22.3719 30.2757C22.7405 30.4969 22.888 30.6444 23.183 30.8656L26.2799 33.2252C26.5011 33.4464 26.8698 33.2989 26.796 32.9302L26.2061 28.9484C26.1324 28.5798 26.1324 28.3585 26.1324 28.0636V26.5151C26.1324 26.0727 26.4274 25.7778 26.8698 25.7778H30.5566C30.999 25.7778 31.294 26.0727 31.294 26.5151V28.0636C31.294 28.3585 31.294 28.5798 31.2202 28.9484L30.6303 32.9302C30.5566 33.2989 30.9253 33.4464 31.1465 33.2252L34.4646 30.7181C34.7596 30.4969 34.8333 30.4232 35.202 30.202L36.4555 29.4646C36.8242 29.2434 37.1929 29.3909 37.4141 29.7595L39.2575 32.9302C39.4787 33.2989 39.405 33.7413 39.0363 33.9625L37.6353 34.6999C37.3403 34.8474 37.1191 34.9948 36.7505 35.1423L33.2111 36.617C32.9162 36.6908 32.8424 37.1332 33.1374 37.2069L36.8242 38.7554L37.6353 39.1241L39.0363 39.8614C39.405 40.0826 39.4787 40.5251 39.2575 40.8937L37.4141 44.0644C37.1929 44.4331 36.8242 44.5806 36.4555 44.3594L35.1283 43.622C34.7596 43.4008 34.5384 43.1796 34.2434 42.9584L31.1465 40.5988C30.9253 40.3776 30.5566 40.5251 30.6303 40.8937L31.2202 44.8755C31.294 45.2442 31.294 45.4654 31.294 45.7603V47.3088C31.294 47.7512 30.999 48.0462 30.5566 48.0462H26.8698C26.4274 48.0462 26.1324 47.7512 26.1324 47.3088V45.7603C26.1324 45.4654 26.1324 45.2442 26.2061 44.8755L26.796 40.8937C26.8698 40.5251 26.5011 40.3776 26.2799 40.5988L23.0355 43.0321C22.7405 43.2533 22.5193 43.4745 22.2244 43.622L20.9709 44.3594C20.6022 44.5806 20.2335 44.4331 20.0123 44.0644L18.1689 40.8937Z";

/** The mark at (x, y), `height` tall. `starCls` animates the asterisk. */
export function mark(
  x: number,
  y: number,
  height: number,
  o: { fill?: string; starCls?: string } = {},
) {
  const { fill = c.white, starCls } = o;
  const s = height / 73.4667;
  return `<g transform="translate(${x} ${y}) scale(${r3(s)})" fill="${fill}"><path d="${MARK_FRAME}"/><path${starCls ? ` class="${starCls}"` : ""} d="${MARK_STAR}"/></g>`;
}

// ── Document ──────────────────────────────────────────────────────────────

export function svg(o: {
  width: number;
  height: number;
  title: string;
  desc: string;
  css: string;
  defs?: string;
  body: string;
  radius?: number;
  /** The hairline around the edge. Off for images that are cropped to the edge. */
  border?: boolean;
}): string {
  const { width: w, height: h, radius = 24, border = true } = o;
  const edge = border
    ? `\n<rect x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" rx="${radius - 0.5}" stroke="${c.lineStrong}"/>`
    : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" fill="none" role="img" aria-labelledby="t d">
<title id="t">${o.title}</title>
<desc id="d">${o.desc}</desc>
<style>${o.css}</style>
<defs><clipPath id="frame"><rect width="${w}" height="${h}" rx="${radius}"/></clipPath>${takeGlyphDefs()}${o.defs ?? ""}</defs>
<g clip-path="url(#frame)">
<rect width="${w}" height="${h}" fill="${c.bg}"/>
${o.body}
</g>${edge}
</svg>
`;
}
