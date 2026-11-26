// Agent eval: gives Claude Code a fresh shadcn Base UI app with the local
// @0xui registry and the 0xui skill, runs a task, then grades the result.
// Usage: bun scripts/agent-eval/run.ts [--task <id>] [--model <id>] [--keep]
import { spawn } from "node:child_process";
import { createReadStream, existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { requireAll, tasks } from "./tasks.ts";
import type { Task } from "./tasks.ts";

const ROOT = resolve(import.meta.dirname, "../..");

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

type Options = {
  tasks: Array<string>;
  model: string;
  keep: boolean;
  timeoutMin: number;
  budgetUsd: number;
  out?: string;
};

function parseArgs(argv: Array<string>): Options {
  const o: Options = {
    tasks: [],
    model: "claude-sonnet-5-5",
    keep: false,
    timeoutMin: 20,
    budgetUsd: 5,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) {
        throw new Error(`${a} needs a value`);
      }
      return v;
    };
    if (a === "--") {
      continue;
    } else if (a === "--task") {
      o.tasks.push(...next().split(",").filter(Boolean));
    } else if (a === "--model") {
      o.model = next();
    } else if (a === "--keep") {
      o.keep = true;
    } else if (a === "--timeout") {
      o.timeoutMin = Number(next());
    } else if (a === "--budget") {
      o.budgetUsd = Number(next());
    } else if (a === "--out") {
      o.out = resolve(next());
    } else {
      throw new Error(
        `Unknown flag ${a}. Flags: --task <id> --model <id> --keep --timeout <min> --budget <usd> --out <dir>`,
      );
    }
  }
  return o;
}

type RunResult = { code: number | null; output: string; timedOut: boolean };

function run(
  cmd: string,
  args: Array<string>,
  opts: {
    cwd: string;
    timeoutMs?: number;
    env?: NodeJS.ProcessEnv;
    onLine?: (line: string) => void;
  },
): Promise<RunResult> {
  return new Promise((done) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: opts.env ?? process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    let partial = "";
    let timedOut = false;
    child.stdout.on("data", (d: Buffer) => {
      const s = d.toString();
      output += s;
      if (!opts.onLine) {
        return;
      }
      partial += s;
      const lines = partial.split("\n");
      partial = lines.pop() ?? "";
      lines.forEach(opts.onLine);
    });
    child.stderr.on("data", (d: Buffer) => (output += d.toString()));
    const timer = opts.timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          child.kill("SIGTERM");
          setTimeout(() => child.kill("SIGKILL"), 10_000).unref();
        }, opts.timeoutMs)
      : undefined;
    child.on("close", (code) => {
      clearTimeout(timer);
      if (partial && opts.onLine) {
        opts.onLine(partial);
      }
      done({ code, output, timedOut });
    });
  });
}

async function must(cmd: string, args: Array<string>, cwd: string) {
  const r = await run(cmd, args, { cwd });
  if (r.code !== 0) {
    throw new Error(`${cmd} ${args.join(" ")} failed (${r.code}):\n${r.output.slice(-4000)}`);
  }
  return r.output;
}

function serveRegistry(): Promise<{ url: string; close: () => void }> {
  const server = createServer((req, res) => {
    const path = resolve(ROOT, "public", "." + new URL(req.url ?? "/", "http://x").pathname);
    if (!path.startsWith(join(ROOT, "public")) || !existsSync(path)) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    createReadStream(path).pipe(res);
  });
  return new Promise((ok) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      ok({ url: `http://localhost:${port}/r/{name}.json`, close: () => server.close() });
    });
  });
}

