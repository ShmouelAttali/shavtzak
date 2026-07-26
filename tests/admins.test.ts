// Handler-level test for api/_handlers/admins.ts against the local test database
// (same shavtzak_test DB the scheduler suite uses — never Supabase).
process.env.SCHEDULER_DATABASE_URL =
  process.env.SCHEDULER_TEST_DATABASE_URL
  ?? 'postgres://postgres:test@localhost:55432/shavtzak_test';

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { getPool } from '../api/_db.js';
import handler from '../api/_handlers/admins.js';

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

// Self-contained fixtures so the hamal-membership derivation (soldier with a
// חמל staff role, matched by email) is exercised without touching real rows.
// The חמל position is identified by the 'חמל' marker INSIDE staff_all_roles
// (same resolution as api/_handlers/hamal.ts), so the fixture position must carry it.
// The second pair mirrors מפלג — another position with staff_all_roles — and
// must NOT unlock the חמל tab.
const TEST_POS_ID = 900;
const TEST_ROLE = 'חמל';
const STAFF_POS_ID = 901;
const STAFF_ROLE = 'רספטסט';

before(async () => {
  await getPool().query(`
    create table if not exists shavtzak_admins (
      email text primary key, note text, added_at timestamp not null default now());
    delete from shavtzak_admins;
    insert into shavtzak_admins (email) values ('admin@example.com');`);
  // A position whose staff_all_roles includes our test role, and a soldier in
  // that role with an email — this is exactly what api/_handlers/admins.ts joins on.
  await getPool().query(
    `insert into positions (id, name, mission_class, config)
     values ($1::smallint, 'חמל-authtest', 'readiness', jsonb_build_object('staff_all_roles', jsonb_build_array($2::text)))
     on conflict (id) do update set config = excluded.config`,
    [TEST_POS_ID, TEST_ROLE]);
  await getPool().query(
    `insert into soldiers (personal_number, full_name, platoon, role, email)
     values ('AUTHTEST1', 'בודק חמל authtest', 'חמ"ל', $1, 'hamal@example.com')
     on conflict (personal_number) do update set role = excluded.role, email = excluded.email`,
    [TEST_ROLE]);
  // …and a מפלג-style staff position + member: staff_all_roles, but not חמל's.
  await getPool().query(
    `insert into positions (id, name, mission_class, config)
     values ($1::smallint, 'מפלג-authtest', 'other', jsonb_build_object('staff_all_roles', jsonb_build_array($2::text)))
     on conflict (id) do update set config = excluded.config`,
    [STAFF_POS_ID, STAFF_ROLE]);
  await getPool().query(
    `insert into soldiers (personal_number, full_name, platoon, role, email)
     values ('AUTHTEST2', 'בודק מפלג authtest', 'מפלג', $1, 'miflag@example.com')
     on conflict (personal_number) do update set role = excluded.role, email = excluded.email`,
    [STAFF_ROLE]);
});
after(async () => {
  await getPool().query(`delete from soldiers where personal_number in ('AUTHTEST1', 'AUTHTEST2')`);
  await getPool().query(`delete from positions where id in (${TEST_POS_ID}, ${STAFF_POS_ID})`);
  await getPool().end();
});

test('admin email -> true', async () => {
  const res = await call('GET', { email: 'admin@example.com' });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { isShavtzakAdmin: true, isHamalMember: false });
});

test('lookup is case-insensitive', async () => {
  const res = await call('GET', { email: 'Admin@Example.COM' });
  assert.deepEqual(res.body, { isShavtzakAdmin: true, isHamalMember: false });
});

test('unknown email -> false', async () => {
  const res = await call('GET', { email: 'someone@else.com' });
  assert.deepEqual(res.body, { isShavtzakAdmin: false, isHamalMember: false });
});

test('חמל member (soldier with a חמל role, matched by email) -> isHamalMember true', async () => {
  // fixture (before): soldier AUTHTEST1 has role TEST_ROLE + email hamal@example.com,
  // and position 900's staff_all_roles includes TEST_ROLE.
  const res = await call('GET', { email: 'hamal@example.com' });
  assert.deepEqual(res.body, { isShavtzakAdmin: false, isHamalMember: true });
});

test('חמל lookup is case-insensitive on email', async () => {
  const res = await call('GET', { email: 'Hamal@Example.COM' });
  assert.deepEqual(res.body, { isShavtzakAdmin: false, isHamalMember: true });
});

test('a מפלג staff role does NOT unlock the חמל tab', async () => {
  // regression: the join used to match ANY position declaring staff_all_roles,
  // so רס"פ/סרס"פ/מנהלה (מפלג) were reported as חמל members.
  const res = await call('GET', { email: 'miflag@example.com' });
  assert.deepEqual(res.body, { isShavtzakAdmin: false, isHamalMember: false });
});

test('missing email -> 400', async () => {
  const res = await call('GET', {});
  assert.equal(res.statusCode, 400);
});

test('non-GET -> 405', async () => {
  const res = await call('POST', { email: 'admin@example.com' });
  assert.equal(res.statusCode, 405);
});
