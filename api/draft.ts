import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getPool, DATE_RE } from './_db.js';
import { dayStatus, positionScope, soldierNamesById, type Queryable } from './_sql.js';
import type { StationGroup, SubType, TimeSlot } from './shavtzak.js';
import type { RationaleEntry } from '../scheduler/src/rationale.js';
import { requiredSeats } from '../scheduler/src/config.js';
import { staffedSeats, type CoverRow } from '../scheduler/src/coverage.js';

// ── Types (imported by the frontend as ../../api/draft) ────────────────────
export type { RationaleEntry };

export interface DraftFinding {
  severity: 'error' | 'warning';
  rule: string;
  message: string;
  soldierId?: number;
}

export interface DraftAssignmentMeta {
  source: string;               // auto | chain | manual | import
  locked: boolean;
  /** false only when EVERY row under this label is a readiness overlay
   *  (blocks_overlap=false, H3 exception) — such a row may legitimately share
   *  its hours with another. The replacement popup uses it to tell a real
   *  double-booking (no_double_booking would reject it) from a legal overlap. */
  blocksOverlap: boolean;
  violations: string[];
  /** structured "why picked" entries (rendered via scheduler/src/rationale.ts) */
  rationale: RationaleEntry[];
}

export interface DraftDay {
  day: string;                  // YYYY-MM-DD (schedule day, starts 14:00)
  status: string;               // draft | generated | approved | published
  generatedAt: string | null;
  publishedAt: string | null;   // set when status === 'published'
  approvedBy: string | null;    // email of the publishing officer
  hasReport: boolean;           // a stored generation report exists (GET /api/report?day=)
  validation: DraftFinding[];
  groups: StationGroup[];       // same shape the existing Shavtzak layouts render
  /** key = `${soldierName}|${timeLabel}` for ⚠ markers */
  meta: Record<string, DraftAssignmentMeta>;
  /** Level-1 buckets: position -> soldier names (incl. מנוחה) */
  dayAssignments: Record<string, string[]>;
}

/** Picker roster for the manual-replacement popup: every soldier in the DB
 *  (identity = id, never a copied name) plus what the popup filters on —
 *  role (מפקד) and qualifications (נהג דוד / נהג טיגריס). */
export interface DraftRosterEntry {
  id: number;
  name: string;
  role: string;
  platoon: string;
  schedulable: boolean;
  quals: string[];
}

export interface DraftResponse { days: DraftDay[]; roster: DraftRosterEntry[] }
export interface DeleteDraftResponse { day: string; status: string; shiftRows: number; dayRows: number }
export interface GenerateResponse {
  day: string;
  rows: number;
  issues: string[];
  validation: DraftFinding[];
}
/** A row the swap had to vacate so the incoming soldier could take the seat
 *  (only with `force`) — its seat is now empty. */
export interface EvictedRow { day: string; position: string; time: string }
export interface ReplaceResponse { day: string; updated: number; evicted: EvictedRow[] }

