// Handler-level tests for api/_handlers/day-structure.ts (the מבנה יומי per-day shift-
// structure editor). GET returns the day's shift structure grouped by position;
// PUT is a declarative whole-day replace (seat change → template-targeted single-
// day seat_override; time/duration change or add → day-scoped slot_templates;
// remove → seats=0 override; new group → positions row is_scheduled=true; rename
// = cancel+create); DELETE resets. חמל / מפלג / rest positions are out of scope.
// Resolve positions by NAME (never hardcoded seed ids).
import './env.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { freshSchema, seedSoldiers, closePool, query } from './helpers.js';
import dsHandler from '../../api/_handlers/day-structure.js';
import { getPool } from '../../api/_db.js';
import type { DsResponse, DsGroup } from '../../api/_handlers/day-structure.js';

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
  await dsHandler(req as any, res as any);
  return out;
}
const get = (day: string) => call({ method: 'GET', query: { day } });
const put = (body: any) => call({ method: 'PUT', query: {}, body });
const del = (day: string) => call({ method: 'DELETE', query: { day } });

const group = (b: DsResponse, name: string) => b.groups.find((g) => g.name === name);
const posOf = (g: DsGroup | undefined, sub: string | null) =>
  g?.positions.find((p) => p.name === sub);

/** deep-clone a GET response's groups into a PUT payload (ids preserved). */
const toPayload = (b: DsResponse) => JSON.parse(JSON.stringify(b.groups));

async function overrideCount(day: string): Promise<number> {
  const r = await query(`select 1 from seat_overrides where valid_from=$1 and slot_template_id is not null`, [day]);
  return r.length;
}
async function dayTemplateCount(day: string): Promise<number> {
  const r = await query(`select 1 from slot_templates where valid_from=$1 and valid_to=$1`, [day]);
  return r.length;
}

before(async () => { await freshSchema(); await seedSoldiers(); });
after(async () => { await getPool().end().catch(() => {}); await closePool(); });

test('GET returns the default structure grouped by position, all origin=default', async () => {
  const D = '2026-09-01';
  const out = await get(D);
  assert.equal(out.status, 200);
  const b = out.body as DsResponse;
  assert.equal(b.day, D);
  const patrol = group(b, 'סיור');
  assert.ok(patrol, 'סיור present');
  const posLevel = patrol!.positions.find((p) => p.subId === null);
  assert.ok(posLevel, 'position-level (sub=null) shifts');
  assert.equal(posLevel!.shifts.length, 3, 'three סיור shifts');
  assert.ok(posLevel!.shifts.every((s) => s.origin === 'default' && s.seats === 4));
  // עמדות הגנה has named sub-positions
  const defense = group(b, 'עמדות הגנה');
  assert.ok(defense && defense.positions.some((p) => p.name === 'שג'));
  // scope: חמל / מפלג / rest never appear
  assert.equal(group(b, 'חמל'), undefined, 'חמל out of scope');
  assert.equal(group(b, 'מפלג'), undefined, 'מפלג out of scope');
  assert.equal(group(b, 'מנוחה'), undefined, 'rest out of scope');
});

test('PUT a seat change → template-targeted single-day override; GET shows origin=resized', async () => {
  const D = '2026-09-02';
  const payload = toPayload((await get(D)).body);
  const patrol = payload.find((g: any) => g.name === 'סיור');
  const posLevel = patrol.positions.find((p: any) => p.subId === null);
  posLevel.shifts[0].seats = 6;   // resize one shift
  const out = await put({ day: D, groups: payload });
  assert.equal(out.status, 200);
  const b = out.body as DsResponse;
  const shift = posOf(group(b, 'סיור'), null)!.shifts.find((s) => s.seats === 6);
  assert.ok(shift, 'resized shift echoed');
  assert.equal(shift!.origin, 'resized');
  assert.equal(await overrideCount(D), 1, 'one template-targeted override');
  assert.equal(await dayTemplateCount(D), 0, 'no day templates for a pure seat change');
});

test('PUT a start-time change → day-scoped template + cancel old', async () => {
  const D = '2026-09-03';
  const payload = toPayload((await get(D)).body);
  const patrol = payload.find((g: any) => g.name === 'סיור');
  const posLevel = patrol.positions.find((p: any) => p.subId === null);
  // move the 14:00 shift to 15:00 (8h → ends 23:00)
  const s = posLevel.shifts.find((x: any) => x.start === '14:00');
  s.start = '15:00'; s.end = '23:00';
  const out = await put({ day: D, groups: payload });
  const b = out.body as DsResponse;
  const shifts = posOf(group(b, 'סיור'), null)!.shifts;
  assert.ok(shifts.some((x) => x.start === '15:00' && x.origin === 'added'), 'moved shift is day-scoped');
  assert.ok(!shifts.some((x) => x.start === '14:00'), 'old 14:00 shift gone');
  assert.equal(await dayTemplateCount(D), 1, 'one day template (the moved shift)');
  assert.equal(await overrideCount(D), 1, 'one seats=0 override cancelling the old shift');
});

