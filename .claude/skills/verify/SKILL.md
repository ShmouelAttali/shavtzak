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

## API surface

```bash
SCHEDULER_DATABASE_URL='postgres://postgres:test@localhost:55432/shavtzak_test' npx tsx scripts/dev-api.ts  # port 3001
curl 'http://localhost:3001/api/draft?from=2026-09-02&to=2026-09-02'
```

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

## Gotchas

- The draft tab needs a date with generated rows — fill the first
  `input[type=date]` (e.g. `2026-09-02`), don't rely on today's default.
- Hebrew/RTL: locate by text (`hasText`), not position.
- Rationale glyph buttons live inside the name span (`span > button`);
  a bare `button hasText ⚠` also matches the ValidationPanel toggle.
