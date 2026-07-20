import './env.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { freshSchema, closePool, query } from './helpers.js';
import { generate, persist } from '../src/generate.js';
import { GenerateResult } from '../src/model.js';
import { validateDay } from '../src/validate.js';

const D = '2026-08-10';

// Everyone-works reporting vs H6b seat reservations (owner, 2026-07-19):
// the unchosen candidate of a NON-release seat rule (the חפק מ"פ/סמ"פ
// commander seat) rests BY DESIGN — no generation issue, no rest_bucket
// warning. A plain available soldier left in מנוחה is still flagged by both.
// Scenario: only חפק + תורנים scheduled; roster: מ"פ + סמ"פ (commander-seat
// candidates; one is picked, the other reserved-resting), two לוחמים for
// תורנים, and a third לוחם with nowhere to work (מגן not scheduled → no
// absorb) who must still be flagged.
let res: GenerateResult;

before(async () => {
  await freshSchema();
  await query(`update positions set is_scheduled = false
               where name not in ('חפק', 'תורנים', 'מנוחה', 'בבית')`);
  // one non-release rule only: the commander seat (roles מ"פ→סמ"פ)
  await query(`update positions set config = jsonb_set(config, '{seat_rules}',
               '[{"sub": "מפקד", "roles": ["מ\\"פ", "סמ\\"פ"], "commander": true}]'::jsonb)
               where name = 'חפק'`);
  await query(`insert into soldiers (personal_number, full_name, platoon, role, rifle_level) values
    ('B001', 'המפ', '1', 'מ"פ', 3),
    ('B002', 'הסמפ', '1', 'סמ"פ', 3),
    ('B003', 'לוחם אחד', '1', 'לוחם', 3),
    ('B004', 'לוחם שניים', '1', 'לוחם', 3),
    ('B005', 'לוחם מיותר', '1', 'לוחם', 3)`);
  res = await generate(D);
  await persist(res);
});
after(closePool);

test('unchosen commander-seat candidate rests by design — no generation issue', async () => {
  // the מ"פ takes the seat (first in the roles order); the סמ"פ is reserved
  const rows = await query<{ name: string }>(`
    select s.full_name name from shift_assignments sa
    join positions p on p.id = sa.position_id
    join soldiers s on s.id = sa.soldier_id
    where sa.day = $1 and p.name = 'חפק'`, [D]);
  assert.deepEqual(rows.map((r) => r.name), ['המפ'], JSON.stringify(rows));
  assert.ok(!res.issues.some((i) => i.includes('הסמפ') && i.includes('נותר במנוחה')),
    res.issues.join(' | '));
  // the leftover regular soldier (whichever of the three didn't get תורנים)
  // IS still flagged
  assert.ok(res.issues.some((i) => i.includes('לוחם') && i.includes('נותר במנוחה')),
    res.issues.join(' | '));
});

test('validator rest_bucket skips seat-reserved candidates, keeps regular resters', async () => {
  const f = await validateDay(D);
  const bucket = f.filter((x) => x.rule === 'rest_bucket');
  assert.ok(!bucket.some((x) => x.message.includes('הסמפ')), JSON.stringify(bucket));
  assert.ok(bucket.some((x) => x.message.includes('לוחם')), JSON.stringify(bucket));
});
