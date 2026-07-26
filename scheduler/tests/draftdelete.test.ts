// Handler-level tests for api/draft.ts's DELETE (the "מחק טיוטה" button of the
// צור שבצק tab): a day's whole draft is thrown away — auto/chain rows AND the
// officer's manual/locked edits — so what stands is the published schedule.
// Survivors: source='import' history and rows of manual-only positions
// (positions.is_scheduled=false → חמל). A published day is frozen (409).
// Positions are resolved by NAME (never hardcoded seed ids).
import './env.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { freshSchema, seedSoldiers, soldierId, closePool, query } from './helpers.js';
import draftHandler from '../../api/draft.js';
import { getPool } from '../../api/_db.js';
import type { DeleteDraftResponse } from '../../api/draft.js';

const DAY = '2026-07-20';

function mockRes() {
  const out: { status: number; body: any } = { status: 0, body: null };
  const res: any = {
    setHeader() { return res; },
    status(code: number) { out.status = code; return res; },
    json(body: any) { out.body = body; return res; },
    end() { return res; },
  };
  return { res, out };
}
const del = async (day: string): Promise<{ status: number; body: any }> => {
  const { res, out } = mockRes();
  await draftHandler({ method: 'DELETE', query: { day } } as any, res as any);
  return out;
};

const posId = async (name: string): Promise<number> => {
  const r = await query<{ id: number }>(`select id from positions where name = $1`, [name]);
  assert.equal(r.length, 1, `position ${name}`);
  return r[0].id;
};

/** one shift_assignments row; `period` spans two hours inside the schedule day */
async function addShift(opts: {
  position: string; soldier: string; source: string; locked?: boolean; hour?: number;
}): Promise<void> {
  const start = `${DAY} ${String(opts.hour ?? 16).padStart(2, '0')}:00`;
  await query(
    `insert into shift_assignments (day, position_id, soldier_id, period, source, locked, blocks_overlap)
     values ($1::date, $2, $3, tsrange($4::timestamp, $4::timestamp + interval '2 hours'),
             $5, $6, false)`,
    [DAY, await posId(opts.position), await soldierId(opts.soldier), start,
     opts.source, opts.locked ?? false]);
}
async function addBucket(position: string, soldier: string, source = 'auto', locked = false): Promise<void> {
  await query(
    `insert into day_assignments (day, soldier_id, position_id, source, locked)
     values ($1::date, $2, $3, $4, $5)`,
    [DAY, await soldierId(soldier), await posId(position), source, locked]);
}

/** the day's surviving rows as `position|soldier|source` */
async function rows(): Promise<string[]> {
  const r = await query<{ k: string }>(
    `select p.name || '|' || s.full_name || '|' || sa.source k
     from shift_assignments sa
     join positions p on p.id = sa.position_id
     join soldiers s on s.id = sa.soldier_id
     where sa.day = $1 order by k`, [DAY]);
  return r.map((x) => x.k);
}
async function buckets(): Promise<string[]> {
  const r = await query<{ k: string }>(
    `select p.name || '|' || s.full_name k
     from day_assignments da
     join positions p on p.id = da.position_id
     join soldiers s on s.id = da.soldier_id
     where da.day = $1 order by k`, [DAY]);
  return r.map((x) => x.k);
}
const dayRow = async () => (await query<{ status: string; generated_at: string | null; has_report: boolean }>(
  `select status, generated_at, (report_html is not null) has_report
   from schedule_days where day = $1`, [DAY]))[0];

/** a day holding one of every row kind the delete must reason about */
async function seedDraft(): Promise<void> {
  await query(`delete from shift_assignments where day = $1`, [DAY]);
  await query(`delete from day_assignments where day = $1`, [DAY]);
  await query(
    `insert into schedule_days (day, status, generated_at, report_html, validation)
     values ($1::date, 'generated', now(), '<html>report</html>', '[{"rule":"x"}]')
     on conflict (day) do update set status = 'generated', generated_at = now(),
       report_html = '<html>report</html>', validation = '[{"rule":"x"}]'`, [DAY]);
  await addShift({ position: 'סיור', soldier: 'חייל 01', source: 'auto', hour: 16 });
  await addShift({ position: 'כרמל חטיבה', soldier: 'חייל 02', source: 'chain', hour: 18 });
  await addShift({ position: 'עמדות הגנה', soldier: 'חייל 03', source: 'manual', locked: true, hour: 20 });
  await addShift({ position: 'תגבצ', soldier: 'חייל 04', source: 'import', hour: 22 });
  await addShift({ position: 'חמל', soldier: 'חייל 05', source: 'manual', locked: true, hour: 16 });
  await addBucket('סיור', 'חייל 01');
  await addBucket('מנוחה', 'חייל 06');
  await addBucket('חמל', 'חייל 05', 'manual', true);
}

before(async () => {
  await freshSchema();
  await seedSoldiers();
});
after(async () => { await getPool().end(); await closePool(); });

test('DELETE drops the whole draft — auto, chain AND manual/locked rows', async () => {
  await seedDraft();
  const { status, body } = await del(DAY);
  assert.equal(status, 200);
  const out = body as DeleteDraftResponse;
  assert.equal(out.day, DAY);
  assert.equal(out.shiftRows, 3);            // auto + chain + manual(locked) on scheduled positions
  assert.equal(out.dayRows, 2);              // סיור + מנוחה buckets (not the חמל one)
  assert.deepEqual(await rows(), [
    'חמל|חייל 05|manual',                     // manual-only position — owned by the חמל tab
    'תגבצ|חייל 04|import',                    // imported history
  ].sort());
  assert.deepEqual(await buckets(), ['חמל|חייל 05']);
});

test('a day with no imported history reverts to an empty draft, report dropped', async () => {
  await seedDraft();
  await query(`delete from shift_assignments where day = $1 and source = 'import'`, [DAY]);
  await del(DAY);
  const d = await dayRow();
  assert.equal(d.status, 'draft');
  assert.equal(d.generated_at, null);
  assert.equal(d.has_report, false);
});

test('imported history keeps the day out of "draft" (it is history, not a draft)', async () => {
  await seedDraft();
  await del(DAY);
  const d = await dayRow();
  assert.equal(d.status, 'generated');
  assert.equal(d.has_report, true);
});

test('deleting twice is a no-op success (idempotent)', async () => {
  await seedDraft();
  await del(DAY);
  const { status, body } = await del(DAY);
  assert.equal(status, 200);
  assert.equal((body as DeleteDraftResponse).shiftRows, 0);
  assert.equal((body as DeleteDraftResponse).dayRows, 0);
});

test('a published day is frozen — 409, nothing deleted', async () => {
  await seedDraft();
  await query(`update schedule_days set status = 'published' where day = $1`, [DAY]);
  const before = await rows();
  const { status, body } = await del(DAY);
  assert.equal(status, 409);
  assert.match(body.error, /פורסם/);
  assert.deepEqual(await rows(), before);
});

test('unknown day → 404; bad date → 400', async () => {
  assert.equal((await del('2019-01-01')).status, 404);
  assert.equal((await del('not-a-day')).status, 400);
});
