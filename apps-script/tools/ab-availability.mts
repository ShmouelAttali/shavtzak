/**
 * A/B the *availability* validator (ShabtzakOps.js) over the live sheet:
 * HEAD vs the working tree, one operational day at a time.
 *
 *   npx tsx apps-script/tools/ab-availability.mts             # last 14 op days
 *   npx tsx apps-script/tools/ab-availability.mts --last 30
 *   npx tsx apps-script/tools/ab-availability.mts --base <ref>
 *   npx tsx apps-script/tools/ab-availability.mts --unassigned   # only "זמין בלי משימה"
 *
 * Why this exists: offline-validate.mts covers rest / overlaps / daily hours,
 * but never ran validateAvailabilityAndMissingAssignments_ — it has no roster —
 * so any change to "who is available when" shipped unmeasured. The v3.11 lesson
 * (184 over-8h errors, 135 of them false) applies double here: an availability
 * rule that fires wrongly floods the officer's dialog with noise he will learn
 * to ignore.
 *
 * Prints only the errors that appear or disappear, so "3 gone, 1 new, all four
 * about the same two soldiers" becomes a fact you can paste into a commit.
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
const REL = 'apps-script/plugat-gaash/ShabtzakOps.js';
const SCHEDULE_TAB = 'כל השבצק';
const ROSTER_TAB = 'מצבת החיילים';

const argv = process.argv.slice(2);
const flag = (name: string, fallback: string) => {
  const i = argv.indexOf(name);
  return i === -1 ? fallback : argv[i + 1];
};
const BASE = flag('--base', 'HEAD');
const LAST = Number(flag('--last', '14'));
const UNASSIGNED = argv.indexOf('--unassigned') !== -1;

for (const f of ['.env', '.env.local']) {
  const p = path.join(REPO, f);
  if (!fs.existsSync(p)) continue;
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
if (!process.env.GOOGLE_SERVICE_ACCOUNT_KEY) {
  console.error('FAIL: no GOOGLE_SERVICE_ACCOUNT_KEY — in a git worktree, link the main .env in first.');
  process.exit(2);
}

/* ------------------------------------------------------------- the sheet */

const credentials = JSON.parse(Buffer.from(process.env.GOOGLE_SERVICE_ACCOUNT_KEY, 'base64').toString('utf8'));
const auth = new GoogleAuth({ credentials, scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] });
const token = (await (await auth.getClient()).getAccessToken()).token!;

