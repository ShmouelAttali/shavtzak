import './env.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { freshSchema, seedSoldiers, soldierId, closePool, query } from './helpers.js';
import { generate, persist } from '../src/generate.js';
import { validateDay } from '../src/validate.js';
import { RationaleEntry } from '../src/rationale.js';

const D1 = '2026-08-01', D2 = '2026-08-02', D3 = '2026-08-03', D4 = '2026-08-04';

// synthetic candidates (seed.sql's real-name rules are replaced for the test DB)
const KASHAR = ['חייל 20', 'חייל 21', 'חייל 22'];
const XOVESH = ['חייל 23', 'חייל 24'];
const NAHAG = ['חייל 25', 'חייל 26'];

const hafakSeat = (day: string, sub: string) => query<{ full_name: string; rationale: RationaleEntry[] }>(`
  select s.full_name, sa.rationale from shift_assignments sa
  join soldiers s on s.id = sa.soldier_id
  join sub_positions sp on sp.id = sa.sub_position_id
  where sa.day = $1 and sa.position_id = 6 and sp.name = $2`, [day, sub]);

before(async () => {
  await freshSchema();
  await seedSoldiers();
  await query(`update soldiers set role = 'מ"פ' where full_name = 'חייל 55'`);
  await query(`update soldiers set role = 'סמ"פ' where full_name = 'חייל 56'`);
  await query(`update positions set config = config || $1::jsonb where id = 6`, [JSON.stringify({
    seat_rules: [
      { sub: 'מפקד', roles: ['מ"פ', 'סמ"פ'], commander: true },
      { sub: 'קשר', soldiers: KASHAR, ordered: true, release_unpicked: true },
      { sub: 'חובש', soldiers: XOVESH },
      { sub: 'נהג', soldiers: NAHAG },
    ],
  })]);
  for (const d of [D1, D2]) await persist(await generate(d));
});
after(closePool);

test('all four seats filled by their dedicated candidates (H6b)', async () => {
  const expect: [string, string[]][] = [
    ['מפקד', ['חייל 55']],       // מ"פ preferred over סמ"פ
    ['קשר', [KASHAR[0]]],        // ordered list -> first available
    ['חובש', XOVESH],
    ['נהג', NAHAG],
  ];
  for (const [sub, allowed] of expect) {
    const rows = await hafakSeat(D1, sub);
    assert.equal(rows.length, 1, `${sub}: expected exactly one assignment`);
    assert.ok(allowed.includes(rows[0].full_name), `${sub}: got ${rows[0].full_name}`);
    assert.ok(rows[0].rationale.some((e) => e.code === 'seat_rule' && e.params?.seat === sub),
      `${sub}: missing seat_rule rationale`);
  }
});

test('unchosen non-release candidates are reserved -> מנוחה, never elsewhere', async () => {
  const [chosen] = await hafakSeat(D1, 'חובש');
  const unchosen = XOVESH.find((n) => n !== chosen.full_name)!;
  const sid = await soldierId(unchosen);
  const elsewhere = await query(`
    select 1 from shift_assignments sa join positions p on p.id = sa.position_id
    where sa.day = $1 and sa.soldier_id = $2 and p.name <> 'חפק'`, [D1, sid]);
  assert.equal(elsewhere.length, 0, `${unchosen} assigned outside חפק`);
  const rest = await query(`
    select 1 from day_assignments da join positions p on p.id = da.position_id
    where da.day = $1 and da.soldier_id = $2 and p.name = 'מנוחה'`, [D1, sid]);
  assert.equal(rest.length, 1, `${unchosen} not in מנוחה`);
});

test('unordered pairs rotate by fairness across days', async () => {
  const d1 = (await hafakSeat(D1, 'חובש'))[0].full_name;
  const d2 = (await hafakSeat(D2, 'חובש'))[0].full_name;
  assert.notEqual(d1, d2, 'חובש must alternate between the two candidates');
});

test('ordered קשר list does NOT rotate — first available always wins', async () => {
  assert.equal((await hafakSeat(D2, 'קשר'))[0].full_name, KASHAR[0]);
});

