import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getPool, DATE_RE } from './_db.js';
import { getRoster, type RosterResponse } from './roster.js';
import {
  PRESENT, addDays, dayRange, isFullDayKind, offeredStates, planPresenceWrite,
  presenceMatrix, canonicalKind, type UnavailRow,
} from '../src/lib/presencePlan.js';

// ── נוכחות tab API (presence editor, admin-only) ──────────────────────────────
// As of 2026-07-26 the DB is the SOURCE OF TRUTH for presence: the sheet import
// no longer rebuilds `unavailability` (scheduler/import/cleanup.py part 3 is
// opt-in behind --rebuild-presence, for the initial import only). This endpoint
// is how presence is maintained from then on.
//
//   GET /api/presence?from=YYYY-MM-DD&to=YYYY-MM-DD
//       -> { from, to, days, states, roster, presence }
//   PUT /api/presence  body { soldier_id, days: [{ day, status }] }
//       -> { ok, soldierId, days }
//
// `roster` is api/roster.ts's document verbatim, so the tab's filter bar (the
// shared RosterFilters component) behaves exactly like מצבת חיילים's.
//
// `states` is DERIVED FROM THE DB — the `unavailability` kind CHECK constraint
// intersected with the full-day kinds (src/lib/presencePlan.ts). Only full-day
// statuses are editable (owner decision); the partial kinds (יציאה בבוקר,
// חזרה בערב, the short-exit יציאה rows) are display-only and are replaced
// wholesale when their day is edited.
//
// The PUT is a declarative per-day replace over the touched day range; all the
// run/clip/merge math is the pure planPresenceWrite() so it is unit-testable
// without a DB. Nothing here reads or writes exit_requests.

export interface PresenceRow {
  soldierId: number;
  /** one status per day of `days`, same order */
  statuses: string[];
}

export interface PresenceResponse {
  from: string;
  to: string;
  days: string[];
  states: string[];
  roster: RosterResponse;
  presence: PresenceRow[];
}

export interface PresenceDayInput { day: string; status: string }
export interface PresenceInput { soldier_id: number; days: PresenceDayInput[] }

/** Guard rail: the matrix is roster × days, so keep the window sane. */
const MAX_DAYS = 62;

const err = (message: string, status: number) =>
  Object.assign(new Error(message), { status });

// ── read ─────────────────────────────────────────────────────────────────────

/** The kinds the unavailability CHECK constraint still accepts.
 *  Cached for the lifetime of the process: the constraint is DDL, so it can
 *  only change with a deploy/migration, and this ran on every GET *and* every
 *  PUT (validate() calls it too) purely to read a catalog table. */
let cachedKinds: string[] | null = null;
async function constraintKinds(): Promise<string[]> {
  if (cachedKinds) return cachedKinds;
  const pool = getPool();
  const { rows } = await pool.query(
    `select pg_get_constraintdef(oid) def from pg_constraint
      where conrelid = 'unavailability'::regclass and contype = 'c'
        and pg_get_constraintdef(oid) like '%kind%'`);
  const out = new Set<string>();
  for (const r of rows as any[])
    for (const m of String(r.def).matchAll(/'([^']*)'/g)) if (m[1]) out.add(m[1]);
  return (cachedKinds = [...out]);
}

/** Tests rebuild the schema between suites, so the cached DDL must be
 *  droppable. Not used by the handler. */
export function _resetKindsCache(): void { cachedKinds = null; }

/** Every non-archived soldier's rows overlapping [from 00:00, to+1 00:00). */
async function rowsInWindow(from: string, to: string): Promise<Map<number, UnavailRow[]>> {
  const pool = getPool();
  const { rows } = await pool.query(
    `select u.id, u.soldier_id, u.kind,
            to_char(lower(u.period), 'YYYY-MM-DD HH24:MI:SS') s,
            to_char(upper(u.period), 'YYYY-MM-DD HH24:MI:SS') e
       from unavailability u
       join soldiers so on so.id = u.soldier_id and so.archived_at is null
      where u.period && tsrange($1::timestamp, $2::timestamp)
      order by u.id`,
    [`${from} 00:00:00`, `${addDays(to, 1)} 00:00:00`]);
  const out = new Map<number, UnavailRow[]>();
  for (const r of rows as any[]) {
    const sid = Number(r.soldier_id);
    const list = out.get(sid);
    const row: UnavailRow = { id: Number(r.id), kind: r.kind, start: r.s, end: r.e };
    if (list) list.push(row); else out.set(sid, [row]);
  }
  return out;
}

async function getPresence(from: string, to: string): Promise<PresenceResponse> {
  const days = dayRange(from, to);
  const [roster, kinds, bySoldier] = await Promise.all([
    getRoster(), constraintKinds(), rowsInWindow(from, to),
  ]);
  const presence = roster.soldiers
    .filter((s) => s.archivedAt == null)
    .map((s) => {
      const matrix = presenceMatrix(days, bySoldier.get(s.id) ?? []);
      return { soldierId: s.id, statuses: days.map((d) => matrix[d]) };
    });
  return { from, to, days, states: offeredStates(kinds), roster, presence };
}

// ── validate ─────────────────────────────────────────────────────────────────

function range(q: VercelRequest['query']): { from: string; to: string } {
  const from = String(q.from ?? '');
  const to = String(q.to ?? from);
  if (!DATE_RE.test(from) || !DATE_RE.test(to)) throw err('טווח תאריכים לא תקין', 400);
  if (to < from) throw err('תאריך הסיום קודם לתאריך ההתחלה', 400);
  if (dayRange(from, to).length > MAX_DAYS) throw err(`טווח ארוך מדי (עד ${MAX_DAYS} ימים)`, 400);
  return { from, to };
}

