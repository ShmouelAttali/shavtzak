// Persistence repository for the generator's write path: ALL SQL that stores
// a generated day lives here — generation logic (generate.ts and the level1/
// level2/chains modules) touches no queries. The read path is src/load.ts.

import { pool } from './db.js';
import { validateDay, Finding } from './validate.js';
import { GenerateResult } from './model.js';
import { minToIso } from './time.js';
import { buildDayInput, buildDayReportHtml } from './report.js';

export interface PersistOptions {
  /** Build + store schedule_days.report_html (the דוח חילול the draft tab
   *  re-opens via GET /api/report). Defaults to TRUE — api/draft.ts and the
   *  tests rely on the report being there. `cli generate --no-report` passes
   *  false: the flag means "no report at all", and the old `if (res.report)`
   *  gate never honored it (generate() always fills res.report). */
  storeReport?: boolean;
}

/**
 * The extended-protocol wire format carries the bind-parameter count as an
 * int16, so ONE statement can take at most 65535 parameters. The
 * shift_assignments insert spends 11 per row (+ the shared day), which caps a
 * single statement at ~5957 rows. A normal day is a few hundred, but a wide
 * range or a fat ad-hoc day must not hit "bind message has N parameter
 * formats" — so the values list is chunked. Every chunk still runs inside the
 * SAME transaction, so the write stays all-or-nothing.
 */
export const MAX_ROWS_PER_INSERT = 4000;
/** params the shift_assignments insert spends per row (the widest of the two) */
export const PARAMS_PER_SHIFT_ROW = 11;

export function chunked<T>(rows: readonly T[], size = MAX_ROWS_PER_INSERT): T[][] {
  if (rows.length <= size) return rows.length ? [rows as T[]] : [];
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

export async function persist(res: GenerateResult, opts: PersistOptions = {}): Promise<Finding[]> {
  const { day } = res;
  const storeReport = opts.storeReport ?? true;
  // Batched: multi-row inserts inside one transaction — row-by-row inserts
  // over the WAN pooler take ~12s/day, past Vercel's 10s function limit.
  const dayRows = [...res.level1].map(([sid, pid]) => ({ sid, pid }));

  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query(
      `delete from shift_assignments where day = $1 and source in ('auto','chain') and not locked`, [day]);
    await client.query(
      `delete from day_assignments where day = $1 and source in ('auto','chain') and not locked`, [day]);
    // Daily missions extend past the day boundary; regenerating day D can
    // therefore conflict with a stale draft of D+1. Remove only the future
    // unlocked draft rows that actually collide — regenerating a range
    // rebuilds them in order, and the validator flags any hole left behind.
    const clashed = await client.query(
      `delete from shift_assignments f
       using unnest($2::bigint[], $3::tsrange[]) as n(sid, p)
       where f.day > $1::date and f.source in ('auto','chain') and not f.locked
         and f.soldier_id = n.sid and f.period && n.p
       returning f.day`,
      [day,
        res.assignments.map((a) => a.soldierId),
        res.assignments.map((a) => `[${minToIso(a.period[0])},${minToIso(a.period[1])})`)]);
    if (clashed.rowCount) {
      res.issues.push(`הוסרו ${clashed.rowCount} שיבוצים מתנגשים מטיוטות של ימים עתידיים — יש לחולל אותם מחדש`);
    }
    // day_assignments: 2 params/row — one row per soldier, so the roster size
    // alone keeps it far under the cap; chunked anyway for uniformity.
    for (const part of chunked(dayRows)) {
      const dv: unknown[] = [day];
      const dTuples = part.map(({ sid, pid }) => {
        dv.push(sid, pid);
        return `($1::date, $${dv.length - 1}, $${dv.length}, 'auto')`;
      });
      await client.query(
        `insert into day_assignments (day, soldier_id, position_id, source)
         values ${dTuples.join(',')} on conflict (day, soldier_id) do nothing`, dv);
    }
    // shift_assignments: 11 params/row — the chunk that actually matters
    for (const part of chunked(res.assignments)) {
      const sv: unknown[] = [day];
      const sTuples = part.map((a) => {
        sv.push(a.positionId, a.subPositionId, a.soldierId,
          minToIso(a.period[0]), minToIso(a.period[1]),
          a.seatIndex, a.isCommanderSeat, a.source, a.blocksOverlap,
          JSON.stringify(a.violations), JSON.stringify(a.rationale));
        const b = sv.length - 11;
        return `($1::date, $${b + 1}, $${b + 2}, $${b + 3},` +
          ` tsrange($${b + 4}::timestamp, $${b + 5}::timestamp),` +
          ` $${b + 6}, $${b + 7}, $${b + 8}, $${b + 9}, $${b + 10}::jsonb, $${b + 11}::jsonb)`;
      });
      await client.query(
        `insert into shift_assignments
           (day, position_id, sub_position_id, soldier_id, period, seat_index,
            is_commander_seat, source, blocks_overlap, violations, rationale)
         values ${sTuples.join(',')}`, sv);
    }
    await client.query(
      // naive LOCAL wall-clock, like every other timestamp in the schema
      // (Supabase's server TZ is UTC — a bare now() would store UTC and skew
      // 2-3h against the shift times; see schema.sql's exit_requests.created_at)
      `update schedule_days set status = 'generated',
              generated_at = timezone('Asia/Jerusalem', now()) where day = $1`, [day]);
    await client.query('commit');
  } catch (e) {
    await client.query('rollback');
    throw e;
  } finally {
    client.release();
  }
  // ONE post-commit update for both snapshots. validateDay() (not
  // validateAndStore) so the validation row and the report ride the same
  // statement — validateAndStore keeps its own update for the `cli validate`
  // path, which has no report to store.
  const findings = await validateDay(day);
  // The self-contained generation report, so the draft UI can re-open it
  // (GET /api/report). report.ts builders are pure (no fs); best-effort — a
  // report-build hiccup must never fail the generation, so a throw here only
  // drops the report and the validation snapshot is still written.
  let html: string | null = null;
  if (storeReport && res.report) {
    try {
      html = buildDayReportHtml(buildDayInput(res, findings, false));
    } catch (e) {
      console.error(`report_html build failed for ${day}:`, e);
    }
  }
  if (html !== null) {
    await pool.query(
      `update schedule_days set validation = $2, report_html = $3 where day = $1`,
      [day, JSON.stringify(findings), html]);
  } else {
    // no report asked for (or its build threw) — leave report_html as it was
    await pool.query(`update schedule_days set validation = $2 where day = $1`,
      [day, JSON.stringify(findings)]);
  }
  return findings;
}