const hm = (d: Date) =>
  `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

/** Calendar-date arithmetic on a YYYY-MM-DD string (UTC math, no tz drift). */
function addDaysIso(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** Guard rail on the GET window: every non-draft day in the range fans out a
 *  full validateDay() (~16 statements), so an unbounded range is a DoS on the
 *  pooler. Same limit the נוכחות tab uses (api/presence.ts MAX_DAYS). */
const MAX_DAYS = 62;

/** SQL for labelSlot's `yomi` argument: `daily: true` implies yomi_display and
 *  an explicit yomi_display wins (scheduler/src/config.ts). Computed in the
 *  query so the rows don't have to carry the whole `positions.config` jsonb —
 *  this is the only thing the assignment rows ever read out of it. */
const YOMI_SQL = (alias: string) =>
  `coalesce((${alias}.config->>'yomi_display')::boolean, (${alias}.config->>'daily')::boolean, false)`;

/** Time label for an assignment/slot row. yomi_display positions (מגן/חפק)
 *  are daily crews — no shift times on the card; a shift starting on the next
 *  calendar day (tail of the 14:00→14:00 schedule day) is marked למחרת so the
 *  card reads unambiguously. */
function labelSlot(day: string, pStart: Date, pEnd: Date, yomi: boolean): string {
  if (yomi) return 'יומי';
  const startDay = `${pStart.getFullYear()}-${String(pStart.getMonth() + 1).padStart(2, '0')}-${String(pStart.getDate()).padStart(2, '0')}`;
  return `${hm(pStart)}-${hm(pEnd)}${startDay !== day ? ' (למחרת)' : ''}`;
}

/** placeholder soldier name for an empty seat (rendered as a red badge by SoldierName) */
const UNFILLED = 'לא מאויש';

/** Stale-draft cleanup (Task 7B). A PAST day whose full 14:00→14:00 cycle has
 *  ended, that was never published, but for which a published schedule exists
 *  for that day or a fresher one, no longer needs its regenerable draft: its
 *  auto/chain rows are dropped (locked/manual rows — e.g. a hand-entered חמל —
 *  are always kept). If nothing human remains, the day drops back to 'draft'
 *  so the view shows it empty. A published day is NEVER touched, and a day
 *  with no published successor is kept as a fallback. Idempotent — triggered
 *  lazily on read (getDrafts). */
async function cleanupStaleDrafts(from: string, to: string): Promise<void> {
  const pool = getPool();
  const stale = await pool.query<{ day: string }>(
    `select d.day::text from schedule_days d
     where d.day between $1 and $2
       and d.status <> 'published'
       and day_start(d.day) + interval '24 hours' <= timezone('Asia/Jerusalem', now())
       and exists (select 1 from schedule_days p
                   where p.status = 'published' and p.day >= d.day)`, [from, to]);
  if (!stale.rowCount) return;
  const days = stale.rows.map((r) => r.day);
  // All three writes in ONE transaction: the status flip is only correct if it
  // sees the two deletes, and a failure between them used to leave a day
  // half-cleaned (rows gone, status still 'generated') on every later read.
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query(
      `delete from shift_assignments where day = any($1::date[])
         and source in ('auto','chain') and not locked`, [days]);
    await client.query(
      `delete from day_assignments where day = any($1::date[])
         and source in ('auto','chain') and not locked`, [days]);
    // Days left with nothing human revert to an empty draft.
    await client.query(
      `update schedule_days d set status = 'draft'
       where d.day = any($1::date[])
         and not exists (select 1 from shift_assignments sa where sa.day = d.day)
         and not exists (select 1 from day_assignments da where da.day = d.day)`, [days]);
    await client.query('commit');
  } catch (e) {
    await client.query('rollback').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

async function getDrafts(from: string, to: string): Promise<DraftResponse> {
  const pool = getPool();
  await cleanupStaleDrafts(from, to);
  const [daysRes, rowsRes, dayAssignRes, slotsRes, rosterRes] = await Promise.all([
    pool.query(
      `select day::text, status, generated_at, published_at, approved_by,
              (report_html is not null) has_report
       from schedule_days where day between $1 and $2 order by day`, [from, to]),
    pool.query(
      `select sa.day::text, sa.position_id, p.name pos_name, ${YOMI_SQL('p')} yomi,
              sp.name sub_name, s.full_name,
              lower(sa.period) p_start, upper(sa.period) p_end,
              sa.source, sa.locked, sa.violations, sa.rationale, sa.seat_index,
              sa.blocks_overlap
       from shift_assignments sa
       join positions p on p.id = sa.position_id
       left join sub_positions sp on sp.id = sa.sub_position_id
       left join soldiers s on s.id = sa.soldier_id
       where sa.day between $1 and $2
       order by sa.day, p.id, lower(sa.period), sa.seat_index`, [from, to]),
    pool.query(
      `select da.day::text, p.name pos_name, s.full_name
       from day_assignments da
       join positions p on p.id = da.position_id
       join soldiers s on s.id = da.soldier_id
       where da.day between $1 and $2
       order by da.day, p.id, s.full_name`, [from, to]),
    pool.query(
      // flex_seats is the ONLY part of config requiredSeats() reads, so the
      // slot rows carry just that subobject (plus the yomi flag) rather than
      // the whole jsonb — the helper stays the single authority on the math.
      `select ds.day::text, ds.position_id, p.name pos_name, ${YOMI_SQL('p')} yomi,
              p.config -> 'flex_seats' flex_seats, sp.name sub_name,
              lower(ds.period) p_start, upper(ds.period) p_end, ds.seats
       from day_slots ds
       join positions p on p.id = ds.position_id
       left join sub_positions sp on sp.id = ds.sub_position_id
       where ds.day between $1 and $2 and ${positionScope('p')}
       order by ds.day, p.id, lower(ds.period)`, [from, to]),
    // full roster for the replacement picker (not date-scoped — a replacement
    // may come from anywhere, including soldiers the generator skipped)
    pool.query(
      `select s.id, s.full_name, coalesce(s.role,'') role, coalesce(s.platoon,'') platoon,
              s.is_schedulable,
              coalesce(array_agg(q.qualification) filter (where q.qualification is not null),
                       '{}') quals
       from soldiers s
       left join soldier_qualifications q on q.soldier_id = s.id
       where s.archived_at is null
       group by s.id
       order by s.full_name`),
  ]);

  // Live validation (consistent with api/fairness.ts): the stored
  // schedule_days.validation snapshot goes stale after manual edits, so each
  // generated day is re-validated on read. The snapshot is still written at
  // persist time (scheduler/src/persist.ts) as a historical record.
  const { validateDay } = await import('../scheduler/src/validate.js');
  const liveValidation = new Map(await Promise.all(
    daysRes.rows.filter((d: any) => d.status !== 'draft').map(async (d: any) =>
      [d.day as string, await validateDay(d.day) as DraftFinding[]] as const)));

  const days = new Map<string, DraftDay>();
  for (const d of daysRes.rows) {
    days.set(d.day, {
      day: d.day, status: d.status,
      generatedAt: d.generated_at ? new Date(d.generated_at).toISOString() : null,
      publishedAt: d.published_at ? new Date(d.published_at).toISOString() : null,
      approvedBy: d.approved_by ?? null,
      hasReport: !!d.has_report,
      validation: liveValidation.get(d.day) ?? [], groups: [], meta: {}, dayAssignments: {},
    });
  }

  // group rows: position -> subType (sub-position or position) -> time -> soldiers
  const grouping = new Map<string, Map<string, Map<string, string[]>>>();
  for (const r of rowsRes.rows) {
    const day = days.get(r.day);
    if (!day) continue;
    const time = labelSlot(r.day, new Date(r.p_start), new Date(r.p_end), r.yomi === true);
    const station = r.pos_name as string;
    const sug = (r.sub_name as string | null) ?? station;
    const gKey = `${r.day}|${station}`;
    const bySug = grouping.get(gKey) ?? new Map();
    grouping.set(gKey, bySug);
    const byTime = bySug.get(sug) ?? new Map();
    bySug.set(sug, byTime);
    const soldiers = byTime.get(time) ?? [];
    byTime.set(time, soldiers);
    const name = r.full_name ?? '?';
    soldiers.push(name);
    const violations: string[] = Array.isArray(r.violations) ? r.violations : [];
    const rationale: RationaleEntry[] = Array.isArray(r.rationale) ? r.rationale : [];
    // meta for every row (the ⓘ popup needs it); on key collision — e.g. a
    // readiness overlay sharing a time label with a mission row — merge.
    const key = `${name}|${time}`;
    const prev = day.meta[key];
    day.meta[key] = prev ? {
      source: prev.source, locked: prev.locked || r.locked,
      blocksOverlap: prev.blocksOverlap || r.blocks_overlap,
      violations: [...new Set([...prev.violations, ...violations])],
      rationale: [...prev.rationale, ...rationale],
    } : {
      source: r.source, locked: r.locked, blocksOverlap: r.blocks_overlap,
      violations, rationale,
    };
  }
  // Merge the day's slot catalog in: an under-filled slot shows explicit
  // "לא מאויש" markers so empty positions are visible on the page itself,
  // not only in the validation panel.
  //
  // Staffing is counted by OVERLAP against the day's real rows — the shared
  // `staffedSeats()` the validator's coverage rule runs (coverage.ts) — never
  // by matching the rendered time LABEL. A real row sliced differently from
  // the template staffs it all the same: the officers run כרמל חטיבה's night
  // as one 22:00→06:00 row, and a template that splits the night into two 4h
  // slots used to make the tab shout "לא מאויש" over a fully manned shift
  // while the validator (judging by overlap) saw nothing wrong.
  const rowsByDayPos = new Map<string, CoverRow[]>();
  for (const r of rowsRes.rows) {
    const key = `${r.day}|${r.position_id}`;
    let rows = rowsByDayPos.get(key);
    if (!rows) rowsByDayPos.set(key, rows = []);
    rows.push({
      start: new Date(r.p_start).getTime(), end: new Date(r.p_end).getTime(),
      subName: (r.sub_name as string | null) ?? null,
    });
  }
  for (const sl of slotsRes.rows) {
    const day = days.get(sl.day);
    if (!day || day.status === 'draft') continue;   // never-generated days stay empty
    const n = staffedSeats(
      new Date(sl.p_start).getTime(), new Date(sl.p_end).getTime(),
      (sl.sub_name as string | null) ?? null,
      rowsByDayPos.get(`${sl.day}|${sl.position_id}`) ?? []);
    // flex positions (מגן 10-12, סיור 3-4/shift) may legitimately staff below
    // the template seat count down to the flex minimum — same rule as the
    // validator's coverage check (shared helper)
    const required = requiredSeats(Number(sl.seats), { flex_seats: sl.flex_seats });
    const missing = required - n;
    if (missing <= 0) continue;
    const time = labelSlot(sl.day, new Date(sl.p_start), new Date(sl.p_end), sl.yomi === true);
    const station = sl.pos_name as string;
    const sug = (sl.sub_name as string | null) ?? station;
    const gKey = `${sl.day}|${station}`;
    const bySug = grouping.get(gKey) ?? new Map<string, Map<string, string[]>>();
    grouping.set(gKey, bySug);
    const byTime = bySug.get(sug) ?? new Map<string, string[]>();
    bySug.set(sug, byTime);
    const soldiers = byTime.get(time) ?? [];
    byTime.set(time, soldiers);
    for (let i = 0; i < missing; i++) soldiers.push(UNFILLED);
  }

  for (const [gKey, bySug] of grouping) {
    const [dayKey, station] = gKey.split('|');
    const day = days.get(dayKey)!;
    // schedule-day order: 14:00 first, hours before 14:00 are the day's tail
    const timeVal = (t: string) => {
      if (!t || t === 'יומי') return 9999;
      const h = parseInt(t.split(':')[0] ?? '0', 10);
      return h < 14 ? h + 24 : h;   // mirrors the UI's timeToVal
    };
    const subTypes: SubType[] = [...bySug.entries()].map(([sug, byTime]) => ({
      sug,
      times: [...byTime.entries()]
        .sort((a, b) => timeVal(a[0]) - timeVal(b[0]))
        .map(([time, soldiers]): TimeSlot => ({ time, soldiers })),
    }));
    day.groups.push({ name: station, subTypes } as StationGroup);
  }
  for (const r of dayAssignRes.rows) {
    const day = days.get(r.day);
    if (!day) continue;
    (day.dayAssignments[r.pos_name] ??= []).push(r.full_name);
  }
  const roster: DraftRosterEntry[] = rosterRes.rows.map((r: any) => ({
    id: Number(r.id), name: r.full_name, role: r.role, platoon: r.platoon,
    schedulable: !!r.is_schedulable, quals: (r.quals ?? []) as string[],
  }));
  return { days: [...days.values()], roster };
}

// ── Manual replacement (PUT) ────────────────────────────────────────────────
// Officer edit from the צור שבצק tab: swap the soldier sitting in one
// assignment for another. The clicked assignment is identified the same way
// the UI identifies it everywhere else — day + soldier + TIME LABEL (draft
// `meta` is keyed `${name}|${time}` too) — and the label is recomputed here
// with the very same labelSlot(), so client and server can never disagree
// about what "18:00-02:00 (למחרת)" means. A soldier holding two rows under one
// label (a mission row plus a readiness overlay over the same window) is
// swapped in both: it is the same person in the same window.
//
// The swapped rows become source='manual' + locked=true, so a later
// regeneration of the day keeps them (CLAUDE.md: human edits are never
// deleted by the generator), and their auto-generated rationale is replaced
// by a single manual_replace entry — the old "why he was picked" reasoning
// does not describe the new soldier.
//
// A PUBLISHED day is editable (owner 2026-07-26): fixing one seat in a
// published schedule must not require unpublishing the whole day. Only the
// wholesale operations stay frozen — regenerate (POST) and מחק טיוטה (DELETE).
//
// `force` (the officer approved the popup the client raises when it sees the
// incoming soldier already booked in these hours) evicts his overlapping
// BLOCKING rows first, in the same transaction, so no_double_booking can never
// fire: remove, then assign. The vacated seats come back as לא מאויש.

const err = (status: number, message: string) =>
  Object.assign(new Error(message), { status });

/** Point a soldier's Level-1 bucket at whatever he still holds that day; if he
 *  holds nothing, park him in the rest bucket (מנוחה) so he stays visible on
 *  the page — UNLOCKED, so a regeneration is free to plan him again (a locked
 *  rest bucket would pin him to מנוחה forever, ctx.lockedDay in level1.ts).
 *  With no rest position configured, his bucket row is dropped. */
/** The rest (מנוחה) position id — a constant of the deployment, so it is looked
 *  up once instead of on every rebucket() call (same pattern as hamal.ts's
 *  cachedHamalPid). `undefined` = not looked up yet, `null` = none configured. */
let cachedRestPid: number | null | undefined;
async function restPositionId(client: Queryable): Promise<number | null> {
  if (cachedRestPid !== undefined) return cachedRestPid;
  const r = await client.query(
    `select id from positions where mission_class = 'rest' order by id limit 1`);
  return (cachedRestPid = r.rows[0]?.id ?? null);
}

async function rebucket(client: Queryable, day: string, soldierId: number): Promise<void> {
  const keep = await client.query(
    `select sa.position_id from shift_assignments sa
      where sa.day = $1 and sa.soldier_id = $2
      order by sa.blocks_overlap desc, lower(sa.period) limit 1`, [day, soldierId]);
  const bucket = keep.rows[0]?.position_id ?? (keep.rowCount ? null : await restPositionId(client));
  if (bucket === null) {
    await client.query(
      `delete from day_assignments where day = $1 and soldier_id = $2`, [day, soldierId]);
  } else if (keep.rowCount) {
    await client.query(
      `update day_assignments set position_id = $3
        where day = $1 and soldier_id = $2`, [day, soldierId, bucket]);
  } else {
    await client.query(
      `update day_assignments set position_id = $3, source = 'auto', locked = false
        where day = $1 and soldier_id = $2`, [day, soldierId, bucket]);
  }
}

async function replaceSoldier(day: string, time: string, fromId: number, toId: number,
                              force = false): Promise<ReplaceResponse> {
  const pool = getPool();
  if (fromId === toId) throw err(400, 'אותו חייל — לא בוצע שינוי');

  // Three independent reads — day status, the two names, and the outgoing
  // soldier's rows on the day. One round trip's latency instead of three.
  const [st, nameOf, rows] = await Promise.all([
    dayStatus(day),
    soldierNamesById([fromId, toId]),
    // candidate rows of the outgoing soldier on this day, narrowed to the
    // clicked slot by its rendered time label. `lo`/`hi` serve double duty:
    // the tsrange literals below AND (parsed as naive local) the label math,
    // so the raw lower()/upper() columns are not selected as well.
    pool.query(
      `select sa.id, sa.position_id, p.name pos_name, ${YOMI_SQL('p')} yomi,
              sa.blocks_overlap,
              to_char(lower(sa.period), 'YYYY-MM-DD"T"HH24:MI:SS') lo,
              to_char(upper(sa.period), 'YYYY-MM-DD"T"HH24:MI:SS') hi
       from shift_assignments sa
       join positions p on p.id = sa.position_id
       where sa.day = $1 and sa.soldier_id = $2
       order by sa.blocks_overlap desc, lower(sa.period)`, [day, fromId]),
  ]);
  if (st === null) throw err(404, 'אין טיוטה ליום זה');
  if (!nameOf.has(fromId) || !nameOf.has(toId)) throw err(404, 'חייל לא נמצא');

  const targets = rows.rows.filter((r: any) =>
    labelSlot(day, new Date(r.lo), new Date(r.hi), r.yomi === true) === time);
  if (!targets.length) {
    throw err(404, 'השיבוץ לא נמצא — ייתכן שהטיוטה השתנתה בינתיים. רענן ונסה שוב');
  }
  const ranges = targets.map((r: any) => `[${r.lo},${r.hi})`);

  // H3 / no_double_booking: a blocking row of the incoming soldier that
  // overlaps the window makes the swap impossible for the DB. Without `force`
  // that is a 409 naming WHERE he is (never a raw constraint error); with it,
  // those rows are the ones the officer agreed to vacate.
  const blocking = ranges.filter((_r, i) => targets[i].blocks_overlap);

  // The clash scan is bounded by schedule day. A row whose PERIOD overlaps one
  // of these windows can be filed under schedule day D-1 (a window that starts
  // before 14:00 belongs to the previous day) or D, so ±1 around the span of
  // the target periods is generous and cannot miss one. Unbounded, this query
  // scanned the incoming soldier's ENTIRE assignment history on every swap.
  const dates = targets.flatMap((r: any) => [String(r.lo).slice(0, 10), String(r.hi).slice(0, 10)]);
  const fromDay = addDaysIso(dates.reduce((a, b) => (a < b ? a : b)), -1);
  const toDay = addDaysIso(dates.reduce((a, b) => (a > b ? a : b)), 1);

  // duplicate-seat probe and clash scan are independent of each other
  const [dup, clash] = await Promise.all([
    // already in this very slot?
    pool.query(
      `select 1 from shift_assignments sa
       join unnest($3::bigint[], $4::tsrange[]) as t(pid, per)
         on sa.position_id = t.pid and sa.period = t.per
       where sa.soldier_id = $1 and sa.day = $2 limit 1`,
      [toId, day, targets.map((r: any) => r.position_id), ranges]),
    blocking.length
      ? pool.query(
        `select sa.id, sa.day::text, p.name pos_name, ${YOMI_SQL('p')} yomi,
                lower(sa.period) p_start, upper(sa.period) p_end
         from shift_assignments sa
         join positions p on p.id = sa.position_id
         where sa.soldier_id = $1 and sa.blocks_overlap
           and sa.day between $3::date and $4::date
           and sa.period && any($2::tsrange[])
         order by sa.day, p.id, lower(sa.period)`, [toId, blocking, fromDay, toDay])
      : null,
  ]);
  if (dup.rowCount) throw err(409, `${nameOf.get(toId)} כבר משובץ במשמרת זו`);

  const evict: { id: number; day: string; position: string; time: string }[] = [];
  if (clash) {
    if (clash.rowCount && !force) {
      const where = [...new Set(clash.rows.map((r: any) => r.pos_name as string))].join(', ');
      throw err(409, `${nameOf.get(toId)} כבר משובץ בשעות אלו (${where})`);
    }
    for (const r of clash.rows as any[]) {
      evict.push({
        id: Number(r.id), day: r.day, position: r.pos_name,
        time: labelSlot(r.day, new Date(r.p_start), new Date(r.p_end), r.yomi === true),
      });
    }
  }

  // the day bucket follows the primary (blocking, else first) swapped row
  const primaryPid = targets[0].position_id as number;
  const rationale = JSON.stringify([
    { code: 'manual_replace', params: { from: nameOf.get(fromId) } },
  ]);

  const client = await pool.connect();
  try {
    await client.query('begin');
    // REMOVE first, then assign — the reverse order would trip
    // no_double_booking mid-transaction. The seats are left empty (they render
    // as לא מאויש); the officer fills them next.
    if (evict.length) {
      await client.query(`delete from shift_assignments where id = any($1::bigint[])`,
        [evict.map((e) => e.id)]);
    }
    await client.query(
      `update shift_assignments
          set soldier_id = $2, source = 'manual', locked = true,
              violations = '[]'::jsonb, rationale = $3::jsonb
        where id = any($1::bigint[])`,
      [targets.map((r: any) => r.id), toId, rationale]);
    await client.query(
      `insert into day_assignments (day, soldier_id, position_id, source, locked)
       values ($1::date, $2, $3, 'manual', true)
       on conflict (day, soldier_id)
       do update set position_id = excluded.position_id, source = 'manual', locked = true`,
      [day, toId, primaryPid]);
    // Re-bucket the outgoing soldier — and, on any OTHER day an evicted row
    // belonged to, the incoming one (his bucket there may now name a position
    // he no longer holds). His bucket on `day` is the upsert above.
    await rebucket(client, day, fromId);
    for (const d of new Set(evict.map((e) => e.day))) {
      if (d !== day) await rebucket(client, d, toId);
    }
    await client.query('commit');
  } catch (e) {
    await client.query('rollback').catch(() => {});
    if ((e as any)?.code === '23P01') {
      throw err(409, `${nameOf.get(toId)} כבר משובץ בשעות אלו`);
    }
    throw e;
  } finally {
    client.release();
  }
  return {
    day, updated: targets.length,
    evicted: evict.map(({ day: d, position, time: t }) => ({ day: d, position, time: t })),
  };
}

// ── Draft delete (DELETE) ───────────────────────────────────────────────────
// "מחק טיוטה" from the צור שבצק tab: throw away ONE day's generated draft, so
// the day goes back to empty and what stands is the published schedule instead
// of a draft the officer decided against. The manual, unconditional twin of
// cleanupStaleDrafts() above.
//
// Deleted: every draft row of the day — auto/chain AND the officer's
// manual/locked edits. (The "human rows are never deleted" rule guards the
// GENERATOR; an explicit delete is the officer asking for a clean slate.)
// Kept:
//   - source='import' rows — real history imported from the sheet;
//   - rows of manual-only positions (positions.is_scheduled=false → חמל,
//     חפק2, משימות שונות): owned by other tabs, never produced by generation.
// The day reverts to status='draft' (report + validation snapshot dropped —
// they describe rows that no longer exist), unless imported history remains, in
// which case the day is history and its status is left alone. A published day
// is frozen (409) — unpublish first, exactly like regenerating.
async function deleteDraft(day: string): Promise<DeleteDraftResponse> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('begin');
    // The published-status guard reads INSIDE the transaction and locks the
    // row: checking on the pool first left a window in which a concurrent
    // publish could land between the check and the deletes, wiping an
    // already-approved schedule.
    const st = await client.query<{ status: string }>(
      `select status from schedule_days where day = $1 for update`, [day]);
    if (!st.rows.length) throw err(404, 'אין טיוטה ליום זה');
    if (st.rows[0].status === 'published') {
      throw err(409, 'היום פורסם — יש לבטל פרסום לפני מחיקת הטיוטה');
    }
    const sa = await client.query(
      `delete from shift_assignments sa using positions p
        where p.id = sa.position_id and sa.day = $1
          and p.is_scheduled and sa.source <> 'import'`, [day]);
    const da = await client.query(
      `delete from day_assignments da using positions p
        where p.id = da.position_id and da.day = $1 and p.is_scheduled`, [day]);
    const upd = await client.query<{ status: string }>(
      `update schedule_days set status = 'draft', generated_at = null,
              report_html = null, validation = '[]'::jsonb
        where day = $1
          and not exists (select 1 from shift_assignments sa
                          where sa.day = $1 and sa.source = 'import')
        returning status`, [day]);
    await client.query('commit');
    return {
      day, status: upd.rows[0]?.status ?? st.rows[0].status,
      shiftRows: sa.rowCount ?? 0, dayRows: da.rowCount ?? 0,
    };
  } catch (e) {
    await client.query('rollback').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    if (req.method === 'GET') {
      const from = String(req.query.from ?? '');
      const to = String(req.query.to ?? from);
      if (!DATE_RE.test(from) || !DATE_RE.test(to)) {
        return res.status(400).json({ error: 'from/to required (YYYY-MM-DD)' });
      }
      if (to < from) {
        return res.status(400).json({ error: 'תאריך הסיום קודם לתאריך ההתחלה' });
      }
      // days between, inclusive — 86400000 ms/day, both ends are pure dates
      const span = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000 + 1;
      if (span > MAX_DAYS) {
        return res.status(400).json({ error: `טווח ארוך מדי (עד ${MAX_DAYS} ימים)` });
      }
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json(await getDrafts(from, to));
    }

    if (req.method === 'POST') {
      const { day } = (req.body ?? {}) as { day?: string };
      if (!day || !DATE_RE.test(day)) {
        return res.status(400).json({ error: 'day required (YYYY-MM-DD)' });
      }
      // Overwrite guard: a published day is frozen — regenerating it would
      // silently replace an approved schedule. Refuse until it is unpublished.
      if (await dayStatus(day) === 'published') {
        return res.status(409).json({ error: 'היום פורסם — יש לבטל פרסום לפני חילול מחדש' });
      }
      // One day per request (Vercel time limit); the UI iterates ranges.
      const { generate, persist } = await import('../scheduler/src/generate.js');
      const result = await generate(day);
      const validation = await persist(result);
      const out: GenerateResponse = {
        day, rows: result.assignments.length, issues: result.issues,
        validation: validation as DraftFinding[],
      };
      return res.status(200).json(out);
    }

    if (req.method === 'PUT') {
      const { day, time, fromSoldierId, toSoldierId, force } =
        (req.body ?? {}) as { day?: string; time?: string; fromSoldierId?: number; toSoldierId?: number; force?: boolean };
      if (!day || !DATE_RE.test(day)) {
        return res.status(400).json({ error: 'day required (YYYY-MM-DD)' });
      }
      if (typeof time !== 'string' || !time) {
        return res.status(400).json({ error: 'time (slot label) required' });
      }
      const from = Number(fromSoldierId), to = Number(toSoldierId);
      if (!Number.isInteger(from) || from <= 0 || !Number.isInteger(to) || to <= 0) {
        return res.status(400).json({ error: 'fromSoldierId/toSoldierId required' });
      }
      return res.status(200).json(await replaceSoldier(day, time, from, to, force === true));
    }

    if (req.method === 'DELETE') {
      // day travels in the query string (a DELETE body is not universally
      // forwarded); ?day= is also what the GET uses.
      const day = String(req.query.day ?? (req.body as any)?.day ?? '');
      if (!DATE_RE.test(day)) {
        return res.status(400).json({ error: 'day required (YYYY-MM-DD)' });
      }
      return res.status(200).json(await deleteDraft(day));
    }

    return res.status(405).json({ error: 'method not allowed' });
  } catch (e) {
    const status = (e as any)?.status ?? 500;
    if (status === 500) console.error(e);
    return res.status(status).json({ error: e instanceof Error ? e.message : 'server error' });
  }
}
