import './env.js';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { freshSchema, soldierId, closePool, query } from './helpers.js';
import { generate, persist } from '../src/generate.js';
import { validateDay } from '../src/validate.js';
import { RationaleEntry } from '../src/rationale.js';

// R5 generalized (full_rest_after) + the תורנים exception.
const D = '2026-08-20';
const Y = '2026-08-19';

async function addSoldier(pn: string, name: string) {
  await query(`insert into soldiers (personal_number, full_name, platoon, role, rifle_level)
               values ($1, $2, '1', 'לוחם', 3)`, [pn, name]);
}

async function manualRow(name: string, position: string, day: string, start: string, end: string) {
  const sid = await soldierId(name);
  await query(`insert into schedule_days (day) values ($1) on conflict do nothing`, [day]);
  await query(`
    insert into shift_assignments (day, position_id, soldier_id, period, source, blocks_overlap)
    select $1, p.id, $3, tsrange($4::timestamp, $5::timestamp), 'manual',
           p.mission_class <> 'readiness'
    from positions p where p.name = $2`, [day, position, sid, start, end]);
}

/** Fresh DB where only תורנים (2 seats, 14:00→14:00) is generated. */
async function toranimOnly() {
  await freshSchema();
  await query(`update positions set is_scheduled = false
               where name not in ('תורנים', 'מנוחה', 'בבית')`);
}

after(closePool);

test('R5: finishing קצין מוצב at 14:00 → eligible at 14:00 sharp (full rest, duty_rest)', async () => {
  await toranimOnly();
  await addSoldier('R001', 'רגיל אחד');
  await addSoldier('R002', 'קצין אתמול');
  await manualRow('קצין אתמול', 'קצין מוצב', Y, '2026-08-19 14:00', '2026-08-20 14:00');
  await persist(await generate(D));
  const rows = await query<{ violations: string[]; rationale: RationaleEntry[]; period: string }>(`
    select sa.violations, sa.rationale, sa.period::text period
    from shift_assignments sa
    join positions p on p.id = sa.position_id
    join soldiers s on s.id = sa.soldier_id
    where sa.day = $1 and p.name = 'תורנים' and s.full_name = 'קצין אתמול'`, [D]);
  assert.equal(rows.length, 1, JSON.stringify(rows));
  assert.ok(rows[0].period.includes('2026-08-20 14:00'), rows[0].period);
  assert.deepEqual(rows[0].violations, []);                 // primary pick, not בדוחק
  assert.ok(rows[0].rationale.some((e) => e.code === 'duty_rest'), JSON.stringify(rows[0].rationale));
  const f = await validateDay(D);
  assert.ok(!f.some((x) => x.rule === 'rest' && x.message.includes('קצין אתמול')), JSON.stringify(f));
});

test('R5: finishing חפק at 14:00 → a 14:00 start passes validation (gap 0)', async () => {
  await toranimOnly();
  await addSoldier('R003', 'חפק אתמול');
  // חפק is re-anchored to the full schedule day 14:00–14:00
  await manualRow('חפק אתמול', 'חפק', Y, '2026-08-19 14:00', '2026-08-20 14:00');
  await manualRow('חפק אתמול', 'עמדות הגנה', D, '2026-08-20 14:00', '2026-08-20 18:00');
  const f = await validateDay(D);
  assert.ok(!f.some((x) => x.rule === 'rest' && x.message.includes('חפק אתמול')), JSON.stringify(f));
});

test('R5: מגן continuity crew repeats back-to-back at gap 0 without בדוחק', async () => {
  await freshSchema();
  await query(`update positions set is_scheduled = false
               where name not in ('מגן', 'מנוחה', 'בבית')`);
  for (let i = 1; i <= 10; i++) await addSoldier(`M${String(i).padStart(2, '0')}`, `מגן ${i}`);
  await persist(await generate(Y));
  await persist(await generate(D));
  const rows = await query<{ violations: string[]; rationale: RationaleEntry[] }>(`
    select sa.violations, sa.rationale from shift_assignments sa
    join positions p on p.id = sa.position_id
    where p.name = 'מגן' and sa.day = $1`, [D]);
  assert.equal(rows.length, 10, JSON.stringify(rows));
  for (const r of rows) {
    assert.deepEqual(r.violations, [], JSON.stringify(r.rationale));
    assert.ok(r.rationale.some((e) => e.code === 'continuity_crew'), JSON.stringify(r.rationale));
    assert.ok(r.rationale.some((e) => e.code === 'duty_rest'), JSON.stringify(r.rationale));
  }
  const f = await validateDay(D);
  assert.deepEqual(f.filter((x) => x.rule === 'rest' && x.severity === 'error'), [], JSON.stringify(f));
  assert.deepEqual(f.filter((x) => x.rule === 'consecutive_nights' && x.severity === 'error'), [], JSON.stringify(f));
});

