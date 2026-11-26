// Banner B, "Every state": one transaction-button walks through its phases
// while a marker follows along in the exported `TxPhase` union.
import { EASE, Timeline, c, icon, icons, mark, measure, rect, runs, svg, text } from "./lib";

const W = 1280;
const H = 500;
const T = 18;

type Phase =
  | "idle"
  | "switching"
  | "confirming"
  | "pending"
  | "success"
  | "reverted"
  | "cancelled"
  | "error";

// Column by column, the order the union is declared in.
const members: Array<Phase> = [
  "idle",
  "switching",
  "confirming",
  "pending",
  "success",
  "reverted",
  "cancelled",
  "error",
];

type Beat = {
  phase: Phase;
  from: number;
  label: string;
  busy?: boolean;
  check?: boolean;
  /** Line under the button. */
  status?: string;
  alert?: boolean;
};

// Labels and status lines are the ones transaction-button.tsx renders.
const send = "Send 0.01 ETH";
const confirming: Omit<Beat, "from"> = {
  phase: "confirming",
  label: "Confirm in wallet…",
  busy: true,
  status: "Confirm the transaction in your wallet.",
};
const pending: Omit<Beat, "from"> = {
  phase: "pending",
  label: "Pending…",
  busy: true,
  status: "Transaction submitted. Waiting for confirmation…",
};
const beats: Array<Beat> = [
  { phase: "idle", from: 0, label: "Switch to Base" },
  {
    phase: "switching",
    from: 1.3,
    label: "Switching network…",
    busy: true,
    status: "Approve the network switch in your wallet.",
  },
  { phase: "idle", from: 2.7, label: send },
  { ...confirming, from: 3.7 },
  { ...pending, from: 5.3 },
  { phase: "success", from: 7.3, label: "Done", check: true, status: "Transaction confirmed." },
  { phase: "idle", from: 9.1, label: send },
  { ...confirming, from: 10.1 },
  { phase: "cancelled", from: 11.5, label: send, status: "Cancelled in wallet." },
  { ...confirming, from: 13.2 },
  { ...pending, from: 14.2 },
  {
    phase: "reverted",
    from: 15.4,
    label: send,
    status: "Transaction reverted. Nothing changed except the gas fee.",
    alert: true,
  },
];
// A click starts every beat that follows an enabled button.
const clicks = [1.3, 3.7, 10.1, 13.2];

