import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getPool } from './_db.js';

// ── מצבת חיילים tab API (roster editor, admin-only) ──────────────────────────
// The scheduler DB is the source of truth for the roster, but until now only
// psql could write it (the sheet importer is insert-only; seed-candidates.sql
// is a hand-applied manifest). This endpoint exposes ONE soldier's full
// scheduler-relevant configuration as a single declarative document:
//
//   soldiers row + soldier_qualifications + soldier_allowed_positions (H6c)
//   + that soldier's position_candidates rows (קצין מוצב pool / חפק seats)
//   + the shavtzak_admins row keyed by their email.
//
//   GET    /api/roster            -> RosterResponse (active AND archived)
//   POST   /api/roster   body RosterInput (no id)  -> RosterResponse
//   PUT    /api/roster   body RosterInput with id  -> RosterResponse
//
// Removal is SOFT (owner decision 2026-07-26): PUT { archived: true } stamps
// soldiers.archived_at. Hard delete is never offered — shift_assignments,
// day_assignments, position_candidates and magen_commander_history are
// NO-ACTION FKs, so anyone with history could not be deleted anyway, and
// dropping fairness history would be wrong. Restore = { archived: false }.
//
// Mutations echo the full re-read GET payload so the hook can rebase.

export interface RosterCandidacy {
  positionId: number;
  subPositionId: number | null;
  priority: number | null;       // null = unordered/fairness-rotated
}

export interface RosterSoldier {
  id: number;
  personalNumber: string;
  fullName: string;
  platoon: string;
  role: string;
  rifleLevel: number | null;
  phone: string;
  email: string;
  isSchedulable: boolean;
  notes: string;
  archivedAt: string | null;     // null = active
  isAdmin: boolean;              // shavtzak_admins row for lower(email)
  quals: string[];
  allowedPositionIds: number[];  // H6c whitelist; [] = may serve anywhere
  candidacies: RosterCandidacy[];
}

/** One closed candidate list the editor can add a soldier to. Derived, not
 *  configured: the distinct (position, sub) pairs that already have candidates,
 *  plus positions marked config.candidate_pool (קצין מוצב) even when empty. */
export interface RosterClosedList {
  positionId: number;
  subPositionId: number | null;
  label: string;                 // "קצין מוצב" / "חפק — קשר"
  ordered: boolean;              // existing rows carry priorities ⇒ show the order input
}

export interface RosterResponse {
  soldiers: RosterSoldier[];
  positions: { id: number; name: string; isScheduled: boolean; missionClass: string }[];
  subPositions: { positionId: number; id: number; name: string }[];
  closedLists: RosterClosedList[];
  qualifications: string[];      // catalog ∪ values in use
  roles: string[];
  platoons: string[];
}

/** Input shape: the editable subset of RosterSoldier (id null/absent = create). */
export interface RosterInput {
  id?: number | null;
  personalNumber: string;
  fullName: string;
  platoon: string;
  role: string;
  rifleLevel: number | null;
  phone: string;
  email: string;
  isSchedulable: boolean;
  notes: string;
  archived: boolean;
  isAdmin: boolean;
  quals: string[];
  allowedPositionIds: number[];
  candidacies: RosterCandidacy[];
}

// The importer's keyword list (scheduler/import/import_history.py QUAL_KEYWORDS)
// — the checkbox catalog. Unioned with whatever is already in the DB so an
// unlisted historical value never silently disappears from the editor.
export const QUAL_CATALOG = [
  'נהג דוד', 'נהג טיגריס', 'חובש', 'קלע', 'נגב', 'מאג', 'רחפן', 'מטב',
];

const UNKNOWN_PLATOON = 'לא ידוע';   // soldiers.platoon is NOT NULL (importer's fallback)

const err = (message: string, status: number) =>
  Object.assign(new Error(message), { status });

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

// ── read ─────────────────────────────────────────────────────────────────────

/** Exported for the נוכחות tab (api/presence.ts): its filter bar is the very
 *  same one, so it serves the very same roster document. */
