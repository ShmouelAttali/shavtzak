import './env.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { freshSchema, seedSoldiers, soldierId, closePool, query } from './helpers.js';
import { generate, persist } from '../src/generate.js';
import { validateDay } from '../src/validate.js';
import { RATIONALE_CODES, RationaleEntry } from '../src/rationale.js';

const D1 = '2026-08-01', D2 = '2026-08-02', D3 = '2026-08-03';

before(async () => {
  await freshSchema();
  await seedSoldiers();
  // seed.sql's חפק seat rules name real soldiers — remap to synthetic ones so
  // the seats fill and the coverage rule sees a fully-staffable roster
  await query(`update soldiers set role = 'מ"פ' where full_name = 'חייל 55'`);
  await query(`update positions set config = config || $1::jsonb where id = 6`, [JSON.stringify({
    seat_rules: [
      { sub: 'מפקד', roles: ['מ"פ'], commander: true },
      { sub: 'קשר', soldiers: ['חייל 20', 'חייל 21'], ordered: true, release_unpicked: true },
      { sub: 'חובש', soldiers: ['חייל 23', 'חייל 24'] },
      { sub: 'נהג', soldiers: ['חייל 25', 'חייל 26'] },
    ],
  })]);
  for (const d of [D1, D2, D3]) {
    const res = await generate(d);
    await persist(res);
  }
});
after(closePool);

test('no unfilled seats after warm-up day', async () => {
  const res = await generate(D3);           // dry re-run for inspection
  const unfilled = res.issues.filter((i) => i.includes('לא אויש'));
  assert.deepEqual(unfilled, []);
});

test('no overlapping blocking assignments (H3)', async () => {
  const rows = await query(`
    select count(*) n from shift_assignments a
    join shift_assignments b on b.soldier_id = a.soldier_id and b.id > a.id
      and a.period && b.period and a.blocks_overlap and b.blocks_overlap`);
  assert.equal(Number(rows[0].n), 0);
});

test('one Level-1 position per soldier per day (H4) and full coverage', async () => {
  const dup = await query(`
    select day, soldier_id from day_assignments group by 1,2 having count(*) > 1`);
  assert.equal(dup.length, 0);
  const missing = await query(`
    select s.id from soldiers s
    where s.is_schedulable and not exists
      (select 1 from day_assignments da where da.soldier_id = s.id and da.day = $1)`, [D2]);
  assert.equal(missing.length, 0);
});

test('daily cap: counted mission hours <= 8 (R4)', async () => {
  const rows = await query(`
    select sa.day, sa.soldier_id, sum(least(hours(sa.period), 8)) h
    from shift_assignments sa join positions p on p.id = sa.position_id
    where p.mission_class not in ('readiness','rest')
    group by 1,2 having sum(least(hours(sa.period), 8)) > 8.01`);
  assert.deepEqual(rows, []);
});

test('validator: no errors on generated days', async () => {
  for (const d of [D2, D3]) {
    const findings = await validateDay(d);
    const errors = findings.filter((f) => f.severity === 'error');
    assert.deepEqual(errors, [], `day ${d}: ${JSON.stringify(errors)}`);
  }
});

test('chained duties: carmel/konenut/tracker crews descend from source shifts (T4)', async () => {
  const findings = await validateDay(D3);
  assert.deepEqual(findings.filter((f) => f.rule === 'chain' && f.severity === 'error'), []);
});

test('tracker: exactly one soldier per כונן גשש window (T4c)', async () => {
  const rows = await query(`
    select lower(sa.period) s, count(*) n
    from shift_assignments sa join positions p on p.id = sa.position_id
    where p.name = 'כונן גשש' and sa.day = $1 group by 1`, [D3]);
  assert.ok(rows.length >= 1, 'tracker windows exist');
  for (const r of rows) assert.equal(Number(r.n), 1);
});

test('unavailable soldier is never assigned (H1)', async () => {
  const sid = await soldierId('חייל 20');
  await query(`insert into unavailability (soldier_id, period, kind)
               values ($1, tsrange(day_start($2), day_start($2) + interval '1 day'), 'חופש')`, [sid, D3]);
  const res = await generate(D3);
  await persist(res);
  const rows = await query(`
    select 1 from shift_assignments where soldier_id = $1 and day = $2`, [sid, D3]);
  assert.equal(rows.length, 0);
  // fully-unavailable soldier lands in the בבית bucket, not מנוחה
  const bucket = await query<{ name: string }>(`
    select p.name from day_assignments da join positions p on p.id = da.position_id
    where da.soldier_id = $1 and da.day = $2`, [sid, D3]);
  assert.equal(bucket[0]?.name, 'בבית');
  await query(`delete from unavailability where soldier_id = $1`, [sid]);
});

