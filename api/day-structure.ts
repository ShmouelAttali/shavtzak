import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getPool, DATE_RE } from './_db.js';
import { ensureScheduleDay, positionScope, POSITION_SCOPE, type Queryable } from './_sql.js';

// ── מבנה יומי tab API (per-DAY shift-structure editor, admin-only) ────────────
// Overrides the SHIFT STRUCTURE of ONE specific schedule day: add/remove/rename
// a position group (= positions row), add/remove/rename a position in it
// (= sub_positions row), change a shift's start/end/seats — with NO cross-shift
// validation (unlike the חמל tiling tab). NO soldier lists (unlike חמל). All on
// the EXISTING slot infrastructure, so the generator reads the edited structure
// straight from the day_slots view (no scheduler/src change):
//
//  * A single-day SEAT change → a template-targeted single-day seat_override
//    (slot_template_id = the permanent template, valid_from = day,
//    valid_to = next-day 14:00, note 'מבנה יומי').
//  * A REMOVED shift → the same override with seats = 0 (day_slots omits it).
//  * An ADDED / MOVED / DURATION-CHANGED shift → a DAY-SCOPED slot_templates row
//    (valid_from = valid_to = day) at the desired (sub, start_time, duration).
//    Sharing (position, sub, start_time) with a seats=0-cancelled permanent
//    template is legal (the day-scoped exemption on slot_templates_no_overlap),
//    so day_slots emits exactly one row for a duration-only change.
//  * A NEW group → a positions row (mission_class='static', is_scheduled=true)
//    with id = max(id)+1; its shifts are day-scoped templates only.
//  * A RENAME = day-scoped delete + create: the payload sends the item with a
//    null id + the new name (a fresh row), and the OLD id is simply absent — so
//    its baseline slots are all cancelled for the day. No global renames.
//
// The PUT is a DECLARATIVE WHOLE-DAY REPLACE: it first WIPES this tab's prior
// writes for the day (single-day template-targeted overrides + day-scoped
// templates of in-scope positions) then re-diffs the desired structure against
// the PERMANENT baseline. Idempotent; saving the default structure leaves zero
// rows. Scope = is_scheduled AND mission_class <> 'rest' AND no staff_all_roles
// — so it NEVER touches חמל / מפלג / rest positions.
//
//   GET  /api/day-structure?day=YYYY-MM-DD    -> { day, groups: DsGroup[] }
//   PUT  /api/day-structure   body { day, groups: DsGroup-with-nullable-ids[] }
//   DELETE /api/day-structure?day=YYYY-MM-DD  -> reset to the default structure

export interface DsShift {
  templateId: number;
  start: string;            // "HH:MM"
  end: string;              // "HH:MM"
  seats: number;
  origin: 'default' | 'resized' | 'added';
}
export interface DsPosition { subId: number | null; name: string | null; shifts: DsShift[] }
export interface DsGroup { positionId: number; name: string; positions: DsPosition[] }
export interface DsResponse { day: string; groups: DsGroup[] }

// PUT input mirrors the GET shape with nullable ids (null = create) and no origin.
interface DsShiftInput { start: string; end: string; seats: number }
interface DsPositionInput { subId: number | null; name: string | null; shifts: DsShiftInput[] }
interface DsGroupInput { positionId: number | null; name: string; positions: DsPositionInput[] }

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

const err = (message: string, status: number) =>
  Object.assign(new Error(message), { status });

// ── date/time helpers (naive local, mirror scheduler/src/time.ts semantics) ──

function addDaysIso(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}

const toMin = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };

/** Duration (minutes) of a [start,end) window, handling cross-midnight
 *  (end <= start ⇒ ends the next day) and a full 24h window (start === end). */
function windowMinutes(start: string, end: string): number {
  const s = toMin(start), e = toMin(end);
  return e > s ? e - s : e + 1440 - s;
}

/** Next-day 14:00 (day_start(day+1)) as a naive-local timestamp string — the
 *  EXCLUSIVE valid_to that scopes a seat_override to exactly the schedule day. */
const dayEndTs = (day: string) => `${addDaysIso(day, 1)} 14:00`;

/** The scope filter used everywhere: never touches חמל / מפלג / rest.
 *  Shared with api/draft.ts's coverage markers (api/_sql.ts). */
const SCOPE = POSITION_SCOPE;

