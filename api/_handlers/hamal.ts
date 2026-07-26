import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getPool, DATE_RE } from '../_db.js';

// ── חמל tab API (per-shift, fully MANUAL, 2026-07-24) ────────────────────────
// חמל is manual-only (positions.is_scheduled=false) — the generator NEVER
// auto-fills it. The חמל tab picks the crew PER SHIFT. A day is split into shift
// windows; each window gets its own crew. Two layers of storage, both on the
// EXISTING slot infrastructure:
//
//  1. STRUCTURE — DAY-SCOPED slot_templates rows (position=חמל, sub=null,
//     valid_from = valid_to = the schedule day) hold a day's shift windows.
//     This is the generic "add a shift on this one day" mechanism (day_slots
//     materializes them; seat_overrides could resize/cancel them; מגן internal
//     shifts will reuse it). A day stores rows ONLY when its window list is
//     CUSTOMIZED away from the 3 implicit defaults (14:00-22:00, 22:00-06:00,
//     06:00-14:00; from config `hamal_default_shifts` or the hardcoded fallback
//     below) OR when it carries picks. No rows ⇒ the day shows empty defaults.
//     duration_minutes encodes the window (incl. cross-midnight); seats = a sane
//     default (max picks, 1). Distinct start_times per day satisfy
//     slot_templates_no_overlap.
//  2. PICKS — ordinary shift_assignments rows (position חמל, source='manual',
//     locked=true, blocks_overlap=false), one per (shift, soldier). `period` is
//     the concrete shift window (computed like the day_slots lateral), not the
//     whole day. seat_index restarts at 1 per shift. blocks_overlap=false so
//     overlapping windows / a soldier in two overlapping shifts never trip
//     no_double_booking.
//
// Owner decisions: a חמל pick RESERVES the soldier for the whole 14:00→14:00 day
// (D2) — a locked day_assignments bucket per picked soldier keeps the generator
// from seating them elsewhere.
//
//   GET  /api/hamal?from=YYYY-MM-DD[&to=YYYY-MM-DD]
//        -> { defaults, days: [{ day, custom, shifts: [{ start, end, picks }] }], roster }
//   PUT  /api/hamal   body { day, shifts: [{ start, end, soldierIds: number[] }] }  (POST alias)
//        -> replaces that day's shift structure + picks atomically
//   DELETE /api/hamal?day=YYYY-MM-DD    -> virgin reset (clears picks AND structure)

export interface HamalPick { soldierId: number; name: string; seatIndex: number }
export interface HamalShift { start: string; end: string; picks: HamalPick[] } // "HH:MM"
export interface HamalDay { day: string; custom: boolean; shifts: HamalShift[] }
export interface HamalRosterEntry { id: number; name: string; role: string; platoon: string; schedulable: boolean }
export interface HamalWindow { start: string; end: string }
export interface HamalResponse { defaults: HamalWindow[]; days: HamalDay[]; roster: HamalRosterEntry[] }
export type HamalWriteResponse = HamalDay;

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Hardcoded fallback default windows (owner D1). Overridable per-deployment by
 *  the config row `hamal_default_shifts` (a JSON array of {start,end}). */
const FALLBACK_DEFAULTS: HamalWindow[] = [
  { start: '10:00', end: '18:00' },
  { start: '18:00', end: '02:00' },
  { start: '02:00', end: '10:00' },
];

// The חמל runs on its own 10:00→10:00 cycle (NOT the 14:00 schedule day): a shift
// whose clock start is before 10:00 belongs to the next calendar day (the tail of
// the חמל day). Used to anchor concrete shift windows + order them.
const HAMAL_DAY_START = '10:00';

/** Resolve the חמל position id. Detected via the staff_all_roles config marker
 *  (the role that names this crew) rather than a hardcoded position name/id. */