test('partial-day unavailability never lands in בבית', async () => {
  const sid = await soldierId('חייל 21');
  await query(`insert into unavailability (soldier_id, period, kind)
               values ($1, tsrange(day_start($2) + interval '4 hours', day_start($2) + interval '8 hours'), 'יציאה')`, [sid, D3]);
  await persist(await generate(D3));
  const bucket = await query<{ name: string }>(`
    select p.name from day_assignments da join positions p on p.id = da.position_id
    where da.soldier_id = $1 and da.day = $2`, [sid, D3]);
  assert.notEqual(bucket[0]?.name, 'בבית');
  await query(`delete from unavailability where soldier_id = $1`, [sid]);
  await persist(await generate(D3));   // restore clean D3 for later tests
});

test('locked assignment survives regeneration', async () => {
  const [row] = await query(`
    select id, soldier_id from shift_assignments
    where day = $1 and source = 'auto' limit 1`, [D3]);
  await query(`update shift_assignments set locked = true where id = $1`, [row.id]);
  const res = await generate(D3);
  await persist(res);
  const kept = await query(`select 1 from shift_assignments where id = $1`, [row.id]);
  assert.equal(kept.length, 1);
  await query(`update shift_assignments set locked = false where id = $1`, [row.id]);
});

test('regeneration is stable (same row count)', async () => {
  const n1 = await query(`select count(*) n from shift_assignments where day = $1`, [D2]);
  const res = await generate(D2);
  await persist(res);
  const n2 = await query(`select count(*) n from shift_assignments where day = $1`, [D2]);
  assert.equal(Number(n2[0].n), Number(n1[0].n));
});

test('מגן continuity: same crew on consecutive days, all one platoon', async () => {
  const crews = await query(`
    select da.day::text, array_agg(da.soldier_id order by da.soldier_id) crew,
           count(distinct s.platoon) platoons
    from day_assignments da join soldiers s on s.id = da.soldier_id
    where da.position_id = (select id from positions where name = 'מגן')
      and da.day in ($1, $2) group by da.day order by da.day`, [D2, D3]);
  assert.equal(crews.length, 2);
  assert.deepEqual(crews[0].crew, crews[1].crew, 'crew must repeat (continuity)');
  for (const c of crews) assert.equal(Number(c.platoons), 1, 'crew must be one platoon');
});

test('תורנים and קצין מוצב run the full schedule day (14:00→14:00)', async () => {
  const rows = await query(`
    select p.name, lower(sa.period)::text lo,
           extract(epoch from (upper(sa.period) - lower(sa.period))) / 3600 dur_h
    from shift_assignments sa join positions p on p.id = sa.position_id
    where sa.day = $1 and p.name in ('תורנים', 'קצין מוצב')`, [D3]);
  assert.ok(rows.length >= 3, 'תורנים + קצין מוצב rows exist');
  for (const r of rows) {
    assert.ok(String(r.lo).includes('14:00:00'), `${r.name}: starts at ${r.lo}`);
    assert.equal(Number(r.dur_h), 24, `${r.name}: duration ${r.dur_h}h`);
  }
});

test('seat override changes crew size, continuity keeps existing members', async () => {
  const D4 = '2026-08-04';
  const magen = `(select id from positions where name = 'מגן')`;
  await query(`insert into seat_overrides (position_id, valid_from, seats, note)
               values ((select id from positions where name = 'מגן'), $1, 12, 'test')`, [D4]);
  const res = await generate(D4);
  await persist(res);
  const rows = await query(`
    select count(*) total,
           count(*) filter (where exists (select 1 from day_assignments y
             where y.day = $2 and y.soldier_id = da.soldier_id and y.position_id = ${magen})) kept
    from day_assignments da where da.day = $1 and da.position_id = ${magen}`, [D4, D3]);
  assert.equal(Number(rows[0].total), 12);
  assert.equal(Number(rows[0].kept), 10);
  await query(`delete from seat_overrides where note = 'test'`);
  await query(`delete from shift_assignments where day = $1`, [D4]);
  await query(`delete from day_assignments where day = $1`, [D4]);
});

test('no duplicate soldier within a single slot/crew (H7)', async () => {
  const dup = await query(`
    select day, position_id, lower(period) s, soldier_id, count(*)
    from shift_assignments where day between $1 and $2
    group by 1,2,3,4 having count(*) > 1`, [D1, D3]);
  assert.deepEqual(dup, []);
});

