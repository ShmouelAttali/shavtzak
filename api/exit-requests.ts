import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getPool, DATE_RE } from './_db.js';
import { normalizeName } from '../scheduler/src/text.js';
import { DAY, dayStart, minToDate, minToIso, scheduleDayStart, toMin, type Minutes } from '../scheduler/src/time.js';

// ── Types (imported by the frontend as ../../api/exit-requests) ─────────────

export interface ExitRequest {
  id: number;
  soldierName: string;
  day: string;        // schedule day YYYY-MM-DD (the 14:00 cycle the exit starts in)
  start: string;      // 'YYYY-MM-DD HH:MM' naive local
  end: string;        // 'YYYY-MM-DD HH:MM'
  note: string | null;
}
export interface ExitRequestsResponse { requests: ExitRequest[] }
export const FROM_TIMES = ['14:00', '18:00', '22:00', '02:00', '06:00'] as const;
export const TO_TIMES = ['18:00', '22:00', '02:00', '06:00', '14:00'] as const;

// ── Time math (mirrors slotStart() in scheduler/src/time.ts) ────────────────
// Boundary times are shift boundaries inside the 14:00→14:00 schedule day:
// hours-from-14:00 offsets. Times before 14:00 belong to the NEXT calendar
// day; a 14:00 `to` means the end of the cycle (offset 24).

const BOUNDARY_OFFSET: Record<string, number> = {
  '14:00': 0, '18:00': 4, '22:00': 8, '02:00': 12, '06:00': 16,
};
const toOffsetOf = (to: string) => (to === '14:00' ? 24 : BOUNDARY_OFFSET[to]);

/** Timestamp literal for SQL ('YYYY-MM-DD HH:MM:00'); the contract's
 *  'YYYY-MM-DD HH:MM' display form is produced by to_char in the queries. */
const sqlTs = (m: Minutes) => minToIso(m);

/** Schedule days (YYYY-MM-DD) whose 14:00→14:00 cycle overlaps [s, e). */
function affectedDays(s: Minutes, e: Minutes): string[] {
  const days: string[] = [];
  for (let d = scheduleDayStart(s); d < e; d += DAY) days.push(minToDate(d));
  return days;
}

// ── DB helpers ───────────────────────────────────────────────────────────────

/** Resolve a soldier by full name: exact match first, then normalized
 *  (quote-variant / whitespace tolerant — mirrors scheduler/src/text.ts). */
async function resolveSoldier(
  name: string, schedulableOnly: boolean,
): Promise<{ id: number; fullName: string } | null> {
  const pool = getPool();
  const cond = schedulableOnly ? 'and is_schedulable' : '';
  const exact = await pool.query(
    `select id, full_name from soldiers where full_name = $1 ${cond}`, [name]);
  if (exact.rows[0]) return { id: Number(exact.rows[0].id), fullName: exact.rows[0].full_name };
  const all = await pool.query(
    `select id, full_name from soldiers where true ${cond}`);
  const wanted = normalizeName(name);
  const hit = all.rows.find((r: any) => normalizeName(r.full_name) === wanted);
  return hit ? { id: Number(hit.id), fullName: hit.full_name } : null;
}

/** First affected schedule day whose שבצ"ק is already generated, else null. */
async function generatedDay(days: string[]): Promise<string | null> {
  const pool = getPool();
  for (const d of days) {
    const rows = await pool.query(
      `select 1 from shift_assignments where day = $1 limit 1`, [d]);
    if (rows.rowCount) return d;
    const st = await pool.query(
      `select 1 from schedule_days where day = $1 and coalesce(status, 'draft') <> 'draft'`, [d]);
    if (st.rowCount) return d;
  }
  return null;
}

const REQUEST_COLS = `
  er.id, s.full_name,
  schedule_day_of(lower(er.period))::text as day,
  to_char(lower(er.period), 'YYYY-MM-DD HH24:MI') as start,
  to_char(upper(er.period), 'YYYY-MM-DD HH24:MI') as "end",
  er.note`;

const toExitRequest = (r: any): ExitRequest => ({
  id: Number(r.id), soldierName: r.full_name,
  day: r.day, start: r.start, end: r.end, note: r.note ?? null,
});

// ── Handlers ─────────────────────────────────────────────────────────────────

async function handleGet(req: VercelRequest, res: VercelResponse) {
  const from = String(req.query.from ?? '');
  const to = String(req.query.to ?? from);
  if (!DATE_RE.test(from) || !DATE_RE.test(to)) {
    return res.status(400).json({ error: 'from/to required (YYYY-MM-DD)' });
  }
  res.setHeader('Cache-Control', 'no-store');
  const params: unknown[] = [from, to];
  let nameCond = '';
  const name = req.query.name ? String(req.query.name) : '';
  if (name) {
    const soldier = await resolveSoldier(name, false);
    if (!soldier) {
      const out: ExitRequestsResponse = { requests: [] };
      return res.status(200).json(out);
    }
    params.push(soldier.id);
    nameCond = 'and er.soldier_id = $3';
  }
  const { rows } = await getPool().query(
    `select ${REQUEST_COLS}
     from exit_requests er
     join soldiers s on s.id = er.soldier_id
     where schedule_day_of(lower(er.period)) between $1::date and $2::date ${nameCond}
     order by er.period, er.id`, params);
  const out: ExitRequestsResponse = { requests: rows.map(toExitRequest) };
  return res.status(200).json(out);
}

