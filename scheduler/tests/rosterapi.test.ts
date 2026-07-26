// Handler-level tests for api/roster.ts (the מצבת חיילים roster editor).
// GET returns every soldier — active AND archived — with quals, the H6c
// whitelist, closed-list candidacies and the shavtzak_admins grant, plus the
// catalogs the editor needs. POST creates, PUT is a declarative whole-soldier
// replace, and removal is soft (archived_at) and reversible.
// Resolve positions / sub-positions by NAME (never hardcoded seed ids).
import './env.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { freshSchema, seedSoldiers, addCandidates, closePool, query } from './helpers.js';
import rosterHandler, { mergeRoleCatalog } from '../../api/roster.js';
import { getPool } from '../../api/_db.js';
import type { RosterInput, RosterResponse, RosterSoldier } from '../../api/roster.js';
import { loadContext } from '../src/load.js';

function mockRes() {
  const out: { status: number; body: any } = { status: 0, body: null };
  const res: any = {
    setHeader() { return res; },
    status(code: number) { out.status = code; return res; },
    json(body: any) { out.body = body; return res; },
    end() { return res; },
  };
  return { res, out };
}
async function call(req: any): Promise<{ status: number; body: any }> {
  const { res, out } = mockRes();
  await rosterHandler(req as any, res as any);
  return out;
}
const get = () => call({ method: 'GET', query: {} });
const post = (body: any) => call({ method: 'POST', query: {}, body });
const put = (body: any) => call({ method: 'PUT', query: {}, body });

const soldier = (b: RosterResponse, name: string): RosterSoldier => {
  const s = b.soldiers.find((x) => x.fullName === name);
  assert.ok(s, `no soldier ${name} in the response`);
  return s!;
};
const posId = async (name: string): Promise<number> =>
  Number((await query<{ id: number }>(`select id from positions where name = $1`, [name]))[0].id);

/** GET → the input shape the editor would PUT back. */
function toInput(s: RosterSoldier): RosterInput {
  return {
    id: s.id, personalNumber: s.personalNumber, fullName: s.fullName, platoon: s.platoon,
    role: s.role, rifleLevel: s.rifleLevel, phone: s.phone, email: s.email,
    isSchedulable: s.isSchedulable, notes: s.notes, archived: s.archivedAt != null,
    isAdmin: s.isAdmin, quals: [...s.quals], allowedPositionIds: [...s.allowedPositionIds],
    candidacies: s.candidacies.map((c) => ({ ...c })),
  };
}
const NEW: Omit<RosterInput, 'personalNumber' | 'fullName'> = {
  id: null, platoon: '3', role: 'לוחם', rifleLevel: 70, phone: '', email: '',
  isSchedulable: true, notes: '', archived: false, isAdmin: false,
  quals: [], allowedPositionIds: [], candidacies: [],
};

before(async () => {
  await freshSchema();
  await seedSoldiers();
  await addCandidates('חפק', 'קשר', ['חייל 20', 'חייל 21'], true);
});
after(async () => { await getPool().end().catch(() => {}); await closePool(); });

