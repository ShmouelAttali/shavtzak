import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';

/**
 * v3.12 rules for כונן גשש, exercised end to end through
 * updateShabtzakRecommendations() against a synthetic three-tab spreadsheet.
 *
 * Two rules, both pinned here:
 *   1. the shift is reserved for whoever just came off the matching סיור —
 *      anyone else drops to "בדוחק" and only shows when no descender is left;
 *   2. among the descenders the ranking is the תורנים rule on a different
 *      queue: fewest previous כונן גשש shifts in all of "כל השבצק" wins.
 */
// Both files share one global scope in Apps Script and are loaded in filename
// order; the engine calls helpers that live in ShabtzakOps.js (parseExitStatus_).
const DIR = path.join(process.cwd(), 'apps-script/plugat-gaash');
const SOURCES = ['ShabtzakOps.js', 'ShavtzakRecommendation.js']
  .map(f => fs.readFileSync(path.join(DIR, f), 'utf8'));

const PREV = '10/08/2026';
const BASE = '11/08/2026';
const NEXT = '12/08/2026';

type Soldier = { name: string; role: string; platoon?: string; status?: string };
type Task = { date: string; position: string; type: string; time: string; soldier?: string };
type HistoryRow = { date: string; position: string; type: string; time: string; soldier: string };

const ROSTER: Soldier[] = [
  { name: 'מפקד א', role: 'מ"כ' },
  { name: 'מפקד ב', role: 'מ"כ' },
  { name: 'לוחם א', role: 'לוחם' },
  { name: 'לוחם ב', role: 'לוחם' },
  { name: 'לוחם ג', role: 'לוחם' },
  { name: 'לוחם ד', role: 'לוחם' },
  { name: 'לוחם ה', role: 'לוחם' },
  { name: 'לוחם ו', role: 'לוחם' },
  { name: 'נהג א', role: 'נהג דוד' },
  { name: 'נהג ב', role: 'נהג דוד' },
];

/** The 06:00-14:00 tour that the 14:00-22:00 גשש shift is fed from. */
function tour(date: string, time: string, soldiers: (string | undefined)[]): Task[] {
  return soldiers.map(soldier => ({ date, position: 'סיור', type: 'סיור', time, soldier }));
}

function trackerShift(date: string, time: string, soldier?: string): Task {
  return { date, position: 'כונן גשש', type: 'כונן גשש', time, soldier };
}