async function scaffold(work: string, registryUrl: string) {
  console.log(`Scaffolding a shadcn Vite app (Base UI) in ${work}`);
  await must(
    "bunx",
    [
      "--bun",
      "shadcn@latest",
      "init",
      "--template",
      "vite",
      "--base",
      "base",
      "--preset",
      "nova",
      "--name",
      "app",
      "--no-monorepo",
      "--yes",
    ],
    work,
  );
  const app = join(work, "app");
  const configPath = join(app, "components.json");
  const config: unknown = JSON.parse(await readFile(configPath, "utf8"));
  if (!isRecord(config)) {
    throw new Error(`${configPath} is not a JSON object.`);
  }
  config.registries = { "@0xui": registryUrl };
  await writeFile(configPath, JSON.stringify(config, null, 2) + "\n");
  await mkdir(join(app, ".claude/skills/0xui"), { recursive: true });
  await cp(join(ROOT, "skills/0xui/SKILL.md"), join(app, ".claude/skills/0xui/SKILL.md"));
  if (!existsSync(join(app, ".git"))) {
    await must("git", ["init", "-q"], app);
  }
  await must("git", ["add", "-A"], app);
  await must(
    "git",
    [
      "-c",
      "user.name=eval",
      "-c",
      "user.email=eval@localhost",
      "commit",
      "-qm",
      "scaffold",
      "--no-verify",
    ],
    app,
  );
  return app;
}

type Transcript = {
  toolCalls: number;
  tools: Record<string, number>;
  skillUsed: boolean;
  shadcnAdds: Array<string>;
  costUsd?: number;
  durationMs?: number;
  turns?: number;
  resultSubtype?: string;
  isError?: boolean;
  finalMessage?: string;
};

type ContentBlock = { type: string; id?: string; name?: string; input?: Record<string, unknown> };

function summarizeTool(b: ContentBlock) {
  const i = b.input ?? {};
  const detail = i.command ?? i.file_path ?? i.skill ?? i.url ?? i.pattern ?? "";
  return `${b.name} ${String(detail).replaceAll(/\s+/g, " ").slice(0, 120)}`;
}

/** One line of `claude -p --output-format stream-json`, or undefined when it isn't an object. */
function parseEvent(line: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(line);
    return isRecord(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

/** The content blocks of an assistant event's message. */
function contentBlocks(ev: Record<string, unknown>): Array<ContentBlock> {
  const message = ev.message;
  if (!isRecord(message) || !Array.isArray(message.content)) {
    return [];
  }
  return message.content.flatMap((block: unknown) =>
    isRecord(block) && typeof block.type === "string"
      ? [
          {
            type: block.type,
            id: typeof block.id === "string" ? block.id : undefined,
            name: typeof block.name === "string" ? block.name : undefined,
            input: isRecord(block.input) ? block.input : undefined,
          },
        ]
      : [],
  );
}

function parseTranscript(lines: Array<string>): Transcript {
  const t: Transcript = { toolCalls: 0, tools: {}, skillUsed: false, shadcnAdds: [] };
  const seen = new Set<string>();
  for (const line of lines) {
    const ev = parseEvent(line);
    if (!ev) {
      continue;
    }
    if (ev.type === "assistant") {
      for (const b of contentBlocks(ev)) {
        if (b.type !== "tool_use" || !b.name || (b.id && seen.has(b.id))) {
          continue;
        }
        if (b.id) {
          seen.add(b.id);
        }
        t.toolCalls++;
        t.tools[b.name] = (t.tools[b.name] ?? 0) + 1;
        const input = JSON.stringify(b.input ?? {});
        if (
          (b.name === "Skill" && input.includes("0xui")) ||
          input.includes(".claude/skills/0xui")
        ) {
          t.skillUsed = true;
        }
        const cmd = String(b.input?.command ?? "");
        if (b.name === "Bash" && /shadcn\S*\s+add\b/.test(cmd)) {
          t.shadcnAdds.push(cmd);
        }
      }
    } else if (ev.type === "result") {
      t.costUsd = typeof ev.total_cost_usd === "number" ? ev.total_cost_usd : undefined;
      t.durationMs = typeof ev.duration_ms === "number" ? ev.duration_ms : undefined;
      t.turns = typeof ev.num_turns === "number" ? ev.num_turns : undefined;
      t.resultSubtype = typeof ev.subtype === "string" ? ev.subtype : undefined;
      t.isError = typeof ev.is_error === "boolean" ? ev.is_error : undefined;
      t.finalMessage = typeof ev.result === "string" ? ev.result.slice(0, 2000) : undefined;
    }
  }
  return t;
}

async function listFiles(dir: string, base = dir): Promise<Array<string>> {
  const out: Array<string> = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === ".git" || e.name === "dist") {
      continue;
    }
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      out.push(...(await listFiles(p, base)));
    } else {
      out.push(relative(base, p));
    }
  }
  return out;
}

