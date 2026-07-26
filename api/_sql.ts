import { getPool } from './_db.js';

// Shared scheduler-DB query fragments. Underscore-prefixed file: not exposed as
// a route (same convention as _db.ts).
//
// Everything here was copy-pasted across two or more endpoints; a single
// definition keeps them from drifting apart (the POSITION_SCOPE predicate in
// particular decides what the מבנה יומי tab may edit AND which slots the צור
// שבצק tab marks לא מאויש — the two must agree).

/** A pool or a checked-out client — both expose `.query`. Anything running
 *  inside a transaction must pass the client, never the pool. */
export interface Queryable {
  query: (text: string, params?: any[]) => Promise<any>;
}

/** `schedule_days.status` for a day, or null when the day has no row at all.
 *  Pass the transaction client when the answer must be consistent with writes
 *  in the same transaction (otherwise the check is a TOCTOU window). */
export async function dayStatus(day: string, q: Queryable = getPool()): Promise<string | null> {
  const r = await q.query(`select status from schedule_days where day = $1`, [day]);
  return r.rows[0]?.status ?? null;
}

/** Make sure the day exists in `schedule_days` (the tabs write day-scoped rows
 *  that FK onto it). Idempotent. */
export async function ensureScheduleDay(q: Queryable, day: string): Promise<void> {
  await q.query(`insert into schedule_days (day) values ($1) on conflict do nothing`, [day]);
}

/** The positions the generated schedule is made of — everything the מבנה יומי
 *  editor may touch and the צור שבצק tab counts coverage for. Excludes the
 *  manual-only tabs' positions (חמל), the role-crew ones (מפלג — any
 *  `staff_all_roles` position) and the rest bucket (מנוחה).
 *
 *  `alias` prefixes each column, for queries that join `positions` in
 *  (`positionScope('p')` → `p.is_scheduled and ...`). */
export function positionScope(alias = ''): string {
  const c = alias ? `${alias}.` : '';
  return `${c}is_scheduled and ${c}mission_class <> 'rest' and not (${c}config ? 'staff_all_roles')`;
}

/** Unaliased form — for `... from positions where ${POSITION_SCOPE}`. */
export const POSITION_SCOPE = positionScope();

/** id → full_name for the given soldier ids (missing ids are simply absent, so
 *  the caller can tell "unknown soldier" from "found"). */
export async function soldierNamesById(
  ids: number[], q: Queryable = getPool(),
): Promise<Map<number, string>> {
  if (!ids.length) return new Map();
  const { rows } = await q.query(
    `select id, full_name from soldiers where id = any($1::bigint[])`, [ids]);
  return new Map(rows.map((r: any) => [Number(r.id), r.full_name as string]));
}
