// Task 1: סיור נהג דוד shortage PRIORITY (owner 2026-07-24). When drivers are
// too few for every patrol crew, the scarce נהג דוד stay with the earlier
// crews — noon (14:00) keeps a driver longest, then night (22:00), and the
// morning (06:00) crew goes without first. A driverless morning crew on a
// genuinely-exhausted pool is a WARNING (not an error); a skipped/available
// driver or a priority violation stays an error.
import './env.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { freshSchema, seedSoldiers, closePool, query } from './helpers.js';
import { generate, persist } from '../src/generate.js';
import { validateDay } from '../src/validate.js';

// hour-of-day of a patrol crew start, from lower(period)
type Crew = { hh: number; drivers: number };
async function patrolCrews(day: string): Promise<Crew[]> {
  const rows = await query<{ hh: string; drivers: string }>(`
    select extract(hour from lower(sa.period))::int hh,
           count(*) filter (where exists (
             select 1 from soldier_qualifications q
             where q.soldier_id = sa.soldier_id and q.qualification = 'נהג דוד')) drivers
    from shift_assignments sa join positions p on p.id = sa.position_id
    where sa.day = $1 and p.name = 'סיור'
    group by 1 order by 1`, [day]);
  return rows.map((r) => ({ hh: Number(r.hh), drivers: Number(r.drivers) }));
}
const driverFindings = async (day: string) =>
  (await validateDay(day)).filter((f) => f.rule === 'driver');

const outForDay = (names: string[], day: string) =>
  query(`insert into unavailability (soldier_id, period, kind)
         select id, tsrange(day_start($1), day_start($1) + interval '1 day'), 'חופש'
         from soldiers where full_name = any($2)`, [day, names]);

before(async () => {
  await freshSchema();
  await seedSoldiers();   // seeds 4 נהג דוד: חייל 11,12,15,16
});
after(closePool);

test('(a) enough drivers: all three patrol crews carry a נהג דוד, no driver finding', async () => {
  const D = '2026-09-01';
  await persist(await generate(D));
  const crews = await patrolCrews(D);
  assert.equal(crews.length, 3, 'three patrol crews exist');
  for (const c of crews) assert.ok(c.drivers >= 1, `crew ${c.hh}:00 has no נהג דוד`);
  assert.deepEqual(await driverFindings(D), [], 'no driver finding when the pool suffices');
});

test('(b) two drivers: noon + night covered, morning without — WARNING not error', async () => {
  const D = '2026-09-02';
  await outForDay(['חייל 15', 'חייל 16'], D);   // leaves exactly 2 נהג דוד
  await persist(await generate(D));
  const crews = await patrolCrews(D);
  const by = new Map(crews.map((c) => [c.hh, c.drivers]));
  assert.ok((by.get(14) ?? 0) >= 1, 'noon (14:00) crew keeps a driver');
  assert.ok((by.get(22) ?? 0) >= 1, 'night (22:00) crew keeps a driver');
  assert.equal(by.get(6) ?? 0, 0, 'morning (06:00) crew is the one without a driver');

  const f = await driverFindings(D);
  assert.ok(f.some((x) => x.severity === 'warning' && x.message.includes('06:00')),
    `morning driverless crew must be a WARNING: ${JSON.stringify(f)}`);
  assert.equal(f.filter((x) => x.severity === 'error').length, 0,
    `no driver ERROR when the pool is exhausted and only the lowest-priority crew lacks a driver: ${JSON.stringify(f)}`);
});

test('(c) one driver: noon crew keeps it; no driver error', async () => {
  const D = '2026-09-03';
  await outForDay(['חייל 12', 'חייל 15', 'חייל 16'], D);   // leaves exactly 1 נהג דוד
  await persist(await generate(D));
  const by = new Map((await patrolCrews(D)).map((c) => [c.hh, c.drivers]));
  assert.ok((by.get(14) ?? 0) >= 1, 'the single driver goes to the noon (14:00) crew');

  const f = await driverFindings(D);
  assert.equal(f.filter((x) => x.severity === 'error').length, 0,
    `night/morning driverless crews are warnings, not errors: ${JSON.stringify(f)}`);
});
