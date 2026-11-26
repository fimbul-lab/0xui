// Banner A, "Hero": the docs hero, played as a loop. The install command
// types, the swap block lands in the stage, and a swap runs to confirmed.
import { EASE, Timeline, c, icon, icons, measure, rect, runs, svg, text } from "./lib";

const W = 1280;
const H = 540;
const T = 14;

const eth = (x: number, y: number) =>
  `<g transform="translate(${x} ${y})"><circle r="13" fill="${c.gray5}"/><path d="M0-8.6 5.3.4 0 3.5Z" fill="#6f7cf0"/><path d="M0-8.6-5.3.4 0 3.5Z" fill="#a9b2ff"/><path d="M0 4.9 5.3 1.8 0 9.2Z" fill="#6f7cf0"/><path d="M0 4.9-5.3 1.8 0 9.2Z" fill="#a9b2ff"/></g>`;
const usdc = (x: number, y: number) =>
  `<g transform="translate(${x} ${y})"><circle r="13" fill="#2775ca"/>${text("$", { size: 15, weight: 600, x: 0, y: 5.3, anchor: "middle" })}<path d="M-3.4-9.3a9.9 9.9 0 0 0 0 18.6M3.4-9.3a9.9 9.9 0 0 1 0 18.6" stroke="#fff" stroke-width="1.5" stroke-linecap="round"/></g>`;