async function validate(body: unknown): Promise<PresenceInput> {
  if (!body || typeof body !== 'object') throw err('גוף הבקשה חסר', 400);
  const b = body as Record<string, any>;

  const soldierId = Number(b.soldier_id ?? b.soldierId);
  if (!Number.isInteger(soldierId) || soldierId <= 0) throw err('מזהה חייל חסר או לא תקין', 400);

  const allowed = new Set(offeredStates(await constraintKinds()));

  const seen = new Map<string, string>();
  for (const raw of Array.isArray(b.days) ? b.days : []) {
    const day = String(raw?.day ?? '');
    if (!DATE_RE.test(day)) throw err(`תאריך לא תקין: ${day || '(ריק)'}`, 400);
    const status = canonicalKind(String(raw?.status ?? ''));
    if (!allowed.has(status)) {
      // partial kinds are display-only: they may not be written from the tab
      throw err(isFullDayKind(status) || status === PRESENT
        ? `הסטטוס "${status}" אינו זמין`
        : `הסטטוס "${status}" אינו ניתן לעריכה מהטאב (רק ימים מלאים)`, 400);
    }
    seen.set(day, status);
  }
  if (!seen.size) throw err('לא נבחרו ימים לעדכון', 400);
  if (seen.size > MAX_DAYS) throw err(`יותר מדי ימים בבקשה (עד ${MAX_DAYS})`, 400);

  return {
    soldier_id: soldierId,
    days: [...seen.entries()].map(([day, status]) => ({ day, status })),
  };
}

// ── write ────────────────────────────────────────────────────────────────────

async function savePresence(input: PresenceInput) {
  const pool = getPool();
  const days = [...input.days].sort((a, b) => a.day.localeCompare(b.day));
  const first = days[0].day;
  const last = days[days.length - 1].day;

  const client = await pool.connect();
  try {
    await client.query('begin');

    const who = await client.query(
      `select 1 from soldiers where id = $1 and archived_at is null`, [input.soldier_id]);
    if (!who.rowCount) throw err('החייל לא נמצא', 404);

    // Everything overlapping the touched days PLUS their neighbours — the
    // adjacency is what lets a new run merge into an untouched same-kind row.
    const { rows } = await client.query(
      `select id, kind,
              to_char(lower(period), 'YYYY-MM-DD HH24:MI:SS') s,
              to_char(upper(period), 'YYYY-MM-DD HH24:MI:SS') e
         from unavailability
        where soldier_id = $1 and period && tsrange($2::timestamp, $3::timestamp)
        order by id
        for update`,
      [input.soldier_id, `${addDays(first, -1)} 00:00:00`, `${addDays(last, 2)} 00:00:00`]);

    const plan = planPresenceWrite(days, (rows as any[]).map((r) => ({
      id: Number(r.id), kind: r.kind, start: r.s, end: r.e,
    })));

    if (plan.deleteIds.length)
      await client.query(`delete from unavailability where id = any($1::bigint[])`,
        [plan.deleteIds]);
    // one multi-row insert instead of a round trip per emitted run (soldier_id
    // is constant, so the three parallel arrays carry the whole plan)
    if (plan.insert.length)
      await client.query(
        `insert into unavailability (soldier_id, period, kind)
         select $1, tsrange(s, e), k
           from unnest($2::timestamp[], $3::timestamp[], $4::text[]) as t(s, e, k)`,
        [input.soldier_id, plan.insert.map((i) => i.start),
         plan.insert.map((i) => i.end), plan.insert.map((i) => i.kind)]);

    await client.query('commit');
  } catch (e) {
    await client.query('rollback').catch(() => {});
    if ((e as any)?.code === '23P01') throw err('הטווח מתנגש בתקופה קיימת', 409);
    if ((e as any)?.code === '23514') throw err('סטטוס לא מוכר במסד הנתונים', 400);
    throw e as Error;
  } finally {
    client.release();
  }

  // echo the soldier's recomputed statuses over the touched range
  const window = dayRange(first, last);
  const { rows } = await pool.query(
    `select id, kind,
            to_char(lower(period), 'YYYY-MM-DD HH24:MI:SS') s,
            to_char(upper(period), 'YYYY-MM-DD HH24:MI:SS') e
       from unavailability
      where soldier_id = $1 and period && tsrange($2::timestamp, $3::timestamp)`,
    [input.soldier_id, `${first} 00:00:00`, `${addDays(last, 1)} 00:00:00`]);
  const matrix = presenceMatrix(window, (rows as any[]).map((r) => ({
    id: Number(r.id), kind: r.kind, start: r.s, end: r.e,
  })));
  return {
    ok: true,
    soldierId: input.soldier_id,
    days: window.map((day) => ({ day, status: matrix[day] })),
  };
}

// ── handler ──────────────────────────────────────────────────────────────────

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,PUT,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    if (req.method === 'GET') {
      res.setHeader('Cache-Control', 'no-store');
      const { from, to } = range(req.query);
      return res.status(200).json(await getPresence(from, to));
    }
    if (req.method === 'PUT')
      return res.status(200).json(await savePresence(await validate(req.body)));
    return res.status(405).json({ error: 'method not allowed' });
  } catch (e) {
    const status = (e as any)?.status ?? 500;
    if (status === 500) console.error(e);
    return res.status(status).json({ error: e instanceof Error ? e.message : 'server error' });
  }
}