type Registry = Map<string, Array<string>>; // item name -> file paths relative to registry/default

async function loadRegistry(): Promise<Registry> {
  // The source manifest: the built index leaves out the unlisted items.
  const index: unknown = JSON.parse(await readFile(join(ROOT, "registry.json"), "utf8"));
  if (!isRecord(index) || !Array.isArray(index.items)) {
    throw new Error("registry.json has no items.");
  }
  const items: Array<unknown> = index.items;
  const reg: Registry = new Map();
  for (const item of items) {
    if (!isRecord(item) || typeof item.name !== "string") {
      continue;
    }
    const files: Array<unknown> = Array.isArray(item.files) ? item.files : [];
    reg.set(
      item.name,
      files.flatMap((f) =>
        isRecord(f) && typeof f.path === "string" ? [f.path.replace(/^registry\/[^/]+\//, "")] : [],
      ),
    );
  }
  return reg;
}

const stripExt = (p: string) => p.replace(/\.(tsx?|jsx?)$/, "");

const IMPORT_RE = /(?:from\s*|import\s*\(\s*|import\s+)["']([^"']+)["']/g;

type Check = { pass: boolean; detail: string };

async function grade(app: string, task: Task, reg: Registry, buildLog: string) {
  const files = await listFiles(app);
  // Map each registry file to where shadcn wrote it in the app (src/components/x.tsx etc.).
  const installedAt = (regPath: string) =>
    files.find((f) => f === regPath || f.endsWith("/" + regPath));
  const registryFiles = new Set<string>();
  for (const paths of reg.values()) {
    for (const p of paths) {
      const at = installedAt(p);
      if (at) {
        registryFiles.add(at);
      }
    }
  }
  const appCode = files.filter(
    (f) =>
      /\.(tsx?|jsx?)$/.test(f) &&
      f.startsWith("src/") &&
      !f.startsWith("src/components/ui/") &&
      !registryFiles.has(f),
  );
  const sources = new Map<string, string>();
  for (const f of appCode) {
    sources.set(f, await readFile(join(app, f), "utf8"));
  }

  const imported = new Set<string>();
  for (const [f, src] of sources) {
    for (const m of src.matchAll(IMPORT_RE)) {
      const spec = m[1];
      if (spec === undefined) {
        continue;
      }
      let target: string | undefined;
      if (spec.startsWith("@/")) {
        target = "src/" + spec.slice(2);
      } else if (spec.startsWith(".")) {
        target = relative(app, resolve(app, dirname(f), spec));
      }
      if (target) {
        imported.add(stripExt(target));
      }
    }
  }

  const itemStatus = (name: string) => {
    const paths = reg.get(name);
    if (!paths) {
      return { installed: false, imported: false, note: "not in registry" };
    }
    const at = paths.map(installedAt);
    const installed = at.every(Boolean);
    const isImported = at.some((p) => p && imported.has(stripExt(p)));
    return {
      installed,
      imported: isImported,
      note: installed ? (isImported ? "ok" : "installed, not imported") : "not installed",
    };
  };

  const groups = task.expect.map((g) => ({
    items: g,
    status: Object.fromEntries(g.map((n) => [n, itemStatus(n)])),
  }));
  const passedGroup = groups.find((g) =>
    Object.values(g.status).every((s) => s.installed && s.imported),
  );
  const items: Check = {
    pass: Boolean(passedGroup),
    detail: passedGroup
      ? passedGroup.items.join(" + ")
      : groups
          .map((g) =>
            Object.entries(g.status)
              .map(([n, s]) => `${n}: ${s.note}`)
              .join(", "),
          )
          .join(" | or | "),
  };

  const scan = (rules: Array<{ pattern: string; why: string }>) =>
    rules.flatMap((r) => {
      const re = new RegExp(r.pattern);
      const hits: Array<string> = [];
      for (const [f, src] of sources) {
        src.split("\n").forEach((line, i) => {
          if (re.test(line)) {
            hits.push(`${f}:${i + 1}`);
          }
        });
      }
      return [{ ...r, hits }];
    });

  const forbidden = scan(task.forbid ?? []).filter((r) => r.hits.length);
  const forbid: Check = {
    pass: forbidden.length === 0,
    detail: forbidden.map((r) => `${r.why} (${r.hits.join(", ")})`).join("; ") || "none",
  };
  const missing = scan(requireAll).filter((r) => r.hits.length === 0);
  const required: Check = {
    pass: missing.length === 0,
    detail: missing.map((r) => `missing: ${r.why}`).join("; ") || "ok",
  };
  const build: Check = { pass: buildLog === "", detail: buildLog ? buildLog.slice(-3000) : "ok" };

  return {
    pass: build.pass && items.pass && forbid.pass && required.pass,
    checks: { build, items, forbid, required },
    groups,
    appCode,
  };
}

const mark = (c: Check) => (c.pass ? "pass" : "FAIL");

async function runTask(
  task: Task,
  template: string,
  work: string,
  out: string,
  o: Options,
  reg: Registry,
) {
  const dir = join(work, task.id);
  const app = join(dir, "app");
  const logDir = join(out, task.id);
  await mkdir(logDir, { recursive: true });
  await mkdir(dir, { recursive: true });
  await must("cp", ["-a", template, app], work);

  console.log(`\n[${task.id}] ${task.prompt}`);
  const env = { ...process.env };
  delete env.CLAUDECODE;
  delete env.CLAUDE_CODE_ENTRYPOINT;
  const started = Date.now();
  const lines: Array<string> = [];
  const agent = await run(
    "claude",
    [
      "-p",
      task.prompt,
      "--model",
      o.model,
      "--permission-mode",
      "bypassPermissions",
      "--output-format",
      "stream-json",
      "--verbose",
      // Only the app's own settings and skill: no user CLAUDE.md, skills, plugins or MCP servers.
      "--setting-sources",
      "project,local",
      "--strict-mcp-config",
      "--mcp-config",
      '{"mcpServers":{}}',
      "--no-session-persistence",
      "--max-budget-usd",
      String(o.budgetUsd),
    ],
    {
      cwd: app,
      env,
      timeoutMs: o.timeoutMin * 60_000,
      onLine: (line) => {
        lines.push(line);
        const ev = parseEvent(line);
        if (ev?.type === "assistant") {
          for (const b of contentBlocks(ev)) {
            if (b.type === "tool_use") {
              console.log(`  [${task.id}] ${summarizeTool(b)}`);
            }
          }
        }
      },
    },
  );
  const wallMs = Date.now() - started;
  await writeFile(join(logDir, "transcript.jsonl"), lines.join("\n") + "\n");
  if (agent.code !== 0) {
    await writeFile(join(logDir, "agent-stderr.log"), agent.output.slice(-20_000));
  }
  const transcript = parseTranscript(lines);

  console.log(
    `  [${task.id}] agent done (exit ${agent.code}${agent.timedOut ? ", timed out" : ""}); building`,
  );
  const b = await run("bun", ["run", "build"], { cwd: app, timeoutMs: 10 * 60_000 });
  await writeFile(join(logDir, "build.log"), b.output);
  const graded = await grade(app, task, reg, b.code === 0 ? "" : b.output || `exit ${b.code}`);
  const status = await run("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: app });
  await run("git", ["add", "-A", "--intent-to-add"], { cwd: app });
  const diff = await run("git", ["diff", "--", ".", ":!*.lock", ":!package-lock.json"], {
    cwd: app,
  });
  await writeFile(join(logDir, "diff.patch"), diff.output);

  const result = {
    task: task.id,
    prompt: task.prompt,
    model: o.model,
    pass: graded.pass,
    checks: graded.checks,
    groups: graded.groups,
    agent: {
      exitCode: agent.code,
      timedOut: agent.timedOut,
      wallMs,
      ...transcript,
    },
    changedFiles: status.output
      .split("\n")
      .filter(Boolean)
      .map((l) => l.slice(3)),
    appCode: graded.appCode,
    appDir: o.keep ? app : undefined,
  };
  await writeFile(join(logDir, "result.json"), JSON.stringify(result, null, 2) + "\n");
  console.log(
    `  [${task.id}] ${result.pass ? "PASS" : "FAIL"}: build ${mark(graded.checks.build)}, items ${mark(graded.checks.items)}, forbidden ${mark(graded.checks.forbid)}, provider ${mark(graded.checks.required)}`,
  );
  if (!o.keep) {
    await rm(dir, { recursive: true, force: true });
  }
  return result;
}

type Result = Awaited<ReturnType<typeof runTask>>;

const yn = (b: boolean) => (b ? "✅" : "❌");
const money = (n?: number) => (n === undefined ? "–" : `$${n.toFixed(2)}`);
const mins = (ms?: number) => (ms === undefined ? "–" : `${(ms / 60_000).toFixed(1)}m`);

function summary(results: Array<Result>, o: Options) {
  const rows = results.map((r) => {
    const c = r.checks;
    return `| ${r.task} | ${yn(r.pass)} | ${yn(c.build.pass)} | ${yn(c.items.pass)} | ${yn(c.forbid.pass)} | ${yn(c.required.pass)} | ${r.agent.skillUsed ? "yes" : "no"} | ${r.agent.toolCalls} | ${r.agent.turns ?? "–"} | ${money(r.agent.costUsd)} | ${mins(r.agent.wallMs)} |`;
  });
  const passed = results.filter((r) => r.pass).length;
  const failures = results
    .filter((r) => !r.pass)
    .map((r) => {
      const bad = Object.entries(r.checks)
        .filter(([, c]) => !c.pass)
        .map(([k, c]) => `- ${k}: ${k === "build" ? "see build.log" : c.detail}`);
      const agentNote = r.agent.timedOut
        ? ["- agent timed out"]
        : r.agent.exitCode !== 0
          ? [`- agent exited ${r.agent.exitCode}`]
          : [];
      return [`### ${r.task}`, ...agentNote, ...bad].join("\n");
    });
  return [
    `## 0xui agent eval: ${passed}/${results.length} passed`,
    "",
    `Model \`${o.model}\`. Cost total ${money(results.reduce((s, r) => s + (r.agent.costUsd ?? 0), 0))}.`,
    "",
    "| Task | Pass | Build | Items | Forbidden | Provider | Skill used | Tool calls | Turns | Cost | Duration |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...rows,
    ...(failures.length ? ["", ...failures] : []),
    "",
  ].join("\n");
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  const selected = o.tasks.length ? tasks.filter((t) => o.tasks.includes(t.id)) : tasks;
  const unknown = o.tasks.filter((id) => !tasks.some((t) => t.id === id));
  if (unknown.length) {
    throw new Error(
      `Unknown task ${unknown.join(", ")}. Tasks: ${tasks.map((t) => t.id).join(", ")}`,
    );
  }
  if (!existsSync(join(ROOT, "public/r/registry.json"))) {
    throw new Error("public/r is missing. Run `bun run registry:build` first.");
  }

  const work = await mkdtemp(join(tmpdir(), "0xui-agent-eval-"));
  const out = o.out ?? join(work, "results");
  await mkdir(out, { recursive: true });
  const server = await serveRegistry();
  const results: Array<Result> = [];
  try {
    const reg = await loadRegistry();
    await mkdir(join(work, "template"));
    const template = await scaffold(join(work, "template"), server.url);
    for (const task of selected) {
      results.push(await runTask(task, template, work, out, o, reg));
    }
    if (!o.keep) {
      await rm(join(work, "template"), { recursive: true, force: true });
    }
  } finally {
    server.close();
  }

  const md = summary(results, o);
  await writeFile(
    join(out, "results.json"),
    JSON.stringify({ model: o.model, date: new Date().toISOString(), results }, null, 2) + "\n",
  );
  await writeFile(join(out, "summary.md"), md);
  console.log("\n" + md);
  console.log(`Results: ${out}${o.keep ? `\nApps: ${work}` : ""}`);
  process.exitCode = results.every((r) => r.pass) ? 0 : 1;
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 2;
}