test('GET returns the roster with quals, catalogs and closed lists', async () => {
  const out = await get();
  assert.equal(out.status, 200);
  const b = out.body as RosterResponse;
  assert.equal(b.soldiers.length, 60);

  const driver = soldier(b, 'חייל 11');
  assert.deepEqual(driver.quals, ['נהג דוד']);
  assert.equal(driver.archivedAt, null);
  assert.equal(driver.isAdmin, false);
  assert.deepEqual(driver.allowedPositionIds, []);

  // seedSoldiers puts חייל 07..10 in the קצין מוצב pool (sub = null)
  const pool = soldier(b, 'חייל 07');
  assert.equal(pool.candidacies.length, 1);
  assert.equal(pool.candidacies[0].subPositionId, null);
  assert.equal(pool.candidacies[0].priority, null);

  // חפק/קשר was seeded ordered
  const kesher = soldier(b, 'חייל 20');
  assert.equal(kesher.candidacies[0].priority, 1);

  // catalogs
  assert.ok(b.qualifications.includes('נהג דוד') && b.qualifications.includes('רחפן'));
  assert.ok(b.roles.includes('מ"כ') && b.roles.includes('לוחם'));
  // תפקיד is a closed list, so the roles the DB DECLARES must be offered even
  // when no soldier holds them — otherwise nobody could ever be put in
  // חמל / מפלג, whose only entry point is setting תפקיד.
  assert.ok(!b.soldiers.some((s) => s.role === 'חמל'), 'fixture has no חמל soldier');
  for (const r of ['חמל', 'רס"פ', 'סרס"פ', 'מנהלה'])   // positions.config.staff_all_roles
    assert.ok(b.roles.includes(r), `staff role ${r} missing from the catalog: ${b.roles.join(', ')}`);
  for (const r of ['מ"פ', 'סמ"פ'])                      // חפק's seat_rules[].roles
    assert.ok(b.roles.includes(r), `seat-rule role ${r} missing from the catalog`);
  assert.ok(b.platoons.includes('1') && b.platoons.includes('לא ידוע'));
  assert.ok(b.positions.some((p) => p.name === 'סיור' && p.isScheduled));
  assert.ok(b.positions.some((p) => p.name === 'מנוחה' && p.missionClass === 'rest'));

  const labels = b.closedLists.map((l) => l.label);
  assert.ok(labels.includes('קצין מוצב'), `closed lists: ${labels.join(', ')}`);
  assert.ok(labels.some((l) => l.startsWith('חפק')), `closed lists: ${labels.join(', ')}`);
  assert.equal(b.closedLists.find((l) => l.label === 'קצין מוצב')!.ordered, false);
  assert.equal(b.closedLists.find((l) => l.label.startsWith('חפק'))!.ordered, true);
});

test('POST creates a soldier; role "" is stored as null', async () => {
  const out = await post({ ...NEW, personalNumber: 'N001', fullName: 'חדש אחד', role: '' });
  assert.equal(out.status, 200);
  const s = soldier(out.body as RosterResponse, 'חדש אחד');
  assert.equal(s.role, '');
  assert.equal(s.platoon, '3');
  assert.equal(s.rifleLevel, 70);
  const raw = await query<{ role: string | null }>(
    `select role from soldiers where full_name = 'חדש אחד'`);
  assert.equal(raw[0].role, null, 'soldiers_role_check forbids the empty string');
});

test('POST rejects a duplicate full_name / personal_number with 409', async () => {
  const dupName = await post({ ...NEW, personalNumber: 'N002', fullName: 'חדש אחד' });
  assert.equal(dupName.status, 409);
  assert.match(dupName.body.error, /שם/);

  const dupPn = await post({ ...NEW, personalNumber: 'N001', fullName: 'חדש שני' });
  assert.equal(dupPn.status, 409);
  assert.match(dupPn.body.error, /המספר האישי/);
});

test('POST rejects missing required fields', async () => {
  assert.equal((await post({ ...NEW, personalNumber: 'N003', fullName: '  ' })).status, 400);
  assert.equal((await post({ ...NEW, personalNumber: '', fullName: 'חדש שלישי' })).status, 400);
  assert.equal((await post({ ...NEW, personalNumber: 'N004', fullName: 'חדש רביעי', rifleLevel: 'abc' as any })).status, 400);
});

test('PUT replaces quals, the whitelist and closed-list candidacies', async () => {
  const before = soldier((await get()).body as RosterResponse, 'חייל 30');
  const patrol = await posId('סיור');
  const toranim = await posId('תורנים');
  const officer = await posId('קצין מוצב');

  const saved = await put({
    ...toInput(before),
    role: 'מ"כ',
    rifleLevel: 95,
    quals: ['נהג דוד', 'חובש'],
    allowedPositionIds: [patrol, toranim],
    candidacies: [{ positionId: officer, subPositionId: null, priority: null }],
  });
  assert.equal(saved.status, 200);
  const s = soldier(saved.body as RosterResponse, 'חייל 30');
  assert.deepEqual([...s.quals].sort(), ['חובש', 'נהג דוד']);
  assert.deepEqual([...s.allowedPositionIds].sort((a, b) => a - b), [patrol, toranim].sort((a, b) => a - b));
  assert.equal(s.candidacies.length, 1);
  assert.equal(s.candidacies[0].positionId, officer);
  assert.equal(s.rifleLevel, 95);

  // and removal round-trips: everything back to empty
  const cleared = await put({ ...toInput(s), quals: [], allowedPositionIds: [], candidacies: [] });
  const s2 = soldier(cleared.body as RosterResponse, 'חייל 30');
  assert.deepEqual(s2.quals, []);
  assert.deepEqual(s2.allowedPositionIds, []);
  assert.deepEqual(s2.candidacies, []);
});

