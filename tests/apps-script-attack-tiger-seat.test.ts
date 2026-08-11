import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';

/**
 * v3.20: the last seat of an התקפי group is reserved for a נהג טיגריס, the same
 * rule the סיור has had for נהג דוד since v3.6.
 *
 * The decision these tests pin: it is the last seat of the WHOLE group, not of
 * each team of 4. That is how the sheet is actually written — in the 8-seat
 * blocks of 07–11/08 the tiger driver sits in seat 8 only, and seat 4 (the end
 * of the first team) never holds one. The commander rule, by contrast, IS per
 * team. The two cannot be derived from each other.
 *
 * The live sheet cannot exercise the rejection: all 8 seats there are already
 * assigned, so nothing is ever recommended into the driver seat.
 */
const DIR = path.join(process.cwd(), 'apps-script/plugat-gaash');
const SOURCES = ['ShabtzakOps.js', 'ShavtzakRecommendation.js']
  .map((f) => fs.readFileSync(path.join(DIR, f), 'utf8'));

const BASE = '11/08/2026';
const NEXT = '12/08/2026';

type Soldier = { name: string; role: string; platoon?: string; status?: string };
type Task = { date: string; position: string; type: string; time: string; soldier?: string };

const ROSTER: Soldier[] = [
  { name: 'מפקד א', role: 'מ"כ' },
  { name: 'מפקד ב', role: 'מ"כ' },
  { name: 'מפקד ג', role: 'מ"כ' },
  { name: 'לוחם א', role: 'לוחם' },
  { name: 'לוחם ב', role: 'לוחם' },
  { name: 'לוחם ג', role: 'לוחם' },
  { name: 'לוחם ד', role: 'לוחם' },
  { name: 'לוחם ה', role: 'לוחם' },
  { name: 'לוחם ו', role: 'לוחם' },
  { name: 'טיגריס א', role: 'נהג טיגריס' },
  { name: 'דוד א', role: 'נהג דוד' },
];

const attackGroup = (time: string, slots: (string | undefined)[]): Task[] =>
  slots.map((soldier) => ({ date: BASE, position: 'התקפי', type: 'התקפי', time, soldier }));

function buildSheets(tasks: Task[], roster: Soldier[]) {
  const dates = [BASE, NEXT].map((d) => d.slice(0, 6) + d.slice(8));
  const rosterRows: string[][] = [
    ['', '', '', '', '', '', '', '', '', ...dates],
    [],
    ['מספר אישי', 'שם מלא', 'תפקיד', 'מחלקה', '', '', '', '', '', 'יום א', 'יום ב'],
  ];
  roster.forEach((s, i) => {
    const row = new Array(11).fill('');
    row[0] = String(1000 + i);
    row[1] = s.name;
    row[2] = s.role;
    row[3] = s.platoon ?? '2';
    row[9] = s.status ?? 'נוכח';
    row[10] = s.status ?? 'נוכח';
    rosterRows.push(row);
  });

  const scheduleRows: string[][] = [
    ['תאריך', '', '', '', BASE],
    [],
    ['שם מלא', 'משימה יום קודם', 'מחלקה', 'תפקיד', 'אתמול', 'היום', 'מחר', 'תאריך', 'העמדה', 'סוג', 'השעה', 'החייל'],
  ];
  tasks.forEach((t) => {
    scheduleRows.push(['', '', '', '', '', '', '', t.date, t.position, t.type, t.time, t.soldier ?? '']);
  });

  return {
    'שבצק': scheduleRows,
    'מצבת החיילים': rosterRows,
    'כל השבצק': [['תאריך', 'העמדה', 'סוג', 'השעה', 'החייל']],
  } as Record<string, string[][]>;
}

function a1ToRC(a1: string) {
  const m = a1.match(/^([A-Z]+)(\d+)$/)!;
  let col = 0;
  for (const ch of m[1]) col = col * 26 + (ch.charCodeAt(0) - 64);
  return { row: Number(m[2]), col };
}

