import type { VercelRequest, VercelResponse } from '@vercel/node';
import { GoogleAuth } from 'google-auth-library';

const SHEET_ID =
  process.env.GOOGLE_SHEET_ID ||
  '1FCuaQsOvDzrHcVhlYy49Mr5p6gTyTjEF1GqnW5frXDg';

const SHEET_NAME = 'שבצק';

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
  name: string; // העמדה value
  subTypes: SubType[];
}

export interface ShavtzakData {
  date: string;
  groups: StationGroup[];
}

// ── Helpers ────────────────────────────────────────────────────────────────
function timeToVal(t: string): number {
  if (t === 'יומי' || t === '') return 9999;
  const h = parseInt(t.split(':')[0] ?? '0');
  return h < 6 ? h + 24 : h; // 00-05 → treat as next day
}

// ── Parser ─────────────────────────────────────────────────────────────────
function parseShavtzak(rows: string[][]): ShavtzakData {
  if (!rows || rows.length < 3) return { date: '', groups: [] };

  // Find date (DD/MM/YYYY) anywhere in first 3 rows
  let date = '';
  for (let r = 0; r < 3 && !date; r++) {
    for (const cell of rows[r] ?? []) {
      const m = (cell || '').match(/\d{1,2}\/\d{2}\/\d{4}/);
      if (m) { date = m[0]; break; }
    }
  }

  // Find header row by locating the key column names
  let headerRow = -1;
  let colAmda = -1, colSug = -1, colShaa = -1, colHayyal = -1;

  for (let r = 0; r < Math.min(8, rows.length); r++) {
    const row = rows[r] ?? [];
    for (let c = 0; c < row.length; c++) {
      const v = (row[c] || '').trim();
      if (v === 'העמדה') colAmda = c;
      if (v === 'סוג') colSug = c;
      if (v === 'השעה') colShaa = c;
      if (v === 'החייל') colHayyal = c;
    }
    if (colAmda >= 0 && colSug >= 0 && colShaa >= 0 && colHayyal >= 0) {
      headerRow = r;
      break;
    }
  }

  if (headerRow === -1) return { date, groups: [] };

  // Accumulate: sug (top group) → amda (sub-type) → time → soldiers[]
  const groupOrder: string[] = [];
  const groupMap = new Map<string, Map<string, Map<string, string[]>>>();

  for (let r = headerRow + 1; r < rows.length; r++) {
    const row = rows[r] ?? [];
    if (row.every(c => !c)) continue;

    const amda   = (row[colAmda]   || '').trim();
    const sug    = (row[colSug]    || '').trim();
    const shaa   = (row[colShaa]   || '').trim();
    const hayyal = (row[colHayyal] || '').trim();

    if (!sug || !hayyal) continue;

    if (!groupMap.has(sug)) {
      groupMap.set(sug, new Map());
      groupOrder.push(sug);
    }
    const amdaMap = groupMap.get(sug)!;
    if (!amdaMap.has(amda)) amdaMap.set(amda, new Map());
    const timeMap = amdaMap.get(amda)!;
    if (!timeMap.has(shaa)) timeMap.set(shaa, []);
    timeMap.get(shaa)!.push(hayyal);
  }

  const groups: StationGroup[] = groupOrder.map(sug => {
    const amdaMap = groupMap.get(sug)!;
    const subTypes: SubType[] = Array.from(amdaMap.entries()).map(([amda, timeMap]) => ({
      sug: amda, // sub-type label = העמדה value
      times: Array.from(timeMap.entries())
        .map(([time, soldiers]) => ({ time, soldiers }))
        .sort((a, b) => timeToVal(a.time) - timeToVal(b.time)),
    }));
    return { name: sug, subTypes };
  });

  return { date, groups };
}

// ── Handler ────────────────────────────────────────────────────────────────
export default async function handler(_req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');

  try {
    const token = await getAccessToken();
    const range = encodeURIComponent(`${SHEET_NAME}!A1:Z300`);
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${range}`;
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!response.ok) {
      const body = await response.text();
      return res.status(response.status).json({ error: body });
    }

    const json = (await response.json()) as { values?: string[][] };
    return res.status(200).json(parseShavtzak(json.values || []));
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return res.status(500).json({ error: message });
  }
}
