/**
 * Run the sheet's own validators (ShabtzakOps.js) against the live "כל השבצק",
 * outside Apps Script — no menu click, no spreadsheet, no writes.
 *
 *   npx tsx apps-script/tools/offline-validate.mts 11/08/2026      # one op day, detailed
 *   npx tsx apps-script/tools/offline-validate.mts --last 14       # last N op days + attribution
 *
 * Why this exists: when validation output looks like noise, the question is
 * always "is the sheet wrong, or is the script out of step with how the sheet is
 * written today?". This answers it with numbers — it blames each error on the
 * time spelling that produced it, so a format drift shows up as one spelling
 * dominating the list. That is how the v3.11 daily-mission bug was found (184
 * over-8h errors across 13 days, 135 of them false).
 *
 * Reads the sheet with the same service account as the api/ handlers, via
 * GOOGLE_SERVICE_ACCOUNT_KEY + GOOGLE_SHEET_ID in .env / .env.local.
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { GoogleAuth } from 'google-auth-library';

const REPO = path.resolve(import.meta.dirname, '../..');
const OPS = path.join(REPO, 'apps-script/plugat-gaash/ShabtzakOps.js');
const TAB = 'כל השבצק';

for (const f of ['.env', '.env.local']) {
  const p = path.join(REPO, f);
  if (!fs.existsSync(p)) continue;
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

// --- load the Apps Script into a sandbox with the Google globals stubbed
const ctx: any = {
  console, Date, Math, JSON, String, Number, Array, Object, Map, Set, isNaN, parseInt, parseFloat, RegExp, Error,
  SpreadsheetApp: { getUi: () => ({ createMenu: () => ({ addItem() { return this; }, addSeparator() { return this; }, addToUi() {} }) }) },
  HtmlService: {},
};
vm.createContext(ctx);
// top-level `const CONFIG` lives in script scope, not on the vm global
vm.runInContext(fs.readFileSync(OPS, 'utf8') + '\n;globalThis.CONFIG = CONFIG;\n', ctx);

// --- pull the tab
const credentials = JSON.parse(Buffer.from(process.env.GOOGLE_SERVICE_ACCOUNT_KEY!, 'base64').toString('utf8'));
const auth = new GoogleAuth({ credentials, scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] });
const token = (await (await auth.getClient()).getAccessToken()).token!;
const url = `https://sheets.googleapis.com/v4/spreadsheets/${process.env.GOOGLE_SHEET_ID}/values/${encodeURIComponent(TAB)}?majorDimension=ROWS`;
const values: string[][] = (await (await fetch(url, { headers: { Authorization: `Bearer ${token}` } })).json()).values ?? [];
if (!values.length) throw new Error(`no data in "${TAB}"`);

const header = values[0].map((c) => String(c ?? '').trim());
const col = { date: header.indexOf('תאריך'), position: header.indexOf('העמדה'), type: header.indexOf('סוג'), time: header.indexOf('השעה'), soldier: header.indexOf('החייל') };
if (Object.values(col).some((i) => i < 0)) throw new Error(`unexpected header: ${header.join(',')}`);

let carried: Date | null = null;
const rows = values.slice(1).flatMap((r, i) => {
  const cell = String(r[col.date] ?? '').trim();
  if (cell) {
    const [d, m, y] = cell.split('/').map(Number);
    if (y) carried = new Date(y, m - 1, d);
  }
  const soldier = String(r[col.soldier] ?? '').trim();
  const timeText = String(r[col.time] ?? '').trim();
  if (!carried || (!soldier && !timeText)) return [];
  return [{ rowNumber: i + 2, date: carried, position: String(r[col.position] ?? '').trim(), type: String(r[col.type] ?? '').trim(), timeText, soldier }];
});

const DAY_START = ctx.CONFIG.OPERATIONAL_DAY_START_HOUR * 60;
const opDayOf = (r: any) => {
  const t = ctx.parseShiftTime_(r, [], 'x');
  return ctx.operationalDayOfDateTime_(r.date, t.hasRealTimeRange ? t.startMin % 1440 : DAY_START);
};
const label = (d: Date) => `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;

function runDay(opDay: Date) {
  const target = rows.filter((r) => ctx.sameDate_(opDayOf(r), opDay));
  if (!target.length) return null;
  const prev = rows.filter((r) => ctx.sameDate_(opDayOf(r), new Date(opDay.getFullYear(), opDay.getMonth(), opDay.getDate() - 1)));
  const warnings: string[] = [];
  const parsed = ctx.buildParsedShifts_(target, [], warnings, 'target');
  const parsedPrev = ctx.buildParsedShifts_(prev, [], [], 'prev');
  const overlaps: string[] = []; ctx.validateOverlaps_(parsed, overlaps);
  const hours: string[] = []; const hourWarn: string[] = []; ctx.validateDailyHours_(parsed, null, hours, hourWarn);
  const rest: string[] = []; ctx.validateRestBetweenShifts_(parsed, parsedPrev, rest);
  return { rows: target.length, parsed, overlaps, hours, hourWarn, rest, warnings };
}

const arg = process.argv[2];

if (arg === '--last') {
  const n = Number(process.argv[3] || 14);
  const opDays = [...new Set(rows.map((r) => opDayOf(r).getTime()))].sort((a, b) => a - b).slice(-n).map((t) => new Date(t));
  const blame = new Map<string, number>();
  let totals = { overlaps: 0, hours: 0, rest: 0, warnings: 0 };
  for (const day of opDays) {
    const res = runDay(day);
    if (!res) continue;
    totals.overlaps += res.overlaps.length; totals.hours += res.hours.length;
    totals.rest += res.rest.length; totals.warnings += res.warnings.length;
    console.log(`${label(day)}  rows ${String(res.rows).padStart(3)}   over-8h ${String(res.hours.length).padStart(3)}   overlaps ${String(res.overlaps.length).padStart(3)}   rest ${String(res.rest.length).padStart(2)}   parse-warn ${res.warnings.length}`);
    // blame the longest shift of every soldier who breaks the cap
    const by = new Map<string, any[]>();
    res.parsed.filter((s: any) => !s.isCarmel && !s.isTracker && !ctx.shouldIgnoreSoldier_(s.soldier))
      .forEach((s: any) => { if (!by.has(s.soldier)) by.set(s.soldier, []); by.get(s.soldier)!.push(s); });
    by.forEach((shifts) => {
      if (shifts.reduce((a, s) => a + (s.hoursForDailyTotal || 0), 0) <= ctx.CONFIG.MAX_DAILY_HOURS) return;
      const worst = shifts.slice().sort((a, b) => b.hoursForDailyTotal - a.hoursForDailyTotal)[0];
      const k = `${worst.timeText}  (${worst.type} | ${worst.position})`;
      blame.set(k, (blame.get(k) || 0) + 1);
    });
  }
  console.log(`\nTOTAL over ${opDays.length} op days:  over-8h ${totals.hours}   overlaps ${totals.overlaps}   rest ${totals.rest}   parse-warnings ${totals.warnings}`);
  console.log('\nover-8h errors blamed on the longest shift (top 12) — one spelling dominating means format drift, not a bad schedule:');
  [...blame.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).forEach(([k, v]) => console.log(`  ${String(v).padStart(4)}  ${k}`));
} else {
  const [dd, mm, yy] = (arg || label(new Date())).split('/').map(Number);
  const res = runDay(new Date(yy, mm - 1, dd));
  if (!res) { console.log(`no rows for op day ${arg}`); process.exit(0); }
  console.log(`op day ${arg}: ${res.rows} rows, ${res.parsed.length} parsed\n`);
  const show = (t: string, a: string[]) => { console.log(`--- ${t} (${a.length}) ---`); a.forEach((x) => console.log('   ' + x)); console.log(); };
  show('over 8 hours', res.hours);
  show('overlaps', res.overlaps);
  show('rest', res.rest);
  show('parse warnings', res.warnings);
}
