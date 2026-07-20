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
  /** true when any 14:00→14:00 schedule day the period overlaps already has a
   *  generated שבצ"ק (shift_assignments rows / non-draft schedule_days). */
  generated: boolean;
}
export interface ExitRequestsResponse { requests: ExitRequest[] }
import { FROM_TIMES, TO_TIMES } from '../src/constants/exitRequests.js';
export { FROM_TIMES, TO_TIMES };

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

/** Free-form admin timestamps: 'YYYY-MM-DD HH:MM' naive local. */
const TS_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/;
const parseTs = (ts: string): Minutes => {
  const [d, hm] = ts.split(' ');
  return toMin(d, hm);
};

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

// `generated` mirrors generatedDay() in SQL over every schedule day the
// period overlaps ([) upper bound → last day is schedule_day_of(upper - 1min).
const REQUEST_COLS = `
  er.id, s.full_name,
  schedule_day_of(lower(er.period))::text as day,
  to_char(lower(er.period), 'YYYY-MM-DD HH24:MI') as start,
  to_char(upper(er.period), 'YYYY-MM-DD HH24:MI') as "end",
  er.note,
  (exists (select 1 from shift_assignments sa
           where sa.day between schedule_day_of(lower(er.period))
                            and schedule_day_of(upper(er.period) - interval '1 minute'))
   or exists (select 1 from schedule_days sd
              where sd.day between schedule_day_of(lower(er.period))
                               and schedule_day_of(upper(er.period) - interval '1 minute')
                and coalesce(sd.status, 'draft') <> 'draft')) as generated`;

const toExitRequest = (r: any): ExitRequest => ({
  id: Number(r.id), soldierName: r.full_name,
  day: r.day, start: r.start, end: r.end, note: r.note ?? null,
  generated: r.generated === true,
});

const genWarning = (d: string) =>
  `השבצ"ק ליום ${d} כבר נוצר — יש לייצר אותו מחדש כדי שהיציאה תיכנס לתוקף`;

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

const OVERLAP_ERR = 'כבר קיימת בקשת יציאה חופפת';
const VACATION_ERR =
  'היציאה משאירה פחות מ-8 שעות זמינות ביממת השיבוץ — ליציאה ארוכה כזו יש להגיש יום חופש';

/** True when the exit leaves under 8h available in some affected cycle. */
function leavesUnderEightHours(days: string[], s: Minutes, e: Minutes): boolean {
  return days.some((d) => {
    const ds = dayStart(d);
    return Math.min(e, ds + DAY) - Math.max(s, ds) > 16 * 60;
  });
}

async function handlePost(req: VercelRequest, res: VercelResponse) {
  if ((req.body as any)?.admin === true) return handleAdminPost(req, res);
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
  if (leavesUnderEightHours(days, s, e)) {
    return res.status(400).json({ error: VACATION_ERR });
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
    return res.status(409).json({ error: OVERLAP_ERR });
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
      return res.status(409).json({ error: OVERLAP_ERR });
    }
    throw err;
  }
}

// ── Admin operations ─────────────────────────────────────────────────────────
// No server-side auth (accepted repo-wide) — admin gating is client-side
// (shavtzak_admins); these are parameter-gated, like api/draft.ts POST.

/** POST { admin: true, name, start, end, note?, email? } — free-form
 *  'YYYY-MM-DD HH:MM' period. Generated days don't block: the response
 *  carries a warning instead. */
async function handleAdminPost(req: VercelRequest, res: VercelResponse) {
  const { name, start, end, email, note } = (req.body ?? {}) as {
    name?: string; start?: string; end?: string; email?: string; note?: string;
  };

  // 1. free-form period, end > start
  if (!start || !TS_RE.test(start) || !end || !TS_RE.test(end)) {
    return res.status(400).json({ error: 'טווח זמנים לא תקין' });
  }
  const s = parseTs(start);
  const e = parseTs(end);
  if (e <= s) return res.status(400).json({ error: 'טווח זמנים לא תקין' });

  // 2. soldier resolution (exact, then normalized)
  const soldier = await resolveSoldier(String(name ?? ''), true);
  if (!soldier) {
    return res.status(404).json({ error: 'החייל לא נמצא במצבת המשובצים' });
  }

  // 3. must leave ≥8h available in every affected 14:00→14:00 cycle
  const days = affectedDays(s, e);
  if (leavesUnderEightHours(days, s, e)) {
    return res.status(400).json({ error: VACATION_ERR });
  }

  // 4. overlap with existing exit requests
  const pool = getPool();
  const range = [sqlTs(s), sqlTs(e)];
  const dup = await pool.query(
    `select 1 from exit_requests
     where soldier_id = $1 and period && tsrange($2::timestamp, $3::timestamp, '[)') limit 1`,
    [soldier.id, ...range]);
  if (dup.rowCount) {
    return res.status(409).json({ error: OVERLAP_ERR });
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
    // a generated affected day doesn't block — it warns
    const gen = await generatedDay(days);
    return res.status(200).json({
      request: toExitRequest(rows[0]),
      ...(gen ? { warning: genWarning(gen) } : {}),
    });
  } catch (err: any) {
    if (err?.code === '23P01') {
      return res.status(409).json({ error: OVERLAP_ERR });
    }
    throw err;
  }
}

