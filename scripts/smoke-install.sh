#!/usr/bin/env bash
# Installs every 0xui registry item into a fresh shadcn Vite app, renders them
# in App.tsx, and builds. Proves `shadcn add @0xui/<item>` yields code that
# compiles. Run after `bun run registry:build`.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="${SMOKE_DIR:-$(mktemp -d)}"
PORT="${SMOKE_PORT:-4399}"

# Serve the freshly built registry.
bun -e "Bun.serve({ port: $PORT, fetch: (req) => new Response(Bun.file('$ROOT/public' + new URL(req.url).pathname)) })" &
SERVER=$!
trap 'kill $SERVER' EXIT

cd "$WORK"
# stdin from /dev/null: fail instead of hanging if shadcn adds a new prompt.
# 0xui ships its own primitives on ui-sdk, so --base only skips the flavor prompt.
bunx --bun shadcn@latest init --template vite --base base --preset nova \
  --name app --no-monorepo --yes </dev/null
cd app

# Point the @0xui namespace at the local server.
bun -e "
const c = await Bun.file('components.json').json();
c.registries = { '@0xui': 'http://localhost:$PORT/r/{name}.json' };
await Bun.write('components.json', JSON.stringify(c, null, 2));
"

ITEMS=$(bun -e "console.log((await Bun.file('$ROOT/registry.json').json()).items.map(i => '@0xui/' + i.name).join(' '))")
bunx --bun shadcn@latest add $ITEMS --yes --overwrite </dev/null

cp "$ROOT/scripts/smoke-app.tsx" src/App.tsx
bun run build
echo "Smoke install OK: $ITEMS"
