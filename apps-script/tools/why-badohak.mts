/**
 * Explain every "(בדוחק)" the engine would write to "שבצק" right now.
 *
 *   npx tsx apps-script/tools/why-badohak.mts              # rendered candidates only
 *   npx tsx apps-script/tools/why-badohak.mts --all        # every fallback verdict, rendered or not
 *   npx tsx apps-script/tools/why-badohak.mts --only סיור
 *
 * Why this exists: the cell shows the marker but not the reason. The reasons
 * live in the row's note, and for an unassigned row the note only details the
 * leaders — so a candidate can come out "(בדוחק)" with nothing on screen
 * explaining it. Four different rules produce the same marker:
 *
 *   1. rest BEFORE the slot          — visible: the מנוחה column
 *   2. rest AFTER  the slot          — invisible: depends on his NEXT assignment
 *   3. the daily mission-hours cap   — invisible: depends on his whole day
 *   4. כונן גשש not a tour descender — invisible unless you know the rule
 *
 * (2) and (3) are the confusing ones: a soldier with 16 hours of rest behind him
 * can still be marked, because the rule that fired was about what comes after.
 *
 * Reads the sheet with the same service account as the api/ handlers, via
 * GOOGLE_SERVICE_ACCOUNT_KEY + GOOGLE_SHEET_ID in .env / .env.local.
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { GoogleAuth } from 'google-auth-library';

const REPO = path.resolve(import.meta.dirname, '../..');
const FILES = ['ShabtzakOps.js', 'ShavtzakRecommendation.js'];
const TABS = ['שבצק', 'מצבת החיילים', 'כל השבצק'];

for (const f of ['.env', '.env.local']) {
  const p = path.join(REPO, f);
  if (!fs.existsSync(p)) continue;
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const argv = process.argv.slice(2);
const ALL = argv.includes('--all');
const ONLY = argv.includes('--only') ? argv[argv.indexOf('--only') + 1] : null;

const credentials = JSON.parse(Buffer.from(process.env.GOOGLE_SERVICE_ACCOUNT_KEY!, 'base64').toString('utf8'));
const auth = new GoogleAuth({ credentials, scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] });
const token = (await (await auth.getClient()).getAccessToken()).token!;

async function fetchTab(title: string): Promise<string[][]> {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${process.env.GOOGLE_SHEET_ID}` +
    `/values/${encodeURIComponent(title)}?majorDimension=ROWS`;
  const rows: string[][] = (await (await fetch(url, { headers: { Authorization: `Bearer ${token}` } })).json()).values ?? [];
  if (!rows.length) throw new Error(`no data in "${title}"`);
  const w = rows.reduce((m, r) => Math.max(m, r.length), 0);
  return rows.map((r) => { const a = [...r]; while (a.length < w) a.push(''); return a; });
}

const snapshot: Record<string, string[][]> = {};
for (const t of TABS) snapshot[t] = await fetchTab(t);

/* ------------------------------------------------- a fake SpreadsheetApp */

const colToLetter = (n: number) => { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = (n - m - 1) / 26; } return s; };
const a1ToRC = (a1: string) => {
  const m = a1.match(/^([A-Z]+)(\d+)$/)!;
  let col = 0;
  for (const ch of m[1]) col = col * 26 + (ch.charCodeAt(0) - 64);
  return { row: Number(m[2]), col };
};

type Write = { kind: string; row: number; col: number; values: any[][] };
const writes: Write[] = [];

