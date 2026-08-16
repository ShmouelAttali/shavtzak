/** Read the live sheet: tab list + a requested tab's grid. */
import fs from 'node:fs';
import path from 'node:path';
import { GoogleAuth } from 'google-auth-library';

const REPO = '/Users/elyashiv/dev/ShmouelAttali/shavtzak';
for (const f of ['.env', '.env.local']) {
  const p = path.join(REPO, f);
  if (!fs.existsSync(p)) continue;
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
const SHEET = process.env.GOOGLE_SHEET_ID || '1FCuaQsOvDzrHcVhlYy49Mr5p6gTyTjEF1GqnW5frXDg';
const credentials = JSON.parse(Buffer.from(process.env.GOOGLE_SERVICE_ACCOUNT_KEY!, 'base64').toString('utf8'));
const auth = new GoogleAuth({ credentials, scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] });
const token = (await (await auth.getClient()).getAccessToken()).token!;

const meta = await (await fetch(
  `https://sheets.googleapis.com/v4/spreadsheets/${SHEET}?fields=sheets.properties`,
  { headers: { Authorization: `Bearer ${token}` } })).json();
console.log('TABS:');
for (const s of meta.sheets) console.log(' -', s.properties.title, `(${s.properties.gridProperties.rowCount}x${s.properties.gridProperties.columnCount})`);

const want = process.argv[2];
if (want) {
  const r = await (await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${SHEET}/values/${encodeURIComponent(want)}?valueRenderOption=FORMATTED_VALUE`,
    { headers: { Authorization: `Bearer ${token}` } })).json();
  const rows: string[][] = r.values || [];
  const colLetter = (i: number) => {
    let s = '', n = i + 1;
    while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
    return s;
  };
  console.log(`\n=== ${want} — ${rows.length} rows ===`);
  const maxRow = Number(process.argv[3] || 60);
  rows.slice(0, maxRow).forEach((row, i) => {
    const cells = row.map((c, j) => c === '' ? '' : `${colLetter(j)}:${String(c).replace(/\n/g, '⏎')}`).filter(Boolean);
    console.log(String(i + 1).padStart(3), cells.join(' | ').slice(0, 400));
  });
}