let cachedHamalPid: number | null = null;
async function hamalPositionId(): Promise<number> {
  if (cachedHamalPid != null) return cachedHamalPid;   // position id is immutable per deployment
  const { rows } = await getPool().query(
    `select id from positions where config->'staff_all_roles' ? 'חמל' limit 1`);
  if (!rows.length) throw new Error('חמל position not found');
  return (cachedHamalPid = rows[0].id as number);
}

/** The default windows, from config `hamal_default_shifts` if valid, else the
 *  hardcoded fallback. */
async function defaultShifts(): Promise<HamalWindow[]> {
  const { rows } = await getPool().query(
    `select value from config where key = 'hamal_default_shifts'`);
  const raw = rows[0]?.value;
  if (Array.isArray(raw)) {
    const parsed = raw
      .filter((w: any) => TIME_RE.test(w?.start) && TIME_RE.test(w?.end))
      .map((w: any) => ({ start: String(w.start), end: String(w.end) }));
    if (parsed.length) return parsed;
  }
  return FALLBACK_DEFAULTS;
}

// ── date/time helpers (naive local, mirror scheduler/src/time.ts semantics) ──

function addDaysIso(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}

function daysInRange(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to && out.length < 400; d = addDaysIso(d, 1)) out.push(d);
  return out;
}

const toMin = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };

/** Duration (minutes) of a [start,end) window, handling cross-midnight
 *  (end <= start ⇒ ends the next day) and a full 24h window (start === end). */
function windowMinutes(start: string, end: string): number {
  const s = toMin(start), e = toMin(end);
  return e > s ? e - s : e + 1440 - s;
}

/** Concrete [start,end) window of a חמל shift on חמל day D, as naive-local
 *  'YYYY-MM-DDTHH:MM' timestamp strings. חמל anchors on HAMAL_DAY_START (10:00),
 *  NOT the 14:00 schedule day: start rolls to D+1 when its clock time is before
 *  10:00; end rolls a further day when end_time <= start_time (crosses midnight). */
function shiftWindow(day: string, start: string, end: string): { startTs: string; endTs: string } {
  const startOff = start < HAMAL_DAY_START ? 1 : 0;
  const endOff = startOff + (end <= start ? 1 : 0);
  return {
    startTs: `${addDaysIso(day, startOff)}T${start}`,
    endTs: `${addDaysIso(day, endOff)}T${end}`,
  };
}

/** Order-insensitive equality of two window lists (by start+end). */
function sameWindows(a: HamalWindow[], b: HamalWindow[]): boolean {
  if (a.length !== b.length) return false;
  const key = (w: HamalWindow) => `${w.start}-${w.end}`;
  const sa = a.map(key).sort();
  const sb = b.map(key).sort();
  return sa.every((k, i) => k === sb[i]);
}

// ── GET ──────────────────────────────────────────────────────────────────────