test('R5: finishing התקפי → 14:00 start of the new schedule day passes validation', async () => {
  await toranimOnly();
  await addSoldier('R004', 'תוקף אתמול');
  // ad-hoc attack recorded as a blocking mission row ending in the morning
  const sid = await soldierId('תוקף אתמול');
  await query(`insert into schedule_days (day) values ($1) on conflict do nothing`, [Y]);
  await query(`
    insert into shift_assignments (day, position_id, soldier_id, period, source, blocks_overlap)
    select $1, p.id, $2, tsrange('2026-08-20 02:00', '2026-08-20 06:00'), 'manual', true
    from positions p where p.name = 'התקפי'`, [Y, sid]);
  await manualRow('תוקף אתמול', 'עמדות הגנה', D, '2026-08-20 14:00', '2026-08-20 18:00');
  const f = await validateDay(D);
  assert.ok(!f.some((x) => x.rule === 'rest' && x.message.includes('תוקף אתמול')), JSON.stringify(f));
});

test('תורנים exception: an immediate 14:00 start is flagged as a rest error', async () => {
  await toranimOnly();
  await addSoldier('R005', 'תורן אתמול');
  await manualRow('תורן אתמול', 'תורנים', Y, '2026-08-19 14:00', '2026-08-20 14:00');
  await manualRow('תורן אתמול', 'עמדות הגנה', D, '2026-08-20 14:00', '2026-08-20 18:00');
  const f = await validateDay(D);
  assert.ok(f.some((x) => x.rule === 'rest' && x.severity === 'error'
    && x.message.includes('תורן אתמול')), JSON.stringify(f));
});

test('תורנים exception: generator takes him at 14:00 only בדוחק (fallback)', async () => {
  await toranimOnly();
  await addSoldier('R006', 'רגיל אחד');
  await addSoldier('R007', 'תורן אתמול');
  await manualRow('תורן אתמול', 'תורנים', Y, '2026-08-19 14:00', '2026-08-20 14:00');
  await persist(await generate(D));
  const rows = await query<{ violations: string[] }>(`
    select sa.violations from shift_assignments sa
    join positions p on p.id = sa.position_id
    join soldiers s on s.id = sa.soldier_id
    where sa.day = $1 and p.name = 'תורנים' and s.full_name = 'תורן אתמול'`, [D]);
  assert.equal(rows.length, 1, JSON.stringify(rows));
  assert.ok(rows[0].violations.some((v) => v.includes('בדוחק') && v.includes('פחות מ-4')),
    JSON.stringify(rows[0].violations));
});

test('תורנים exception: eligible at 18:00 for a short task (warning only, not בדוחק)', async () => {
  await freshSchema();
  // single 4h defense window at 18:00 (שג post only)
  await query(`update positions set is_scheduled = false
               where name not in ('עמדות הגנה', 'מנוחה', 'בבית')`);
  await query(`delete from slot_templates
               where position_id <> (select id from positions where name = 'עמדות הגנה')
                  or sub_position_id <> 1 or start_time <> '18:00'`);
  await addSoldier('R008', 'תורן אתמול');
  await manualRow('תורן אתמול', 'תורנים', Y, '2026-08-19 14:00', '2026-08-20 14:00');
  await persist(await generate(D));
  const rows = await query<{ violations: string[] }>(`
    select sa.violations from shift_assignments sa
    join positions p on p.id = sa.position_id
    join soldiers s on s.id = sa.soldier_id
    where sa.day = $1 and p.name = 'עמדות הגנה' and s.full_name = 'תורן אתמול'`, [D]);
  assert.equal(rows.length, 1, JSON.stringify(rows));
  assert.ok(rows[0].violations.some((v) => v.includes('מנוחה קצרה')), JSON.stringify(rows[0].violations));
  assert.ok(!rows[0].violations.some((v) => v.includes('בדוחק')), JSON.stringify(rows[0].violations));
});