test('PUT a duration change → day-scoped template at same start, single emission', async () => {
  const D = '2026-09-04';
  const payload = toPayload((await get(D)).body);
  const tor = payload.find((g: any) => g.name === 'תורנים');
  const pl = tor.positions.find((p: any) => p.subId === null);
  // תורנים is a 14:00→14:00 full-day (1440 min); shorten to 14:00-22:00
  pl.shifts[0].end = '22:00';
  const out = await put({ day: D, groups: payload });
  const b = out.body as DsResponse;
  const shifts = posOf(group(b, 'תורנים'), null)!.shifts;
  assert.equal(shifts.length, 1, 'still one shift (single emission)');
  assert.equal(shifts[0].end, '22:00');
  assert.equal(shifts[0].origin, 'added');
});

test('PUT removing a sub-position cancels its slots (seats=0)', async () => {
  const D = '2026-09-05';
  const payload = toPayload((await get(D)).body);
  const defense = payload.find((g: any) => g.name === 'עמדות הגנה');
  defense.positions = defense.positions.filter((p: any) => p.name !== 'דרומית');   // drop דרומית
  const out = await put({ day: D, groups: payload });
  const b = out.body as DsResponse;
  assert.equal(posOf(group(b, 'עמדות הגנה'), 'דרומית'), undefined, 'דרומית gone');
  assert.ok(posOf(group(b, 'עמדות הגנה'), 'שג'), 'שג kept');
  // דרומית had 6 shifts → 6 seats=0 overrides
  assert.equal(await overrideCount(D), 6);
});

test('PUT dropping a whole group cancels all its slots', async () => {
  const D = '2026-09-06';
  const payload = toPayload((await get(D)).body).filter((g: any) => g.name !== 'תורנים');
  await put({ day: D, groups: payload });
  const b = (await get(D)).body as DsResponse;
  assert.equal(group(b, 'תורנים'), undefined, 'תורנים group removed for the day');
});

test('PUT adding a new group creates a scheduled static position with day-only slots', async () => {
  const D = '2026-09-07';
  const payload = toPayload((await get(D)).body);
  payload.push({ positionId: null, name: 'עמדה חדשה',
    positions: [{ subId: null, name: null, shifts: [{ start: '18:00', end: '22:00', seats: 2 }] }] });
  const out = await put({ day: D, groups: payload });
  const b = out.body as DsResponse;
  const g = group(b, 'עמדה חדשה');
  assert.ok(g, 'new group present');
  assert.equal(g!.positions[0].shifts[0].origin, 'added');
  const p = await query<{ mission_class: string; is_scheduled: boolean }>(
    `select mission_class, is_scheduled from positions where name='עמדה חדשה'`);
  assert.equal(p[0].mission_class, 'static');
  assert.equal(p[0].is_scheduled, true);
  // the new group's slots are day-scoped only (no permanent template)
  const perm = await query(`select 1 from slot_templates st join positions p on p.id=st.position_id
                            where p.name='עמדה חדשה' and st.valid_from <> st.valid_to`);
  assert.equal(perm.length, 0, 'no permanent template for the new group');
});

test('PUT a new group whose name collides with an existing position → 409', async () => {
  const D = '2026-09-08';
  const payload = toPayload((await get(D)).body);
  payload.push({ positionId: null, name: 'סיור',   // already exists
    positions: [{ subId: null, name: null, shifts: [{ start: '18:00', end: '22:00', seats: 1 }] }] });
  const out = await put({ day: D, groups: payload });
  assert.equal(out.status, 409);
  assert.match(out.body.error, /כבר קיימת/);
});

test('rename a group = cancel old + create new (day-scoped)', async () => {
  const D = '2026-09-09';
  const payload = toPayload((await get(D)).body);
  const tor = payload.find((g: any) => g.name === 'תורנים');
  // rename = send positionId null + new name, carrying the shifts; old id absent
  const idx = payload.indexOf(tor);
  payload[idx] = { positionId: null, name: 'תורנות לילה',
    positions: tor.positions.map((p: any) => ({ subId: null, name: null, shifts: p.shifts.map((s: any) => ({ start: s.start, end: s.end, seats: s.seats })) })) };
  const b = (await put({ day: D, groups: payload })).body as DsResponse;
  assert.ok(group(b, 'תורנות לילה'), 'new name present');
  assert.equal(group(b, 'תורנים'), undefined, 'old תורנים slots cancelled for the day');
});

