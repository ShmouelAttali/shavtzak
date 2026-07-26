// Pins the single-function API routing (api/_routes.ts + api/[...route].ts).
//
// The Hobby plan allows 12 Serverless Functions per deployment, so all 14
// endpoints are served by ONE catch-all that dispatches through the ROUTES
// table. The failure mode that buys: a handler file added under api/_handlers/
// without its line in ROUTES is simply unreachable — silently, and only in
// production. These tests make that a red suite instead.
process.env.SCHEDULER_DATABASE_URL ??=
  process.env.SCHEDULER_TEST_DATABASE_URL
  ?? 'postgres://postgres:test@localhost:55432/shavtzak_test';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ROUTES, routeKey } from '../api/_routes.js';
import catchAll from '../api/[...route].js';

const dir = (p: string) => fileURLToPath(new URL(p, import.meta.url));

const mockRes = () => {
  const out: { code: number; body: unknown } = { code: 200, body: undefined };
  const res: any = {
    status(c: number) { out.code = c; return res; },
    json(b: unknown) { out.body = b; return res; },
    send(b: unknown) { out.body = b; return res; },
    setHeader() { return res; },
  };
  return { res, out };
};

test('every handler file under api/_handlers/ has a ROUTES entry', () => {
  const files = readdirSync(dir('../api/_handlers'))
    .filter((f) => f.endsWith('.ts'))
    .map((f) => f.replace(/\.ts$/, ''));
  for (const f of files) {
    assert.ok(ROUTES[f], `api/_handlers/${f}.ts is unreachable — add '${f}' to api/_routes.ts`);
  }
  assert.equal(Object.keys(ROUTES).length, files.length, 'ROUTES has an entry with no handler file');
});

test('every /api/<path> the client fetches is routable', () => {
  const roots = [dir('../src'), dir('../src/components'), dir('../src/hooks'), dir('../src/lib')];
  const used = new Set<string>();
  for (const root of roots) {
    for (const f of readdirSync(root, { withFileTypes: true })) {
      if (!f.isFile() || !/\.tsx?$/.test(f.name)) continue;
      const src = readFileSync(`${root}/${f.name}`, 'utf8');
      for (const m of src.matchAll(/['"`]\/api\/([a-z-]+)/g)) used.add(m[1]);
    }
  }
  assert.ok(used.size > 0, 'found no /api/ call sites — the scan is broken');
  for (const path of used) assert.ok(ROUTES[path], `client calls /api/${path} but ROUTES has no such key`);
});

test('every ROUTES entry resolves to a handler function', async () => {
  for (const [key, load] of Object.entries(ROUTES)) {
    const mod = await load();
    assert.equal(typeof mod.default, 'function', `api/_handlers/${key}.ts has no default export`);
  }
});

test('routeKey normalizes the shapes Vercel and the dev server produce', () => {
  assert.equal(routeKey('draft'), 'draft');              // Vercel: single segment
  assert.equal(routeKey(['draft']), 'draft');            // Vercel: segment array
  assert.equal(routeKey('/api/exit-requests'), 'exit-requests');  // dev server: pathname
  assert.equal(routeKey('/api/roster/'), 'roster');
  assert.equal(routeKey('/api/draft?day=2026-07-26&from=x'), 'draft');  // req.url: query stripped
  assert.equal(routeKey(undefined), '');
});

test('catch-all routes off req.url, not just the route param', async () => {
  // The production outage: the [...route] param arrived empty and every
  // endpoint 404'd. req.url is the path as received, so it must be enough
  // on its own — with no query.route at all.
  const { res, out } = mockRes();
  await catchAll({ method: 'GET', url: '/api/admins?email=', query: {} } as any, res);
  assert.equal(out.code, 400);
  assert.deepEqual(out.body, { error: 'email required' });
});

test('catch-all dispatches to the handler named by the route param', async () => {
  const { res, out } = mockRes();
  // admins GET with no email is the cheapest handler round trip that never
  // touches the DB — its 'email required' 400 comes from api/_handlers/admins.ts
  // itself, so it proves the dispatch reached that exact module.
  await catchAll({ method: 'GET', query: { route: 'admins' } } as any, res);
  assert.equal(out.code, 400);
  assert.deepEqual(out.body, { error: 'email required' });
});

test('catch-all 404s an unknown endpoint', async () => {
  const { res, out } = mockRes();
  await catchAll({ method: 'GET', url: '/api/nope', query: {} } as any, res);
  assert.equal(out.code, 404);
  assert.deepEqual(out.body, { error: 'unknown endpoint: /api/nope' });
});

test('vercel.json: nothing rewrites /api, and the functions pattern names a real file', () => {
  const cfg = JSON.parse(readFileSync(dir('../vercel.json'), 'utf8')) as {
    rewrites?: { source: string; destination: string }[];
    functions?: Record<string, unknown>;
  };
  // The outage in one line: an /api/(.*) -> /api/$1 rewrite ($1 is a literal in
  // path-to-regexp, not a backreference) hid behind per-endpoint files for as
  // long as the filesystem matched them first, then broke every endpoint the
  // moment the catch-all needed the path intact.
  for (const r of cfg.rewrites ?? []) {
    assert.ok(!r.source.startsWith('/api'), `vercel.json rewrites /api (${r.source} -> ${r.destination}) — it will shadow the catch-all`);
  }
  for (const pattern of Object.keys(cfg.functions ?? {})) {
    assert.ok(readFileSync(dir(`../${pattern}`), 'utf8'), `functions pattern ${pattern} names no file`);
  }
});
