import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';

/**
 * v3.6 rules for the סיור driver seat, exercised end to end through
 * updateShabtzakRecommendations() against a synthetic three-tab spreadsheet.
 *
 * The live sheet cannot show these: it has exactly one available נהג דוד and
 * all three driver seats already filled, so the reservation never triggers
 * there. Here we control how many drivers exist and which seats are open.
 */
const REC = path.join(process.cwd(), 'apps-script/plugat-gaash/ShavtzakRecommendation.js');
const SOURCE = fs.readFileSync(REC, 'utf8');

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
  { name: 'נהג א', role: 'נהג דוד' },
  { name: 'נהג ב', role: 'נהג דוד' },
];

// three slots per tour: commander, filler, driver seat (last row of the group)
function tourGroup(date: string, time: string, slots: (string | undefined)[]): Task[] {
  return slots.map(soldier => ({ date, position: 'סיור', type: 'סיור', time, soldier }));
}

type HistoryRow = { date: string; position: string; type: string; time: string; soldier: string };

function buildSheets(tasks: Task[], roster: Soldier[] = ROSTER, history: HistoryRow[] = []) {
  const dates = [BASE, NEXT].map(d => d.slice(0, 6) + d.slice(8));  // DD/MM/YY
  const rosterRows: string[][] = [
    ['', '', '', '', '', '', '', '', '', ...dates],
    [],
    ['מספר אישי', 'שם פרטי', 'שם משפחה', 'שם מלא', 'תפקיד', 'מחלקה', '', '', '', 'יום א', 'יום ב'],
  ];
  // header row above is index 2; columns are located by label, not position
  rosterRows[2] = ['מספר אישי', 'שם מלא', 'תפקיד', 'מחלקה', '', '', '', '', '', 'יום א', 'יום ב'];
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
  tasks.forEach(t => {
    scheduleRows.push(['', '', '', '', '', '', '', t.date, t.position, t.type, t.time, t.soldier ?? '']);
  });

  return {
    'שבצק': scheduleRows,
    'מצבת החיילים': rosterRows,
    'כל השבצק': [
      ['תאריך', 'העמדה', 'סוג', 'השעה', 'החייל'],
      ...history.map(h => [h.date, h.position, h.type, h.time, h.soldier]),
    ],
  } as Record<string, string[][]>;
}

function a1ToRC(a1: string) {
  const m = a1.match(/^([A-Z]+)(\d+)$/)!;
  let col = 0;
  for (const ch of m[1]) col = col * 26 + (ch.charCodeAt(0) - 64);
  return { row: Number(m[2]), col };
}