test('PUT rejects a bad priority and an unknown position', async () => {
  const s = soldier((await get()).body as RosterResponse, 'חייל 31');
  const officer = await posId('קצין מוצב');
  assert.equal((await put({
    ...toInput(s),
    candidacies: [{ positionId: officer, subPositionId: null, priority: 0 }],
  })).status, 400);
  assert.equal((await put({ ...toInput(s), allowedPositionIds: [9999] })).status, 400);
  assert.equal((await put({ ...toInput(s), id: 999999 })).status, 404);
});

test('the אדמין שבצ"ק checkbox writes and clears shavtzak_admins', async () => {
  const base = soldier((await get()).body as RosterResponse, 'חייל 32');

  // no email → cannot be an admin
  assert.equal((await put({ ...toInput(base), isAdmin: true })).status, 400);

  const on = await put({ ...toInput(base), email: 'A.Cohen@Example.com', isAdmin: true });
  assert.equal(on.status, 200);
  const s = soldier(on.body as RosterResponse, 'חייל 32');
  assert.equal(s.email, 'a.cohen@example.com', 'email is normalized to lowercase');
  assert.equal(s.isAdmin, true);
  assert.equal((await query(`select 1 from shavtzak_admins where email = 'a.cohen@example.com'`)).length, 1);

  // changing the address moves the grant instead of leaving a stale row
  const moved = await put({ ...toInput(s), email: 'new@example.com', isAdmin: true });
  assert.equal((await query(`select 1 from shavtzak_admins where email = 'a.cohen@example.com'`)).length, 0);
  assert.equal((await query(`select 1 from shavtzak_admins where email = 'new@example.com'`)).length, 1);

  const off = await put({ ...toInput(soldier(moved.body as RosterResponse, 'חייל 32')), isAdmin: false });
  assert.equal(soldier(off.body as RosterResponse, 'חייל 32').isAdmin, false);
  assert.equal((await query(`select 1 from shavtzak_admins where email = 'new@example.com'`)).length, 0);
});

test('archive hides the soldier from the generator roster; restore brings them back', async () => {
  const base = soldier((await get()).body as RosterResponse, 'חייל 40');
  const D = '2026-09-10';
  await query(`insert into schedule_days (day) values ($1) on conflict do nothing`, [D]);

  const inRoster = async () =>
    [...(await loadContext(D)).soldiers.values()].some((s) => s.name === 'חייל 40');
  assert.ok(await inRoster());

  const archived = await put({ ...toInput(base), archived: true });
  assert.equal(archived.status, 200);
  const gone = soldier(archived.body as RosterResponse, 'חייל 40');
  assert.ok(gone.archivedAt, 'archivedAt is stamped');

  assert.ok(!(await inRoster()), 'an archived soldier is out of the generator roster');
  assert.equal(
    (await query(`select 1 from soldier_fairness($1) f join soldiers s on s.id = f.soldier_id
                  where s.full_name = 'חייל 40'`, [D])).length, 0,
    'and out of soldier_fairness');

  const restored = await put({ ...toInput(gone), archived: false });
  assert.equal(soldier(restored.body as RosterResponse, 'חייל 40').archivedAt, null);
  assert.ok(await inRoster());
});

test('archiving revokes the scheduler-admin grant', async () => {
  const base = soldier((await get()).body as RosterResponse, 'חייל 41');
  const on = await put({ ...toInput(base), email: 'gone@example.com', isAdmin: true });
  assert.equal(soldier(on.body as RosterResponse, 'חייל 41').isAdmin, true);

  const off = await put({ ...toInput(soldier(on.body as RosterResponse, 'חייל 41')), archived: true });
  assert.equal(soldier(off.body as RosterResponse, 'חייל 41').isAdmin, false);
  assert.equal((await query(`select 1 from shavtzak_admins where email = 'gone@example.com'`)).length, 0);
});

