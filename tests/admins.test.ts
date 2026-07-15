// Handler-level test for api/admins.ts against the local test database
// (same shavtzak_test DB the scheduler suite uses — never Supabase).
process.env.SCHEDULER_DATABASE_URL =
  process.env.SCHEDULER_TEST_DATABASE_URL
  ?? 'postgres://postgres:test@localhost:55432/shavtzak_test';

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { getPool } from '../api/_db.js';
import handler from '../api/admins.js';

function mockRes() {
  const res: any = {
    headers: {} as Record<string, string>,
    statusCode: 0,
    body: undefined as unknown,
    setHeader(k: string, v: string) { res.headers[k] = v; },
    status(c: number) { res.statusCode = c; return res; },
    json(b: unknown) { res.body = b; return res; },
  };
  return res;
}

const call = async (method: string, query: Record<string, string>) => {
  const res = mockRes();
  await handler({ method, query } as any, res);
  return res;
};

before(async () => {
  await getPool().query(`
    create table if not exists shavtzak_admins (
      email text primary key, note text, added_at timestamp not null default now());
    delete from shavtzak_admins;
    insert into shavtzak_admins (email) values ('admin@example.com');`);
});
after(() => getPool().end());

test('admin email -> true', async () => {
  const res = await call('GET', { email: 'admin@example.com' });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { isShavtzakAdmin: true });
});

test('lookup is case-insensitive', async () => {
  const res = await call('GET', { email: 'Admin@Example.COM' });
  assert.deepEqual(res.body, { isShavtzakAdmin: true });
});

test('unknown email -> false', async () => {
  const res = await call('GET', { email: 'someone@else.com' });
  assert.deepEqual(res.body, { isShavtzakAdmin: false });
});

test('missing email -> 400', async () => {
  const res = await call('GET', {});
  assert.equal(res.statusCode, 400);
});

test('non-GET -> 405', async () => {
  const res = await call('POST', { email: 'admin@example.com' });
  assert.equal(res.statusCode, 405);
});
