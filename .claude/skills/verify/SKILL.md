---
name: verify
description: Build/launch/drive recipe for verifying shavtzak changes end-to-end (API + draft-tab UI) in a headless environment.
---

# Verifying shavtzak changes

## Database (no Docker needed)

If Docker is unavailable, run the system Postgres 16 directly on the expected port:

```bash
PGDATA=/var/lib/postgresql/pgdata
mkdir -p $PGDATA && chown postgres:postgres $PGDATA
setpriv --reuid=postgres --regid=postgres --clear-groups /usr/lib/postgresql/16/bin/initdb -D $PGDATA --auth=trust -U postgres
setpriv --reuid=postgres --regid=postgres --clear-groups /usr/lib/postgresql/16/bin/pg_ctl -D $PGDATA \
  -o "-p 55432 -c listen_addresses=localhost -c unix_socket_directories=/var/lib/postgresql" -l $PGDATA/log start
psql -h localhost -p 55432 -U postgres -c "alter user postgres password 'test'"
```

Seed a test DB by running the scheduler suite once, or programmatically via
`scheduler/tests/helpers.ts` (`freshSchema()` + `seedSoldiers()`), then
`generate()`/`persist()` a couple of days.

## Working in a worktree (`.claude/worktrees/<name>`)

A fresh worktree has **no `node_modules` and no `.env`** — install both trees and
copy the env files, or the build is a vendor-only false green (`npm run build`
should transform ~130 modules / ~390 kB, not a handful):

```bash
cp ../../../.env ../../../.env.local .      # from .claude/worktrees/<name>
npm install && (cd scheduler && npm install)
```

`node_modules/playwright` is usually **only in the main repo** — import it by
absolute path from there, not from the worktree.

Bash tool gotcha: the working directory **persists between calls**, so a
`cd scheduler && …` leaves later `npm test` runs in `scheduler/`. Both suites
print a count — root ≈160 tests, scheduler ≈311 — use that to tell which one
actually ran, and `cd` with an absolute path each time.

## API surface

```bash
SCHEDULER_DATABASE_URL='postgres://postgres:test@localhost:55432/shavtzak_test' npx tsx scripts/dev-api.ts  # port 3001
curl 'http://localhost:3001/api/draft?from=2026-09-02&to=2026-09-02'
```

**Gotcha**: `scripts/dev-api.ts`'s minimal .env loader OVERRIDES existing env
vars — if `.env`/`.env.local` holds the Supabase URL, the export above is
silently ignored and dev-api connects to Supabase. Verify which DB you hit
(real names vs `חייל NN` in responses) before trusting results; GETs are safe,
never verify writes that way.

**Port 3001 is often already taken by the owner's own `npm run dev:api`** (check
`lsof -nP -iTCP:3001 -sTCP:LISTEN`, then `ps -o lstart=,command= -p <pid>` — a
command path under the MAIN repo is not yours). Then `curl :3001` silently hits
THEIR Supabase-backed server running THEIR code, so your changes appear absent
and a write would land in production. Never kill it. To verify **writes**,
bypass `dev-api.ts` entirely (it would re-read `.env.local` anyway) and start
your own server on a free port with a 2-line launcher in the scratchpad:

```ts
import { createDevApiServer } from '<worktree>/scripts/dev-api-server.js';
createDevApiServer().listen(3005, () => console.log('dev api on 3005'));
```
```bash
SCHEDULER_DATABASE_URL='postgres://postgres:test@localhost:55432/shavtzak_test' npx tsx $S/dev-api-3005.ts
```

Then point the harness at it by temporarily editing `vite.config.ts`'s proxy
target to 3005 (revert before committing) and run vite on a free port too:
`npx vite --port 5199 --strictPort`.

The local `shavtzak_test` DB is left seeded by the last suite run (60 synthetic
`חייל NN`), which is enough to drive any roster/presence UI.

## UI surface (Clerk-gated)

`src/main.tsx` throws without `VITE_CLERK_PUBLISHABLE_KEY` (git-ignored `.env`),
and real sign-in is impossible headless. Bypass ONLY the Clerk shell: add a
temporary `verify-harness.html` + `src/__verify_harness.tsx` that mounts the
real component under test (e.g. `<DraftSchedule soldiers={[]} />`), run
`npm run dev` (vite 5173 proxies /api → 3001), and drive with Playwright.
Delete the harness files before committing.

Playwright gotcha: `npm i --no-save playwright`, then launch with
`chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })` — the
preinstalled browser revision won't match the npm package's expected one.

On macOS (local dev, not the headless container): launch with
`chromium.launch({ channel: 'chrome', headless: true })` instead. The drive
script must resolve `playwright` from the project's node_modules — run it from
the repo, or import by absolute path
(`<repo>/node_modules/playwright/index.mjs`) if it lives in the scratchpad.

Cleanup: kill only the servers YOU started (by PID or
`kill $(lsof -ti:3001)`) — `pkill -f vite` also kills a dev server the user
has running.

Harness example that worked for an admin tab (מצבת חיילים) — the whole check was
"is this field a closed `<select>` now?", answered without any Clerk login:

```ts
await p.locator('tbody tr').first().click();          // open the edit popup
const el = p.locator('label', { hasText: 'תפקיד' }).first().locator('select, input').first();
console.log(await el.evaluate(n => n.tagName),        // SELECT vs INPUT
            await el.evaluate(n => [...n.options].map(o => o.text)),
            await el.inputValue());
await el.selectOption({ label: 'חמל' });              // and the draft takes it
```

Assert on `tagName` + the option list, not on a screenshot alone — a `<datalist>`
input looks identical in a picture. `await p.locator('datalist').count()` is a
cheap check that the old suggestion-only markup is really gone.

## Gotchas

- The draft tab needs a date with generated rows — fill the first
  `input[type=date]` (e.g. `2026-09-02`), don't rely on today's default.
- Hebrew/RTL: locate by text (`hasText`), not position.
- Rationale glyph buttons live inside the name span (`span > button`);
  a bare `button hasText ⚠` also matches the ValidationPanel toggle.
