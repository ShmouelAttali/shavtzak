// Slot coverage is judged by OVERLAP, never by matching the rendered time
// label. A real shift sliced differently from its template still staffs it —
// the officers run כרמל חטיבה's night as ONE 22:00→06:00 row while a template
// may split the night into two 4h slots. The validator (validate.ts §10
// `coverage`) always counted by overlap; the צור שבצק tab's לא-מאויש markers
// used to count by label and shouted over a fully manned night shift. Both now
// call the same helper (scheduler/src/coverage.ts), so they cannot disagree.
//
// Positions / sub-positions are resolved by NAME (testing policy).
import './env.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { freshSchema, seedSoldiers, soldierId, closePool, query } from './helpers.js';
import { staffedSeats, rowFeedsSlot } from '../src/coverage.js';
import { validateDay } from '../src/validate.js';
import draftHandler from '../../api/_handlers/draft.js';
import { getPool } from '../../api/_db.js';
import type { DraftResponse } from '../../api/_handlers/draft.js';

const DAY = '2026-07-20';
const UNFILLED = 'לא מאויש';

// ── pure helper ────────────────────────────────────────────────────────────
// minutes-since-anchor scale (the validator's); api/_handlers/draft.ts feeds epoch ms.

test('staffedSeats: one long row staffs every slot it spans', () => {
  const night = [{ start: 480, end: 960, subName: null }];   // 8h
  assert.equal(staffedSeats(480, 720, null, night), 1);       // first 4h slot
  assert.equal(staffedSeats(720, 960, null, night), 1);       // second 4h slot
});

test('staffedSeats: a partially covering row does not staff the slot', () => {
  const rows = [{ start: 480, end: 600, subName: null }];     // covers 2h of 4h
  assert.equal(staffedSeats(480, 720, null, rows), 0);
});

test('staffedSeats: a replacement PAIR splitting the slot counts as one seat (H1)', () => {
  const pair = [
    { start: 480, end: 600, subName: null },
    { start: 600, end: 720, subName: null },
  ];
  assert.equal(staffedSeats(480, 720, null, pair), 1);
});

test('staffedSeats: concurrent rows are separate seats', () => {
  const rows = [
    { start: 480, end: 720, subName: null },
    { start: 480, end: 720, subName: null },
    { start: 540, end: 720, subName: null },   // late — the minimum still sees 2
  ];
  assert.equal(staffedSeats(480, 720, null, rows), 2);
});

test('staffedSeats: empty window and no rows', () => {
  assert.equal(staffedSeats(480, 720, null, []), 0);
  assert.equal(staffedSeats(720, 720, null, [{ start: 0, end: 1440, subName: null }]), 0);
});

test('rowFeedsSlot: null sub on either side pools, otherwise names must match', () => {
  assert.ok(rowFeedsSlot(null, 'מפקד כרמל חטיבה'));    // imported history row
  assert.ok(rowFeedsSlot('כרמל חטיבה', null));         // position-level slot
  assert.ok(rowFeedsSlot('כרמל חטיבה', 'כרמל חטיבה'));
  assert.ok(!rowFeedsSlot('כרמל חטיבה', 'מפקד כרמל חטיבה'));
});

// ── validator + tab agree over a real day ──────────────────────────────────

before(async () => {
  await freshSchema();
  await seedSoldiers();
  await query(`insert into schedule_days (day, status) values ($1::date, 'published')`, [DAY]);
});
after(async () => { await closePool(); await getPool().end(); });

const posId = async (name: string): Promise<number> => {
  const r = await query<{ id: number }>(`select id from positions where name = $1`, [name]);
  assert.equal(r.length, 1, `position ${name}`);
  return r[0].id;
};
const subId = async (position: string, sub: string): Promise<number> => {
  const r = await query<{ id: number }>(
    `select sp.id from sub_positions sp join positions p on p.id = sp.position_id
     where p.name = $1 and sp.name = $2`, [position, sub]);
  assert.equal(r.length, 1, `sub ${sub}`);
  return r[0].id;
};

