import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getPool, DATE_RE } from './_db.js';
import type { StationGroup, SubType, TimeSlot } from './shavtzak.js';
import type { RationaleEntry } from '../scheduler/src/rationale.js';

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

export interface DraftResponse { days: DraftDay[] }
export interface GenerateResponse {
  day: string;
  rows: number;
  issues: string[];
  validation: DraftFinding[];
}

const hm = (d: Date) =>
  `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

/** Time label for an assignment/slot row. yomi_display positions (מגן/חפק)
 *  are daily crews — no shift times on the card; a shift starting on the next
 *  calendar day (tail of the 14:00→14:00 schedule day) is marked למחרת so the
 *  card reads unambiguously. */
function labelSlot(day: string, pStart: Date, pEnd: Date, posConfig: Record<string, any> | null): string {
  // daily:true implies yomi_display (scheduler/src/config.ts); explicit key wins
  if (posConfig?.yomi_display ?? posConfig?.daily) return 'יומי';
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
  await pool.query(
    `delete from shift_assignments where day = any($1::date[])
       and source in ('auto','chain') and not locked`, [days]);
  await pool.query(
    `delete from day_assignments where day = any($1::date[])
       and source in ('auto','chain') and not locked`, [days]);
  // Days left with nothing human revert to an empty draft.
  await pool.query(
    `update schedule_days d set status = 'draft'
     where d.day = any($1::date[])
       and not exists (select 1 from shift_assignments sa where sa.day = d.day)
       and not exists (select 1 from day_assignments da where da.day = d.day)`, [days]);
}

async function getDrafts(from: string, to: string): Promise<DraftResponse> {
  const pool = getPool();
  await cleanupStaleDrafts(from, to);
  const [daysRes, rowsRes, dayAssignRes, slotsRes] = await Promise.all([
    pool.query(
      `select day::text, status, generated_at, published_at, approved_by,
              (report_html is not null) has_report
       from schedule_days where day between $1 and $2 order by day`, [from, to]),
    pool.query(
      `select sa.day::text, p.name pos_name, p.config pos_config, sp.name sub_name, s.full_name,
              lower(sa.period) p_start, upper(sa.period) p_end,
              sa.source, sa.locked, sa.violations, sa.rationale, sa.seat_index
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
      `select ds.day::text, p.name pos_name, p.config pos_config, sp.name sub_name,
              lower(ds.period) p_start, upper(ds.period) p_end, ds.seats
       from day_slots ds
       join positions p on p.id = ds.position_id
       left join sub_positions sp on sp.id = ds.sub_position_id
       where ds.day between $1 and $2 and p.is_scheduled
         and p.mission_class <> 'rest' and not (p.config ? 'staff_all_roles')
       order by ds.day, p.id, lower(ds.period)`, [from, to]),
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
    const time = labelSlot(r.day, new Date(r.p_start), new Date(r.p_end), r.pos_config);
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
      violations: [...new Set([...prev.violations, ...violations])],
      rationale: [...prev.rationale, ...rationale],
    } : { source: r.source, locked: r.locked, violations, rationale };
  }
  // Merge the day's slot catalog in: an under-filled slot shows explicit
  // "לא מאויש" markers so empty positions are visible on the page itself,
  // not only in the validation panel. Imported history rows carry no
  // sub-position, so null-sub rows at the same start excuse any sub-slot.
  const countAt = (bySug: Map<string, Map<string, string[]>>, sug: string, time: string) =>
    bySug.get(sug)?.get(time)?.length ?? 0;
  for (const sl of slotsRes.rows) {
    const day = days.get(sl.day);
    if (!day || day.status === 'draft') continue;   // never-generated days stay empty
    const time = labelSlot(sl.day, new Date(sl.p_start), new Date(sl.p_end), sl.pos_config);
    const station = sl.pos_name as string;
    const sug = (sl.sub_name as string | null) ?? station;
    const gKey = `${sl.day}|${station}`;
    const bySug = grouping.get(gKey) ?? new Map<string, Map<string, string[]>>();
    grouping.set(gKey, bySug);
    // rows matching this slot: exact sub + pooled null-sub rows (import data)
    let n = countAt(bySug, sug, time);
    if (sl.sub_name !== null) n += countAt(bySug, station, time);
    // flex positions (מגן 10-12, סיור 3-4/shift) may legitimately staff below
    // the template seat count down to the flex minimum — same rule as the
    // validator's coverage check
    const flexMin = sl.pos_config?.flex_seats?.min;
    const required = flexMin !== undefined ? Math.min(Number(sl.seats), Number(flexMin)) : Number(sl.seats);
    const missing = required - n;
    if (missing <= 0) continue;
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
  return { days: [...days.values()] };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
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
      return res.status(200).json(await getDrafts(from, to));
    }

    if (req.method === 'POST') {
      const { day } = (req.body ?? {}) as { day?: string };
      if (!day || !DATE_RE.test(day)) {
        return res.status(400).json({ error: 'day required (YYYY-MM-DD)' });
      }
      // Overwrite guard: a published day is frozen — regenerating it would
      // silently replace an approved schedule. Refuse until it is unpublished.
      const st = await getPool().query<{ status: string }>(
        `select status from schedule_days where day = $1`, [day]);
      if (st.rows[0]?.status === 'published') {
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

    return res.status(405).json({ error: 'method not allowed' });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e instanceof Error ? e.message : 'server error' });
  }
}