const makeSheet = (name: string) => {
  const grid = snapshot[name];
  const mk = (row: number, col: number, nR: number, nC: number) => {
    const self: any = {
      getValues: () => Array.from({ length: nR }, (_, r) =>
        Array.from({ length: nC }, (_, c) => grid[row - 1 + r]?.[col - 1 + c] ?? '')),
      getValue: () => grid[row - 1]?.[col - 1] ?? '',
      getA1Notation: () => `${colToLetter(col)}${row}`,
      setValues: (v: any[][]) => { writes.push({ kind: 'values', row, col, values: v }); return self; },
      setNotes: (v: any[][]) => { writes.push({ kind: 'notes', row, col, values: v }); return self; },
      setBackgrounds: (v: any[][]) => { writes.push({ kind: 'backgrounds', row, col, values: v }); return self; },
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
for (const t of TABS) sheets[t] = makeSheet(t);
const props: Record<string, string> = {};

const ctx: any = {
  console, Date, Math, JSON, String, Number, Boolean, Array, Object, Map, Set,
  isNaN, parseInt, parseFloat, RegExp, Error,
  SpreadsheetApp: {
    getActiveSpreadsheet: () => ({ getSheetByName: (n: string) => sheets[n] ?? null, toast: () => {} }),
    getUi: () => { throw new Error('no UI in the harness'); },
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
for (const f of FILES) vm.runInContext(fs.readFileSync(path.join(REPO, 'apps-script/plugat-gaash', f), 'utf8'), ctx);

/* ---- capture every fallback verdict, with the numbers behind it ---- */

vm.runInContext(`
  globalThis.__falls = [];
  const __origEval = evaluateCandidateForTask_;
  evaluateCandidateForTask_ = function(soldier, task, context) {
    const r = __origEval(soldier, task, context);
    if (r && r.fallback) {
      const prev = r.previousAssignment;
      __falls.push({
        row: task.rowNumber,
        position: task.position,
        type: task.type,
        time: task.timeValue || task.timeText || '',
        soldier: soldier.name,
        reason: r.fallbackReason || '',
        restBefore: r.restBeforeHours,
        restAfter: r.restAfterHours,
        sameDay: r.sameDayMissionHours,
        prevText: prev ? (prev.position + ' ' + (prev.timeValue || prev.timeText || '')) : '',
      });
    }
    return r;
  };
`, ctx);

vm.runInContext('updateShabtzakRecommendations()', ctx);

const falls: any[] = vm.runInContext('__falls', ctx);

/* ---- which of them the officer actually SEES in the written cells ---- */

const body = writes.filter((w) => w.kind === 'values').reduce((b, w) => (w.values.length > b.values.length ? w : b));
const rendered = new Map<string, true>();       // "row|name"
const renderedRows = new Map<number, string[]>();
body.values.forEach((rowVals, i) => {
  const sheetRow = body.row + i;
  const text = rowVals.map((v) => String(v ?? '')).join('\n');
  // the marker carries a short reason since v3.19: "(בדוחק: עומס 16ש׳)"
  for (const m of text.matchAll(/(?:^|\n)\s*\d+\.\s*([^\n(]+?)\s*\(בדוחק[^)]*\)/g)) {
    const name = m[1].trim();
    rendered.set(`${sheetRow}|${name}`, true);
    if (!renderedRows.has(sheetRow)) renderedRows.set(sheetRow, []);
    renderedRows.get(sheetRow)!.push(name);
  }
});

const match = (f: any) => !ONLY || (f.position + ' ' + f.type).includes(ONLY);
const shown = falls.filter((f) => match(f) && (ALL || rendered.has(`${f.row}|${f.soldier}`)));

/* ------------------------------------------------------------- report */

const kind = (reason: string) => {
  if (reason.startsWith('אחר כך')) return 'rest AFTER the slot   (invisible — his NEXT assignment)';
  if (reason.includes('כונן גשש שמור')) return 'כונן גשש: not a tour descender';
  if (reason.includes('משימה היום')) return 'daily mission-hours cap (invisible — his whole day)';
  return 'rest BEFORE the slot  (visible — the מנוחה column)';
};

console.log(`שבצק E1 = ${snapshot['שבצק'][0]?.[4] ?? '?'}`);
console.log(`${falls.length} fallback verdicts in total, ${rendered.size} of them actually rendered as "(בדוחק)"${ONLY ? ` — filtered to "${ONLY}"` : ''}\n`);

const byKind = new Map<string, any[]>();
for (const f of shown) {
  const k = kind(f.reason);
  if (!byKind.has(k)) byKind.set(k, []);
  byKind.get(k)!.push(f);
}

for (const [k, list] of [...byKind.entries()].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`\n### ${k} — ${list.length}`);
  for (const f of list.slice(0, 12)) {
    const rb = f.restBefore == null ? '?' : `${f.restBefore}ש׳`;
    const ra = f.restAfter == null ? '?' : `${f.restAfter}ש׳`;
    console.log(`  שורה ${f.row}  ${f.position} ${f.time}  |  ${f.soldier}`);
    console.log(`      ${f.reason}`);
    console.log(`      מנוחה לפני ${rb} · מנוחה אחרי ${ra} · שעות משימה היום ${f.sameDay ?? '?'}${f.prevText ? ` · קודם: ${f.prevText}` : ''}`);
  }
  if (list.length > 12) console.log(`  … ${list.length - 12} more`);
}

if (!shown.length) {
  console.log('\nNothing rendered as (בדוחק) right now. Re-run with --all to see suppressed verdicts,');
  console.log('or check that the block you care about is populated — the sheet is rebuilt daily.');
}
