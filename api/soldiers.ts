import type { VercelRequest, VercelResponse } from '@vercel/node';
import { GoogleAuth } from 'google-auth-library';

const SHEET_ID =
  process.env.GOOGLE_SHEET_ID ||
  '1FCuaQsOvDzrHcVhlYy49Mr5p6gTyTjEF1GqnW5frXDg';

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

const SHEET_NAME = 'מצבת החיילים';

// A date cell looks like "21/06/26" or "1/07/26"
const DATE_RE = /^\d{1,2}\/\d{2}\/\d{2}$/;

interface ParsedSheet {
  soldiers: Soldier[];
  dates: string[];
  dayNames: Record<string, string>;
  allowedEmails: string[];
}

interface Soldier {
  id: string;
  firstName: string;
  lastName: string;
  fullName: string;
  phone: string;
  role: string;
  unit: string;
  notes: string;
  vacationCount: number;
  schedule: Record<string, string>;
}

function parseSheet(rows: string[][]): ParsedSheet {
  if (!rows || rows.length < 4) return { soldiers: [], dates: [], dayNames: {} };

  // Find the header rows by scanning first 5 rows
  let dateRow = -1;
  let dayNameRow = -1;
  let firstDateCol = -1;

  for (let r = 0; r < Math.min(5, rows.length); r++) {
    const row = rows[r];
    for (let c = 0; c < row.length; c++) {
      const cell = (row[c] || '').trim();
      if (DATE_RE.test(cell)) {
        if (dateRow === -1) {
          dateRow = r;
          firstDateCol = c;
        }
        break;
      }
    }
    if (
      row.some((cell) =>
        ['יום ראשון', 'יום שני', 'יום שלישי', 'יום רביעי'].includes(
          (cell || '').trim()
        )
      )
    ) {
      dayNameRow = r;
    }
  }

  if (dateRow === -1) return { soldiers: [], dates: [], dayNames: {} };

  // Build ordered date list from the date row
  const dates: string[] = [];
  const dateColIndex: Record<number, string> = {};
  const dateRow0 = rows[dateRow];
  for (let c = firstDateCol; c < dateRow0.length; c++) {
    const cell = (dateRow0[c] || '').trim();
    if (DATE_RE.test(cell)) {
      dates.push(cell);
      dateColIndex[c] = cell;
    }
  }

  // Build day names map
  const dayNames: Record<string, string> = {};
  if (dayNameRow !== -1) {
    const dnRow = rows[dayNameRow];
    for (const [col, date] of Object.entries(dateColIndex)) {
      const colIdx = Number(col);
      const day = (dnRow[colIdx] || '').trim();
      if (day) dayNames[date] = day;
    }
  }

  // Detect soldier rows: start after the last header row
  const dataStart = Math.max(dateRow, dayNameRow) + 1;

  // Find info column indices — search ALL header rows, fall back to known positions
  const colOf = (labels: string[]) => {
    for (let r = 0; r < dataStart; r++) {
      const row = rows[r] ?? [];
      for (let c = 0; c < firstDateCol; c++) {
        const cell = (row[c] || '').trim();
        if (labels.some((l) => cell.includes(l))) return c;
      }
    }
    return -1;
  };

  // Known column order from the sheet (fallback positions)
  // A=0 מספר אישי, B=1 שם פרטי, C=2 שם משפחה, D=3 פלאפון,
  // E=4 תפקיד, F=5 מחלקה, G=6 הערות, H=7 ?, I=8 סיכימה - חופש
  const fallback = (v: number, def: number) => (v === -1 ? def : v);
  const idCol        = fallback(colOf(['מספר אישי']), 0);
  const firstNameCol = fallback(colOf(['שם פרטי']), 1);
  const lastNameCol  = fallback(colOf(['שם משפחה']), 2);
  const phoneCol     = fallback(colOf(['פלאפון', 'טלפון']), 3);
  const roleCol      = fallback(colOf(['תפקיד']), 4);
  const unitCol      = fallback(colOf(['מחלקה']), 5);
  const notesCol     = fallback(colOf(['הערות']), 6);
  const vacationCol  = fallback(colOf(['סיכימה']), 8);
  const emailCol     = colOf(['email', 'אימייל', 'מייל']);

  const soldiers: Soldier[] = [];
  const allowedEmails: string[] = [];

  for (let r = dataStart; r < rows.length; r++) {
    const row = rows[r];
    if (!row || row.every((c) => !c)) continue;

    const id = idCol >= 0 ? (row[idCol] || '').trim() : '';
    // Skip rows that don't look like soldiers (id should be numeric)
    if (id && !/^\d+$/.test(id)) continue;
    if (!id) continue;

    const firstName = firstNameCol >= 0 ? (row[firstNameCol] || '').trim() : '';
    const lastName = lastNameCol >= 0 ? (row[lastNameCol] || '').trim() : '';
    const phone = phoneCol >= 0 ? (row[phoneCol] || '').trim() : '';
    const role = roleCol >= 0 ? (row[roleCol] || '').trim() : '';
    const unit = unitCol >= 0 ? (row[unitCol] || '').trim() : '';
    const notes = notesCol >= 0 ? (row[notesCol] || '').trim() : '';
    const vacationRaw = vacationCol >= 0 ? (row[vacationCol] || '').trim() : '';
    const vacationCount = parseInt(vacationRaw, 10) || 0;
    const email = emailCol >= 0 ? (row[emailCol] || '').trim().toLowerCase() : '';

    if (email) allowedEmails.push(email);

    const schedule: Record<string, string> = {};
    for (const [col, date] of Object.entries(dateColIndex)) {
      const colIdx = Number(col);
      const cell = (row[colIdx] || '').trim();
      if (cell) schedule[date] = cell;
    }

    soldiers.push({
      id,
      firstName,
      lastName,
      fullName: `${firstName} ${lastName}`.trim(),
      phone,
      role,
      unit,
      notes,
      vacationCount,
      schedule,
    });
  }

  return { soldiers, dates, dayNames, allowedEmails };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');

  try {
    const token = await getAccessToken();
    const range = encodeURIComponent(`${SHEET_NAME}!A1:CZ500`);
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${range}`;
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!response.ok) {
      const body = await response.text();
      return res.status(response.status).json({ error: body });
    }

    const json = (await response.json()) as { values?: string[][] };
    const rows = json.values || [];
    const parsed = parseSheet(rows);

    return res.status(200).json(parsed);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return res.status(500).json({ error: message });
  }
}
