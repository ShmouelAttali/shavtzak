import type { VercelRequest, VercelResponse } from '@vercel/node';
import { GoogleAuth } from 'google-auth-library';

const SHEET_ID =
  process.env.GOOGLE_SHEET_ID ||
  '1FCuaQsOvDzrHcVhlYy49Mr5p6gTyTjEF1GqnW5frXDg';

const SHEET_NAME = 'כל השבצק';

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

// ── Parser ─────────────────────────────────────────────────────────────────
function parseShavtzakAll(rows: string[][]): ShavtzakAllData {
  if (!rows || rows.length < 2) return { dates: [], byDate: {} };

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

  if (headerRow === -1) return { dates: [], byDate: {} };

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

  // Sort dates chronologically
  dateOrder.sort((a, b) => dateToNum(a) - dateToNum(b));

  // Build byDate
  const byDate: Record<string, ShavtzakData> = {};

  for (const date of dateOrder) {
    const sugMap = dateMap.get(date)!;
    const groups: StationGroup[] = Array.from(sugMap.entries()).map(([sug, amdaMap]) => ({
      name: sug,
      subTypes: Array.from(amdaMap.entries()).map(([amda, timeMap]) => ({
        sug: amda,
        times: Array.from(timeMap.entries())
          .map(([time, soldiers]) => ({ time, soldiers }))
          .sort((a, b) => timeToVal(a.time) - timeToVal(b.time)),
      })),
    }));
    byDate[date] = { date, groups };
  }

  return { dates: dateOrder, byDate };
}

// ── Handler ────────────────────────────────────────────────────────────────
export default async function handler(_req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  try {
    const token = await getAccessToken();
    const range = encodeURIComponent(`${SHEET_NAME}!A:F`);
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${range}`;
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!response.ok) {
      const body = await response.text();
      return res.status(response.status).json({ error: body });
    }

    const json = (await response.json()) as { values?: string[][] };
    return res.status(200).json(parseShavtzakAll(json.values || []));
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return res.status(500).json({ error: message });
  }
}