export function bannerB(): string {
  const tl = new Timeline(T, "b");
  const out: Array<string> = [];
  const until = (i: number) => beats[i + 1]?.from ?? T;

  // ── Left: copy ─────────────────────────────────────────────────────────
  const x0 = 64;
  const word = { family: "mono" as const, size: 17, weight: 600, tracking: -0.02, y: 112 };
  out.push(
    mark(x0, 93, 24),
    runs([["0x", { fill: c.gray3 }], ["ui"]], { ...word, x: x0 + 30 }).svg,
  );

  const h1 = { size: 66, weight: 600, tracking: -0.045, x: x0 - 3 };
  out.push(text("Every state", { ...h1, y: 216 }), text("a wallet produces.", { ...h1, y: 282 }));

  const sub = { size: 19, fill: c.gray3, x: x0 };
  out.push(
    text("Pending, cancelled in wallet, wrong network, error.", { ...sub, y: 334 }),
    text("Each one designed, named, and exported as a type.", { ...sub, y: 364 }),
  );

  // The hook, for the headless route.
  const code = { family: "mono" as const, size: 15.5 };
  const pill = { x: x0, y: 400, h: 46 };
  const snippet = runs(
    [
      ["const ", { fill: c.gray4 }],
      ["{ phase }", { fill: c.white }],
      [" = ", { fill: c.gray4 }],
      ["useTransactionFlow", { fill: c.gray1 }],
      ["()", { fill: c.gray4 }],
    ],
    { ...code, x: pill.x + 18, y: pill.y + pill.h / 2 + 5.5 },
  );
  out.push(
    rect(pill.x + 0.5, pill.y + 0.5, snippet.width + 36, pill.h, {
      r: 10,
      fill: c.surface,
      stroke: c.line,
    }),
    snippet.svg,
  );

  // ── Right: the stage ───────────────────────────────────────────────────
  const stage = { x: 716, y: 36, w: 500, h: 428 };
  const label = { family: "mono" as const, size: 14, tracking: 0.04, fill: c.gray3 };
  const tagY = stage.y + 29;
  out.push(
    rect(stage.x + 0.5, stage.y + 0.5, stage.w, stage.h, { r: 14, stroke: c.line }),
    text("transaction-button", { ...label, x: stage.x + 18, y: tagY }),
  );

  // data-phase="…", top right. The value is right-aligned, so the attribute
  // name moves with it: draw the whole string per beat.
  const right = stage.x + stage.w - 18;
  beats.forEach((beat, i) => {
    const value = `"${beat.phase}"`;
    const full = `data-phase=${value}`;
    const width = measure(full, label) + 0.04 * 14;
    const cls = tl.show(beat.from, until(i), { in: 0.01, out: 0.01, still: i === 4 });
    out.push(
      `<g class="${cls}">`,
      runs(
        [
          ["data-phase=", { fill: c.gray4 }],
          [value, { fill: c.gray1 }],
        ],
        {
          ...label,
          x: right - width,
          y: tagY,
        },
      ).svg,
      `</g>`,
    );
  });

  // The button.
  const mid = stage.x + stage.w / 2;
  const btn = { w: 264, h: 48, y: stage.y + 92 };
  const btnX = mid - btn.w / 2;
  const ink = c.gray6;
  const btnText = { size: 16, weight: 500, fill: ink };
  const base = btn.y + btn.h / 2 + 5.5;

  const dimStops: Array<[number, string, string?]> = [];
  beats.forEach((beat, i) => {
    const value = `opacity:${beat.busy ? 0.55 : 1}`;
    if (i > 0) {
      dimStops.push([beat.from + 0.2, value]);
    } else {
      dimStops.push([0, value]);
    }
    dimStops.push([until(i), value, EASE]);
  });
  const dim = tl.track(dimStops, { still: "opacity:.55" });

  const pressStops: Array<[number, string, string?]> = [[0, "transform:scale(1)"]];
  for (const t of clicks) {
    pressStops.push(
      [t - 0.16, "transform:scale(1)", EASE],
      [t - 0.03, "transform:scale(.97)", EASE],
      [t + 0.2, "transform:scale(1)"],
    );
  }
  const press = tl.track(pressStops, { extra: "transform-box:fill-box;transform-origin:center;" });

  const spin = "b-spin";
  tl.rule(
    `@keyframes ${spin}{to{transform:rotate(360deg)}}.${spin}{animation:${spin} .9s linear infinite;transform-box:fill-box;transform-origin:center}`,
  );

  out.push(
    `<g class="${press}">`,
    `<g class="${dim}">${rect(btnX, btn.y, btn.w, btn.h, { r: 11, fill: c.gray1 })}</g>`,
    `<g class="${dim}">`,
  );
  beats.forEach((beat, i) => {
    // The same label twice in a row stays put instead of morphing.
    if (beats[i - 1]?.label === beat.label) {
      return;
    }
    let end = i;
    while (beats[end + 1]?.label === beat.label) {
      end++;
    }
    const cls = tl.show(beat.from + (i ? 0.08 : 0), until(end), {
      dy: 7,
      outDy: -7,
      in: 0.28,
      out: 0.14,
      still: i === 4,
    });
    const glyph = beat.busy ? icons.loader : beat.check ? icons.check : undefined;
    if (glyph) {
      const tw = measure(beat.label, btnText);
      const x = mid - (tw + 17 + 8) / 2;
      out.push(
        `<g class="${cls}">`,
        icon(glyph, x, btn.y + btn.h / 2 - 8.5, 17, {
          stroke: ink,
          sw: 2.25,
          cls: beat.busy ? spin : undefined,
        }),
        text(beat.label, { ...btnText, x: x + 25, y: base }),
        `</g>`,
      );
    } else {
      out.push(
        `<g class="${cls}">${text(beat.label, { ...btnText, x: mid, y: base, anchor: "middle" })}</g>`,
      );
    }
  });
  out.push(`</g></g>`);

  // The line under the button.
  beats.forEach((beat, i) => {
    if (!beat.status) {
      return;
    }
    const cls = tl.show(beat.from + 0.1, until(i), { dy: 4, in: 0.25, out: 0.12, still: i === 4 });
    out.push(
      `<g class="${cls}">`,
      text(beat.status, {
        size: 14.5,
        fill: beat.alert ? c.destructive : c.gray3,
        x: mid,
        y: btn.y + btn.h + 32,
        anchor: "middle",
      }),
      `</g>`,
    );
  });

  // The union, under a hairline.
  const ruleY = stage.y + 214;
  out.push(`<path d="M${stage.x + 1} ${ruleY + 0.5}H${stage.x + stage.w}" stroke="${c.line}"/>`);

  const type = { family: "mono" as const, size: 15.5 };
  const tx = stage.x + 30;
  out.push(
    runs(
      [
        ["export type ", { fill: c.gray4 }],
        ["TxPhase", { fill: c.gray1 }],
        [" =", { fill: c.gray4 }],
      ],
      { ...type, x: tx, y: ruleY + 44 },
    ).svg,
  );

  const rowH = 33;
  const colW = 226;
  const rowsTop = ruleY + 84;
  const cell = (phase: Phase) => {
    const i = members.indexOf(phase);
    return { x: tx + Math.floor(i / 4) * colW, y: rowsTop + (i % 4) * rowH };
  };
  const pipe = measure("| ", type);

  // The marker: a soft row highlight with an accent bar, sliding between rows.
  const origin = cell("idle");
  const markerStops: Array<[number, string, string?]> = [];
  beats.forEach((beat, i) => {
    const at = cell(beat.phase);
    const value = `transform:translate(${at.x - origin.x}px,${at.y - origin.y}px)`;
    if (i > 0) {
      markerStops.push([beat.from + 0.32, value]);
    } else {
      markerStops.push([0, value]);
    }
    markerStops.push([until(i), value, EASE]);
  });
  const pendingAt = cell("pending");
  const marker = tl.track(markerStops, {
    still: `transform:translate(${pendingAt.x - origin.x}px,${pendingAt.y - origin.y}px)`,
  });
  out.push(
    `<g class="${marker}">`,
    rect(origin.x - 14, origin.y - 21, colW - 20, rowH - 3, { r: 8, fill: c.surface2 }),
    rect(origin.x - 14, origin.y - 15, 2.5, rowH - 15, { r: 1.25, fill: c.accent }),
    `</g>`,
  );

  for (const phase of members) {
    const at = cell(phase);
    out.push(
      text("|", { ...type, x: at.x, y: at.y, fill: c.gray5 }),
      text(`"${phase}"`, { ...type, x: at.x + pipe, y: at.y, fill: c.gray3 }),
    );
    // Brighter while it is the current phase.
    const stops: Array<[number, string, string?]> = [];
    beats.forEach((beat, i) => {
      const value = `opacity:${beat.phase === phase ? 1 : 0}`;
      if (i > 0) {
        stops.push([beat.from + 0.3, value]);
      } else {
        stops.push([0, value]);
      }
      stops.push([until(i), value, EASE]);
    });
    const lit = tl.track(stops, { still: `opacity:${phase === "pending" ? 1 : 0}` });
    out.push(
      `<g class="${lit}">${text(`"${phase}"`, { ...type, x: at.x + pipe, y: at.y, fill: c.white })}</g>`,
    );
  }

  return svg({
    width: W,
    height: H,
    title: "0xui: every state a wallet produces.",
    desc: "A transaction button moves through switching network, confirm in wallet, pending, done, cancelled and reverted, while a marker follows the matching member of the exported TxPhase type.",
    css: tl.css(),
    body: out.join("\n"),
  });
}