async function getHamal(from: string, to: string): Promise<HamalResponse> {
  const pool = getPool();
  const pid = await hamalPositionId();
  const defaults = await defaultShifts();
  const [picksRes, structRes, rosterRes] = await Promise.all([
    pool.query(
      `select sa.day::text as day, sa.soldier_id, s.full_name, sa.seat_index,
              to_char(lower(sa.period), 'YYYY-MM-DD"T"HH24:MI') p_start,
              to_char(upper(sa.period), 'YYYY-MM-DD"T"HH24:MI') p_end
       from shift_assignments sa
       join soldiers s on s.id = sa.soldier_id
       where sa.position_id = $1 and sa.day between $2 and $3
         and (sa.locked or sa.source = 'manual')
       order by sa.day, lower(sa.period), sa.seat_index`, [pid, from, to]),
    // day-scoped slot_templates = the per-day shift STRUCTURE (valid_from =
    // valid_to = the schedule day). end_t is derived from start + duration and
    // wraps past midnight. Order by the schedule-day-adjusted start so windows
    // come out 14:00-first (pre-14:00 windows are the day's tail).
    pool.query(
      `select valid_from::text as day,
              to_char(start_time, 'HH24:MI') start_t,
              to_char((start_time + make_interval(mins => duration_minutes)), 'HH24:MI') end_t
       from slot_templates
       where position_id = $1 and valid_from = valid_to
         and valid_from between $2 and $3
       order by valid_from,
                case when start_time < time '10:00' then 1 else 0 end,
                start_time`,
      [pid, from, to]),
    // roster for the picker = ONLY soldiers whose role is a חמל staff role
    // (the חמל position's config.staff_all_roles) — config-driven, not a
    // hardcoded 'חמל' literal. Still NOT filtered by presence/schedulable
    // (the חמל crew is small; pick from all of them regardless of status).
    pool.query(
      `select s.id, s.full_name, coalesce(s.role,'') role, coalesce(s.platoon,'') platoon, s.is_schedulable
       from soldiers s
       join positions p on p.id = $1 and (p.config -> 'staff_all_roles') ? s.role
       where s.archived_at is null
       order by s.full_name`, [pid]),
  ]);

  // structure rows by day (day-scoped slot_templates)
  const structByDay = new Map<string, HamalWindow[]>();
  for (const r of structRes.rows) {
    const arr = structByDay.get(r.day) ?? [];
    arr.push({ start: r.start_t, end: r.end_t });
    structByDay.set(r.day, arr);
  }
  // picks by day
  const picksByDay = new Map<string, any[]>();
  for (const r of picksRes.rows) {
    const arr = picksByDay.get(r.day) ?? [];
    arr.push(r);
    picksByDay.set(r.day, arr);
  }

  const days: HamalDay[] = daysInRange(from, to).map((day) => {
    const stored = structByDay.get(day);
    const windows = stored ?? defaults;
    // custom = the day's window list differs from the defaults. Computed from
    // the windows (not merely "has templates"): a default-shaped day that stored
    // templates only because it has picks is still NOT custom.
    const custom = !sameWindows(windows, defaults);
    const shifts: HamalShift[] = windows.map((w) => ({ start: w.start, end: w.end, picks: [] }));
    // index shifts by their concrete window for exact-period bucketing
    const byWindow = new Map<string, HamalShift>();
    for (const sh of shifts) {
      const { startTs, endTs } = shiftWindow(day, sh.start, sh.end);
      byWindow.set(`${startTs}|${endTs}`, sh);
    }
    const extras = new Map<string, HamalShift>();
    for (const p of picksByDay.get(day) ?? []) {
      const pick: HamalPick = { soldierId: Number(p.soldier_id), name: p.full_name, seatIndex: Number(p.seat_index) };
      const key = `${p.p_start}|${p.p_end}`;
      const target = byWindow.get(key);
      if (target) { target.picks.push(pick); continue; }
      // an assignment matching no configured window → a derived shift. Covers a
      // legacy full-day 14:00→14:00 row (surfaces as a "14:00-14:00" window)
      // and any hand-written window not in the structure.
      let ex = extras.get(key);
      if (!ex) {
        ex = { start: p.p_start.slice(11), end: p.p_end.slice(11), picks: [] };
        extras.set(key, ex);
      }
      ex.picks.push(pick);
    }
    return { day, custom, shifts: [...shifts, ...extras.values()] };
  });

  const roster: HamalRosterEntry[] = rosterRes.rows.map((r: any) => ({
    id: Number(r.id), name: r.full_name, role: r.role, platoon: r.platoon, schedulable: !!r.is_schedulable,
  }));
  return { defaults, days, roster };
}

// ── PUT / POST ─────────────────────────────────────────────────────────────

interface ShiftInput { start: string; end: string; soldierIds: number[] }

