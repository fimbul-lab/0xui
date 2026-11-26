// Banner C, "Decode": the wordmark and the tagline resolve out of hex, over a
// ticker of every component. Block number and gas tick in the corners.
import { Timeline, c, icon, icons, mark, measure, rect, runs, svg, text } from "./lib";

const W = 1280;
const H = 440;
const T = 12;

const components = [
  "wallet-button",
  "connect-wallet",
  "account",
  "sign-message",
  "chain-selector",
  "network-guard",
  "chain-badge",
  "block-number",
  "gas-price",
  "address",
  "address-input",
  "address-avatar",
  "ens-profile",
  "explorer-link",
  "token-input",
  "token-select",
  "amount-input",
  "balance",
  "token-amount",
  "token-icon",
  "add-token",
  "nft-card",
  "transaction-button",
  "approve-button",
  "batch-transaction",
  "transaction-status",
  "transaction-toast",
  "transaction-history",
  "contract-form",
  "event-feed",
  "copy-button",
  "swap",
  "send",
  "portfolio",
];

// A fixed sequence, so the file is the same on every build.
function hexStream(seed: number) {
  let state = seed;
  let last = "";
  return () => {
    let ch = last;
    while (ch === last) {
      state = (state * 1664525 + 1013904223) >>> 0;
      ch = "0123456789abcdef"[state >>> 28];
    }
    last = ch;
    return ch;
  };
}