/** Runs the engine and returns, per task row, the recommendation output. */
function runEngine(tasks: Task[], roster: Soldier[] = ROSTER, history: HistoryRow[] = []) {
  const grids = buildSheets(tasks, roster, history);
  for (const key of Object.keys(grids)) {
    const w = Math.max(...grids[key].map(r => r.length), 1);
    grids[key] = grids[key].map(r => { const a = [...r]; while (a.length < w) a.push(''); return a; });
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
  vm.runInContext(SOURCE, ctx);
  vm.runInContext('updateShabtzakRecommendations()', ctx);

  const body = writes.filter(w => w.kind === 'values').reduce((b, w) => (w.values.length > b.values.length ? w : b));
  // body starts at the task header row; task i sits at body row i+1
  return tasks.map((task, i) => {
    const row = body.values[i + 1] ?? [];
    return { task, candidates: String(row[0] ?? ''), warnings: String(row[4] ?? ''), groupStatus: String(row[5] ?? '') };
  });
}

test('the last סיור slot only ever offers נהג דוד', () => {
  const out = runEngine(tourGroup(BASE, '14:00', ['מפקד א', 'לוחם א', undefined]));
  const seat = out[2];

  assert.match(seat.candidates, /נהג/, 'a driver must be offered');
  for (const nonDriver of ['לוחם ב', 'לוחם ג', 'מפקד ב']) {
    assert.doesNotMatch(seat.candidates, new RegExp(nonDriver), `${nonDriver} must not be offered`);
  }
});

test('with no נהג דוד available the seat stays empty rather than taking anyone', () => {
  const roster = ROSTER.map(s => (s.role === 'נהג דוד' ? { ...s, status: 'חופש' } : s));
  const out = runEngine(tourGroup(BASE, '14:00', ['מפקד א', 'לוחם א', undefined]), roster);

  assert.equal(out[2].candidates, 'אין מועמד מתאים');
  assert.match(out[2].warnings, /משבצת אחרונה בסיור שמורה לנהג דוד/);
});

test('a נהג דוד is held back from other positions while a seat he can take is open', () => {
  const out = runEngine([
    ...tourGroup(BASE, '14:00', ['מפקד א', 'לוחם א', undefined]),   // driver seat open
    { date: BASE, position: 'שג', type: 'עמדות הגנה', time: '18:00' },
  ]);

  const defence = out[3];
  assert.doesNotMatch(defence.candidates, /נהג א|נהג ב/, 'drivers are reserved for the tour seat');
  assert.match(defence.candidates, /לוחם|מפקד/, 'other soldiers are still recommended');
});

test('a driver is not offered for the ordinary slots of a סיור either, only the driver seat', () => {
  // slot 2 is an ordinary tour slot, slot 3 is the driver seat — both open
  const out = runEngine(tourGroup(BASE, '14:00', ['מפקד א', undefined, undefined]));

  const ordinarySlot = out[1];
  const driverSeat = out[2];

  assert.doesNotMatch(ordinarySlot.candidates, /נהג א|נהג ב/,
    'drivers must not be offered for an ordinary סיור slot while the driver seat is open');
  assert.match(ordinarySlot.candidates, /לוחם|מפקד/, 'other soldiers are still offered');
  assert.match(driverSeat.candidates, /נהג/, 'the driver seat still offers them');
});

test('once every seat a driver could take is filled, he is free for other positions', () => {
  // both driver seats taken by drivers => nothing left to reserve them for
  const out = runEngine([
    ...tourGroup(BASE, '14:00', ['מפקד א', 'לוחם א', 'נהג א']),
    ...tourGroup(BASE, '22:00', ['מפקד ב', 'לוחם ב', 'נהג ב']),
    { date: BASE, position: 'שג', type: 'עמדות הגנה', time: '18:00' },
  ]);

  const seats = [out[2], out[5]];
  for (const seat of seats) assert.match(seat.groupStatus, /נהג דוד במשבצת האחרונה/);

  // נהג א and נהג ב are both already on a tour today, so "already assigned
  // today" keeps them out — the point is only that the reservation is gone.
  assert.doesNotMatch(out[6].candidates, /אין מועמד מתאים/);
});

test('a driver who cannot reach any open seat is not held back', () => {
  // one driver, and the only open seat is a tour he is already committed to
  const roster = ROSTER.filter(s => s.name !== 'נהג ב');
  const out = runEngine([
    ...tourGroup(BASE, '14:00', ['מפקד א', 'לוחם א', 'נהג א']),   // covered
    { date: BASE, position: 'שג', type: 'עמדות הגנה', time: '18:00' },
  ], roster);

  // no uncovered seat at all => reservation empty => the engine is free to
  // rank the driver on his merits (he is busy today, so he may still not win,
  // but he must not be rejected *for being reserved*)
  assert.doesNotMatch(out[3].warnings, /שמור למשבצת הנהג/);
});

/**
 * A tired driver is still a driver. Short rest drops a candidate to "בדוחק"
 * rather than rejecting him, so he still counts as able to take the seat and
 * stays reserved for it. Only a hard rejection — unavailable, already
 * assigned today, an actual overlap — releases a driver to other positions.
 */
test('short rest does not release a driver: he is offered בדוחק and stays reserved', () => {
  const out = runEngine(
    [
      // 14:00 driver seat is open, but נהג ב only came off a tour at 13:00
      ...tourGroup(BASE, '14:00', ['מפקד א', 'לוחם א', undefined]),
      // 22:00 seat already covered by נהג א; its ordinary slot is open
      ...tourGroup(BASE, '22:00', ['מפקד ב', undefined, 'נהג א']),
    ],
    ROSTER,
    [{ date: BASE, position: 'סיור', type: 'סיור', time: '05:00-13:00', soldier: 'נהג ב' }],
  );

  const openDriverSeat = out[2];
  const ordinarySlotLater = out[4];

  // a tired driver beats no driver — offered, flagged בדוחק
  assert.match(openDriverSeat.candidates, /נהג ב/);
  assert.match(openDriverSeat.candidates, /בדוחק/);
  // and he is still held out of the ordinary slot in the other סיור
  assert.doesNotMatch(ordinarySlotLater.candidates, /נהג ב/);
});

test('the driver seat rule does not fire on a one-slot סיור (commander wins)', () => {
  const out = runEngine([{ date: BASE, position: 'סיור', type: 'סיור', time: '14:00' }]);
  assert.doesNotMatch(out[0].warnings, /שמורה לנהג דוד/);
  assert.match(out[0].candidates, /מפקד/);
});

test('a warning already shown in the group status is not repeated', () => {
  const out = runEngine(tourGroup(BASE, '14:00', ['מפקד א', 'לוחם א', 'לוחם ב']));
  for (const row of out) {
    assert.doesNotMatch(row.groupStatus, /⚠ ⚠/, 'no doubled warning');
    const occurrences = row.groupStatus.split('אינה נהג דוד').length - 1;
    assert.ok(occurrences <= 1, `driver warning repeated ${occurrences}x in: ${row.groupStatus}`);
  }
});