/** Replace a day's חמל shift structure + picks atomically. */
async function setHamal(day: string, shiftsIn: ShiftInput[]): Promise<HamalWriteResponse> {
  const pool = getPool();
  const pid = await hamalPositionId();
  const defaults = await defaultShifts();

  // normalize + validate windows
  const windows: HamalWindow[] = shiftsIn.map((s) => ({ start: String(s.start), end: String(s.end) }));
  for (const w of windows) {
    if (!TIME_RE.test(w.start) || !TIME_RE.test(w.end)) {
      throw Object.assign(new Error('bad shift time (HH:MM)'), { status: 400 });
    }
  }
  // start_time must be UNIQUE per day: day-scoped slot_templates are keyed by
  // start_time (slot_templates_no_overlap excludes on start_time within the same
  // day) — two windows with the same start can't both be stored. (This is
  // stricter than "distinct start+end".)
  const seen = new Set<string>();
  for (const w of windows) {
    if (seen.has(w.start)) {
      throw Object.assign(new Error('duplicate shift start (each window needs a distinct start time)'), { status: 400 });
    }
    seen.add(w.start);
  }
  // dedup soldier ids within each shift
  const perShift = shiftsIn.map((s) => [...new Set(
    (Array.isArray(s.soldierIds) ? s.soldierIds : []).map(Number)
      .filter((n) => Number.isInteger(n) && n > 0))]);
  const totalPicks = perShift.reduce((n, ids) => n + ids.length, 0);

  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query(`insert into schedule_days (day) values ($1) on conflict do nothing`, [day]);
    // this tab fully owns the חמל position for the day
    await client.query(`delete from shift_assignments where day = $1 and position_id = $2`, [day, pid]);
    await client.query(`delete from day_assignments where day = $1 and position_id = $2`, [day, pid]);
    // clear the day's own on-demand (day-scoped) חמל templates only
    await client.query(
      `delete from slot_templates where position_id = $1 and valid_from = $2 and valid_to = $2`, [pid, day]);

    // Write day-scoped slot_templates for the shown windows UNLESS the day is
    // the untouched default (default windows AND no picks) — then leave none and
    // the day reverts to showing the empty defaults with no stored structure.
    // When there are picks (or a customized window list), store every shown
    // window so empty custom windows persist and the picks have their slots.
    if (!(sameWindows(windows, defaults) && totalPicks === 0)) {
      const sv: string[] = [];
      const sp: unknown[] = [pid, day];   // $1 = position_id, $2 = day
      windows.forEach((w, i) => {
        const seats = Math.max(perShift[i].length, 1);
        sp.push(w.start, windowMinutes(w.start, w.end), seats);
        const b = sp.length - 2;   // $start_time, $duration, $seats
        sv.push(`($1, $${b}::time, $${b + 1}::int, $${b + 2}::smallint, $2::date, $2::date)`);
      });
      await client.query(
        `insert into slot_templates
           (position_id, start_time, duration_minutes, seats, valid_from, valid_to)
         values ${sv.join(',')}`, sp);
    }

    // one shift_assignments row per (shift, soldier); seat_index restarts per shift
    const rowVals: string[] = [];
    const rowParams: unknown[] = [day, pid];  // $1 = day, $2 = position_id
    const pickedUnion = new Set<number>();
    shiftsIn.forEach((_s, i) => {
      const { startTs, endTs } = shiftWindow(day, windows[i].start, windows[i].end);
      perShift[i].forEach((sid, seat) => {
        pickedUnion.add(sid);
        rowParams.push(sid, seat + 1, startTs, endTs);
        const b = rowParams.length - 3;  // $sid, $seat, $startTs, $endTs
        // readiness row → blocks_overlap=false; locked + source=manual so the
        // generator keeps it (and it never auto-fills חמל anyway)
        rowVals.push(`($1::date, $2, $${b}, tsrange($${b + 2}::timestamp, $${b + 3}::timestamp), $${b + 1}, false, 'manual', false, true)`);
      });
    });
    if (rowVals.length) {
      await client.query(
        `insert into shift_assignments
           (day, position_id, soldier_id, period, seat_index, is_commander_seat,
            source, blocks_overlap, locked)
         values ${rowVals.join(',')}`, rowParams);
    }

    // D2: a חמל pick reserves the soldier for the WHOLE day — one locked
    // day_assignments bucket per picked soldier (union across shifts)
    const union = [...pickedUnion];
    if (union.length) {
      const dp: unknown[] = [day, pid];
      const dv = union.map((sid, i) => { dp.push(sid); return `($1::date, $${i + 3}, $2, 'manual', true)`; });
      await client.query(
        `insert into day_assignments (day, soldier_id, position_id, source, locked)
         values ${dv.join(',')}
         on conflict (day, soldier_id)
         do update set position_id = excluded.position_id, source = 'manual', locked = true`, dp);
    }
    await client.query('commit');
  } catch (e) {
    await client.query('rollback');
    throw e;
  } finally {
    client.release();
  }
  // Build the echo from what we just wrote instead of re-running the full GET
  // (which would re-query picks + structure + the whole roster — ~4 extra
  // round-trips over the WAN pooler). After a full replace the day's state IS
  // exactly `windows` + `perShift`; only soldier NAMES need one lookup.
  const allIds = [...new Set(perShift.flat())];
  const nameById = new Map<number, string>();
  if (allIds.length) {
    const { rows } = await pool.query(`select id, full_name from soldiers where id = any($1)`, [allIds]);
    for (const r of rows) nameById.set(Number(r.id), r.full_name as string);
  }
  return {
    day,
    custom: !sameWindows(windows, defaults),
    shifts: windows.map((w, i) => ({
      start: w.start, end: w.end,
      picks: perShift[i].map((sid, seat) => ({ soldierId: sid, name: nameById.get(sid) ?? '', seatIndex: seat + 1 })),
    })),
  };
}

