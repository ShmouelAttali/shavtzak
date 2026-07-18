// T4 chain identity checks: T4a — the carmel commander is the highest-rifle
// member of the descending crew; T4c — the גשש pick is the lowest-tracker
// eligible member of the descending patrol crew.
import './env.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { freshSchema, seedSoldiers, closePool, query } from './helpers.js';
import { generate, persist } from '../src/generate.js';

const D1 = '2026-08-01', D2 = '2026-08-02';

before(async () => {
  await freshSchema();
  await seedSoldiers();
  // distinct rifle levels so the T4a "highest rifle" identity is unambiguous
  await query(`update soldiers set rifle_level = 10 + id`);
  for (const d of [D1, D2]) await persist(await generate(d));
});
after(closePool);

test('T4a: carmel commander is a real מפקד from the crew, else the highest rifle', async () => {
  const rows = await query<{ start: string; sub: string; soldier_id: string; rifle: number; role: string }>(`
    select lower(sa.period)::text start, sp.name sub, sa.soldier_id::text, s.rifle_level rifle,
           coalesce(s.role, '') role
    from shift_assignments sa
    join positions p on p.id = sa.position_id
    join sub_positions sp on sp.id = sa.sub_position_id
    join soldiers s on s.id = sa.soldier_id
    where p.name = 'כרמל חטיבה' and sa.day = $1`, [D2]);
  const isCmdRole = (role: string) => ['מ"מ', 'סמל', 'מ"כ', 'מ"ח'].includes(role);
  const byStart = new Map<string, typeof rows>();
  for (const r of rows) (byStart.get(r.start) ?? byStart.set(r.start, []).get(r.start)!).push(r);
  assert.ok(byStart.size >= 4, 'carmel shifts exist');
  for (const [start, crew] of byStart) {
    const cmd = crew.find((r) => r.sub === 'מפקד כרמל חטיבה');
    assert.ok(cmd, `${start}: commander seat filled`);
    const commanders = crew.filter((r) => isCmdRole(r.role));
    if (commanders.length) {
      // owner rule: prefer a defined מפקד from the crew (highest rifle among them)
      const maxCmdRifle = Math.max(...commanders.map((r) => Number(r.rifle)));
      assert.ok(isCmdRole(cmd!.role), `${start}: crew has a מפקד but seat went to role "${cmd!.role}"`);
      assert.equal(Number(cmd!.rifle), maxCmdRifle,
        `${start}: commander rifle ${cmd!.rifle} != commanders' max ${maxCmdRifle}`);
    } else {
      const maxRifle = Math.max(...crew.map((r) => Number(r.rifle)));
      assert.equal(Number(cmd!.rifle), maxRifle,
        `${start}: commander rifle ${cmd!.rifle} != crew max ${maxRifle}`);
    }
  }
});

test('T4c: the גשש pick has the lowest tracker hours among eligible crew members', async () => {
  // give two members of D2's 14:00-descending patrol crew (the 22:00 window
  // source) old tracker history (>7 days back — outside the fairness window,
  // so re-generation keeps the same schedule; only tracker totals change)
  const crew = await query<{ soldier_id: string }>(`
    select sa.soldier_id::text from shift_assignments sa
    join positions p on p.id = sa.position_id
    where p.name = 'סיור' and sa.day = $1 and lower(sa.period) = day_start($1)`, [D2]);
  assert.equal(crew.length, 4, 'patrol crew of 4');
  const gash = await query<{ soldier_id: string }>(`
    select sa.soldier_id::text from shift_assignments sa
    join positions p on p.id = sa.position_id
    where p.name = 'כונן גשש' and sa.day = $1
      and lower(sa.period) = day_start($1) + interval '8 hours'`, [D2]);
  assert.equal(gash.length, 1, '22:00 גשש window staffed');
  // load the originally-picked member (and one more) with old tracker hours
  const picked = gash[0].soldier_id;
  const another = crew.find((c) => c.soldier_id !== picked)!.soldier_id;
  await query(`insert into schedule_days (day) values ('2026-07-20') on conflict do nothing`);
  await query(`insert into shift_assignments (day, position_id, soldier_id, period, source, blocks_overlap)
               select '2026-07-20', (select id from positions where name = 'כונן גשש'), sid,
                      tsrange('2026-07-20 22:00', '2026-07-21 07:00'), 'import', false
               from unnest(array[$1::bigint, $2::bigint]) sid`, [picked, another]);

  await persist(await generate(D2));
  const gash2 = await query<{ soldier_id: string }>(`
    select sa.soldier_id::text from shift_assignments sa
    join positions p on p.id = sa.position_id
    where p.name = 'כונן גשש' and sa.day = $1
      and lower(sa.period) = day_start($1) + interval '8 hours'`, [D2]);
  assert.equal(gash2.length, 1);
  assert.notEqual(gash2[0].soldier_id, picked,
    'the loaded member must lose the window to a zero-tracker crew mate');
  // identity: the pick carries the minimum tracker hours among ELIGIBLE crew
  // members (no other assignment overlapping the 22:00-07:00 window) of the
  // best "slept the previous night" tier (R3 preference)
  const eligible = await query<{ soldier_id: string; tracker: string; slept: boolean }>(`
    select f.soldier_id::text, f.tracker_hours_total::text tracker,
      not exists (
        select 1 from shift_assignments n
        join positions np on np.id = n.position_id
        where n.soldier_id = f.soldier_id and n.blocks_overlap
          and np.mission_class <> 'readiness'
          and not coalesce((np.config->>'night_exempt')::boolean, (np.config->>'daily')::boolean, false)
          and n.period && tsrange($1::date::timestamp, $1::date::timestamp + interval '6 hours')
      ) slept
    from soldier_fairness($1) f
    where f.soldier_id = any($2::bigint[])
      and not exists (
        select 1 from shift_assignments x
        where x.soldier_id = f.soldier_id and x.blocks_overlap
          and x.period && tsrange(day_start($1) + interval '8 hours',
                                  day_start($1) + interval '17 hours'))`,
    [D2, crew.map((c) => c.soldier_id)]);
  const tier = eligible.some((e) => e.slept) ? eligible.filter((e) => e.slept) : eligible;
  const minTracker = Math.min(...tier.map((e) => Number(e.tracker)));
  const pickRow = tier.find((e) => e.soldier_id === gash2[0].soldier_id);
  assert.ok(pickRow, 'pick is an eligible crew member of the best slept tier');
  assert.equal(Number(pickRow!.tracker), minTracker);
});