async function handlePost(req: VercelRequest, res: VercelResponse) {
  const { name, day, from, to, email, note } = (req.body ?? {}) as {
    name?: string; day?: string; from?: string; to?: string;
    email?: string; note?: string;
  };

  // 1. shift-boundary window inside one 14:00→14:00 cycle
  if (
    !day || !DATE_RE.test(day)
    || !from || !(FROM_TIMES as readonly string[]).includes(from)
    || !to || !(TO_TIMES as readonly string[]).includes(to)
    || toOffsetOf(to) <= BOUNDARY_OFFSET[from]
  ) {
    return res.status(400).json({ error: 'טווח שעות לא תקין — יש לבחור שעות גבול משמרת' });
  }
  const s = dayStart(day) + BOUNDARY_OFFSET[from] * 60;
  const e = dayStart(day) + toOffsetOf(to) * 60;

  // 2. soldier resolution (exact, then normalized)
  const soldier = await resolveSoldier(String(name ?? ''), true);
  if (!soldier) {
    return res.status(404).json({ error: 'החייל לא נמצא במצבת המשובצים' });
  }

  // 3. the שבצ"ק for an affected day was already generated
  const days = affectedDays(s, e);
  const gen = await generatedDay(days);
  if (gen) {
    return res.status(409).json({
      error: `השבצ"ק ליום ${gen} כבר נוצר — לא ניתן להגיש בקשת יציאה. יש לפנות לאחראי השבצ"ק.`,
    });
  }

  // 4. must leave ≥8h available in every affected 14:00→14:00 cycle
  for (const d of days) {
    const ds = dayStart(d);
    const overlapMin = Math.min(e, ds + DAY) - Math.max(s, ds);
    if (overlapMin > 16 * 60) {
      return res.status(400).json({
        error: 'היציאה משאירה פחות מ-8 שעות זמינות ביממת השיבוץ — ליציאה ארוכה כזו יש להגיש יום חופש',
      });
    }
  }

  // 5. collisions with recorded absences / other exit requests
  const pool = getPool();
  const range = [sqlTs(s), sqlTs(e)];
  const unavail = await pool.query(
    `select 1 from unavailability
     where soldier_id = $1 and period && tsrange($2::timestamp, $3::timestamp, '[)') limit 1`,
    [soldier.id, ...range]);
  if (unavail.rowCount) {
    return res.status(400).json({ error: 'קיימת כבר היעדרות רשומה בתאריכים אלה' });
  }
  const dup = await pool.query(
    `select 1 from exit_requests
     where soldier_id = $1 and period && tsrange($2::timestamp, $3::timestamp, '[)') limit 1`,
    [soldier.id, ...range]);
  if (dup.rowCount) {
    return res.status(409).json({ error: 'כבר קיימת בקשת יציאה חופפת' });
  }

  try {
    const { rows } = await pool.query(
      `with ins as (
         insert into exit_requests (soldier_id, period, created_by, note)
         values ($1, tsrange($2::timestamp, $3::timestamp, '[)'), $4, $5)
         returning *
       )
       select ${REQUEST_COLS}
       from ins er join soldiers s on s.id = er.soldier_id`,
      [soldier.id, ...range, email ?? null, note ?? null]);
    return res.status(200).json({ request: toExitRequest(rows[0]) });
  } catch (err: any) {
    // EXCLUDE constraint (exit_requests_no_overlap) — race with the pre-check
    if (err?.code === '23P01') {
      return res.status(409).json({ error: 'כבר קיימת בקשת יציאה חופפת' });
    }
    throw err;
  }
}

async function handleDelete(req: VercelRequest, res: VercelResponse) {
  const idStr = String(req.query.id ?? '');
  const name = String(req.query.name ?? '');
  const notFound = () => res.status(404).json({ error: 'הבקשה לא נמצאה' });
  if (!/^\d+$/.test(idStr)) return notFound();

  const pool = getPool();
  const { rows } = await pool.query(
    `select er.id, s.full_name,
            to_char(lower(er.period), 'YYYY-MM-DD HH24:MI') as start,
            to_char(upper(er.period), 'YYYY-MM-DD HH24:MI') as "end"
     from exit_requests er join soldiers s on s.id = er.soldier_id
     where er.id = $1`, [idStr]);
  const row = rows[0];
  // ownership: the requester can only cancel their own soldier's request
  if (!row || normalizeName(row.full_name) !== normalizeName(name)) return notFound();

  const parseTs = (ts: string): Minutes => {
    const [d, hm] = ts.split(' ');
    return toMin(d, hm);
  };
  const days = affectedDays(parseTs(row.start), parseTs(row.end));
  const gen = await generatedDay(days);
  if (gen) {
    return res.status(409).json({
      error: `השבצ"ק ליום ${gen} כבר נוצר — לביטול יש לפנות לאחראי השבצ"ק`,
    });
  }
  await pool.query(`delete from exit_requests where id = $1`, [idStr]);
  return res.status(200).json({ ok: true });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    if (req.method === 'GET') return await handleGet(req, res);
    if (req.method === 'POST') return await handlePost(req, res);
    if (req.method === 'DELETE') return await handleDelete(req, res);
    return res.status(405).json({ error: 'method not allowed' });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e instanceof Error ? e.message : 'server error' });
  }
}