export async function getRoster(): Promise<RosterResponse> {
  const pool = getPool();
  const [soldiers, quals, allowed, cands, positions, subs] = await Promise.all([
    pool.query(
      `select s.id, s.personal_number, s.full_name, s.platoon,
              coalesce(s.role,'') role, s.rifle_level,
              coalesce(s.phone,'') phone, coalesce(s.email,'') email,
              s.is_schedulable, coalesce(s.notes,'') notes,
              to_char(s.archived_at, 'YYYY-MM-DD"T"HH24:MI:SS') archived_at,
              (a.email is not null) is_admin
       from soldiers s
       left join shavtzak_admins a on a.email = lower(s.email)
       order by s.full_name`),
    pool.query(`select soldier_id, qualification from soldier_qualifications
                order by qualification`),
    pool.query(`select soldier_id, position_id from soldier_allowed_positions`),
    pool.query(`select soldier_id, position_id, sub_position_id, priority
                from position_candidates
                order by position_id, priority nulls last, id`),
    pool.query(`select id, name, is_scheduled, mission_class,
                       (config ? 'candidate_pool') as is_pool
                from positions order by id`),
    pool.query(`select position_id, id, name from sub_positions order by position_id, id`),
  ]);

  const byId = new Map<number, RosterSoldier>();
  const out: RosterSoldier[] = soldiers.rows.map((r: any) => {
    const s: RosterSoldier = {
      id: Number(r.id),
      personalNumber: r.personal_number,
      fullName: r.full_name,
      platoon: r.platoon,
      role: r.role,
      rifleLevel: r.rifle_level == null ? null : Number(r.rifle_level),
      phone: r.phone,
      email: r.email,
      isSchedulable: r.is_schedulable,
      notes: r.notes,
      archivedAt: r.archived_at ?? null,
      isAdmin: r.is_admin,
      quals: [],
      allowedPositionIds: [],
      candidacies: [],
    };
    byId.set(s.id, s);
    return s;
  });
  for (const r of quals.rows as any[]) byId.get(Number(r.soldier_id))?.quals.push(r.qualification);
  for (const r of allowed.rows as any[])
    byId.get(Number(r.soldier_id))?.allowedPositionIds.push(Number(r.position_id));
  for (const r of cands.rows as any[])
    byId.get(Number(r.soldier_id))?.candidacies.push({
      positionId: Number(r.position_id),
      subPositionId: r.sub_position_id == null ? null : Number(r.sub_position_id),
      priority: r.priority == null ? null : Number(r.priority),
    });

  const uniqSorted = (xs: string[]) =>
    [...new Set(xs.filter(Boolean))].sort((a, b) => a.localeCompare(b, 'he'));

  const posName = new Map<number, string>(positions.rows.map((r: any) => [Number(r.id), r.name]));
  const subName = new Map<string, string>(
    subs.rows.map((r: any) => [`${r.position_id}|${r.id}`, r.name]));

  // closed lists = the (position, sub) pairs already in use + empty declared pools
  const listOrdered = new Map<string, boolean>();
  for (const r of cands.rows as any[]) {
    const k = `${r.position_id}|${r.sub_position_id ?? ''}`;
    listOrdered.set(k, (listOrdered.get(k) ?? false) || r.priority != null);
  }
  for (const r of positions.rows as any[])
    if (r.is_pool && !listOrdered.has(`${r.id}|`)) listOrdered.set(`${r.id}|`, false);

  const closedLists = [...listOrdered.entries()].map(([k, ordered]) => {
    const [p, s] = k.split('|');
    const positionId = Number(p);
    const subPositionId = s === '' ? null : Number(s);
    const label = subPositionId == null
      ? (posName.get(positionId) ?? String(positionId))
      : `${posName.get(positionId) ?? positionId} — ${subName.get(k) ?? subPositionId}`;
    return { positionId, subPositionId, label, ordered };
  }).sort((a, b) => a.label.localeCompare(b.label, 'he'));

  return {
    soldiers: out,
    positions: positions.rows.map((r: any) => ({
      id: Number(r.id), name: r.name,
      isScheduled: r.is_scheduled, missionClass: r.mission_class,
    })),
    subPositions: subs.rows.map((r: any) => ({
      positionId: Number(r.position_id), id: Number(r.id), name: r.name,
    })),
    closedLists,
    qualifications: uniqSorted([...QUAL_CATALOG, ...quals.rows.map((r: any) => r.qualification)]),
    roles: uniqSorted(out.map((s) => s.role)),
    platoons: uniqSorted([...out.map((s) => s.platoon), UNKNOWN_PLATOON]),
  };
}

