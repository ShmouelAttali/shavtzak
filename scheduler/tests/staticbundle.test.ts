// loadStatic() / loadDay(): the day-independent half of the load is fetched
// once and shared by every day of a range. This suite pins the invariant that
// makes that safe — the SHARED bundle must produce byte-identical schedules to
// the per-day load, including across consecutive days (a day that mutated a
// shared Position / Soldier would poison the next one).
import './env.js';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { freshSchema, seedSoldiers, closePool } from './helpers.js';
import { generate, persist, loadStatic } from '../src/generate.js';
import { loadStatic as loadStaticDirect, loadDay } from '../src/load.js';
import type { GenerateResult } from '../src/model.js';

const DAYS = ['2026-08-10', '2026-08-11', '2026-08-12'];

after(closePool);

/** Every seat of a generated day, order-independent. */
const fingerprint = (res: GenerateResult): string => [
  ...res.assignments.map((a) => [
    res.day, a.positionId, a.subPositionId ?? '-', a.soldierId,
    a.period[0], a.period[1], a.seatIndex, a.isCommanderSeat, a.source,
  ].join('|')),
  ...[...res.level1].map(([sid, pid]) => `L1|${res.day}|${sid}|${pid}`),
].sort().join('\n');

async function runRange(shared: boolean): Promise<string[]> {
  await freshSchema();
  await seedSoldiers();
  const base = shared ? await loadStatic() : undefined;
  const out: string[] = [];
  for (const day of DAYS) {
    const res = base ? await generate(day, base) : await generate(day);
    await persist(res, { storeReport: false });
    out.push(fingerprint(res));
  }
  return out;
}

test('a pre-loaded static bundle generates the identical range, day for day', async () => {
  const perDay = await runRange(false);
  const shared = await runRange(true);
  for (let i = 0; i < DAYS.length; i++) {
    assert.equal(shared[i], perDay[i],
      `${DAYS[i]} differs between the shared-bundle and per-day load paths`);
  }
});

test('loadDay over a shared bundle carries the same roster/positions as loadContext', async () => {
  const base = await loadStaticDirect();
  const a = await loadDay(DAYS[0], base);
  const b = await loadDay(DAYS[2], base);
  // the day-independent halves are the very same objects — that is the point
  assert.equal(a.soldiers, b.soldiers);
  assert.equal(a.positions, b.positions);
  assert.equal(a.tunables, b.tunables);
  // ...and the day-dependent halves are NOT shared
  assert.notEqual(a.slots, b.slots);
  assert.notEqual(a.fairness, b.fairness);
  assert.equal(a.day, DAYS[0]);
  assert.equal(b.day, DAYS[2]);
});

test('generate() forwards the load\'s rows to persist as validateRefs', async () => {
  const base = await loadStaticDirect();
  const res = await generate(DAYS[0], base);
  assert.equal(res.validateRefs, base.refs);
  assert.ok(res.validateRefs!.positions.length > 0);
  assert.ok(res.validateRefs!.config.length > 0);
});

test('loadDay rejects a malformed day before touching the DB', async () => {
  const base = await loadStaticDirect();
  await assert.rejects(() => loadDay('2026-8-1', base), /bad day/);
});