/** Virgin reset: clear picks AND the day-scoped structure for the day. */
async function clearHamal(day: string): Promise<HamalWriteResponse> {
  const pool = getPool();
  const pid = await hamalPositionId();
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query(`insert into schedule_days (day) values ($1) on conflict do nothing`, [day]);
    await client.query(`delete from shift_assignments where day = $1 and position_id = $2`, [day, pid]);
    await client.query(`delete from day_assignments where day = $1 and position_id = $2`, [day, pid]);
    await client.query(
      `delete from slot_templates where position_id = $1 and valid_from = $2 and valid_to = $2`, [pid, day]);
    await client.query('commit');
  } catch (e) {
    await client.query('rollback');
    throw e;
  } finally {
    client.release();
  }
  const { days } = await getHamal(day, day);
  return days[0];
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    if (req.method === 'GET') {
      const from = String(req.query.from ?? '');
      const to = String(req.query.to ?? from);
      if (!DATE_RE.test(from) || !DATE_RE.test(to)) {
        return res.status(400).json({ error: 'from/to required (YYYY-MM-DD)' });
      }
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json(await getHamal(from, to));
    }

    if (req.method === 'PUT' || req.method === 'POST') {
      const { day, shifts } = (req.body ?? {}) as { day?: string; shifts?: unknown };
      if (!day || !DATE_RE.test(day)) {
        return res.status(400).json({ error: 'day required (YYYY-MM-DD)' });
      }
      if (!Array.isArray(shifts) || shifts.length === 0) {
        return res.status(400).json({ error: 'shifts array required (non-empty)' });
      }
      return res.status(200).json(await setHamal(day, shifts as ShiftInput[]));
    }

    if (req.method === 'DELETE') {
      const day = String(req.query.day ?? '');
      if (!DATE_RE.test(day)) return res.status(400).json({ error: 'day required (YYYY-MM-DD)' });
      return res.status(200).json(await clearHamal(day));
    }

    return res.status(405).json({ error: 'method not allowed' });
  } catch (e) {
    const status = (e as any)?.status ?? 500;
    if (status === 500) console.error(e);
    return res.status(status).json({ error: e instanceof Error ? e.message : 'server error' });
  }
}