// ── validate ─────────────────────────────────────────────────────────────────

function validate(body: unknown, requireId: boolean): RosterInput {
  if (!body || typeof body !== 'object') throw err('גוף הבקשה חסר', 400);
  const b = body as Record<string, unknown>;

  const id = b.id == null ? null : Number(b.id);
  if (requireId && (id == null || !Number.isInteger(id) || id <= 0))
    throw err('id חסר או לא תקין', 400);

  const fullName = str(b.fullName);
  if (!fullName) throw err('שם מלא הוא שדה חובה', 400);
  const personalNumber = str(b.personalNumber);
  if (!personalNumber) throw err('מספר אישי הוא שדה חובה', 400);

  let rifleLevel: number | null = null;
  if (b.rifleLevel != null && String(b.rifleLevel).trim() !== '') {
    rifleLevel = Number(b.rifleLevel);
    if (!Number.isInteger(rifleLevel) || rifleLevel < 0) throw err('רובאי חייב להיות מספר שלם', 400);
  }

  const email = str(b.email).toLowerCase();
  const isAdmin = b.isAdmin === true;
  if (isAdmin && !email) throw err('אי אפשר לסמן אדמין שבצ"ק ללא כתובת מייל', 400);

  const quals = Array.isArray(b.quals)
    ? [...new Set(b.quals.map(str).filter(Boolean))]
    : [];

  const allowedPositionIds = Array.isArray(b.allowedPositionIds)
    ? [...new Set(b.allowedPositionIds.map(Number))]
    : [];
  if (allowedPositionIds.some((n) => !Number.isInteger(n)))
    throw err('עמדות מותרות: מזהה לא תקין', 400);

  const seen = new Set<string>();
  const candidacies: RosterCandidacy[] = [];
  for (const raw of Array.isArray(b.candidacies) ? b.candidacies : []) {
    const c = raw as Record<string, unknown>;
    const positionId = Number(c.positionId);
    if (!Number.isInteger(positionId)) throw err('רשימות סגורות: מזהה עמדה לא תקין', 400);
    const subPositionId = c.subPositionId == null ? null : Number(c.subPositionId);
    if (subPositionId != null && !Number.isInteger(subPositionId))
      throw err('רשימות סגורות: מזהה תפקיד לא תקין', 400);
    let priority: number | null = null;
    if (c.priority != null && String(c.priority).trim() !== '') {
      priority = Number(c.priority);
      // position_candidates_priority_check: priority >= 1
      if (!Number.isInteger(priority) || priority < 1)
        throw err('רשימות סגורות: עדיפות חייבת להיות מספר שלם מ־1 ומעלה', 400);
    }
    // unique nulls not distinct (position_id, sub_position_id, soldier_id)
    const k = `${positionId}|${subPositionId ?? ''}`;
    if (seen.has(k)) continue;
    seen.add(k);
    candidacies.push({ positionId, subPositionId, priority });
  }

  return {
    id,
    personalNumber,
    fullName,
    platoon: str(b.platoon) || UNKNOWN_PLATOON,
    role: str(b.role),
    rifleLevel,
    phone: str(b.phone),
    email,
    isSchedulable: b.isSchedulable !== false,
    notes: str(b.notes),
    archived: b.archived === true,
    isAdmin,
    quals,
    allowedPositionIds,
    candidacies,
  };
}

/** Map the constraint violations the editor can realistically produce. */
function rethrow(e: unknown): never {
  const code = (e as any)?.code;
  const constraint = String((e as any)?.constraint ?? '');
  if (code === '23505') {
    if (constraint.includes('full_name')) throw err('כבר קיים חייל בשם הזה במצבת', 409);
    if (constraint.includes('personal_number')) throw err('המספר האישי הזה כבר קיים במצבת', 409);
    throw err('הערך כבר קיים במצבת', 409);
  }
  if (code === '23503') throw err('עמדה או תפקיד שנבחרו אינם קיימים', 400);
  throw e as Error;
}

// ── write ────────────────────────────────────────────────────────────────────

