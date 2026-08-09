/**
 * Diff what the recommendations engine WOULD write to "שבצק", before and after
 * your change, against the live sheet — outside Apps Script, no writes.
 *
 *   npx tsx apps-script/tools/ab-recommendations.mts                 # HEAD vs working tree
 *   npx tsx apps-script/tools/ab-recommendations.mts --base main
 *   npx tsx apps-script/tools/ab-recommendations.mts --only סיור     # report only matching rows
 *   npx tsx apps-script/tools/ab-recommendations.mts --full          # don't truncate cell text
 *
 * Why this exists: a push to Apps Script is a live deploy for the whole company
 * (see the sheet-apps-script skill), and the engine is ~2.5k lines of scoring
 * where a one-line change can silently reorder every candidate list. This runs
 * both versions over the SAME live snapshot and prints the cells that differ,
 * so "6 cells changed, all in the התקפי block" is a fact rather than a hope.
 *
 * ⚠ The sheet moves. It is rebuilt for the next day constantly, and a block you
 * are testing can be empty by the time you run this — which yields "0 cells
 * changed" that reads like "no regression" but means "nothing was compared".
 * That is why coverage is printed first and an empty comparison is a FAILURE,
 * not a pass. Inject a lineup into the empty block if you need to test one.
 *
 * Reads the sheet with the same service account as the api/ handlers, via
 * GOOGLE_SERVICE_ACCOUNT_KEY + GOOGLE_SHEET_ID in .env / .env.local.
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import { GoogleAuth } from 'google-auth-library';

const REPO = path.resolve(import.meta.dirname, '../..');
const FILES = ['ShabtzakOps.js', 'ShavtzakRecommendation.js']; // filename order = Apps Script load order
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
const flag = (name: string) => {
  const i = argv.indexOf(name);
  return i === -1 ? null : (argv[i + 1] ?? '');
};
const BASE = flag('--base') ?? 'HEAD';
const ONLY = flag('--only');
const FULL = argv.includes('--full');
const WIDTH = FULL ? 100000 : 150;

/* ---------------------------------------------------------------- the sheet */

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

/** Runs one version of the engine over the snapshot; returns its biggest values write. */
function run(sources: string[]): { body: Write; ms: number } {
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
  // both files, in load order — they share one global scope in Apps Script and
  // the engine calls helpers that live in ShabtzakOps.js
  for (const src of sources) vm.runInContext(src, ctx);

  const t0 = Date.now();
  vm.runInContext('updateShabtzakRecommendations()', ctx);
  const ms = Date.now() - t0;

  const bodies = writes.filter((w) => w.kind === 'values');
  if (!bodies.length) throw new Error('the engine wrote nothing');
  return { body: bodies.reduce((b, w) => (w.values.length > b.values.length ? w : b)), ms };
}

const working = FILES.map((f) => fs.readFileSync(path.join(REPO, 'apps-script/plugat-gaash', f), 'utf8'));
const base = FILES.map((f) =>
  execFileSync('git', ['show', `${BASE}:apps-script/plugat-gaash/${f}`], { cwd: REPO, encoding: 'utf8', maxBuffer: 32 << 20 }));

/* ------------------------------------------------------------- coverage */

const tasks = snapshot['שבצק'];
const rowInfo = (sheetRow: number) => {
  const r = tasks[sheetRow - 1] ?? [];
  return { date: r[7] ?? '', position: r[8] ?? '', type: r[9] ?? '', time: r[10] ?? '', soldier: r[11] ?? '' };
};

const taskRows = tasks
  .map((_, i) => i + 1)
  .filter((n) => n >= 4 && (rowInfo(n).position || rowInfo(n).type));
const assignedRows = taskRows.filter((n) => rowInfo(n).soldier);

console.log(`base ${BASE}  |  שבצק E1 = ${tasks[0]?.[4] ?? '?'}`);
console.log(`coverage: ${taskRows.length} task rows, ${assignedRows.length} assigned, ${taskRows.length - assignedRows.length} open`);
if (ONLY) {
  const matching = taskRows.filter((n) => (rowInfo(n).position + ' ' + rowInfo(n).type).includes(ONLY));
  console.log(`          --only "${ONLY}" matches ${matching.length} rows`);
  if (!matching.length) {
    console.error(`\nFAIL: no rows match --only "${ONLY}" — the block is empty or renamed, nothing would be compared.`);
    process.exit(2);
  }
}
if (!taskRows.length) {
  console.error('\nFAIL: the שבצק task block is empty — there is nothing to compare.');
  process.exit(2);
}

/* ------------------------------------------------------------------ diff */

const a = run(base);
const b = run(working);
console.log(`ran base in ${a.ms}ms, working tree in ${b.ms}ms\n`);

if (a.body.row !== b.body.row || a.body.col !== b.body.col) {
  console.log(`NOTE: output block moved — base ${colToLetter(a.body.col)}${a.body.row}, ` +
    `working ${colToLetter(b.body.col)}${b.body.row} (expected if you changed the layout)\n`);
}

const COLUMNS = ['מועמדים', 'משימה קודמת', 'מנוחה', 'עומס', 'התאמה/אזהרות', 'סטטוס צוות'];
const clip = (s: string) => (s.length > WIDTH ? s.slice(0, WIDTH) + '…' : s);

let changed = 0;
let reported = 0;
for (let r = 0; r < Math.max(a.body.values.length, b.body.values.length); r++) {
  const sheetRow = b.body.row + r;
  const info = rowInfo(sheetRow);
  const ra = a.body.values[r] ?? [];
  const rb = b.body.values[r] ?? [];

  for (let c = 0; c < Math.max(ra.length, rb.length); c++) {
    const before = String(ra[c] ?? '');
    const after = String(rb[c] ?? '');
    if (before === after) continue;
    changed++;
    if (ONLY && !(info.position + ' ' + info.type).includes(ONLY)) continue;
    reported++;
    console.log(`row ${sheetRow} [${COLUMNS[c] ?? `col+${c}`}]  ${info.position} ${info.time}`);
    console.log(`  base: ${JSON.stringify(clip(before))}`);
    console.log(`  new : ${JSON.stringify(clip(after))}\n`);
  }
}

console.log(ONLY
  ? `${changed} cells changed in total, ${reported} of them in rows matching "${ONLY}"`
  : `${changed} cells changed`);
