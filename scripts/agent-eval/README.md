# Agent eval

Checks that a coding agent can build with 0xui. For each task in `tasks.ts`, the harness:

1. Scaffolds a fresh shadcn Vite app on Base UI (once per run, copied per task), points `@0xui` in `components.json` at a local server for `public/r`, and copies `skills/0xui/SKILL.md` to `.claude/skills/0xui/SKILL.md`.
2. Runs `claude -p "<prompt>"` headless in the app with `bypassPermissions`. Only the app's own settings and skill load: no user `CLAUDE.md`, skills, plugins or MCP servers.
3. Grades the app.

## Run locally

Needs `bun`, the `claude` CLI (logged in, or `ANTHROPIC_API_KEY` set) and network access for package installs.

```sh
bun run registry:build
bun run eval:agents                                  # all tasks, claude-sonnet-5-5
bun run eval:agents --task header-balance --model claude-haiku-5-5 --keep
```

| Flag              | Default                           |                                      |
| ----------------- | --------------------------------- | ------------------------------------ |
| `--task <id>`     | all                               | Repeat or comma-separate for several |
| `--model <id>`    | `claude-sonnet-5-5`               |                                      |
| `--keep`          | off                               | Keep the app dirs to inspect         |
| `--timeout <min>` | 20                                | Per agent run                        |
| `--budget <usd>`  | 5                                 | Per agent run (`--max-budget-usd`)   |
| `--out <dir>`     | `<tmp>/0xui-agent-eval-*/results` | Results directory                    |

Apps live under the OS temp dir, never in the repo. The exit code is 0 when every task passes, 1 when one fails, 2 when the harness errors.

## What's graded

A task passes when all four checks pass:

- **Build**: `bun run build` (`tsc -b && vite build`) succeeds.
- **Items**: every item in one of the task's `expect` groups is installed (its registry files exist in the app) and imported by app code. App code is `src/` minus `components/ui/` and files the registry wrote.
- **Forbidden**: none of the task's `forbid` patterns match app code, like a hand-rolled `useWriteContract` where `transaction-button` fits.
- **Provider**: app code uses `Web3Provider` or `WagmiProvider`.

Also recorded, not graded: whether the agent loaded the 0xui skill, its `shadcn add` commands, tool calls, turns, cost and duration.

## Output

`--out` holds `results.json`, `summary.md`, and per task `result.json`, `transcript.jsonl` (stream-json), `build.log` and `diff.patch` (every change the agent made, lockfiles excluded).

CI: `.github/workflows/agent-eval.yml` runs only when started by hand from the Actions tab (model and task inputs), with `ANTHROPIC_API_KEY` from repo secrets. Run it after changing the skill, the docs or the registry. It uploads the results directory and writes `summary.md` to the job summary.