/** Replace one soldier's whole configuration (create when input.id is null). */
async function saveSoldier(input: RosterInput): Promise<RosterResponse> {
  const pool = getPool();
  const client = await pool.connect();
  // An archived soldier keeps no scheduler-admin access.
  const isAdmin = input.isAdmin && !input.archived;
  try {
    await client.query('begin');

    let id = input.id ?? null;
    let prevEmail = '';
    if (id == null) {
      const ins = await client.query(
        `insert into soldiers (personal_number, full_name, platoon, role, rifle_level,
                               phone, email, is_schedulable, notes, archived_at)
         values ($1,$2,$3,nullif($4,''),$5,nullif($6,''),nullif($7,''),$8,nullif($9,''),
                 case when $10 then timezone('Asia/Jerusalem', now()) else null end)
         returning id`,
        [input.personalNumber, input.fullName, input.platoon, input.role, input.rifleLevel,
         input.phone, input.email, input.isSchedulable, input.notes, input.archived]);
      id = Number(ins.rows[0].id);
    } else {
      const prev = await client.query(
        `select coalesce(email,'') email from soldiers where id = $1`, [id]);
      if (!prev.rowCount) throw err('החייל לא נמצא', 404);
      prevEmail = String(prev.rows[0].email).toLowerCase();
      await client.query(
        `update soldiers set personal_number = $2, full_name = $3, platoon = $4,
                             role = nullif($5,''), rifle_level = $6, phone = nullif($7,''),
                             email = nullif($8,''), is_schedulable = $9, notes = nullif($10,''),
                             archived_at = case
                               when not $11 then null
                               -- keep the original removal timestamp on re-save
                               else coalesce(archived_at, timezone('Asia/Jerusalem', now())) end
         where id = $1`,
        [id, input.personalNumber, input.fullName, input.platoon, input.role, input.rifleLevel,
         input.phone, input.email, input.isSchedulable, input.notes, input.archived]);
    }

    // declarative replace of the three id tables (this soldier's rows only)
    await client.query(`delete from soldier_qualifications where soldier_id = $1`, [id]);
    if (input.quals.length)
      await client.query(
        `insert into soldier_qualifications (soldier_id, qualification)
         select $1, unnest($2::text[])`, [id, input.quals]);

    await client.query(`delete from soldier_allowed_positions where soldier_id = $1`, [id]);
    if (input.allowedPositionIds.length)
      await client.query(
        `insert into soldier_allowed_positions (soldier_id, position_id)
         select $1, unnest($2::smallint[])`, [id, input.allowedPositionIds]);

    await client.query(`delete from position_candidates where soldier_id = $1`, [id]);
    for (const c of input.candidacies)
      await client.query(
        `insert into position_candidates (position_id, sub_position_id, soldier_id, priority)
         values ($1, $2, $3, $4)`,
        [c.positionId, c.subPositionId, id, c.priority]);

    // shavtzak_admins is email-keyed: drop the old address too, so renaming an
    // admin's email moves the grant instead of leaving a stale row behind.
    if (prevEmail) await client.query(`delete from shavtzak_admins where email = $1`, [prevEmail]);
    if (input.email) await client.query(`delete from shavtzak_admins where email = $1`, [input.email]);
    if (isAdmin)
      await client.query(
        `insert into shavtzak_admins (email, note) values ($1, $2)`,
        [input.email, `${input.fullName} — מתוך מצבת חיילים`]);

    await client.query('commit');
  } catch (e) {
    await client.query('rollback').catch(() => {});
    rethrow(e);
  } finally {
    client.release();
  }
  return getRoster();
}

// ── handler ──────────────────────────────────────────────────────────────────

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,PUT,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    if (req.method === 'GET') {
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json(await getRoster());
    }
    if (req.method === 'POST')
      return res.status(200).json(await saveSoldier(validate(req.body, false)));
    if (req.method === 'PUT')
      return res.status(200).json(await saveSoldier(validate(req.body, true)));
    return res.status(405).json({ error: 'method not allowed' });
  } catch (e) {
    const status = (e as any)?.status ?? 500;
    if (status === 500) console.error(e);
    return res.status(status).json({ error: e instanceof Error ? e.message : 'server error' });
  }
}