test('מפקד falls back to סמ"פ when מ"פ unavailable; empty + flag when neither', async () => {
  const mp = await soldierId('חייל 55'), smp = await soldierId('חייל 56');
  await query(`insert into unavailability (soldier_id, period, kind)
               values ($1, tsrange(day_start($2), day_start($2) + interval '1 day'), 'חופש')`, [mp, D3]);
  await persist(await generate(D3));
  assert.equal((await hafakSeat(D3, 'מפקד'))[0].full_name, 'חייל 56');

  await query(`insert into unavailability (soldier_id, period, kind)
               values ($1, tsrange(day_start($3), day_start($3) + interval '1 day'), 'חופש'),
                      ($2, tsrange(day_start($3), day_start($3) + interval '1 day'), 'חופש')`,
    [mp, smp, D4]);
  const res = await generate(D4);
  await persist(res);
  assert.equal((await hafakSeat(D4, 'מפקד')).length, 0, 'seat must stay empty');
  assert.ok(res.issues.some((i) => i.includes('מושב מפקד')), JSON.stringify(res.issues));
  const findings = await validateDay(D4);
  assert.ok(findings.some((f) => f.rule === 'seat_rules' && f.severity === 'warning'
    && f.message.includes('מפקד')), JSON.stringify(findings.filter((f) => f.rule === 'seat_rules')));
  await query(`delete from unavailability`);
});

test('validator errors when a reserved candidate is assigned elsewhere', async () => {
  const sid = await soldierId(NAHAG[0]);
  await query(`insert into shift_assignments (day, position_id, soldier_id, period, source, blocks_overlap)
               values ($1, 1, $2, tsrange(day_start($1) + interval '16 hours', day_start($1) + interval '20 hours'), 'manual', false)`,
    [D2, sid]);
  const findings = await validateDay(D2);
  assert.ok(findings.some((f) => f.rule === 'seat_rules' && f.severity === 'error' && f.soldierId === sid),
    JSON.stringify(findings.filter((f) => f.rule === 'seat_rules')));
  await query(`delete from shift_assignments where day = $1 and soldier_id = $2 and source = 'manual'`, [D2, sid]);
});

test('no seat_rules errors on clean generated days', async () => {
  for (const d of [D1, D2]) {
    const errs = (await validateDay(d)).filter((f) => f.rule === 'seat_rules' && f.severity === 'error');
    assert.deepEqual(errs, [], `day ${d}`);
  }
});

test('allowed_positions (H6c): whitelisted soldier serves only there, incl. chains', async () => {
  const sid = await soldierId('חייל 30');
  await query(`update soldiers set allowed_positions = array['סיור'] where id = $1`, [sid]);
  const D5 = '2026-08-05', D6 = '2026-08-06';
  for (const d of [D5, D6]) await persist(await generate(d));
  const wrong = await query(`
    select p.name from shift_assignments sa join positions p on p.id = sa.position_id
    where sa.soldier_id = $1 and sa.day in ($2, $3) and p.name <> 'סיור'`, [sid, D5, D6]);
  assert.deepEqual(wrong, [], 'restricted soldier assigned outside סיור');
  await query(`update soldiers set allowed_positions = null where id = $1`, [sid]);
});

test('allowed_positions: validator errors on out-of-whitelist assignment', async () => {
  const sid = await soldierId('חייל 31');
  await query(`update soldiers set allowed_positions = array['סיור'] where id = $1`, [sid]);
  await query(`insert into shift_assignments (day, position_id, soldier_id, period, source, blocks_overlap)
               values ($1, 2, $2, tsrange(day_start($1) + interval '26 hours', day_start($1) + interval '30 hours'), 'manual', false)`, [D2, sid]);
  const findings = await validateDay(D2);
  assert.ok(findings.some((f) => f.rule === 'allowed_positions' && f.soldierId === sid),
    JSON.stringify(findings.filter((f) => f.rule === 'allowed_positions')));
  await query(`delete from shift_assignments where soldier_id = $1 and source = 'manual'`, [sid]);
  await query(`update soldiers set allowed_positions = null where id = $1`, [sid]);
});