/** PATCH { id, start, end, note? } — admin edit; same shape/validations as
 *  admin POST, overlap check excludes the row itself. Warning when an
 *  affected day of the OLD or NEW period is generated. */
async function handlePatch(req: VercelRequest, res: VercelResponse) {
  const { id, start, end, note } = (req.body ?? {}) as {
    id?: number | string; start?: string; end?: string; note?: string | null;
  };
  const idStr = String(id ?? '');
  if (!/^\d+$/.test(idStr)) return res.status(404).json({ error: 'הבקשה לא נמצאה' });

  const pool = getPool();
  const { rows: existing } = await pool.query(
    `select er.soldier_id, er.note,
            to_char(lower(er.period), 'YYYY-MM-DD HH24:MI') as start,
            to_char(upper(er.period), 'YYYY-MM-DD HH24:MI') as "end"
     from exit_requests er where er.id = $1`, [idStr]);
  const old = existing[0];
  if (!old) return res.status(404).json({ error: 'הבקשה לא נמצאה' });

  if (!start || !TS_RE.test(start) || !end || !TS_RE.test(end)) {
    return res.status(400).json({ error: 'טווח זמנים לא תקין' });
  }
  const s = parseTs(start);
  const e = parseTs(end);
  if (e <= s) return res.status(400).json({ error: 'טווח זמנים לא תקין' });

  const days = affectedDays(s, e);
  if (leavesUnderEightHours(days, s, e)) {
    return res.status(400).json({ error: VACATION_ERR });
  }

  const range = [sqlTs(s), sqlTs(e)];
  const dup = await pool.query(
    `select 1 from exit_requests
     where soldier_id = $1 and id <> $2
       and period && tsrange($3::timestamp, $4::timestamp, '[)') limit 1`,
    [old.soldier_id, idStr, ...range]);
  if (dup.rowCount) {
    return res.status(409).json({ error: OVERLAP_ERR });
  }

  try {
    const { rows } = await pool.query(
      `with upd as (
         update exit_requests
         set period = tsrange($2::timestamp, $3::timestamp, '[)'), note = $4
         where id = $1
         returning *
       )
       select ${REQUEST_COLS}
       from upd er join soldiers s on s.id = er.soldier_id`,
      [idStr, ...range, note !== undefined ? note : old.note]);
    // warning when an affected day of the old OR new period is generated
    const allDays = [...new Set([
      ...affectedDays(parseTs(old.start), parseTs(old.end)),
      ...days,
    ])];
    const gen = await generatedDay(allDays);
    return res.status(200).json({
      request: toExitRequest(rows[0]),
      ...(gen ? { warning: genWarning(gen) } : {}),
    });
  } catch (err: any) {
    if (err?.code === '23P01') {
      return res.status(409).json({ error: OVERLAP_ERR });
    }
    throw err;
  }
}

async function handleDelete(req: VercelRequest, res: VercelResponse) {
  const idStr = String(req.query.id ?? '');
  const name = String(req.query.name ?? '');
  const force = String(req.query.force ?? '') === '1';   // admin delete
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
  if (!row) return notFound();
  // ownership: the requester can only cancel their own soldier's request
  // (force = admin delete: no ownership check)
  if (!force && normalizeName(row.full_name) !== normalizeName(name)) return notFound();

  const days = affectedDays(parseTs(row.start), parseTs(row.end));
  const gen = await generatedDay(days);
  if (gen && !force) {
    return res.status(409).json({
      error: `השבצ"ק ליום ${gen} כבר נוצר — לביטול יש לפנות לאחראי השבצ"ק`,
    });
  }
  await pool.query(`delete from exit_requests where id = $1`, [idStr]);
  // gen non-null here implies force — warn that a regeneration is needed
  return res.status(200).json({ ok: true, ...(gen ? { warning: genWarning(gen) } : {}) });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    if (req.method === 'GET') return await handleGet(req, res);
    if (req.method === 'POST') return await handlePost(req, res);
    if (req.method === 'PATCH') return await handlePatch(req, res);
    if (req.method === 'DELETE') return await handleDelete(req, res);
    return res.status(405).json({ error: 'method not allowed' });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e instanceof Error ? e.message : 'server error' });
  }
}