/** one כרמל חטיבה row, positioned by HOURS AFTER the day's 14:00 anchor — bare
 *  clock times are ambiguous across a 14:00→14:00 day (06:00 = +16h, i.e. the
 *  next calendar morning; 14:00 = +24h, the day's end). */
async function addRow(sub: string, soldier: string, fromH: number, toH: number): Promise<void> {
  await query(
    `insert into shift_assignments
       (day, position_id, sub_position_id, soldier_id, period, source, blocks_overlap)
     values ($1::date, $2, $3, $4,
             tsrange(day_start($1::date) + make_interval(hours => $5),
                     day_start($1::date) + make_interval(hours => $6)), 'import', false)`,
    [DAY, await posId('כרמל חטיבה'), await subId('כרמל חטיבה', sub), await soldierId(soldier),
     fromH, toH]);
}

/** the seeded (sub, start, duration) grid of כרמל חטיבה, for the assertions
 *  that must not silently pass because the template changed shape */
const carmelGrid = async (): Promise<string[]> => (await query<{ k: string }>(
  `select sp.name || '|' || t.start_time || '|' || t.duration_minutes k
   from slot_templates t join sub_positions sp on sp.id = t.sub_position_id
   join positions p on p.id = t.position_id
   where p.name = 'כרמל חטיבה' and t.valid_to is null order by k`)).map((r) => r.k);

const draftDay = async (): Promise<DraftResponse['days'][number]> => {
  const out: { body: any } = { body: null };
  const res: any = {
    setHeader() { return res; }, status() { return res; },
    json(body: any) { out.body = body; return res; }, end() { return res; },
  };
  await draftHandler({ method: 'GET', query: { from: DAY, to: DAY } } as any, res);
  const day = (out.body as DraftResponse).days.find((d) => d.day === DAY);
  assert.ok(day, 'day in response');
  return day;
};

/** every (sug, time) cell of כרמל חטיבה holding a לא-מאויש marker */
function unfilledCells(day: DraftResponse['days'][number]): string[] {
  const g = day.groups.find((x) => x.name === 'כרמל חטיבה');
  if (!g) return [];
  const out: string[] = [];
  for (const s of g.subTypes) for (const t of s.times) {
    const n = t.soldiers.filter((x) => x === UNFILLED).length;
    if (n) out.push(`${s.sug}|${t.time}|${n}`);
  }
  return out.sort();
}

test('כרמל חטיבה is seeded with ONE 8h night window, no 02:00 one', async () => {
  // The rule this file's night case rests on (SPEC §T4a, owner 2026-07-26):
  // the 18:00-22:00 defense crew holds standby 22:00→06:00, so a 02:00 window
  // must not exist. Asserted explicitly — a template regression would
  // otherwise quietly turn the day-grid test below into the only real check.
  assert.deepEqual(await carmelGrid(), [
    'כרמל חטיבה|06:00:00|240',
    'כרמל חטיבה|10:00:00|240',
    'כרמל חטיבה|14:00:00|240',
    'כרמל חטיבה|18:00:00|240',
    'כרמל חטיבה|22:00:00|480',
    'מפקד כרמל חטיבה|06:00:00|240',
    'מפקד כרמל חטיבה|10:00:00|240',
    'מפקד כרמל חטיבה|14:00:00|240',
    'מפקד כרמל חטיבה|18:00:00|240',
    'מפקד כרמל חטיבה|22:00:00|480',
  ]);
});

