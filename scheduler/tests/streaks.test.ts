import './env.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { freshSchema, seedSoldiers, soldierId, closePool, query } from './helpers.js';
import { validateDay } from '../src/validate.js';

// R6 consecutive nights + T3 static streak (post-hoc rules).
// Schedule day D runs 14:00→14:00; the night of D is calendar D+1 00:00–06:00.

const D1 = '2026-09-10', D2 = '2026-09-11', D3 = '2026-09-12';

async function manualRow(name: string, position: string, day: string, start: string, end: string) {
  const sid = await soldierId(name);
  await query(`
    insert into shift_assignments (day, position_id, soldier_id, period, source, blocks_overlap)
    select $1, p.id, $3, tsrange($4::timestamp, $5::timestamp), 'manual',
           p.mission_class <> 'readiness'
    from positions p where p.name = $2`,
    [day, position, sid, start, end]);
}

const night = (name: string, day: string, next: string) =>
  manualRow(name, 'סיור', day, `${next} 00:00`, `${next} 06:00`);

before(async () => {
  await freshSchema();
  await seedSoldiers();
  for (const d of [D1, D2, D3]) await query(`insert into schedule_days (day) values ($1)`, [d]);

  // חייל 40: nights on D1+D2+D3 (run of 3)
  await night('חייל 40', D1, '2026-09-11');
  await night('חייל 40', D2, '2026-09-12');
  await night('חייל 40', D3, '2026-09-13');
  // חייל 41: nights on D1 and D3 only (gap resets the run)
  await night('חייל 41', D1, '2026-09-11');
  await night('חייל 41', D3, '2026-09-13');
  // חייל 42: readiness covering all three nights — never counts as a night
  for (const [d, from, to] of [[D1, '2026-09-10', '2026-09-11'], [D2, '2026-09-11', '2026-09-12'], [D3, '2026-09-12', '2026-09-13']]) {
    await manualRow('חייל 42', 'התקפי', d, `${from} 14:00`, `${to} 14:00`);
  }
  // חייל 43: static-only on D1+D2+D3 (streak of 3)
  for (const d of [D1, D2, D3]) await manualRow('חייל 43', 'עמדות הגנה', d, `${d} 14:00`, `${d} 18:00`);
  // חייל 44: static, dynamic, static — dynamic day breaks the streak
  await manualRow('חייל 44', 'עמדות הגנה', D1, `${D1} 14:00`, `${D1} 18:00`);
  await manualRow('חייל 44', 'סיור', D2, `${D2} 14:00`, `${D2} 18:00`);
  await manualRow('חייל 44', 'עמדות הגנה', D3, `${D3} 14:00`, `${D3} 18:00`);
});
after(closePool);

const byRule = (f: Awaited<ReturnType<typeof validateDay>>, rule: string, name: string) =>
  f.filter((x) => x.rule === rule && x.message.includes(name));

test('R6: second consecutive night reported as warning', async () => {
  const f = await validateDay(D2);
  const hits = byRule(f, 'consecutive_nights', 'חייל 40');
  assert.equal(hits.length, 1, JSON.stringify(f.filter((x) => x.rule === 'consecutive_nights')));
  assert.equal(hits[0].severity, 'warning');
});

test('R6: third consecutive night reported as error', async () => {
  const f = await validateDay(D3);
  const hits = byRule(f, 'consecutive_nights', 'חייל 40');
  assert.equal(hits.length, 1, JSON.stringify(f.filter((x) => x.rule === 'consecutive_nights')));
  assert.equal(hits[0].severity, 'error');
  assert.ok(hits[0].message.includes('3'), hits[0].message);
});

test('R6: a night-free day resets the run', async () => {
  for (const d of [D1, D3]) {
    const f = await validateDay(d);
    assert.deepEqual(byRule(f, 'consecutive_nights', 'חייל 41'), [], `day ${d}`);
  }
});

test('R6: readiness overlapping the night window does not count', async () => {
  for (const d of [D2, D3]) {
    const f = await validateDay(d);
    assert.deepEqual(byRule(f, 'consecutive_nights', 'חייל 42'), [], `day ${d}`);
  }
});

test('T3: third static-only day reported as warning', async () => {
  const f = await validateDay(D3);
  const hits = byRule(f, 'static_streak', 'חייל 43');
  assert.equal(hits.length, 1, JSON.stringify(f.filter((x) => x.rule === 'static_streak')));
  assert.equal(hits[0].severity, 'warning');
});

test('T3: no warning before the third day', async () => {
  const f = await validateDay(D2);
  assert.deepEqual(byRule(f, 'static_streak', 'חייל 43'), []);
});

test('T3: a dynamic day breaks the streak', async () => {
  const f = await validateDay(D3);
  assert.deepEqual(byRule(f, 'static_streak', 'חייל 44'), []);
});
