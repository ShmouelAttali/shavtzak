import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getPool, DATE_RE } from './_db.js';

// ── חמל tab API (Task 8) ─────────────────────────────────────────────────────
// Manual assignment of the חמל crew. "Manual replaces auto-staffing": the picks
// for a day are stored as ordinary shift_assignments + day_assignments rows
// (position = חמל, source='manual', locked=true, blocks_overlap=false — חמל is
// a readiness row, so an arbitrary soldier can sit here even if assigned
// elsewhere or non-schedulable). The generator sees those locked rows and skips
// its auto role-based fill for that day (scheduler/src/level1.ts, level2.ts);
// persist() never deletes locked/manual rows. No draft/approval — a write is
// persisted and reflected immediately in the main שבצק.
//
//   GET  /api/hamal?from=YYYY-MM-DD[&to=YYYY-MM-DD]
//        -> { days: [{ day, picks: [{ soldierId, name, seatIndex }] }],
//             roster: [{ id, name, role, platoon, schedulable }] }
//   PUT  /api/hamal   body { day, soldierIds: number[] }   (POST alias)
//        -> replaces that day's manual חמל rows atomically; [] clears the day
//   DELETE /api/hamal?day=YYYY-MM-DD    -> clears that day's manual חמל rows

export interface HamalPick { soldierId: number; name: string; seatIndex: number }
export interface HamalDay { day: string; picks: HamalPick[] }
export interface HamalRosterEntry { id: number; name: string; role: string; platoon: string; schedulable: boolean }
export interface HamalResponse { days: HamalDay[]; roster: HamalRosterEntry[] }
export interface HamalWriteResponse { day: string; picks: HamalPick[] }

/** Resolve the חמל position id. Detected via the staff_all_roles config marker
 *  (the role that names this crew) rather than a hardcoded position name. */
async function hamalPositionId(): Promise<number> {
  const { rows } = await getPool().query(
    `select id from positions where config->'staff_all_roles' ? 'חמל' limit 1`);
  if (!rows.length) throw new Error('חמל position not found');
  return rows[0].id as number;
}

async function getHamal(from: string, to: string): Promise<HamalResponse> {
  const pool = getPool();
  const pid = await hamalPositionId();
  const [picksRes, rosterRes] = await Promise.all([
    pool.query(
      `select sa.day::text as day, sa.soldier_id, s.full_name, sa.seat_index
       from shift_assignments sa
       join soldiers s on s.id = sa.soldier_id
       where sa.position_id = $1 and sa.day between $2 and $3
         and (sa.locked or sa.source = 'manual')
       order by sa.day, sa.seat_index`, [pid, from, to]),
    // whole roster (all soldiers, NOT just schedulable/present ones)
    pool.query(
      `select id, full_name, coalesce(role,'') role, coalesce(platoon,'') platoon, is_schedulable
       from soldiers order by full_name`),
  ]);
  const byDay = new Map<string, HamalDay>();
  for (const r of picksRes.rows) {
    const d: HamalDay = byDay.get(r.day) ?? { day: r.day, picks: [] };
    d.picks.push({ soldierId: Number(r.soldier_id), name: r.full_name, seatIndex: Number(r.seat_index) });
    byDay.set(r.day, d);
  }
  const roster: HamalRosterEntry[] = rosterRes.rows.map((r: any) => ({
    id: Number(r.id), name: r.full_name, role: r.role, platoon: r.platoon, schedulable: !!r.is_schedulable,
  }));
  return { days: [...byDay.values()], roster };
}

/** Replace a day's manual חמל rows atomically. Empty soldierIds clears the day
 *  (the generator then auto-fills חמל again on the next run). */
async function setHamal(day: string, soldierIds: number[]): Promise<HamalWriteResponse> {
  const pool = getPool();
  const pid = await hamalPositionId();
  const ids = [...new Set(soldierIds.map(Number).filter((n) => Number.isInteger(n) && n > 0))];
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query(`insert into schedule_days (day) values ($1) on conflict do nothing`, [day]);
    // Reset the day's חמל crew: this tab fully owns the חמל position for the
    // day. Removing ALL existing חמל rows (auto ones from a prior generation
    // included) both avoids a seat-index collision and enacts "manual replaces
    // auto" immediately — the generator skips its auto חמל fill on the next run
    // while these locked picks stand. Clearing (empty list) leaves חמל empty
    // until the next generation, which then auto-fills it again.
    await client.query(`delete from shift_assignments where day = $1 and position_id = $2`, [day, pid]);
    await client.query(`delete from day_assignments where day = $1 and position_id = $2`, [day, pid]);
    if (ids.length) {
      // one seat per pick over the חמל daily slot (14:00→14:00); readiness row
      // (blocks_overlap=false) so it never collides with other assignments.
      const values: string[] = [];
      const params: unknown[] = [day, pid];
      ids.forEach((sid, i) => {
        params.push(sid, i + 1);
        const b = params.length - 1;
        // (…is_commander_seat, source, blocks_overlap, locked): readiness row →
        // blocks_overlap=false (never collides with other assignments); locked
        // + source=manual so the generator keeps it and skips auto חמל fill
        values.push(`($1::date, $2, $${b}, day_range($1), $${b + 1}, false, 'manual', false, true)`);
      });
      await client.query(
        `insert into shift_assignments
           (day, position_id, soldier_id, period, seat_index, is_commander_seat,
            source, blocks_overlap, locked)
         values ${values.join(',')}`, params);
      // pin their Level-1 bucket to חמל so the generator won't also seat them
      // elsewhere (manual wins over any prior auto bucket)
      const dParams: unknown[] = [day, pid];
      const dValues = ids.map((sid, i) => { dParams.push(sid); return `($1::date, $${i + 3}, $2, 'manual', true)`; });
      await client.query(
        `insert into day_assignments (day, soldier_id, position_id, source, locked)
         values ${dValues.join(',')}
         on conflict (day, soldier_id)
         do update set position_id = excluded.position_id, source = 'manual', locked = true`, dParams);
    }
    await client.query('commit');
  } catch (e) {
    await client.query('rollback');
    throw e;
  } finally {
    client.release();
  }
  const { days } = await getHamal(day, day);
  return { day, picks: days[0]?.picks ?? [] };
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
      const { day, soldierIds } = (req.body ?? {}) as { day?: string; soldierIds?: unknown };
      if (!day || !DATE_RE.test(day)) {
        return res.status(400).json({ error: 'day required (YYYY-MM-DD)' });
      }
      if (!Array.isArray(soldierIds)) {
        return res.status(400).json({ error: 'soldierIds array required' });
      }
      return res.status(200).json(await setHamal(day, soldierIds as number[]));
    }

    if (req.method === 'DELETE') {
      const day = String(req.query.day ?? '');
      if (!DATE_RE.test(day)) return res.status(400).json({ error: 'day required (YYYY-MM-DD)' });
      return res.status(200).json(await setHamal(day, []));
    }

    return res.status(405).json({ error: 'method not allowed' });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e instanceof Error ? e.message : 'server error' });
  }
}