test('one 8h row spanning two 4h slots: no coverage error, no לא מאויש', async () => {
  // ONE 06:00→14:00 row per seat against the template's two 4h morning slots
  // (06:00-10:00 + 10:00-14:00) — the row matches the label of NEITHER, which
  // is exactly what used to make the tab shout over a manned shift.
  for (const [sub, soldier] of [
    ['כרמל חטיבה', 'חייל 21'], ['כרמל חטיבה', 'חייל 22'],
    ['כרמל חטיבה', 'חייל 23'], ['מפקד כרמל חטיבה', 'חייל 01'],
  ] as const) await addRow(sub, soldier, 16, 24);   // 06:00 → 14:00

  const findings = await validateDay(DAY);
  const gaps = findings.filter((f) => f.rule === 'coverage'
    && f.message.includes('כרמל') && / (06|10):00:/.test(f.message));
  assert.deepEqual(gaps, [], JSON.stringify(gaps));

  const day = await draftDay();
  const marked = unfilledCells(day).filter((c) => /\|(06|10):00-/.test(c));
  assert.deepEqual(marked, [], `tab marked a manned shift unfilled: ${marked.join(', ')}`);

  // the crew itself is still rendered, on its own 06:00-14:00 row
  const g = day.groups.find((x) => x.name === 'כרמל חטיבה')!;
  const crew = g.subTypes.find((s) => s.sug === 'כרמל חטיבה')!
    .times.find((t) => t.time === '06:00-14:00 (למחרת)');
  assert.ok(crew, JSON.stringify(g.subTypes));
  assert.equal(crew.soldiers.length, 3);
});

test('the 8h night window is staffed by one 8h row (no split needed)', async () => {
  for (const [sub, soldier] of [
    ['כרמל חטיבה', 'חייל 24'], ['כרמל חטיבה', 'חייל 25'],
    ['כרמל חטיבה', 'חייל 26'], ['מפקד כרמל חטיבה', 'חייל 02'],
  ] as const) await addRow(sub, soldier, 8, 16);    // 22:00 → 06:00

  const findings = await validateDay(DAY);
  const gaps = findings.filter((f) => f.rule === 'coverage'
    && f.message.includes('כרמל') && / 22:00:/.test(f.message));
  assert.deepEqual(gaps, [], JSON.stringify(gaps));
  const marked = unfilledCells(await draftDay()).filter((c) => /\|22:00-/.test(c));
  assert.deepEqual(marked, [], marked.join(', '));
});

test('a genuinely empty slot is still reported by BOTH surfaces', async () => {
  // nothing was ever added for the 14:00 shift
  const findings = await validateDay(DAY);
  assert.ok(findings.some((f) => f.rule === 'coverage' && f.severity === 'error'
    && f.message.includes('כרמל חטיבה') && f.message.includes('14:00')),
    JSON.stringify(findings.filter((f) => f.rule === 'coverage')));

  const cells = unfilledCells(await draftDay());
  assert.ok(cells.includes('כרמל חטיבה|14:00-18:00|3'), cells.join(', '));
  assert.ok(cells.includes('מפקד כרמל חטיבה|14:00-18:00|1'), cells.join(', '));
});

test('a half-covered slot is reported by BOTH surfaces', async () => {
  // one of the three 18:00 regular seats taken — 2 still missing
  await query(
    `insert into shift_assignments
       (day, position_id, sub_position_id, soldier_id, period, source, blocks_overlap)
     values ($1::date, $2, $3, $4,
             tsrange($1::date + time '18:00', $1::date + time '22:00'), 'import', false)`,
    [DAY, await posId('כרמל חטיבה'), await subId('כרמל חטיבה', 'כרמל חטיבה'),
     await soldierId('חייל 31')]);

  const findings = await validateDay(DAY);
  assert.ok(findings.some((f) => f.rule === 'coverage'
    && f.message.includes('כרמל חטיבה 18:00') && f.message.includes('1/3')),
    JSON.stringify(findings.filter((f) => f.rule === 'coverage')));

  const cells = unfilledCells(await draftDay());
  assert.ok(cells.includes('כרמל חטיבה|18:00-22:00|2'), cells.join(', '));
});