/** Wipe this tab's prior writes for the day — the single-day template-targeted
 *  seat_overrides and the day-scoped slot_templates — both restricted to
 *  in-scope positions so a stray row of חמל / מפלג / rest is never collateral.
 *  Shared by the PUT (before re-diffing) and the DELETE (reset to default). */
async function wipeDayWrites(client: Queryable, day: string, dayEnd: string): Promise<void> {
  await client.query(
    `delete from seat_overrides o
      where o.valid_from = $1 and o.valid_to = $2::timestamp
        and o.slot_template_id is not null
        and o.position_id in (select id from positions where ${SCOPE})`,
    [day, dayEnd]);
  await client.query(
    `delete from slot_templates
      where valid_from = $1 and valid_to = $1
        and position_id in (select id from positions where ${SCOPE})`,
    [day]);
}

/** Diff key of a concrete slot within the day. */
const slotKey = (positionId: number, subId: number | null, startTime: string, dur: number) =>
  `${positionId}|${subId ?? '-'}|${startTime}|${dur}`;

// ── GET ──────────────────────────────────────────────────────────────────────

async function getDayStructure(day: string): Promise<DsResponse> {
  const pool = getPool();
  await ensureScheduleDay(pool, day);
  const dayEnd = dayEndTs(day);
  const { rows } = await pool.query(
    `select ds.slot_template_id as template_id,
            st.position_id, p.name as position_name,
            st.sub_position_id as sub_id, sp.name as sub_name,
            to_char(lower(ds.period), 'HH24:MI') as start_t,
            to_char(upper(ds.period), 'HH24:MI') as end_t,
            ds.seats,
            (st.valid_from = st.valid_to) as is_day_scoped,
            exists(select 1 from seat_overrides o
                   where o.slot_template_id = st.id
                     and o.valid_from = $1 and o.valid_to = $2::timestamp) as has_resize
     from day_slots ds
     join slot_templates st on st.id = ds.slot_template_id
     join positions p on p.id = ds.position_id
     left join sub_positions sp on sp.id = ds.sub_position_id
     where ds.day = $1 and ${positionScope('p')}
     order by p.id, sp.id nulls first, lower(ds.period)`,
    [day, dayEnd]);

  const groups: DsGroup[] = [];
  const groupByPid = new Map<number, DsGroup>();
  const posBySub = new Map<string, DsPosition>();  // key `${pid}|${subId ?? '-'}`
  for (const r of rows) {
    const pid = Number(r.position_id);
    let g = groupByPid.get(pid);
    if (!g) { g = { positionId: pid, name: r.position_name, positions: [] }; groupByPid.set(pid, g); groups.push(g); }
    const subId = r.sub_id == null ? null : Number(r.sub_id);
    const pkey = `${pid}|${subId ?? '-'}`;
    let pos = posBySub.get(pkey);
    if (!pos) { pos = { subId, name: r.sub_name ?? null, shifts: [] }; posBySub.set(pkey, pos); g.positions.push(pos); }
    const origin: DsShift['origin'] = r.is_day_scoped ? 'added' : r.has_resize ? 'resized' : 'default';
    pos.shifts.push({ templateId: Number(r.template_id), start: r.start_t, end: r.end_t, seats: Number(r.seats), origin });
  }
  return { day, groups };
}

// ── PUT (declarative whole-day replace) ──────────────────────────────────────

function validate(groups: unknown): DsGroupInput[] {
  if (!Array.isArray(groups)) throw err('groups array required', 400);
  const out: DsGroupInput[] = [];
  for (const g of groups as any[]) {
    const name = String(g?.name ?? '').trim();
    if (!name) throw err('שם קבוצה חסר', 400);
    const positionId = g?.positionId == null ? null : Number(g.positionId);
    const positions: DsPositionInput[] = [];
    for (const p of (Array.isArray(g?.positions) ? g.positions : []) as any[]) {
      const subId = p?.subId == null ? null : Number(p.subId);
      const rawName = p?.name == null ? null : String(p.name).trim();
      const pname = rawName ? rawName : null;
      const shifts: DsShiftInput[] = [];
      for (const s of (Array.isArray(p?.shifts) ? p.shifts : []) as any[]) {
        const start = String(s?.start ?? ''), end = String(s?.end ?? '');
        if (!TIME_RE.test(start) || !TIME_RE.test(end)) throw err('שעת משמרת לא תקינה (HH:MM)', 400);
        const seats = Number(s?.seats);
        if (!Number.isInteger(seats) || seats < 1) throw err('מספר עמדות חייב להיות 1 ומעלה', 400);
        shifts.push({ start, end, seats });
      }
      positions.push({ subId, name: pname, shifts });
    }
    out.push({ positionId, name, positions });
  }
  return out;
}

