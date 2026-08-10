import type { VercelRequest, VercelResponse } from '@vercel/node';
import { GoogleAuth } from 'google-auth-library';

const SHEET_ID =
  process.env.GOOGLE_SHEET_ID ||
  '1FCuaQsOvDzrHcVhlYy49Mr5p6gTyTjEF1GqnW5frXDg';

const SHEET_NAME = 'כל השבצק';

// ── חמל ────────────────────────────────────────────────────────────────────
// חמל is not part of the שבצק. That crew runs its own rotation, planned in its
// own tab, and `כל השבצק`'s חמל rows are only a hand-copied echo of it — which
// drifts: on 2026-08-10 the two disagreed on 11 of the 39 days they shared, and
// `כל השבצק` was simply blank for 30/07–03/08 and 13/08. Owner decision
// 2026-08-10: `שיבוץ חמל` is the source of truth for that group.
const HAMAL_SHEET_NAME = 'שיבוץ חמל';
const HAMAL_GROUP = 'חמל';

// Both schedule tabs spell the group `חמל`, but the roster's מחלקה for the same
// unit is `חמ"ל` — so normalize the quotes away instead of betting on one
// spelling. (A keyword that silently never matches has cost this project twice;
// see the Hebrew-keyword section of the sheet-apps-script skill.)
function isHamalLabel(v: string): boolean {
  return v.replace(/["'׳״]/g, '').trim() === HAMAL_GROUP;
}

async function getAccessToken(): Promise<string> {
  const b64 = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!b64) throw new Error('GOOGLE_SERVICE_ACCOUNT_KEY not set');
  const credentials = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
  const auth = new GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  const client = await auth.getClient();
  const token = await client.getAccessToken();
  if (!token.token) throw new Error('Failed to get access token');
  return token.token;
}

// ── Types ──────────────────────────────────────────────────────────────────
export interface TimeSlot {
  time: string;
  soldiers: string[];
}

export interface SubType {
  sug: string;
  times: TimeSlot[];
}

export interface StationGroup {
  name: string;
  subTypes: SubType[];
}

export interface ShavtzakData {
  date: string;
  groups: StationGroup[];
}

export interface ShavtzakAllData {
  dates: string[];                       // sorted available dates DD/MM/YYYY
  byDate: Record<string, ShavtzakData>;
}

// ── Helpers ────────────────────────────────────────────────────────────────
function timeToVal(t: string): number {
  if (t === 'יומי' || t === '') return 9999;
  const h = parseInt(t.split(':')[0] ?? '0');
  return h < 6 ? h + 24 : h;
}

// Matches "25/06/2026" or "1/06/2026"
const DATE_RE = /^\d{1,2}\/\d{2}\/\d{4}$/;

function dateToNum(d: string): number {
  const [dd, mm, yyyy] = d.split('/').map(Number);
  return (yyyy ?? 0) * 10000 + (mm ?? 0) * 100 + (dd ?? 0);
}

// ── חמל parser ─────────────────────────────────────────────────────────────
/**
 * `שיבוץ חמל` → date (DD/MM/YYYY) → that day's חמל shifts.
 *
 * Shape: תאריך / שעה / שם החייל, plus a שבת marker column this ignores. Shifts
 * are 10:00, 18:00 and 02:00, and every row carries its own literal calendar
 * date — the 02:00 shift, which belongs to the חמל day that began at 10:00 the
 * previous morning, is filed under the day it actually happens on, exactly like
 * every other date in this spreadsheet.
 *
 * A row needs a real date AND a name to mean anything: the tab's trailing
 * template rows carry a time and nothing else, and there is deliberately no
 * blank-date carry-forward (unlike `כל השבצק`) — with 02:00 sitting at the top
 * of its own date's block, an implied date would be a guess.
 */
export function parseHamalShifts(rows: string[][]): Map<string, TimeSlot[]> {
  const out = new Map<string, TimeSlot[]>();
  if (!rows || rows.length < 2) return out;

  let headerRow = -1;
  let colDate = -1, colTime = -1, colName = -1;

  for (let r = 0; r < Math.min(5, rows.length); r++) {
    const row = rows[r] ?? [];
    for (let c = 0; c < row.length; c++) {
      const v = (row[c] || '').trim();
      if (v === 'תאריך') colDate = c;
      if (v === 'שעה' || v === 'השעה') colTime = c;
      if (v === 'שם החייל' || v === 'החייל') colName = c;
    }
    if (colDate >= 0 && colTime >= 0 && colName >= 0) {
      headerRow = r;
      break;
    }
  }

  if (headerRow === -1) return out;

  const byDate = new Map<string, Map<string, string[]>>();

  for (let r = headerRow + 1; r < rows.length; r++) {
    const row = rows[r] ?? [];
    const date = (row[colDate] || '').trim();
    const time = (row[colTime] || '').trim();
    const name = (row[colName] || '').trim();
    if (!DATE_RE.test(date) || !name) continue;

    if (!byDate.has(date)) byDate.set(date, new Map());
    const timeMap = byDate.get(date)!;
    if (!timeMap.has(time)) timeMap.set(time, []);
    timeMap.get(time)!.push(name);
  }

  for (const [date, timeMap] of byDate) {
    out.set(date, Array.from(timeMap.entries())
      .map(([time, soldiers]) => ({ time, soldiers }))
      .sort((a, b) => timeToVal(a.time) - timeToVal(b.time)));
  }
  return out;
}

// ── Parser ─────────────────────────────────────────────────────────────────
export function parseShavtzakAll(rows: string[][], hamalRows: string[][] = []): ShavtzakAllData {
  const hamalByDate = parseHamalShifts(hamalRows);
  if (!rows || rows.length < 2) {
    return buildResult([], new Map(), hamalByDate);
  }

  // Find header row
  let headerRow = -1;
  let colDate = -1, colAmda = -1, colSug = -1, colShaa = -1, colHayyal = -1;

  for (let r = 0; r < Math.min(8, rows.length); r++) {
    const row = rows[r] ?? [];
    for (let c = 0; c < row.length; c++) {
      const v = (row[c] || '').trim();
      if (v === 'תאריך')  colDate   = c;
      if (v === 'העמדה')  colAmda   = c;
      if (v === 'סוג')    colSug    = c;
      if (v === 'השעה')   colShaa   = c;
      if (v === 'החייל')  colHayyal = c;
    }
    if (colAmda >= 0 && colSug >= 0 && colShaa >= 0 && colHayyal >= 0) {
      headerRow = r;
      break;
    }
  }

  if (headerRow === -1) return buildResult([], new Map(), hamalByDate);

  // date → sug → amda → time → soldiers[]
  const dateOrder: string[] = [];
  const dateMap = new Map<string, Map<string, Map<string, Map<string, string[]>>>>();

  let currentDate = '';

  for (let r = headerRow + 1; r < rows.length; r++) {
    const row = rows[r] ?? [];
    if (row.every(c => !c)) continue;

    const rawDate = colDate >= 0 ? (row[colDate] || '').trim() : '';
    if (rawDate && DATE_RE.test(rawDate)) currentDate = rawDate;
    if (!currentDate) continue;

    const amda   = (row[colAmda]   || '').trim();
    const sug    = (row[colSug]    || '').trim();
    const shaa   = (row[colShaa]   || '').trim();
    const hayyal = (row[colHayyal] || '').trim();

    if (!sug || !hayyal) continue;

    if (!dateMap.has(currentDate)) {
      dateMap.set(currentDate, new Map());
      dateOrder.push(currentDate);
    }
    const sugMap = dateMap.get(currentDate)!;
    if (!sugMap.has(sug)) sugMap.set(sug, new Map());
    const amdaMap = sugMap.get(sug)!;
    if (!amdaMap.has(amda)) amdaMap.set(amda, new Map());
    const timeMap = amdaMap.get(amda)!;
    if (!timeMap.has(shaa)) timeMap.set(shaa, []);
    timeMap.get(shaa)!.push(hayyal);
  }

  return buildResult(dateOrder, dateMap, hamalByDate);
}

// date → sug → amda → time → soldiers[], as parseShavtzakAll accumulates it.
type SugMap = Map<string, Map<string, Map<string, string[]>>>;

/**
 * Folds the two sources into one payload, so every consumer of `/api/shavtzak`
 * (the שבצק tab, לוז אישי's mission list, סיכום פלוגתי) sees the same shape it
 * always did — with the חמל group coming from `שיבוץ חמל`.
 *
 * Per date, the חמל tab REPLACES whatever `כל השבצק` holds for that group.
 * When the tab says nothing about a date, `כל השבצק`'s own חמל rows stay: the
 * tab only starts at 06/07/2026, and dropping the group outright would erase
 * eleven days of history that exist nowhere else.
 *
 * Dates are the union of both tabs. A day the חמל tab plans ahead of the שבצק
 * shows up as a day with only a חמל card, which is what a חמל soldier opening
 * לוז אישי needs to see — hiding it would hide their next shift.
 */
function buildResult(
  dateOrder: string[],
  dateMap: Map<string, SugMap>,
  hamalByDate: Map<string, TimeSlot[]>,
): ShavtzakAllData {
  const dates = Array.from(new Set([...dateOrder, ...hamalByDate.keys()]))
    .sort((a, b) => dateToNum(a) - dateToNum(b));

  const byDate: Record<string, ShavtzakData> = {};

  for (const date of dates) {
    const sugMap: SugMap = dateMap.get(date) ?? new Map();
    const groups: StationGroup[] = Array.from(sugMap.entries()).map(([sug, amdaMap]) => ({
      name: sug,
      subTypes: Array.from(amdaMap.entries()).map(([amda, timeMap]) => ({
        sug: amda,
        times: Array.from(timeMap.entries())
          .map(([time, soldiers]) => ({ time, soldiers }))
          .sort((a, b) => timeToVal(a.time) - timeToVal(b.time)),
      })),
    }));

    const hamalTimes = hamalByDate.get(date);
    byDate[date] = {
      date,
      groups: hamalTimes
        ? [
            ...groups.filter(g => !isHamalLabel(g.name)),
            { name: HAMAL_GROUP, subTypes: [{ sug: HAMAL_GROUP, times: hamalTimes }] },
          ]
        : groups,
    };
  }

  return { dates, byDate };
}

// ── Handler ────────────────────────────────────────────────────────────────
export default async function handler(_req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  try {
    const token = await getAccessToken();

    const readTab = async (range: string) => {
      const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(range)}`;
      const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) return { ok: false as const, status: response.status, body: await response.text() };
      const json = (await response.json()) as { values?: string[][] };
      return { ok: true as const, values: json.values ?? [] };
    };

    // Two reads, not one batchGet: batchGet fails the whole request if any range
    // is bad, and a renamed/deleted `שיבוץ חמל` must never take the שבצק down
    // with it. A missing חמל tab just leaves `כל השבצק`'s own חמל rows standing.
    const [main, hamal] = await Promise.all([
      readTab(`${SHEET_NAME}!A:F`),
      readTab(`${HAMAL_SHEET_NAME}!A:D`),
    ]);

    if (!main.ok) return res.status(main.status).json({ error: main.body });

    return res.status(200).json(parseShavtzakAll(main.values, hamal.ok ? hamal.values : []));
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return res.status(500).json({ error: message });
  }
}
