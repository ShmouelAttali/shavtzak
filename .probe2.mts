/** Roster lookup: names + מחלקה + status for a date. */
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

const r = await (await fetch(
  `https://sheets.googleapis.com/v4/spreadsheets/${SHEET}/values/${encodeURIComponent('מצבת החיילים')}?valueRenderOption=FORMATTED_VALUE`,
  { headers: { Authorization: `Bearer ${token}` } })).json();
const rows: string[][] = r.values || [];

// find header row with שם מלא
let hr = -1;
for (let i = 0; i < Math.min(8, rows.length); i++) {
  if (rows[i].some(c => String(c).trim() === 'שם מלא')) { hr = i; break; }
}
const headers = rows[hr].map(c => String(c).trim());
const nameCol = headers.indexOf('שם מלא');
const platoonCol = headers.indexOf('מחלקה');
const roleCol = headers.indexOf('תפקיד');
console.log('header row', hr + 1, 'nameCol', nameCol, 'platoonCol', platoonCol, 'roleCol', roleCol);

// date row = first row within 5 with a DD/MM/YY cell
let dr = -1;
for (let i = 0; i < Math.min(6, rows.length); i++) {
  if (rows[i].some(c => /^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(String(c).trim()))) { dr = i; break; }
}
const dateRow = rows[dr].map(c => String(c).trim());
console.log('date row', dr + 1);
const want = process.argv.slice(2);
const dateCols = ['14/08/26', '15/08/26', '13/08/26'].map(d => ({ d, i: dateRow.indexOf(d) }));
console.log('date cols', JSON.stringify(dateCols));

const needles = want.length ? want : [];
for (let i = hr + 1; i < rows.length; i++) {
  const name = String(rows[i]?.[nameCol] ?? '').trim();
  if (!name) continue;
  if (needles.length && !needles.some(n => name.includes(n))) continue;
  const st = dateCols.map(dc => `${dc.d}="${dc.i === -1 ? '?' : String(rows[i]?.[dc.i] ?? '').trim()}"`).join(' ');
  console.log(`r${i + 1} | ${name} | מחלקה=${String(rows[i]?.[platoonCol] ?? '').trim()} | תפקיד=${String(rows[i]?.[roleCol] ?? '').trim()} | ${st}`);
}
