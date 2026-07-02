import type { VercelRequest, VercelResponse } from '@vercel/node';
import { GoogleAuth } from 'google-auth-library';

const SHEET_ID = process.env.GOOGLE_SHEET_ID || '1FCuaQsOvDzrHcVhlYy49Mr5p6gTyTjEF1GqnW5frXDg';
const SHEET_NAME = 'יציאות לזמן קצר';

async function getAccessToken(): Promise<string> {
  const b64 = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!b64) throw new Error('GOOGLE_SERVICE_ACCOUNT_KEY not set');
  const credentials = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
  const auth = new GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  const client = await auth.getClient();
  const token = await client.getAccessToken();
  if (!token.token) throw new Error('Failed to get access token');
  return token.token;
}

export interface ShortExit {
  rowIndex: number;
  name: string;
  exitTime: string;
  returnTime: string;
}

async function getSheetGid(token: string): Promise<number> {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}?fields=sheets.properties`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const json = await res.json() as { sheets: Array<{ properties: { title: string; sheetId: number } }> };
  const sheet = json.sheets.find(s => s.properties.title === SHEET_NAME);
  if (!sheet) throw new Error(`Sheet "${SHEET_NAME}" not found`);
  return sheet.properties.sheetId;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const token = await getAccessToken();

    // ── GET ────────────────────────────────────────────────────────────────
    if (req.method === 'GET') {
      res.setHeader('Cache-Control', 'no-store');
      const range = encodeURIComponent(`${SHEET_NAME}!A2:C200`);
      const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${range}`;
      const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      const json = await r.json() as { values?: string[][] };
      const exits: ShortExit[] = (json.values || [])
        .map((row, i) => ({
          rowIndex: i + 2,
          name: (row[0] || '').trim(),
          exitTime: (row[1] || '').trim(),
          returnTime: (row[2] || '').trim(),
        }))
        .filter(e => e.name);
      return res.status(200).json(exits);
    }

    // ── POST ───────────────────────────────────────────────────────────────
    if (req.method === 'POST') {
      const { name, exitTime, returnTime } = req.body as { name?: string; exitTime?: string; returnTime?: string };
      if (!name?.trim()) return res.status(400).json({ error: 'name required' });
      const range = encodeURIComponent(`${SHEET_NAME}!A:C`);
      const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${range}:append?valueInputOption=USER_ENTERED`;
      const r = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ values: [[name.trim(), exitTime ?? '', returnTime ?? '']] }),
      });
      if (!r.ok) return res.status(r.status).json({ error: await r.text() });
      return res.status(200).json({ ok: true });
    }

    // ── DELETE ─────────────────────────────────────────────────────────────
    if (req.method === 'DELETE') {
      const rowIndex = parseInt(req.query.row as string);
      if (!rowIndex || rowIndex < 2) return res.status(400).json({ error: 'invalid row' });
      const sheetGid = await getSheetGid(token);
      const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}:batchUpdate`;
      const r = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requests: [{
            deleteDimension: {
              range: { sheetId: sheetGid, dimension: 'ROWS', startIndex: rowIndex - 1, endIndex: rowIndex },
            },
          }],
        }),
      });
      if (!r.ok) return res.status(r.status).json({ error: await r.text() });
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
}