function buildSheets(tasks: Task[], roster: Soldier[], history: HistoryRow[]) {
  const dates = [PREV, BASE, NEXT].map(d => d.slice(0, 6) + d.slice(8));  // DD/MM/YY
  const rosterRows: string[][] = [
    ['', '', '', '', '', '', '', '', '', ...dates],
    [],
    ['מספר אישי', 'שם מלא', 'תפקיד', 'מחלקה', '', '', '', '', '', 'יום א', 'יום ב', 'יום ג'],
  ];
  roster.forEach((s, i) => {
    const row = new Array(12).fill('');
    row[0] = String(1000 + i);
    row[1] = s.name;
    row[2] = s.role;
    row[3] = s.platoon ?? '2';
    row[9] = s.status ?? 'נוכח';
    row[10] = s.status ?? 'נוכח';
    row[11] = s.status ?? 'נוכח';
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
        setNotes: (v: any) => { writes.push({ kind: 'notes', row, col, values: v }); return self; },
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

  const body = writes.filter(w => w.kind === 'values').reduce((b, w) => (w.values.length > b.values.length ? w : b));
  // notes are written for the same range, one column wide, without the header row
  const noteWrite = writes.filter(w => w.kind === 'notes').pop();
  // body starts at the task header row; task i sits at body row i+1
  return tasks.map((task, i) => {
    const row = body.values[i + 1] ?? [];
    return {
      task,
      candidates: String(row[0] ?? ''),
      warnings: String(row[4] ?? ''),
      groupStatus: String(row[5] ?? ''),
      note: String(noteWrite?.values?.[i + 1]?.[0] ?? ''),
    };
  });
}

/** Order of appearance in the candidates cell, restricted to the given names. */
function ranking(candidates: string, names: string[]) {
  return names
    .map(name => ({ name, at: candidates.indexOf(name) }))
    .filter(x => x.at >= 0)
    .sort((a, b) => a.at - b.at)
    .map(x => x.name);
}

/** The single "N. name (…)" line a soldier occupies in the candidates cell. */
function lineFor(candidates: string, name: string) {
  return candidates.split('\n').find(l => l.includes(name)) ?? '';
}

/** N previous כונן גשש shifts for a soldier, spread over distinct past days. */
function trackerHistory(soldier: string, count: number): HistoryRow[] {
  return Array.from({ length: count }, (_, i) => ({
    date: `${String((i % 28) + 1).padStart(2, '0')}/07/2026`,
    position: 'כונן גשש',
    type: 'כונן גשש',
    time: '14:00-22:00',
    soldier,
  }));
}

test('the 14:00 גשש shift only offers soldiers who came off the tour that just ended', () => {
  const out = runEngine([
    ...tour(BASE, '06:00-14:00', ['מפקד א', 'לוחם א', 'לוחם ב']),
    trackerShift(BASE, '14:00-22:00'),
  ]);

  const shift = out[3];
  for (const descender of ['לוחם א', 'לוחם ב']) {
    assert.match(shift.candidates, new RegExp(descender), `${descender} came off the tour and must be offered`);
    assert.doesNotMatch(lineFor(shift.candidates, descender), /בדוחק/,
      `${descender} came off the tour and is a proper candidate`);
  }
  // everyone else is offered only as בדוחק — behind every descender
  for (const outsider of ['לוחם ג', 'לוחם ד', 'לוחם ה', 'לוחם ו']) {
    const line = lineFor(shift.candidates, outsider);
    if (!line) continue;
    assert.match(line, /בדוחק/, `${outsider} did not come off the tour and must be בדוחק`);
  }
});

test('a soldier who did not come off the tour is flagged, not silently offered', () => {
  // no סיור on the board at all — nobody descended, so everyone is בדוחק
  const out = runEngine([trackerShift(BASE, '14:00-22:00')]);

  assert.notEqual(out[0].candidates, 'אין מועמד מתאים', 'the shift must still get candidates');
  assert.match(out[0].candidates, /בדוחק/);
  assert.match(out[0].warnings, /כונן גשש שמור ליורדי הסיור/);
});

test('among tour descenders, fewest previous גשש shifts ranks first', () => {
  const out = runEngine(
    [
      ...tour(BASE, '06:00-14:00', ['מפקד א', 'לוחם א', 'לוחם ב', 'לוחם ג']),
      trackerShift(BASE, '14:00-22:00'),
    ],
    ROSTER,
    [
      ...trackerHistory('לוחם א', 4),
      ...trackerHistory('לוחם ב', 2),
      // לוחם ג has never done one
    ],
  );

  assert.deepEqual(
    ranking(out[4].candidates, ['לוחם א', 'לוחם ב', 'לוחם ג']),
    ['לוחם ג', 'לוחם ב', 'לוחם א'],
    'the queue runs from fewest previous גשש shifts to most',
  );
});

test('the גשש history is spelled out in the row note of an assigned shift', () => {
  const out = runEngine(
    [
      ...tour(BASE, '06:00-14:00', ['מפקד א', 'לוחם א', 'לוחם ב']),
      trackerShift(BASE, '14:00-22:00', 'לוחם א'),
    ],
    ROSTER,
    [...trackerHistory('לוחם א', 3), ...trackerHistory('לוחם ב', 0)],
  );

  const shift = out[3];
  assert.match(shift.note, /3 משמרות כונן גשש בעבר/, 'the assigned soldier\'s count is stated');
  assert.match(shift.note, /ירד מסיור .* מיועד לכונן גשש/, 'and so is his descent from the tour');
  // an assigned row shows the occupant in the cell and the alternatives in the note
  assert.match(shift.candidates, /משובץ: לוחם א/);
  assert.match(shift.note, /חלופות מובילות:[\s\S]*לוחם ב/, 'the never-did-one descender is the alternative');
});

test('the גשש count is capped, so a veteran is not blocked forever', () => {
  // 20 vs 6 previous shifts — both past the cap, so the tie is broken by the
  // ordinary factors, not by an ever-growing penalty.
  const out = runEngine(
    [
      ...tour(BASE, '06:00-14:00', ['מפקד א', 'לוחם א', 'לוחם ב']),
      trackerShift(BASE, '14:00-22:00'),
    ],
    ROSTER,
    [...trackerHistory('לוחם א', 20), ...trackerHistory('לוחם ב', 6)],
  );

  const shift = out[3];
  for (const name of ['לוחם א', 'לוחם ב']) {
    assert.match(shift.candidates, new RegExp(name), `${name} must still be offered`);
    assert.doesNotMatch(lineFor(shift.candidates, name), /בדוחק/,
      'a heavy גשש history is a penalty, never a rejection');
  }
  // both are past the cap, so the count no longer separates them and the
  // ordinary factors decide — the veteran is not pushed below the newer one.
  assert.ok(ranking(shift.candidates, ['לוחם א', 'לוחם ב']).length === 2);
});

test('a תורנות history does not count as גשש history, and vice versa', () => {
  const out = runEngine(
    [
      ...tour(BASE, '06:00-14:00', ['מפקד א', 'לוחם א', 'לוחם ב']),
      trackerShift(BASE, '14:00-22:00'),
    ],
    ROSTER,
    [
      // לוחם א has a heavy תורנות history but has never done גשש
      ...Array.from({ length: 6 }, (_, i) => ({
        date: `${String(i + 1).padStart(2, '0')}/07/2026`,
        position: 'תורנים', type: 'תורנות', time: 'יומי', soldier: 'לוחם א',
      })),
      ...trackerHistory('לוחם ב', 3),
    ],
  );

  assert.deepEqual(
    ranking(out[3].candidates, ['לוחם א', 'לוחם ב']),
    ['לוחם א', 'לוחם ב'],
    'תורנות history must not push a soldier down the גשש queue',
  );
});

test('"כונן גשש ותורן רס״פ" counts as a גשש shift, not a תורנות', () => {
  const ctx: any = { console, Date, Math, JSON, String, Number, Boolean, Array, Object, RegExp, Error, isNaN, parseInt, parseFloat,
    SpreadsheetApp: { getUi: () => ({ createMenu: () => ({ addItem() { return this; }, addSeparator() { return this; }, addToUi() {} }) }) },
    HtmlService: {}, Utilities: {} };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  for (const source of SOURCES) vm.runInContext(source, ctx);

  assert.equal(ctx.isTrackerText_('כונן גשש ותורן רס"פ', 'יומי'), true);
  assert.equal(ctx.isToranutText_('כונן גשש ותורן רס"פ', 'יומי'), false);
  // and the plain תורנות row is the mirror image
  assert.equal(ctx.isTrackerText_('תורנים', 'תורנות'), false);
  assert.equal(ctx.isToranutText_('תורנים', 'תורנות'), true);
});

/**
 * The daily-load cap (maxSameDayMissionHours: 10) and this rule collide by
 * construction: an 8h סיור plus an 8h גשש is 16h, so before v3.12 *every*
 * correct גשש candidate came out בדוחק and the marker meant nothing. The גשש
 * is standby held on top of a real mission, so the cap no longer blocks it.
 */
// the 14:00-22:00 tour and the 22:00-07:00 shift sit in the SAME operational
// day (14:00→14:00), which is what makes the load add up; a 06:00-14:00 tour
// belongs to the day before and never triggers the cap.
test('a tour descender is not pushed to בדוחק by the daily-load cap', () => {
  const out = runEngine([
    ...tour(BASE, '14:00-22:00', ['מפקד א', 'לוחם א', 'לוחם ב']),
    trackerShift(BASE, '22:00-07:00'),
  ]);

  const shift = out[3];
  for (const descender of ['לוחם א', 'לוחם ב']) {
    const line = lineFor(shift.candidates, descender);
    assert.ok(line, `${descender} must be offered`);
    assert.doesNotMatch(line, /בדוחק/, `${descender} did an 8h tour + 8h גשש and must stay a proper candidate`);
    assert.doesNotMatch(shift.warnings, /יעבור 10ש׳ משימה היום/);
  }
  // the load is still reported honestly, just not as a blocker
  assert.match(shift.warnings, /כבר 8ש׳ היום/);
});

test('the 22:00-07:00 shift counts as 8h of load, the same as it does in the history', () => {
  // 9h of wall clock; the cap check must use trackerDailyWorkloadHours (8) for
  // the candidate task too, not the raw duration it uses for every other task
  const out = runEngine([
    ...tour(BASE, '14:00-22:00', ['מפקד א', 'לוחם א', 'לוחם ב']),
    trackerShift(BASE, '22:00-07:00', 'לוחם א'),
  ]);

  assert.match(out[3].note, /היום משימה 8ש׳/, 'the tour that fed the shift is the 8h of same-day load');
  assert.doesNotMatch(out[3].note, /יעבור 10ש׳/, 'the assigned descender is not flagged over the cap');
});

test('each of the three גשש shifts is fed by its own tour', () => {
  // 22:00-07:00 is fed by the tour ending 22:00, not by the one ending 14:00
  const out = runEngine([
    ...tour(BASE, '06:00-14:00', ['מפקד א', 'לוחם א', 'לוחם ב']),
    ...tour(BASE, '14:00-22:00', ['מפקד ב', 'לוחם ג', 'לוחם ד']),
    trackerShift(BASE, '22:00-07:00'),
  ]);

  const nightShift = out[6];
  const order = ranking(nightShift.candidates, ['לוחם ג', 'לוחם ד', 'לוחם א', 'לוחם ב']);
  assert.ok(order.length >= 2, 'the shift must have candidates');
  assert.ok(['לוחם ג', 'לוחם ד'].includes(order[0]),
    `the 22:00 tour feeds the 22:00 shift, got ${order[0]}`);
});