export function bannerA(): string {
  const tl = new Timeline(T, "a");
  const out: Array<string> = [];
  const defs: Array<string> = [];

  // Beats, in seconds.
  const typeFrom = 0.7;
  const typeTo = 2.3;
  const enter = 2.6;
  const land = 2.9;
  const amount = 4.5;
  const quoted = 5.3;
  const click = 6.5;
  const pending = 8.2;
  const done = 10.4;
  const leave = 12.9;

  // ── Left: copy ─────────────────────────────────────────────────────────
  const x0 = 64;

  const pulse = "a-pulse";
  tl.rule(
    `@keyframes ${pulse}{0%{opacity:.6;transform:scale(1)}70%,100%{opacity:0;transform:scale(3.4)}}.${pulse}{animation:${pulse} 2.4s ${EASE} infinite;transform-box:fill-box;transform-origin:center}`,
  );
  out.push(
    `<circle class="${pulse}" cx="${x0 + 4}" cy="113" r="3.5" fill="${c.accent}" opacity="0"/>`,
    `<circle cx="${x0 + 4}" cy="113" r="3.5" fill="${c.accent}"/>`,
  );
  const mono = { family: "mono" as const, size: 16, fill: c.gray3, y: 118 };
  const sep: [string, object] = [" / ", { fill: c.gray5 }];
  out.push(
    runs([["wagmi"], sep, ["viem"], sep, ["Base UI"], sep, ["Tailwind v4"]], {
      ...mono,
      x: x0 + 18,
    }).svg,
  );

  const h1 = { size: 72, weight: 600, tracking: -0.045, x: x0 - 3 };
  out.push(text("Web3 components", { ...h1, y: 206 }), text("you own.", { ...h1, y: 278 }));

  const tag = { size: 20, fill: c.gray3, x: x0 };
  out.push(
    text("React components for wallets, tokens and transactions,", { ...tag, y: 328 }),
    text("copied into your app as source.", { ...tag, y: 358 }),
  );

  // Command pill.
  const command = "npx shadcn@latest add @0xui/swap";
  const cmd = { family: "mono" as const, size: 16 };
  const advance = measure("0", cmd);
  const cmdW = advance * command.length;
  const pill = { x: x0, y: 398, h: 50 };
  const cmdX = pill.x + 18 + advance + 14;
  const pillW = cmdX - pill.x + cmdW + 20 + 18 + 16;
  const base = pill.y + pill.h / 2 + 5.7;
  out.push(
    rect(pill.x + 0.5, pill.y + 0.5, pillW, pill.h, { r: 10, fill: c.surface, stroke: c.line }),
    text("$", { ...cmd, x: pill.x + 18, y: base, fill: c.gray4 }),
    icon(icons.copy, pill.x + pillW - 16 - 17, pill.y + 17, 17, { stroke: c.gray3 }),
  );

  // The command is always drawn; a cover the colour of the pill steps off it.
  const n = command.length;
  const typed = `transform:translateX(${cmdW}px)`;
  const cover = tl.track(
    [
      [0, "transform:translateX(0)"],
      [typeFrom, "transform:translateX(0)", `steps(${n},end)`],
      [typeTo, typed],
      [leave + 0.2, typed, `steps(${n},end)`],
      [leave + 0.6, "transform:translateX(0)"],
    ],
    { still: typed },
  );
  const blink = tl.track(
    [
      [0, "opacity:1"],
      [0.34, "opacity:1", "steps(1,end)"],
      [0.35, "opacity:0"],
      [0.69, "opacity:0", "steps(1,end)"],
      [0.7, "opacity:1"],
      [enter, "opacity:1"],
      [enter + 0.01, "opacity:0"],
      [leave + 0.19, "opacity:0"],
      [leave + 0.2, "opacity:1"],
    ],
    { still: "opacity:0" },
  );
  defs.push(
    `<clipPath id="a-cmd"><rect x="${cmdX - 2}" y="${pill.y + 8}" width="${cmdW + 8}" height="${pill.h - 16}"/></clipPath>`,
  );
  out.push(
    `<g clip-path="url(#a-cmd)">`,
    runs(
      [
        ["npx", { fill: c.gray2 }],
        [" shadcn@latest add ", { fill: c.gray2 }],
        ["@0xui/swap", { fill: c.white }],
      ],
      { ...cmd, x: cmdX, y: base },
    ).svg,
    `<g class="${cover}">`,
    rect(cmdX, pill.y + 8, cmdW + 8, pill.h - 16, { fill: c.surface }),
    rect(cmdX + 1, pill.y + 15, 1.5, 20, { fill: c.white, cls: blink }),
    `</g></g>`,
  );

  // What the CLI wrote, under the pill.
  const wrote = tl.show(enter + 0.3, leave, { dy: 6, still: true });
  out.push(
    `<g class="${wrote}">`,
    icon(icons.check, x0 + 1, 468, 15, { stroke: c.accent, sw: 2.5 }),
    runs(
      [
        ["components/swap.tsx", { fill: c.gray2 }],
        ["  in your repo, yours to edit", { fill: c.gray4 }],
      ],
      { family: "mono", size: 14.5, x: x0 + 26, y: 481 },
    ).svg,
    `</g>`,
  );

  // ── Right: the stage ───────────────────────────────────────────────────
  const stage = { x: 736, y: 36, w: 480, h: 468 };
  const pad = 20;
  const cx = stage.x + pad;
  const cw = stage.w - pad * 2;
  const label = { family: "mono" as const, size: 14, tracking: 0.04, fill: c.gray3 };
  out.push(
    rect(stage.x + 0.5, stage.y + 0.5, stage.w, stage.h, { r: 14, stroke: c.line }),
    text("blocks/swap", { ...label, x: stage.x + 18, y: stage.y + 29 }),
  );
  const live = tl.show(land + 0.5, leave, { still: true });
  out.push(
    `<g class="${live}">`,
    text("live", { ...label, x: stage.x + stage.w - 18, y: stage.y + 29, anchor: "end" }),
    `</g>`,
  );

  const panelH = 112;
  const payY = stage.y + 92;
  const getY = payY + panelH + 6;
  const btnY = getY + panelH + 22;
  const btnH = 46;

  // Empty slots until the block lands.
  const slots = tl.track(
    [
      [0, "opacity:1"],
      [land, "opacity:1", "ease-in"],
      [land + 0.25, "opacity:0"],
      [leave + 0.45, "opacity:0", EASE],
      [leave + 0.85, "opacity:1"],
    ],
    { still: "opacity:0" },
  );
  const dash = `stroke-dasharray="3 7" stroke-linecap="round"`;
  out.push(
    `<g class="${slots}">`,
    rect(cx + 0.5, payY + 0.5, cw - 1, panelH - 1, { r: 18, stroke: c.lineStrong, extra: dash }),
    rect(cx + 0.5, getY + 0.5, cw - 1, panelH - 1, { r: 18, stroke: c.lineStrong, extra: dash }),
    rect(cx + 0.5, btnY + 0.5, cw - 1, btnH - 1, { r: 10, stroke: c.lineStrong, extra: dash }),
    `</g>`,
  );

  const piece = (i: number) => tl.show(land + i * 0.09, leave, { dy: 12, in: 0.45, still: true });

  // Title.
  out.push(
    `<g class="${piece(0)}">`,
    text("Swap", { size: 19, weight: 600, tracking: -0.02, x: cx + 2, y: stage.y + 72 }),
    `</g>`,
  );

  const chip = (y: number, symbol: string, token: (x: number, y: number) => string) => {
    const tw = measure(symbol, { size: 15, weight: 600 });
    const w = 8 + 26 + 9 + tw + 8 + 14 + 12;
    const x = cx + cw - 16 - w;
    return [
      rect(x + 0.5, y + 0.5, w, 42, { r: 21, fill: c.surface2, stroke: c.lineStrong }),
      token(x + 8 + 13, y + 21.5),
      text(symbol, { size: 15, weight: 600, x: x + 8 + 26 + 9, y: y + 26.5, fill: c.gray1 }),
      icon(icons.chevronDown, x + w - 12 - 15, y + 14.5, 15, { stroke: c.gray3 }),
    ].join("");
  };

  const amountText = { size: 30, weight: 500, tracking: -0.02 };

  // You pay.
  const ax = cx + 18;
  const payBase = payY + 74;
  const typing = [
    ["1", amount, amount + 0.13],
    ["1.", amount + 0.13, amount + 0.26],
    ["1.5", amount + 0.26, leave],
  ] as const;
  out.push(
    `<g class="${piece(1)}">`,
    rect(cx + 0.5, payY + 0.5, cw - 1, panelH - 1, { r: 18, fill: c.surface, stroke: c.line }),
    text("You pay", { size: 15, fill: c.gray3, x: ax, y: payY + 33 }),
    `<g class="${tl.show(0, amount, { out: 0.01 })}">`,
    text("0", { ...amountText, x: ax, y: payBase, fill: c.gray4 }),
    `</g>`,
    ...typing.map(
      ([str, from, to], i) =>
        `<g class="${tl.show(from, to, { in: 0.01, out: to === leave ? 0.2 : 0.01, still: i === 2 })}">${text(str, { ...amountText, x: ax, y: payBase })}</g>`,
    ),
    `<g class="${tl.show(amount + 0.4, leave, { dy: 4, still: true })}">`,
    text("$4,816.20", { size: 14, fill: c.gray3, x: ax, y: payY + 97 }),
    `</g>`,
    chip(payY + 35, "ETH", eth),
    `</g>`,
  );

  // You receive.
  const getBase = getY + 74;
  out.push(
    `<g class="${piece(2)}">`,
    rect(cx + 0.5, getY + 0.5, cw - 1, panelH - 1, { r: 18, fill: c.surface, stroke: c.line }),
    text("You receive", { size: 15, fill: c.gray3, x: ax, y: getY + 33 }),
    `<g class="${tl.show(0, quoted, { out: 0.12 })}">`,
    text("0", { ...amountText, x: ax, y: getBase, fill: c.gray4 }),
    `</g>`,
    `<g class="${tl.show(quoted, leave, { dy: 6, still: true })}">`,
    text("4,812.60", { ...amountText, x: ax, y: getBase }),
    text("1 ETH = 3,208.40 USDC", { size: 14, fill: c.gray3, x: ax, y: getY + 97 }),
    `</g>`,
    chip(getY + 35, "USDC", usdc),
    `</g>`,

    // Switch tokens.
    `<g class="${piece(3)}">`,
    rect(cx + cw / 2 - 18, payY + panelH + 3 - 18, 36, 36, {
      r: 11,
      fill: c.surface2,
      stroke: c.bg,
      sw: 4,
    }),
    icon(icons.arrowUpDown, cx + cw / 2 - 8, payY + panelH + 3 - 8, 16, { stroke: c.gray1 }),
    `</g>`,
  );

  // The button, and the line under it.
  const dim = tl.track(
    [
      [0, "opacity:.45"],
      [quoted, "opacity:.45", EASE],
      [quoted + 0.2, "opacity:1"],
      [click, "opacity:1", EASE],
      [click + 0.2, "opacity:.6"],
      [done, "opacity:.6", EASE],
      [done + 0.2, "opacity:1"],
    ],
    { still: "opacity:1" },
  );
  const press = tl.track(
    [
      [click - 0.14, "transform:scale(1)", EASE],
      [click - 0.02, "transform:scale(.98)", EASE],
      [click + 0.18, "transform:scale(1)"],
    ],
    { extra: "transform-box:fill-box;transform-origin:center;" },
  );
  const ink = c.gray6;
  const btnText = { size: 16, weight: 500, fill: ink };
  const mid = cx + cw / 2;
  const btnBase = btnY + btnH / 2 + 5.3;
  const morph = (from: number, to: number, still = false) =>
    tl.show(from ? from + 0.08 : 0, to, { dy: 7, outDy: -7, in: 0.28, out: 0.14, still });
  const spin = "a-spin";
  tl.rule(
    `@keyframes ${spin}{to{transform:rotate(360deg)}}.${spin}{animation:${spin} .9s linear infinite;transform-box:fill-box;transform-origin:center}`,
  );
  const withIcon = (str: string, paths: string, cls?: string, stroke = ink) => {
    const tw = measure(str, btnText);
    const x = mid - (tw + 16 + 8) / 2;
    return (
      icon(paths, x, btnY + btnH / 2 - 8, 16, { stroke, sw: 2.25, cls }) +
      text(str, { ...btnText, x: x + 24, y: btnBase })
    );
  };
  const centered = (str: string) => text(str, { ...btnText, x: mid, y: btnBase, anchor: "middle" });

  out.push(
    `<g class="${piece(4)}"><g class="${press}">`,
    `<g class="${dim}">`,
    rect(cx, btnY, cw, btnH, { r: 10, fill: c.gray1 }),
    `</g>`,
    `<g class="${dim}">`,
    `<g class="${morph(0, amount + 0.3)}">${centered("Enter an amount")}</g>`,
    `<g class="${morph(amount + 0.3, quoted)}">${centered("Fetching quote…")}</g>`,
    `<g class="${morph(quoted, click, true)}">${centered("Swap")}</g>`,
    `<g class="${morph(click, pending)}">${withIcon("Confirm in wallet…", icons.loader, spin)}</g>`,
    `<g class="${morph(pending, done)}">${withIcon("Pending…", icons.loader, spin)}</g>`,
    `<g class="${morph(done, leave)}">${withIcon("Done", icons.check)}</g>`,
    `</g>`,
    `</g></g>`,
  );

  const status = {
    size: 14.5,
    fill: c.gray3,
    x: mid,
    y: btnY + btnH + 30,
    anchor: "middle" as const,
  };
  const line = (from: number, to: number) => tl.show(from, to, { dy: 4, in: 0.25, out: 0.15 });
  out.push(
    `<g class="${line(click + 0.1, pending)}">${text("Confirm the transaction in your wallet.", status)}</g>`,
    `<g class="${line(pending + 0.1, done)}">${text("Transaction submitted. Waiting for confirmation…", status)}</g>`,
    `<g class="${line(done + 0.1, leave)}">${text("Transaction confirmed.", status)}</g>`,
  );

  return svg({
    width: W,
    height: H,
    title: "0xui: Web3 components you own.",
    desc: "The install command types itself, the swap block lands in its stage, and a swap runs from quote to confirmed.",
    css: tl.css(),
    defs: defs.join(""),
    body: out.join("\n"),
  });
}
