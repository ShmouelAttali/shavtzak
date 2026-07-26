// Sunday מגן fill order (owner 2026-07-26) + Level-1 determinism.
//
// Every other day the מגן crew is reserved by the continuity pre-pass, so the
// demand-fill order barely matters for it. A Sunday resets continuity (weekly
// reset, owner 2026-07-19) and the crew is built from scratch — so it must be
// filled FIRST, right after the closed-list position, while every מחלקה is
// still whole. Otherwise it picks its anchor מחלקה out of a pool that סיור and
// התקפי have already thinned, and the single-מחלקה core can miss its flex min.
//
// The second test pins the property the ordering rests on: Level 1 must not
// depend on the roster's LOAD order. Every decision carries an explicit
// tie-break (rank/rankGroup end in tieJitter; the platoon anchor breaks ties by
// מחלקה name; group anchors are ranked), and load.ts orders the roster query —
// so shuffling the roster's insertion order must not move a single soldier.
import './env.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { freshSchema, addCandidates, closePool, query } from './helpers.js';
import { generate } from '../src/generate.js';
import { loadContext } from '../src/load.js';
import { buildGen } from '../src/state.js';
import { runLevel1, reserveSeatCandidates } from '../src/level1.js';
import type { RationaleEntry } from '../src/rationale.js';

const SUNDAY = '2026-08-09';        // a Sunday — weekly reset, no continuity
const MONDAY = '2026-08-10';
const PLATOON_SIZES = [16, 12, 12]; // uneven on purpose: מחלקה 1 is the anchor

before(async () => {
  await freshSchema();
  const values: string[] = [];
  let i = 0;
  PLATOON_SIZES.forEach((n, p) => {
    for (let k = 0; k < n; k++) {
      i++;
      const role = k === 0 ? 'מ"מ' : k === 1 ? 'סמל' : k <= 3 ? 'מ"כ' : 'לוחם';
      values.push(`('T${String(i).padStart(3, '0')}', 'חייל ${String(i).padStart(2, '0')}', `
        + `'${p + 1}', '${role}', ${2 + (i % 8)})`);
    }
  });
  await query(`insert into soldiers (personal_number, full_name, platoon, role, rifle_level)
               values ${values.join(',')}`);
  // one נהג דוד and one נהג טיגריס per מחלקה, so H6d never forces the anchor
  await query(`insert into soldier_qualifications (soldier_id, qualification)
               select id, 'נהג דוד' from soldiers
               where full_name in ('חייל 05','חייל 20','חייל 32')`);
  await query(`insert into soldier_qualifications (soldier_id, qualification)
               select id, 'נהג טיגריס' from soldiers
               where full_name in ('חייל 06','חייל 21','חייל 33')`);
  await addCandidates('קצין מוצב', null, ['חייל 03', 'חייל 18', 'חייל 30']);
});
after(closePool);

const seqOf = (e: RationaleEntry): number | undefined =>
  typeof e.params?.seq === 'number' ? e.params.seq : undefined;

/** soldier id -> position id, keyed by STRING (pg returns bigint as text, so
 *  GenerateResult.level1's keys are strings even though the type says number) */
const buckets = (res: Awaited<ReturnType<typeof generate>>) =>
  new Map([...res.level1].map(([k, v]) => [String(k), v]));

// Pass A (hard commander/driver quotas for EVERY position) deliberately runs
// before any soft fill, so its picks are excluded here — the Sunday rule is
// about Pass B, the demand/fairness fill.
const PASS_A = new Set(['commander_quota', 'driver_quota']);

/** lowest Pass-B (soft fill) pick sequence recorded for a position, if any */
function firstSoftSeq(res: Awaited<ReturnType<typeof generate>>, position: string): number | undefined {
  const pid = res.report!.positions.find((p) => p.name === position)?.id;
  if (pid === undefined) return undefined;
  const bucket = buckets(res);
  const seqs: number[] = [];
  for (const [sid, entries] of Object.entries(res.report!.level1Rationale)) {
    if (bucket.get(String(sid)) !== pid) continue;
    if (entries.some((e) => PASS_A.has(e.code))) continue;
    for (const e of entries) { const s = seqOf(e); if (s !== undefined) seqs.push(s); }
  }
  return seqs.length ? Math.min(...seqs) : undefined;
}

test('Sunday: מגן takes its soft fill before סיור and התקפי', async () => {
  const res = await generate(SUNDAY);
  const magen = firstSoftSeq(res, 'מגן');
  const patrol = firstSoftSeq(res, 'סיור');
  const attack = firstSoftSeq(res, 'התקפי');
  assert.ok(magen !== undefined, 'מגן took soft-fill picks on a Sunday');
  assert.ok(patrol !== undefined && attack !== undefined, 'סיור/התקפי were filled too');
  assert.ok(magen < patrol!, `מגן first pick #${magen} must precede סיור's #${patrol}`);
  assert.ok(magen < attack!, `מגן first pick #${magen} must precede התקפי's #${attack}`);
});

test('Sunday: the מגן crew anchors on the largest מחלקה, core at flex min', async () => {
  const res = await generate(SUNDAY);
  const pid = res.report!.positions.find((p) => p.name === 'מגן')!.id;
  const platoonOf = new Map(res.report!.soldiers.map((s) => [s.id, s.platoon]));
  const counts = new Map<string, number>();
  for (const [sid, p] of res.level1) {
    if (p !== pid) continue;
    const pl = platoonOf.get(sid)!;
    counts.set(pl, (counts.get(pl) ?? 0) + 1);
  }
  const core = Math.max(0, ...counts.values());
  // מחלקה 1 is the largest (16) and is still whole when מגן fills
  assert.equal([...counts.entries()].sort((a, b) => b[1] - a[1])[0][0], '1');
  assert.ok(core >= 10, `single-מחלקה core is ${core} (<10): ${JSON.stringify([...counts])}`);
});

test('a weekday keeps the original order — סיור soft-fills before מגן', async () => {
  const res = await generate(MONDAY);
  const magen = firstSoftSeq(res, 'מגן');
  const patrol = firstSoftSeq(res, 'סיור');
  // מגן may be fully covered by continuity/commander and take no demand picks
  if (magen !== undefined && patrol !== undefined) {
    assert.ok(patrol < magen, `סיור's #${patrol} must precede מגן's #${magen} on a weekday`);
  }
});

test('Level 1 is independent of the roster load order', async () => {
  // Same context, one with the soldier Map deliberately reversed: the roster's
  // insertion order must not move a single soldier between buckets.
  const run = async (reverse: boolean) => {
    const ctx = await loadContext(SUNDAY);
    if (reverse) {
      const entries = [...ctx.soldiers.entries()].reverse();
      ctx.soldiers = new Map(entries);
    }
    const g = buildGen(ctx);
    reserveSeatCandidates(g);
    runLevel1(g);
    return [...g.level1.entries()].sort((a, b) => a[0] - b[0]).map((e) => e.join(':')).join(',');
  };
  assert.equal(await run(false), await run(true));
});