export function bannerC(): string {
  const tl = new Timeline(T, "c");
  const out: Array<string> = [];
  const defs: Array<string> = [];
  const end = 11.4;

  // ── Corners: the chain's pulse ─────────────────────────────────────────
  const label = { family: "mono" as const, size: 14.5, tracking: 0.02, fill: c.gray3 };
  const top = 62;
  const blockEvery = 2;
  const blocks = T / blockEvery;

  const beat = "c-beat";
  tl.rule(
    `@keyframes ${beat}{0%{opacity:.6;transform:scale(1)}70%,100%{opacity:0;transform:scale(3.4)}}.${beat}{animation:${beat} ${blockEvery}s cubic-bezier(0.2,0,0,1) infinite;transform-box:fill-box;transform-origin:center}`,
  );
  out.push(
    `<circle class="${beat}" cx="68" cy="${top - 4.5}" r="3.5" fill="${c.accent}" opacity="0"/>`,
    `<circle cx="68" cy="${top - 4.5}" r="3.5" fill="${c.accent}"/>`,
    text("block", { ...label, x: 82, y: top, fill: c.gray4 }),
  );
  const blockX = 82 + measure("block ", label) + 0.02 * 14.5 * 6;
  for (let i = 0; i < blocks; i++) {
    const cls = tl.show(i * blockEvery, (i + 1) * blockEvery, {
      dy: i ? 5 : 0,
      outDy: -5,
      in: 0.22,
      out: 0.12,
      still: i === 0,
    });
    const number = (24_117_342 + i).toLocaleString("en-US");
    out.push(`<g class="${cls}">${text(number, { ...label, x: blockX, y: top })}</g>`);
  }

  const gas = ["0.928", "0.931", "0.917", "0.942"];
  const gasEvery = T / gas.length;
  gas.forEach((value, i) => {
    const cls = tl.show(i * gasEvery, (i + 1) * gasEvery, {
      dy: i ? 5 : 0,
      outDy: -5,
      in: 0.22,
      out: 0.12,
      still: i === 0,
    });
    out.push(
      `<g class="${cls}">${text(`${value} gwei`, { ...label, x: W - 64, y: top, anchor: "end" })}</g>`,
    );
  });
  const gasW = measure("0.928 gwei", label) + 0.02 * 14.5 * 10;
  out.push(icon(icons.fuel, W - 64 - gasW - 24, top - 13, 15, { stroke: c.gray4 }));

  // ── The wordmark ───────────────────────────────────────────────────────
  const big = { family: "mono" as const, size: 152, weight: 600, tracking: -0.02 };
  const adv = measure("0", big) + big.tracking * big.size;
  const cap = 0.71 * big.size;
  const markH = cap + 10;
  const markW = (58 / 73.4667) * markH;
  const gap = 34;
  const total = markW + gap + adv * 4;
  const left = (W - total) / 2;
  const base = 242;
  const textX = left + markW + gap;

  // The asterisk ticks round a sixth of a turn as each letter lands.
  const landU = 1.25;
  const landI = 1.7;
  const tick = "cubic-bezier(0.3,1.4,0.5,1)";
  const star = tl.track(
    [
      [0, "transform:rotate(0deg)"],
      [landU, "transform:rotate(0deg)", tick],
      [landU + 0.5, "transform:rotate(60deg)"],
      [landI, "transform:rotate(60deg)", tick],
      [landI + 0.5, "transform:rotate(120deg)"],
    ],
    { extra: "transform-box:fill-box;transform-origin:center;" },
  );
  out.push(
    mark(left, base - cap - 5, markH, { starCls: star }),
    text("0x", { ...big, x: textX, y: base, fill: c.gray3 }),
  );

  // Two slots run through hex digits, slowing, then land on `u` and `i`.
  const slot = (index: number, final: string, land: number, seed: number) => {
    const next = hexStream(seed);
    const x = textX + adv * (2 + index);
    let t = 0;
    let step = 0.055;
    while (t < land - 0.001) {
      const until = Math.min(t + step, land);
      const cls = tl.show(t, until, { in: 0.001, out: 0.001 });
      out.push(`<g class="${cls}">${text(next(), { ...big, x, y: base, fill: c.gray5 })}</g>`);
      t = until;
      step *= 1.13;
    }
    // Lands white, and scrambles away again just before the loop.
    const landed = tl.show(land, end, { in: 0.001, out: 0.001, still: true });
    out.push(`<g class="${landed}">${text(final, { ...big, x, y: base })}</g>`);
    const tail = tl.show(end, T, { in: 0.001, out: 0.001 });
    out.push(`<g class="${tail}">${text(next(), { ...big, x, y: base, fill: c.gray5 })}</g>`);
  };
  slot(0, "u", landU, 7);
  slot(1, "i", landI, 23);

  // ── The tagline, decoded left to right ─────────────────────────────────
  const line = "Web3 components you own.";
  const tag = { family: "mono" as const, size: 21, weight: 500 };
  const tagAdv = measure("0", tag);
  const tagX = (W - tagAdv * line.length) / 2;
  const tagY = 312;
  const start = 2;
  const next = hexStream(101);
  Array.from(line).forEach((ch, i) => {
    if (ch === " ") return;
    const x = tagX + tagAdv * i;
    const from = start + i * 0.04;
    const frames = 5;
    const each = 0.07;
    for (let f = 0; f < frames; f++) {
      const cls = tl.show(from + f * each, from + (f + 1) * each, { in: 0.001, out: 0.001 });
      out.push(`<g class="${cls}">${text(next(), { ...tag, x, y: tagY, fill: c.gray4 })}</g>`);
    }
    const cls = tl.show(from + frames * each, end, { in: 0.001, out: 0.25, still: true });
    out.push(`<g class="${cls}">${text(ch, { ...tag, x, y: tagY })}</g>`);
  });

  const sub = tl.show(3.5, end, { dy: 6, in: 0.5, out: 0.25, still: true });
  out.push(
    `<g class="${sub}">`,
    text("React components for wallets, tokens and transactions, copied into your app as source.", {
      size: 17.5,
      fill: c.gray3,
      x: W / 2,
      y: 346,
      anchor: "middle",
    }),
    `</g>`,
  );

  // ── The ticker ─────────────────────────────────────────────────────────
  const rowY = 384;
  const name = { family: "mono" as const, size: 14.5, fill: c.gray3 };
  const rowBase = rowY + (H - rowY) / 2 + 4.6;
  const parts: Array<[string, object?]> = [];
  for (const item of components) parts.push([item], ["   /   ", { fill: c.gray5 }]);
  const once = runs(parts, { ...name, x: 0, y: rowBase });
  const speed = 34;
  const scroll = "c-scroll";
  tl.rule(
    `@keyframes ${scroll}{to{transform:translateX(${-Math.round(once.width * 100) / 100}px)}}.${scroll}{animation:${scroll} ${Math.round(once.width / speed)}s linear infinite}`,
  );
  defs.push(
    `<g id="c-names">${once.svg}</g>`,
    `<linearGradient id="c-fade" x1="0" x2="1" y1="0" y2="0"><stop offset="0" stop-color="${c.bg}"/><stop offset="1" stop-color="${c.bg}" stop-opacity="0"/></linearGradient>`,
  );
  out.push(
    `<path d="M0 ${rowY + 0.5}H${W}" stroke="${c.line}"/>`,
    `<g class="${scroll}"><use href="#c-names" x="64"/><use href="#c-names" x="${64 + once.width}"/></g>`,
    rect(0, rowY + 1, 150, H - rowY - 1, { fill: "url(#c-fade)" }),
    `<g transform="translate(${W} 0) scale(-1 1)">${rect(0, rowY + 1, 150, H - rowY - 1, { fill: "url(#c-fade)" })}</g>`,
  );

  return svg({
    width: W,
    height: H,
    title: "0xui: Web3 components you own.",
    desc: "The 0xui wordmark and its tagline resolve out of scrambling hex digits, above a ticker of every component name. A block number and a gas price tick in the corners.",
    css: tl.css(),
    defs: defs.join(""),
    body: out.join("\n"),
  });
}