function runEngine(tasks: Task[], roster: Soldier[] = ROSTER) {
  const grids = buildSheets(tasks, roster);
  for (const key of Object.keys(grids)) {
    const w = Math.max(...grids[key].map((r) => r.length), 1);
    grids[key] = grids[key].map((r) => { const a = [...r]; while (a.length < w) a.push(''); return a; });
  }

  const writes: any[] = [];
  const makeSheet = (name: string) => {
    const grid = grids[name];
    const mk = (row: number, col: number, nR: number, nC: number) => {
      const self: any = {
        getValues: () => Array.from({ length: nR }, (_, r) =>
          Array.from({ length: nC }, (_, c) => grid[row - 1 + r]?.[col - 1 + c] ?? '')),
        getValue: () => grid[row - 1]?.[col - 1] ?? '',
        getA1Notation: () => `R${row}C${col}`,
        setValues: (v: any) => { writes.push({ kind: 'values', row, col, values: v }); return self; },
        setNotes: () => self,
        setBackgrounds: () => self,
      };
      for (const m of ['setBackground', 'setNote', 'clearContent', 'clearNote', 'setFontWeight',
        'setHorizontalAlignment', 'setVerticalAlignment', 'setWrapStrategy', 'setBorder']) self[m] = () => self;
      return self;
    };
    return {
      getName: () => name,
      getLastRow: () => grid.length,
      getLastColumn: () => grid[0]?.length ?? 0,
      getMaxRows: () => grid.length,
      getMaxColumns: () => grid[0]?.length ?? 0,
      setColumnWidth: () => {},
      getDataRange: () => mk(1, 1, grid.length, grid[0]?.length ?? 0),
      getRange: (...a: any[]) => (typeof a[0] === 'string'
        ? (({ row, col }) => mk(row, col, 1, 1))(a1ToRC(a[0]))
        : mk(a[0], a[1], a[2] ?? 1, a[3] ?? 1)),
    };
  };

  const sheets: Record<string, any> = {};
  for (const t of Object.keys(grids)) sheets[t] = makeSheet(t);
  const props: Record<string, string> = {};
  const ctx: any = {
    console, Date, Math, JSON, String, Number, Boolean, Array, Object, RegExp, Error, isNaN, parseInt, parseFloat,
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ({ getSheetByName: (n: string) => sheets[n] ?? null, toast: () => {} }),
      getUi: () => { throw new Error('no UI'); },
      flush: () => {},
      WrapStrategy: { WRAP: 'WRAP' },
      BorderStyle: { SOLID: 'SOLID' },
    },
    PropertiesService: {
      getDocumentProperties: () => ({
        getProperty: (k: string) => (k in props ? props[k] : null),
        setProperty: (k: string, v: string) => { props[k] = v; },
        deleteProperty: (k: string) => { delete props[k]; },
      }),
    },
    CacheService: { getDocumentCache: () => ({ get: () => null, put: () => {}, remove: () => {} }) },
    LockService: { getDocumentLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
    ScriptApp: { getProjectTriggers: () => [] },
    HtmlService: {}, Utilities: {},
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  for (const source of SOURCES) vm.runInContext(source, ctx);
  vm.runInContext('updateShabtzakRecommendations()', ctx);

  const body = writes.filter((w) => w.kind === 'values').reduce((b, w) => (w.values.length > b.values.length ? w : b));
  return tasks.map((task, i) => {
    const row = body.values[i + 1] ?? [];
    return { task, candidates: String(row[0] ?? ''), warnings: String(row[4] ?? ''), groupStatus: String(row[5] ?? '') };
  });
}

/* ------------------------------------------------------------------ */

/** 8 open seats: 1 and 5 are the team commanders, 8 is the driver seat */
const eightOpen = () => attackGroup('14:00-14:00', [undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined]);

test('the last התקפי seat only ever offers נהג טיגריס', () => {
  const out = runEngine(eightOpen());
  const last = out[7].candidates;
  assert.ok(last.includes('טיגריס א'), 'the tiger driver must be offered: ' + last);
  assert.ok(!last.includes('לוחם'), 'no ordinary soldier may be offered there: ' + last);
  assert.ok(!last.includes('דוד א'), 'a נהג דוד is not a נהג טיגריס: ' + last);
});

test('seat 4 — the end of the first team of 4 — is NOT a driver seat', () => {
  // this is the whole "group, not team" decision, taken from how the sheet is written
  const out = runEngine(eightOpen());
  const seat4 = out[3].candidates;
  assert.ok(seat4.includes('לוחם'), 'ordinary soldiers belong in seat 4: ' + seat4);
});

test('with no נהג טיגריס available the seat says so rather than taking anyone', () => {
  // deliberate: better a visible "no candidate" than quietly seating a non-driver
  const noTiger = ROSTER.filter((s) => s.role !== 'נהג טיגריס');
  const out = runEngine(eightOpen(), noTiger);
  assert.equal(out[7].candidates.trim(), 'אין מועמד מתאים');
  assert.ok(!out[7].candidates.includes('לוחם'));
});

test('a נהג טיגריס is held back from other positions while his seat is open', () => {
  const out = runEngine(eightOpen());
  for (const i of [1, 2, 3, 5, 6]) {
    assert.ok(!out[i].candidates.includes('טיגריס א'),
      `seat ${i + 1} must not offer the tiger driver while his own seat is open: ` + out[i].candidates);
  }
});

test('once the driver seat is filled he is free for the other seats', () => {
  const filled = attackGroup('14:00-14:00',
    [undefined, undefined, undefined, undefined, undefined, undefined, undefined, 'טיגריס א']);
  const out = runEngine(filled);
  // he is taken by his own seat, so he is not double-offered; the point is that
  // the reservation no longer suppresses anyone else's list
  assert.ok(out[1].candidates.includes('לוחם'), 'ordinary candidates still offered: ' + out[1].candidates);
});

test('a נהג דוד is not reserved for the tiger seat — the reservation knows its driver type', () => {
  const out = runEngine(eightOpen());
  const anyOffer = out.slice(1, 7).some((r) => r.candidates.includes('דוד א'));
  assert.ok(anyOffer, 'the dud driver has no seat of his own here and must stay available');
});

test('a one-seat התקפי has no driver seat — the commander rule wins', () => {
  const single = attackGroup('20:00-24:00', [undefined]);
  const out = runEngine(single);
  assert.ok(!out[0].candidates.includes('טיגריס א') || out[0].candidates.includes('מפקד'),
    'a lone seat is the commander seat, not the driver seat: ' + out[0].candidates);
});

test('the group status reports where the tiger driver sits', () => {
  const ok = attackGroup('14:00-14:00',
    ['מפקד א', 'לוחם א', 'לוחם ב', 'לוחם ג', 'מפקד ב', 'לוחם ד', 'לוחם ה', 'טיגריס א']);
  assert.match(runEngine(ok)[0].groupStatus, /נהג טיגריס במשבצת האחרונה/);

  const wrong = attackGroup('14:00-14:00',
    ['מפקד א', 'לוחם א', 'לוחם ב', 'לוחם ג', 'מפקד ב', 'לוחם ד', 'טיגריס א', 'לוחם ה']);
  assert.match(runEngine(wrong)[0].groupStatus, /המשבצת האחרונה אינה נהג טיגריס/);
});

test('the סיור rule is untouched by the generalisation', () => {
  const tour = [undefined, undefined, undefined].map((soldier) => ({
    date: BASE, position: 'סיור', type: 'סיור', time: '14:00', soldier,
  })) as Task[];
  const out = runEngine(tour);
  assert.ok(out[2].candidates.includes('דוד א'), 'the dud driver still owns the last סיור seat: ' + out[2].candidates);
  assert.ok(!out[2].candidates.includes('טיגריס א'), 'a tiger driver is not a dud driver: ' + out[2].candidates);
});