test('an archived soldier keeps their name and personal number reserved', async () => {
  const s = soldier((await get()).body as RosterResponse, 'חייל 40');
  await put({ ...toInput(s), archived: true });
  const dup = await post({ ...NEW, personalNumber: 'X999', fullName: 'חייל 40' });
  assert.equal(dup.status, 409);
  await put({ ...toInput(s), archived: false });
});

test('mergeRoleCatalog: observed spelling wins, declared roles are added', () => {
  // רספ and רס"פ normalize the same — the observed spelling must survive, since
  // that is what api/admins.ts / api/hamal.ts match on EXACTLY.
  const merged = mergeRoleCatalog(['רספ', 'לוחם'], ['רס"פ', 'חמל', 'לוחם']);
  assert.ok(merged.includes('רספ'));
  assert.ok(!merged.includes('רס"פ'), 'no visual duplicate of the same role');
  assert.ok(merged.includes('חמל'), 'a declared role nobody holds is still offered');
  assert.equal(merged.filter((r) => r === 'לוחם').length, 1);
  assert.deepEqual(merged, [...merged].sort((a, b) => a.localeCompare(b, 'he')));
  assert.deepEqual(mergeRoleCatalog(['', '  '], []), [], 'blanks are dropped');
});

test('mergeRoleCatalog: a qualification is never offered as a תפקיד', () => {
  // The sheet's תפקיד column mixes role and qualification, so soldiers.role
  // carried נהג דוד / חובש / מט"ב etc. Those are הסמכות — they must not appear
  // in the role dropdown just because a soldier's row holds one.
  const merged = mergeRoleCatalog(
    ['לוחם', 'נהג דוד', 'חובש', 'מט"ב', 'מ"כ'], ['לוחם', 'חמל']);
  assert.deepEqual(merged, ['חמל', 'לוחם', 'מ"כ']);

  // gershayim spelling is irrelevant — matching is by normalizeName
  assert.deepEqual(mergeRoleCatalog(['מטב'], []), []);
  assert.deepEqual(mergeRoleCatalog(['נהג טיגריס'], []), []);

  // a DECLARED role is authoritative and survives even if it collides with a
  // qualification name: only the observed side is filtered
  assert.deepEqual(mergeRoleCatalog(['חובש'], ['חובש']), ['חובש']);

  // an explicit qualification list overrides the QUAL_CATALOG default
  assert.deepEqual(mergeRoleCatalog(['לוחם', 'צלף'], [], ['צלף']), ['לוחם']);
  assert.deepEqual(mergeRoleCatalog(['לוחם', 'נהג דוד'], [], []),
    ['לוחם', 'נהג דוד'], 'empty qual list filters nothing');
});

test('PUT rejects a תפקיד / מחלקה outside the closed lists', async () => {
  const s = soldier((await get()).body as RosterResponse, 'חייל 33');

  const badRole = await put({ ...toInput(s), role: 'זבנג' });
  assert.equal(badRole.status, 400);
  assert.match(badRole.body.error, /תפקיד לא מוכר/);

  const badPlatoon = await put({ ...toInput(s), platoon: '9' });
  assert.equal(badPlatoon.status, 400);
  assert.match(badPlatoon.body.error, /מחלקה לא מוכרת/);

  assert.equal((await post({ ...NEW, personalNumber: 'N009', fullName: 'חדש רול', role: 'זבנג' })).status, 400);

  // a declared-but-unheld role IS accepted (this is how מפלג gets staffed)
  const ok = await put({ ...toInput(s), role: 'רס"פ' });
  assert.equal(ok.status, 200);
  assert.equal(soldier(ok.body as RosterResponse, 'חייל 33').role, 'רס"פ');
  // ...and an empty platoon still falls back to לא ידוע
  const blank = await put({ ...toInput(soldier(ok.body as RosterResponse, 'חייל 33')), platoon: '' });
  assert.equal(blank.status, 200);
  assert.equal(soldier(blank.body as RosterResponse, 'חייל 33').platoon, 'לא ידוע');
});

test('unsupported methods are rejected', async () => {
  assert.equal((await call({ method: 'DELETE', query: {} })).status, 405);
  assert.equal((await put(null)).status, 400);
});
