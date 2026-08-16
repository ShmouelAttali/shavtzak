/** Yield of the NEW v3.17 validators over the last 14 op days of real data:
 *  validateDailyMissionExclusivity_ (per op day), listed error by error. */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { GoogleAuth } from 'google-auth-library';

const REPO = path.resolve(import.meta.dirname);
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

const ctx: any = {
  console, Date, Math, JSON, String, Number, Array, Object, Map, Set, isNaN, parseInt, parseFloat, RegExp, Error,
  SpreadsheetApp: { getUi: () => ({ createMenu: () => ({ addItem() { return this; }, addSeparator() { return this; }, addToUi() {} }) }) },
  HtmlService: {},
};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(OPS, 'utf8') + '\n;globalThis.CONFIG = CONFIG;\n', ctx);

const credentials = JSON.parse(Buffer.from(process.env.GOOGLE_SERVICE_ACCOUNT_KEY!, 'base64').toString('utf8'));
const auth = new GoogleAuth({ credentials, scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] });
const token = (await (await auth.getClient()).getAccessToken()).token!;
const url = `https://sheets.googleapis.com/v4/spreadsheets/${process.env.GOOGLE_SHEET_ID}/values/${encodeURIComponent(TAB)}?majorDimension=ROWS`;
const values: string[][] = (await (await fetch(url, { headers: { Authorization: `Bearer ${token}` } })).json()).values ?? [];

const header = values[0].map((c) => String(c ?? '').trim());
const col = { date: header.indexOf('תאריך'), position: header.indexOf('העמדה'), type: header.indexOf('סוג'), time: header.indexOf('השעה'), soldier: header.indexOf('החייל') };

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

const opDays = [...new Set(rows.map((r) => opDayOf(r).getTime()))].sort((a, b) => a - b).slice(-14).map((t) => new Date(t));
let total = 0;
for (const day of opDays) {
  const target = rows.filter((r) => ctx.sameDate_(opDayOf(r), day));
  if (!target.length) continue;
  const parsed = ctx.buildParsedShifts_(target, [], [], 'target');
  const errors: string[] = [];
  ctx.validateDailyMissionExclusivity_(parsed, errors);
  total += errors.length;
  if (errors.length) {
    console.log(label(day));
    for (const e of errors) console.log('   ', e);
  }
}
console.log(`TOTAL exclusivity errors over ${opDays.length} op days: ${total}`);
