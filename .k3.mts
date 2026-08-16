/**
 * Build the new K3 (חיילים זמינים) formula, test it on the scratch tab against
 * a date where the rule bites, and only then (with --apply) write K3 itself.
 */
import fs from 'node:fs'; import path from 'node:path';
import { GoogleAuth } from 'google-auth-library';

const REPO = '/Users/elyashiv/dev/ShmouelAttali/shavtzak/.claude/worktrees/ops-batch';
for (const f of ['.env', '.env.local']) {
  const p = path.join(REPO, f); if (!fs.existsSync(p)) continue;
  for (const l of fs.readFileSync(p, 'utf8').split('\n')) {
    const m = l.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
const SHEET = process.env.GOOGLE_SHEET_ID!;
const cred = JSON.parse(Buffer.from(process.env.GOOGLE_SERVICE_ACCOUNT_KEY!, 'base64').toString('utf8'));
const auth = new GoogleAuth({ credentials: cred, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
const token = (await (await auth.getClient()).getAccessToken()).token!;

const api = async (method: string, url: string, body?: any) => {
  const r = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET}${url}`, {
    method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j: any = await r.json();
  if (!r.ok) throw new Error(JSON.stringify(j));
  return j;
};
const read = async (range: string, render = 'FORMULA') =>
  (await api('GET', `/values/${encodeURIComponent(range)}?valueRenderOption=${render}`)).values;
const write = async (range: string, value: string) =>
  api('PUT', `/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`, { values: [[value]] });

const R = "'מצבת החיילים'!";
const PLAT = `${R}$I$4:$I$145`, NAME = `${R}$E$4:$E$145`;
const GRID = `${R}$O$4:$DG$145`, DATES = `${R}$O$1:$DG$1`;

/** the formula, parameterised by whatever expression yields the day's date */
function k3(dateExpr: string) {
  const today = `INDEX(${GRID},0,MATCH(${dateExpr},${DATES},0))`;
  // ⚠ no tomorrow column (the last date in the sheet) falls back to today's.
  // That can never fire the rule — "יציאה מ14" is not "יציאה עד 14" — so the
  // count degrades to exactly the old behaviour instead of erroring out.
  const tomorrow = `INDEX(${GRID},0,IFERROR(MATCH(${dateExpr}+1,${DATES},0),MATCH(${dateExpr},${DATES},0)))`;

  // out for the whole 14:00-24:00 half: an exit that starts at or before 14:00
  // and runs to midnight ("יציאה מ14").
  const outToday = `--REGEXMATCH(TO_TEXT(${today}),"^יציאה\\s+מ\\s*(1[0-4]|[0-9])$")`;
  // out for the whole 00:00-14:00 half: לא מגויס, or an exit running to 14:00
  // or later ("יציאה עד 14"). חופש is deliberately NOT here: with a non-חופש
  // today it is always a FIRST vacation day, so he is still present until the
  // 06:00 changeover and genuinely has hours in the day.
  const outTomorrow = `SIGN((TO_TEXT(${tomorrow})="לא מגויס")+--REGEXMATCH(TO_TEXT(${tomorrow}),"^יציאה\\s+עד\\s*(1[4-9]|2[0-3])$"))`;

  return `=IFERROR(SUMPRODUCT(((${PLAT}=1)+(${PLAT}=2)+(${PLAT}=3))` +
    `*(${NAME}<>"")*(${today}<>"")*(${today}<>"חופש")*(${today}<>"לא מגויס")` +
    `*(1-ARRAYFORMULA(${outToday}*${outTomorrow}))),"אין עמודה לתאריך E1")`;
}

const OLD = (await read('שבצק!K3'))[0][0] as string;
const NEW = k3('$E$1');

if (process.argv.includes('--apply')) {
  fs.writeFileSync(path.join(REPO, '.k3-backup.txt'), OLD, 'utf8');
  console.log('backed up the old K3 formula to .k3-backup.txt');
  const before = (await read('שבצק!K3', 'FORMATTED_VALUE'))[0][0];
  await write('שבצק!K3', NEW);
  const after = (await read('שבצק!K3', 'FORMATTED_VALUE'))[0][0];
  const e1 = (await read('שבצק!E1', 'FORMATTED_VALUE'))[0][0];
  console.log(`K3 for E1=${e1}:  ${before} -> ${after}`);
  process.exit(0);
}

/* ---- dry run on the scratch tab ---- */
// I3/I4 sit in the summary block and are empty (verified); nothing references
// them. They are cleared again at the end of the run.
const SCRATCH = ['שבצק!I3', 'שבצק!I4'];
const D = (s: string) => { const [d, m, y] = s.split('/').map(Number); return `DATE(${y},${m},${d})`; };

const busy = (await read(`שבצק!I3:I4`)) ?? [];
if (busy.flat().filter((c: any) => String(c ?? '') !== '').length) {
  throw new Error(`scratch cells are not empty: ${JSON.stringify(busy)}`);
}

console.log('OLD K3:\n' + OLD + '\n');
console.log('NEW K3:\n' + NEW + '\n');

for (const day of ['13/08/2026', '14/08/2026', '11/08/2026', '27/08/2026']) {
  await write(SCRATCH[0], k3(D(day)));
  await write(SCRATCH[1], OLD.replace(/\$E\$1(?!\d)/g, D(day)));
  const vals = await read('שבצק!I3:I4', 'UNFORMATTED_VALUE');
  const [neu, old] = [vals[0][0], vals[1][0]];
  if (String(old).includes('ERROR') || String(neu).includes('ERROR')) {
    console.log('what landed in the cells:', JSON.stringify(await read('שבצק!I3:I4'), null, 1).slice(0, 1200));
  }
  console.log(`${day}:  old=${old}  new=${neu}   ${old === neu ? '' : '<-- changed'}`);
}
await write(SCRATCH[0], '');
await write(SCRATCH[1], '');
console.log('\nscratch cells cleared. Re-run with --apply to write K3.');