test('idempotent: re-saving the same structure yields the same row counts', async () => {
  const D = '2026-09-10';
  const payload = toPayload((await get(D)).body);
  const patrol = payload.find((g: any) => g.name === 'סיור');
  patrol.positions.find((p: any) => p.subId === null).shifts[0].seats = 5;
  await put({ day: D, groups: payload });
  const ov1 = await overrideCount(D), tpl1 = await dayTemplateCount(D);
  await put({ day: D, groups: toPayload((await get(D)).body) });  // re-save the echoed state
  assert.equal(await overrideCount(D), ov1, 'override count stable');
  assert.equal(await dayTemplateCount(D), tpl1, 'day-template count stable');
});

test('saving the default structure back leaves zero rows', async () => {
  const D = '2026-09-11';
  const payload = toPayload((await get(D)).body);
  payload.find((g: any) => g.name === 'סיור').positions.find((p: any) => p.subId === null).shifts[0].seats = 9;
  await put({ day: D, groups: payload });
  assert.ok(await overrideCount(D) > 0, 'a change wrote rows');
  // now save the pristine default (freshly fetched from a virgin day)
  await put({ day: D, groups: toPayload((await get('2026-09-30')).body) });
  assert.equal(await overrideCount(D), 0, 'no overrides after saving default');
  assert.equal(await dayTemplateCount(D), 0, 'no day templates after saving default');
});

test('DELETE resets the day to default', async () => {
  const D = '2026-09-12';
  const payload = toPayload((await get(D)).body);
  payload.find((g: any) => g.name === 'סיור').positions.find((p: any) => p.subId === null).shifts[0].seats = 7;
  await put({ day: D, groups: payload });
  assert.ok(await overrideCount(D) > 0);
  const out = await del(D);
  assert.equal(out.status, 200);
  assert.equal(await overrideCount(D), 0);
  assert.equal(await dayTemplateCount(D), 0);
});

test('חמל rows are never touched by the tab', async () => {
  const D = '2026-09-13';
  const pid = (await query<{ id: number }>(`select id from positions where config->'staff_all_roles' ? 'חמל'`))[0].id;
  // a day-scoped חמל template (as the חמל tab writes)
  await query(`insert into slot_templates (position_id, start_time, duration_minutes, seats, valid_from, valid_to)
               values ($1,'10:00'::time,480,1,$2,$2)`, [pid, D]);
  // full day replace via the day-structure tab
  await put({ day: D, groups: toPayload((await get(D)).body) });
  const still = await query(`select 1 from slot_templates where position_id=$1 and valid_from=$2 and valid_to=$2`, [pid, D]);
  assert.equal(still.length, 1, 'חמל day template survives');
});

test('a hand-written long-range override survives a save and shows as the baseline', async () => {
  const D = '2026-09-14';
  const pid = (await query<{ id: number }>(`select id from positions where name='סיור'`))[0].id;
  // open-ended hand override: סיור down to 2 seats from D onward (slot_template_id null)
  await query(`insert into seat_overrides (position_id, valid_from, seats, note) values ($1,$2,2,'hand')`, [pid, D]);
  const b = (await get(D)).body as DsResponse;
  assert.ok(posOf(group(b, 'סיור'), null)!.shifts.every((s) => s.seats === 2), 'long-range override is the baseline');
  // saving that same structure back must NOT diff against it (no new rows) and not delete it
  await put({ day: D, groups: toPayload(b) });
  assert.equal(await overrideCount(D), 0, 'no single-day override written (already matches baseline)');
  const hand = await query(`select 1 from seat_overrides where position_id=$1 and note='hand'`, [pid]);
  assert.equal(hand.length, 1, 'hand-written long-range override untouched');
});

test('bad input is rejected', async () => {
  const D = '2026-09-15';
  assert.equal((await get('nope')).status, 400);
  assert.equal((await put({ groups: [] })).status, 400);                       // no day
  assert.equal((await put({ day: D, groups: [{ name: '', positions: [] }] })).status, 400);  // empty name
  assert.equal((await put({ day: D, groups: [{ name: 'x', positionId: null,
    positions: [{ subId: null, name: null, shifts: [{ start: '25:00', end: '01:00', seats: 1 }] }] }] })).status, 400);  // bad time
  assert.equal((await put({ day: D, groups: [{ name: 'x', positionId: null,
    positions: [{ subId: null, name: null, shifts: [{ start: '10:00', end: '12:00', seats: 0 }] }] }] })).status, 400);  // seats < 1
  assert.equal((await call({ method: 'PATCH', query: {} })).status, 405);
});