async function tab(name: string): Promise<string[][]> {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${process.env.GOOGLE_SHEET_ID}/values/${encodeURIComponent(name)}?majorDimension=ROWS`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const json: any = await res.json();
  if (!json.values?.length) throw new Error(`no data in "${name}"`);
  return json.values;
}

const scheduleValues = await tab(SCHEDULE_TAB);
const rosterValues = await tab(ROSTER_TAB);

/* --------------------------------------------------------------- sandbox */

function load(source: string) {
  const ctx: any = {
    console, Date, Math, JSON, String, Number, Boolean, Array, Object, Map, Set,
    isNaN, parseInt, parseFloat, RegExp, Error,
    SpreadsheetApp: { getUi: () => ({ createMenu: () => ({ addItem() { return this; }, addSeparator() { return this; }, addToUi() {} }) }) },
    HtmlService: {},
  };
  vm.createContext(ctx);
  vm.runInContext(source + '\n;globalThis.CONFIG = CONFIG;\n', ctx);
  return ctx;
}

const working = load(fs.readFileSync(path.join(REPO, REL), 'utf8'));
const base = load(execFileSync('git', ['show', `${BASE}:${REL}`], { cwd: REPO, encoding: 'utf8', maxBuffer: 32 << 20 }));

// the roster is read through a sheet object; only these two methods are used
const rosterSheet = {
  getName: () => ROSTER_TAB,
  getDataRange: () => ({ getValues: () => rosterValues }),
};

/* ------------------------------------------------------- schedule rows */

const header = scheduleValues[0].map((c) => String(c ?? '').trim());
const col = {
  date: header.indexOf('תאריך'),
  position: header.indexOf('העמדה'),
  type: header.indexOf('סוג'),
  time: header.indexOf('השעה'),
  soldier: header.indexOf('החייל'),
};
if (Object.values(col).some((i) => i < 0)) throw new Error(`unexpected header: ${header.join(',')}`);

let carried: Date | null = null;
const rows = scheduleValues.slice(1).flatMap((r, i) => {
  const cell = String(r[col.date] ?? '').trim();
  if (cell) {
    const [d, m, y] = cell.split('/').map(Number);
    if (y) carried = new Date(y, m - 1, d);
  }
  const soldier = String(r[col.soldier] ?? '').trim();
  const timeText = String(r[col.time] ?? '').trim();
  if (!carried || (!soldier && !timeText)) return [];
  return [{
    rowNumber: i + 2, date: carried, timeText, soldier,
    position: String(r[col.position] ?? '').trim(),
    type: String(r[col.type] ?? '').trim(),
  }];
});

const DAY_START = working.CONFIG.OPERATIONAL_DAY_START_HOUR * 60;
const opDayOf = (r: any) => {
  const t = working.parseShiftTime_(r, [], 'x');
  return working.operationalDayOfDateTime_(r.date, t.hasRealTimeRange ? t.startMin % 1440 : DAY_START);
};
const label = (d: Date) =>
  `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;

const opDays = [...new Set(rows.map((r) => opDayOf(r).getTime()))]
  .sort((a, b) => a - b)
  .slice(-LAST)
  .map((t) => new Date(t));

if (!opDays.length) {
  console.error('FAIL: no operational days found in the schedule tab — nothing to compare.');
  process.exit(2);
}

/* ------------------------------------------------------------------ run */

/** the availability errors one version produces for one operational day */
function errorsFor(ctx: any, opDay: Date): string[] {
  const target = rows.filter((r) => ctx.sameDate_(opDayOf(r), opDay));
  if (!target.length) return [];
  const parsed = ctx.buildParsedShifts_(target, [], [], 'target');
  const rosterErrors: string[] = [];
  const roster = ctx.readRoster_(rosterSheet, opDay, rosterErrors);
  if (!roster.soldiers.size) return [`(roster unreadable: ${rosterErrors.join('; ') || 'empty'})`];

  const errors: string[] = [];
  ctx.validateAvailabilityAndMissingAssignments_(parsed, roster, errors, []);
  // The "marked available but unassigned" alert is a different rule and is
  // noisy by nature, so by default it is excluded — an availability change is
  // not about it. --unassigned inverts that and measures *only* that rule,
  // which is the only way to A/B a change to it: with the default filter the
  // comparison silently reports "0 changed" no matter what you did.
  return UNASSIGNED
    ? errors.filter((e) => e.indexOf('בלי משימה') !== -1)
    : errors.filter((e) => e.indexOf('בלי משימה') === -1);
}

console.log(`base ${BASE}  |  ${opDays.length} operational days, ${label(opDays[0])} → ${label(opDays[opDays.length - 1])}`);
console.log(`coverage: ${rows.length} schedule rows, ${rosterValues.length} roster rows\n`);

let gone = 0, added = 0, unchanged = 0;
for (const day of opDays) {
  const a = errorsFor(base, day);
  const b = errorsFor(working, day);
  const inA = new Set(a), inB = new Set(b);
  const removed = a.filter((e) => !inB.has(e));
  const fresh = b.filter((e) => !inA.has(e));
  unchanged += a.filter((e) => inB.has(e)).length;
  if (!removed.length && !fresh.length) continue;

  gone += removed.length;
  added += fresh.length;
  console.log(`${label(day)}  (${a.length} → ${b.length})`);
  removed.forEach((e) => console.log(`  − ${e}`));
  fresh.forEach((e) => console.log(`  + ${e}`));
  console.log();
}

console.log(`${gone} errors gone, ${added} new, ${unchanged} unchanged across ${opDays.length} op days`);
if (!gone && !added) {
  console.log('\n⚠ nothing changed. Either the rule does not bite on this data, or the days that');
  console.log('  would exercise it are not in the window — check before concluding "no regression".');
}
