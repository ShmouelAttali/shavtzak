import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getPool, DATE_RE } from './_db.js';

// Draft lifecycle — publish flow (Task 7A). No server-side auth by design
// (officer-gated on the client, like the rest of the draft surface); the
// publishing officer's email travels in the request body as approved_by.
//
//   POST /api/publish   { day, email? }  — 'generated' -> 'published'
//   POST /api/unpublish { day }          — 'published' -> 'generated' (api/unpublish.ts)
//
// Both are idempotent: publishing an already-published day (or unpublishing a
// day already back at 'generated') is a success no-op.

export interface PublishResponse {
  day: string;
  status: string;
  approvedBy: string | null;
  publishedAt: string | null;
}

async function currentStatus(day: string): Promise<string | null> {
  const pool = getPool();
  const r = await pool.query<{ status: string }>(
    `select status from schedule_days where day = $1`, [day]);
  return r.rows[0]?.status ?? null;
}

function respond(res: VercelResponse, row: { day: string; status: string; approved_by: string | null; published_at: string | null }) {
  const out: PublishResponse = {
    day: row.day, status: row.status,
    approvedBy: row.approved_by,
    publishedAt: row.published_at ? new Date(row.published_at).toISOString() : null,
  };
  return res.status(200).json(out);
}

/** 'generated' -> 'published' (idempotent). Returns 409 if the day is not in a
 *  publishable state (missing, or still a bare draft). */
export async function publishDay(res: VercelResponse, day: string, email: string | null) {
  const pool = getPool();
  const upd = await pool.query(
    `update schedule_days
       set status = 'published', approved_by = $2, published_at = now()
     where day = $1 and status = 'generated'
     returning day::text, status, approved_by, published_at`, [day, email]);
  if (upd.rowCount) return respond(res, upd.rows[0]);
  // No transition — figure out why for a clear message / idempotent success.
  const st = await currentStatus(day);
  if (st === 'published') {
    const cur = await pool.query(
      `select day::text, status, approved_by, published_at from schedule_days where day = $1`, [day]);
    return respond(res, cur.rows[0]);         // already published — idempotent
  }
  if (st === null) return res.status(404).json({ error: 'day not found' });
  return res.status(409).json({ error: 'ניתן לפרסם רק יום שחולל (status=generated)' });
}

/** 'published' -> 'generated' (idempotent), clearing approved_by/published_at. */
export async function unpublishDay(res: VercelResponse, day: string) {
  const pool = getPool();
  const upd = await pool.query(
    `update schedule_days
       set status = 'generated', approved_by = null, published_at = null
     where day = $1 and status = 'published'
     returning day::text, status, approved_by, published_at`, [day]);
  if (upd.rowCount) return respond(res, upd.rows[0]);
  const st = await currentStatus(day);
  if (st === 'generated') {
    const cur = await pool.query(
      `select day::text, status, approved_by, published_at from schedule_days where day = $1`, [day]);
    return respond(res, cur.rows[0]);         // already unpublished — idempotent
  }
  if (st === null) return res.status(404).json({ error: 'day not found' });
  return res.status(409).json({ error: 'ניתן לבטל פרסום רק ליום שפורסם' });
}

export function parseDay(req: VercelRequest): string | null {
  const { day } = (req.body ?? {}) as { day?: string };
  return day && DATE_RE.test(day) ? day : null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });
  try {
    const day = parseDay(req);
    if (!day) return res.status(400).json({ error: 'day required (YYYY-MM-DD)' });
    const { email } = (req.body ?? {}) as { email?: string };
    return await publishDay(res, day, email ?? null);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e instanceof Error ? e.message : 'server error' });
  }
}