async function setDayStructure(day: string, groupsIn: unknown): Promise<DsResponse> {
  const groups = validate(groupsIn);
  const pool = getPool();
  const dayEnd = dayEndTs(day);
  const client = await pool.connect();
  try {
    await client.query('begin');
    await ensureScheduleDay(client, day);

    // 1. WIPE this tab's prior writes for the day
    await wipeDayWrites(client, day, dayEnd);

    // 2. Create new positions / subs (id = max+1 inline; single-admin tool).
    //    Resolve each payload group/position to a concrete position/sub id.
    const nextIds = (await client.query<{ pid: number; sid: number }>(
      `select (select coalesce(max(id),0)+1 from positions) pid,
              (select coalesce(max(id),0)+1 from sub_positions) sid`)).rows[0];
    let nextPid = Number(nextIds.pid);
    let nextSid = Number(nextIds.sid);

    for (const g of groups) {
      if (g.positionId == null) {
        const dup = await client.query(`select 1 from positions where name = $1`, [g.name]);
        if (dup.rowCount) throw err(`כבר קיימת קבוצה בשם "${g.name}"`, 409);
        const pid = nextPid++;
        await client.query(
          `insert into positions (id, name, mission_class, is_scheduled, config)
           values ($1, $2, 'static', true, '{}'::jsonb)`, [pid, g.name]);
        (g as any).positionId = pid;
      }
      const pid = g.positionId as number;
      for (const p of g.positions) {
        if (p.subId == null && p.name != null) {
          const dup = await client.query(
            `select 1 from sub_positions where position_id = $1 and name = $2`, [pid, p.name]);
          if (dup.rowCount) throw err(`כבר קיים תפקיד בשם "${p.name}"`, 409);
          const sid = nextSid++;
          await client.query(
            `insert into sub_positions (id, position_id, name) values ($1, $2, $3)`, [sid, pid, p.name]);
          (p as any).subId = sid;
        }
      }
    }

    // 3. DESIRED slots keyed by (positionId, subId, start_time, duration) → seats
    const desired = new Map<string, { positionId: number; subId: number | null; startTime: string; dur: number; seats: number }>();
    for (const g of groups) {
      const pid = g.positionId as number;
      for (const p of g.positions) {
        for (const s of p.shifts) {
          const dur = windowMinutes(s.start, s.end);
          const k = slotKey(pid, p.subId, s.start, dur);
          desired.set(k, { positionId: pid, subId: p.subId, startTime: s.start, dur, seats: s.seats });
        }
      }
    }

    // 4. BASELINE = permanent templates valid on the day for in-scope positions,
    //    with resolved seats (honors surviving long-range overrides; INCLUDES
    //    seats=0 so a long-range-cancelled slot can be re-added for this day).
    const baseRows = (await client.query<{ id: number; position_id: number; sub_id: number | null; start_t: string; dur: number; seats: number }>(
      `select st.id, st.position_id, st.sub_position_id as sub_id,
              to_char(st.start_time,'HH24:MI') as start_t, st.duration_minutes as dur,
              coalesce((select o.seats from seat_overrides o
                        where o.position_id = st.position_id
                          and o.valid_from <= $1
                          and (o.valid_to is null or
                               ($1::timestamp + st.start_time::interval
                                + case when st.start_time < time '14:00' then interval '1 day' else interval '0' end)
                               < o.valid_to)
                          and (o.start_time is null or o.start_time = st.start_time)
                          and (o.slot_template_id is null or o.slot_template_id = st.id)
                        order by (o.slot_template_id is not null) desc,
                                 (o.start_time is not null) desc,
                                 o.valid_from desc, o.id desc
                        limit 1), st.seats) as seats
       from slot_templates st
       join positions p on p.id = st.position_id
       where ${positionScope('p')}
         and (st.valid_to is null or st.valid_from <> st.valid_to)   -- permanent only
         and st.valid_from <= $1 and (st.valid_to is null or $1 <= st.valid_to)`,
      [day])).rows;
    const baseline = new Map<string, { templateId: number; positionId: number; subId: number | null; startTime: string; seats: number }>();
    for (const r of baseRows) {
      const subId = r.sub_id == null ? null : Number(r.sub_id);
      baseline.set(slotKey(Number(r.position_id), subId, r.start_t, Number(r.dur)), {
        templateId: Number(r.id), positionId: Number(r.position_id), subId, startTime: r.start_t, seats: Number(r.seats),
      });
    }

    // 5. DIFF desired vs baseline
    const ovVals: string[] = [];  // seat_overrides: template-targeted single-day rows
    const ovParams: unknown[] = [day, dayEnd];  // $1 day, $2 dayEnd
    const addOverride = (templateId: number, positionId: number, startTime: string, seats: number) => {
      ovParams.push(positionId, startTime, templateId, seats);
      const b = ovParams.length - 3;
      ovVals.push(`($${b}::smallint, $1::date, $2::timestamp, $${b + 1}::time, $${b + 2}::smallint, $${b + 3}::smallint, 'מבנה יומי')`);
    };
    const tplVals: string[] = [];  // day-scoped slot_templates for desired-only slots
    const tplParams: unknown[] = [day];  // $1 = day (valid_from = valid_to = day)
    const addTemplate = (positionId: number, subId: number | null, startTime: string, dur: number, seats: number) => {
      tplParams.push(positionId, subId, startTime, dur, seats);
      const b = tplParams.length - 4;
      tplVals.push(`($${b}::smallint, $${b + 1}::smallint, $${b + 2}::time, $${b + 3}::int, $${b + 4}::smallint, $1::date, $1::date)`);
    };

    for (const [k, d] of desired) {
      const b = baseline.get(k);
      if (b) { if (b.seats !== d.seats) addOverride(b.templateId, b.positionId, b.startTime, d.seats); }
      else addTemplate(d.positionId, d.subId, d.startTime, d.dur, d.seats);   // added / moved / duration-changed
    }
    for (const [k, b] of baseline) {
      if (!desired.has(k) && b.seats > 0) addOverride(b.templateId, b.positionId, b.startTime, 0);  // removed
    }

    if (ovVals.length) {
      await client.query(
        `insert into seat_overrides (position_id, valid_from, valid_to, start_time, slot_template_id, seats, note)
         values ${ovVals.join(',')}`, ovParams);
    }
    if (tplVals.length) {
      await client.query(
        `insert into slot_templates (position_id, sub_position_id, start_time, duration_minutes, seats, valid_from, valid_to)
         values ${tplVals.join(',')}`, tplParams);
    }
    await client.query('commit');
  } catch (e) {
    // .catch: a rollback on a dead connection throws and would mask the real
    // error (the one that got us into this catch block).
    await client.query('rollback').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
  return getDayStructure(day);
}

// ── DELETE (reset to default) ────────────────────────────────────────────────

async function resetDayStructure(day: string): Promise<DsResponse> {
  const pool = getPool();
  const dayEnd = dayEndTs(day);
  const client = await pool.connect();
  try {
    await client.query('begin');
    await ensureScheduleDay(client, day);
    await wipeDayWrites(client, day, dayEnd);
    await client.query('commit');
  } catch (e) {
    await client.query('rollback').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
  return getDayStructure(day);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    if (req.method === 'GET') {
      const day = String(req.query.day ?? '');
      if (!DATE_RE.test(day)) return res.status(400).json({ error: 'day required (YYYY-MM-DD)' });
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json(await getDayStructure(day));
    }
    if (req.method === 'PUT' || req.method === 'POST') {
      const { day, groups } = (req.body ?? {}) as { day?: string; groups?: unknown };
      if (!day || !DATE_RE.test(day)) return res.status(400).json({ error: 'day required (YYYY-MM-DD)' });
      return res.status(200).json(await setDayStructure(day, groups));
    }
    if (req.method === 'DELETE') {
      const day = String(req.query.day ?? '');
      if (!DATE_RE.test(day)) return res.status(400).json({ error: 'day required (YYYY-MM-DD)' });
      return res.status(200).json(await resetDayStructure(day));
    }
    return res.status(405).json({ error: 'method not allowed' });
  } catch (e) {
    const status = (e as any)?.status ?? 500;
    if (status === 500) console.error(e);
    return res.status(status).json({ error: e instanceof Error ? e.message : 'server error' });
  }
}
