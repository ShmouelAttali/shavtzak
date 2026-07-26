// day_slots + seat_overrides.slot_template_id + relaxed slot_templates_no_overlap
// semantics for the מבנה יומי tab (schema delta 2026-07-26). A seat_override may
// now target ONE specific template row (slot_template_id) — the most-specific
// match (beats start_time, which beats position-wide). Day-scoped templates
// (valid_from = valid_to) are EXEMPT from the no-overlap exclusion, so a day
// template can share (position, sub, start_time) with the permanent one it
// replaces (a duration-only change) — day_slots then emits exactly one slot when
// the permanent one is cancelled (seats=0). Resolve positions/templates by NAME.
//
// עמדות הגנה fixture (seed.sql): 4 subs (שג/בונקר/מזרחית/דרומית) × 6 shifts × 4h ×
// 1 seat at 06/10/14/18/22/02. Within schedule day D (14:00→14:00) the 14:00 &
// 18:00 & 22:00 shifts start on D; 02:00 & 06:00 & 10:00 land on the next morning.
import './env.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { freshSchema, seedSoldiers, closePool, query } from './helpers.js';

const D1 = '2026-10-05', D2 = '2026-10-06';
const dayEnd = (d: string) => `${d} 14:00`;  // day_start(d) — the exclusive valid_to for the PREVIOUS schedule day

/** Permanent template id by NAME (position + optional sub + start_time). */
async function templateId(position: string, sub: string | null, start: string): Promise<number> {
  const r = await query<{ id: number }>(`
    select st.id from slot_templates st
    join positions p on p.id = st.position_id
    left join sub_positions sp on sp.id = st.sub_position_id
    where p.name = $1 and st.start_time = $3
      and (($2::text is null and st.sub_position_id is null) or sp.name = $2)
      and (st.valid_to is null or st.valid_from <> st.valid_to)`, [position, sub, start]);
  if (r.length !== 1) throw new Error(`templateId: ${position}/${sub}/${start} matched ${r.length}`);
  return r[0].id;
}

/** Seats of one sub's slot on a day, keyed by concrete HH:MM start. */
async function subSlots(day: string, sub: string): Promise<Map<string, number>> {
  const rows = await query<{ start_t: string; seats: number }>(`
    select to_char(lower(ds.period),'HH24:MI') start_t, ds.seats
    from day_slots ds
    join positions p on p.id = ds.position_id
    join sub_positions sp on sp.id = ds.sub_position_id
    where p.name = 'עמדות הגנה' and sp.name = $2 and ds.day = $1`, [day, sub]);
  return new Map(rows.map((r) => [r.start_t, Number(r.seats)]));
}

async function clearOverrides() { await query(`delete from seat_overrides where note = 'test'`); }
async function clearDayTemplates() { await query(`delete from slot_templates where valid_from = valid_to`); }

before(async () => {
  await freshSchema();
  await seedSoldiers();
  await query(`insert into schedule_days (day) values ($1), ($2) on conflict do nothing`, [D1, D2]);
});
after(closePool);

// ── 1: template-targeted override hits only its row ──────────────────────────
test('a slot_template_id override changes only its slot — sibling same-start sub untouched', async () => {
  const shag14 = await templateId('עמדות הגנה', 'שג', '14:00');
  await query(`insert into seat_overrides (position_id, valid_from, valid_to, start_time, slot_template_id, seats, note)
               select st.position_id, $1, $2::timestamp, st.start_time, st.id, 3, 'test'
               from slot_templates st where st.id = $3`, [D1, dayEnd(D2), shag14]);

  assert.equal((await subSlots(D1, 'שג')).get('14:00'), 3, 'שג 14:00 resized');
  assert.equal((await subSlots(D1, 'בונקר')).get('14:00'), 1, 'sibling sub at same start untouched');
  // other שג shifts on D1 keep template seats
  assert.equal((await subSlots(D1, 'שג')).get('18:00'), 1, 'other שג shift untouched');
  await clearOverrides();
});

// ── 2: specificity — template-id > start_time > position-wide ─────────────────
test('slot_template_id beats a start_time match beats a position-wide row', async () => {
  const shag14 = await templateId('עמדות הגנה', 'שג', '14:00');
  const pid = (await query<{ id: number }>(`select id from positions where name='עמדות הגנה'`))[0].id;
  // position-wide = 2 seats; start_time 14:00 = 4 seats; שג-14:00 template = 7 seats
  await query(`insert into seat_overrides (position_id, valid_from, start_time, slot_template_id, seats, note) values
    ($1,$2,null,null,2,'test'), ($1,$2,'14:00'::time,null,4,'test'),
    ($1,$2,'14:00'::time,$3,7,'test')`, [pid, D1, shag14]);

  assert.equal((await subSlots(D1, 'שג')).get('14:00'), 7, 'template-id wins');
  assert.equal((await subSlots(D1, 'בונקר')).get('14:00'), 4, 'start_time match wins over position-wide');
  assert.equal((await subSlots(D1, 'שג')).get('18:00'), 2, 'position-wide applies elsewhere');
  await clearOverrides();
});