test('rationale: every generated row explains itself with known codes', async () => {
  const rows = await query<{ rationale: RationaleEntry[] }>(`
    select rationale from shift_assignments
    where source in ('auto','chain') and day between $1 and $2`, [D1, D3]);
  assert.ok(rows.length > 0, 'generated rows exist');
  const known = new Set<string>(RATIONALE_CODES);
  for (const r of rows) {
    assert.ok(Array.isArray(r.rationale) && r.rationale.length > 0, 'empty rationale');
    for (const e of r.rationale) assert.ok(known.has(e.code), `unknown code: ${e.code}`);
  }
});

test('rationale: chained overlays record their source shift (T4)', async () => {
  const rows = await query<{ name: string; rationale: RationaleEntry[] }>(`
    select p.name, sa.rationale from shift_assignments sa
    join positions p on p.id = sa.position_id
    where sa.source = 'chain' and sa.day between $1 and $2`, [D1, D3]);
  assert.ok(rows.length > 0, 'chain rows exist');
  for (const r of rows) {
    const chain = r.rationale.find((e) => e.code === 'chain');
    assert.ok(chain, `${r.name}: no chain entry`);
    assert.ok(chain!.params?.source, `${r.name}: missing source`);
    assert.ok(chain!.params?.sourceStart, `${r.name}: missing sourceStart`);
  }
});

test('rationale: returning מגן crew members carry continuity_crew', async () => {
  const rows = await query<{ rationale: RationaleEntry[] }>(`
    select sa.rationale from shift_assignments sa
    join positions p on p.id = sa.position_id
    where p.name = 'מגן' and sa.day = $1 and sa.source = 'auto'
      and exists (select 1 from day_assignments da
                  where da.day = $2 and da.soldier_id = sa.soldier_id
                    and da.position_id = sa.position_id)`, [D3, D2]);
  assert.ok(rows.length > 0, 'returning מגן rows exist');
  for (const r of rows) {
    assert.ok(r.rationale.some((e) => e.code === 'continuity_crew'), JSON.stringify(r.rationale));
  }
});

test('rationale: fallback violations map to structured caveats + counterfactual', async () => {
  const rows = await query<{ violations: string[]; rationale: RationaleEntry[] }>(`
    select violations, rationale from shift_assignments
    where source in ('auto','chain') and day between $1 and $2`, [D1, D3]);
  for (const r of rows) {
    const codes = new Set(r.rationale.map((e) => e.code));
    for (const v of r.violations) {
      if (v === 'הושלם ממנוחה') {
        assert.ok(codes.has('pulled_from_rest') && codes.has('caveat_no_alternative'), v);
      } else if (v.includes('פחות מ-4')) {
        assert.ok(codes.has('caveat_rest_lt4') && codes.has('caveat_no_alternative'), v);
      } else if (v.includes('פחות מ-8')) {
        assert.ok(codes.has('caveat_rest_lt8_long') && codes.has('caveat_no_alternative'), v);
      }
    }
  }
});

test('rationale: fewest_nights claims are honest vs the pick-time median', async () => {
  const rows = await query<{ rationale: RationaleEntry[] }>(`
    select rationale from shift_assignments
    where source = 'auto' and day between $1 and $2`, [D1, D3]);
  let seen = 0;
  for (const r of rows) {
    for (const e of r.rationale) {
      if (e.code !== 'fewest_nights') continue;
      seen++;
      assert.ok(Number(e.params!.nights) <= Number(e.params!.median),
        `dishonest claim: ${JSON.stringify(e.params)}`);
    }
  }
  assert.ok(seen > 0, 'no fewest_nights entries to check');
});

test('fairness spread: nights differ by at most 2 across active soldiers', async () => {
  // dedicated crews (חפק named seats, מגן continuity) never rotate into
  // nights — measure the spread over the actual night-rotation pool
  const rows = await query(`
    select min(night_count_7d) lo, max(night_count_7d) hi
    from soldier_fairness($1) f
    join soldiers s on s.id = f.soldier_id
    where s.is_schedulable and f.mission_hours_7d > 0
      and s.id not in (
        select da.soldier_id from day_assignments da
        join positions p on p.id = da.position_id
        where p.name in ('חפק', 'מגן'))`, ['2026-08-04']);
  assert.ok(Number(rows[0].hi) - Number(rows[0].lo) <= 2,
    `nights spread too wide: ${rows[0].lo}-${rows[0].hi}`);
});