// ── 3: single emission — day template + seats=0 on the permanent same-start ──
test('a day template sharing start_time with a seats=0-cancelled permanent one emits ONE slot', async () => {
  const shag14 = await templateId('עמדות הגנה', 'שג', '14:00');
  const pid = (await query<{ id: number }>(`select id from positions where name='עמדות הגנה'`))[0].id;
  const shagSub = (await query<{ id: number }>(`select sp.id from sub_positions sp join positions p on p.id=sp.position_id where p.name='עמדות הגנה' and sp.name='שג'`))[0].id;
  // cancel the permanent שג 14:00 for D1 (template-targeted seats=0)
  await query(`insert into seat_overrides (position_id, valid_from, valid_to, start_time, slot_template_id, seats, note)
               values ($1,$2,$3::timestamp,'14:00'::time,$4,0,'test')`, [pid, D1, dayEnd(D2), shag14]);
  // add a DAY-SCOPED template at the same (pos, sub, start) with a different duration
  await query(`insert into slot_templates (position_id, sub_position_id, start_time, duration_minutes, seats, valid_from, valid_to)
               values ($1,$2,'14:00'::time,120,5,$3,$3)`, [pid, shagSub, D1]);

  const d1 = await query<{ start_t: string; end_t: string; seats: number }>(`
    select to_char(lower(ds.period),'HH24:MI') start_t, to_char(upper(ds.period),'HH24:MI') end_t, ds.seats
    from day_slots ds join sub_positions sp on sp.id=ds.sub_position_id
    where sp.name='שג' and ds.day=$1 and to_char(lower(ds.period),'HH24:MI')='14:00'`, [D1]);
  assert.equal(d1.length, 1, `exactly one שג 14:00 slot: ${JSON.stringify(d1)}`);
  assert.equal(Number(d1[0].seats), 5, 'the day-scoped template wins');
  assert.equal(d1[0].end_t, '16:00', 'day-scoped 120-min duration');
  // D2 (no day template, no override) shows the original permanent 4h/1-seat slot
  assert.equal((await subSlots(D2, 'שג')).get('14:00'), 1);
  await clearOverrides();
  await clearDayTemplates();
});

// ── 4: relaxed constraint ─────────────────────────────────────────────────────
test('day-scoped duplicate template is allowed; two overlapping PERMANENT versions still rejected', async () => {
  const pid = (await query<{ id: number }>(`select id from positions where name='עמדות הגנה'`))[0].id;
  const shagSub = (await query<{ id: number }>(`select sp.id from sub_positions sp join positions p on p.id=sp.position_id where p.name='עמדות הגנה' and sp.name='שג'`))[0].id;
  // day-scoped row at the SAME (pos, sub, start) as the permanent שג 14:00 — OK
  await query(`insert into slot_templates (position_id, sub_position_id, start_time, duration_minutes, seats, valid_from, valid_to)
               values ($1,$2,'14:00'::time,240,1,$3,$3)`, [pid, shagSub, D1]);
  // a SECOND permanent version overlapping the seed one's validity — rejected
  await assert.rejects(
    query(`insert into slot_templates (position_id, sub_position_id, start_time, duration_minutes, seats, valid_from, valid_to)
            values ($1,$2,'14:00'::time,240,1,'2026-08-01',null)`, [pid, shagSub]),
    /slot_templates_no_overlap|exclusion|conflicting/);
  await clearDayTemplates();
});

// ── 5: single-day scoping — D1 affected, D2 (incl next-morning tail) untouched ─
test('a single-day template override affects only D1, including its next-morning tail slots', async () => {
  const shag02 = await templateId('עמדות הגנה', 'שג', '02:00');   // 02:00 lands on the next morning
  // the D1 02:00 slot starts D2 02:00 (< dayEnd(D2)=D2 14:00) so a single-day
  // override for D1 must catch it; the D2 02:00 slot (D3 02:00) must not
  await query(`insert into seat_overrides (position_id, valid_from, valid_to, start_time, slot_template_id, seats, note)
               select st.position_id, $1, $2::timestamp, st.start_time, st.id, 9, 'test'
               from slot_templates st where st.id = $3`, [D1, dayEnd(D2), shag02]);
  assert.equal((await subSlots(D1, 'שג')).get('02:00'), 9, 'D1 next-morning tail affected');
  assert.equal((await subSlots(D2, 'שג')).get('02:00'), 1, 'D2 next-morning tail untouched');
  await clearOverrides();
});
