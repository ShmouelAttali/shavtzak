import fs from 'node:fs'; import path from 'node:path';
import { GoogleAuth } from 'google-auth-library';
const REPO = '/Users/elyashiv/dev/ShmouelAttali/shavtzak';
for (const f of ['.env', '.env.local']) { const p = path.join(REPO, f); if (!fs.existsSync(p)) continue;
  for (const line of fs.readFileSync(p,'utf8').split('\n')) { const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g,''); } }
const SHEET = process.env.GOOGLE_SHEET_ID || '1FCuaQsOvDzrHcVhlYy49Mr5p6gTyTjEF1GqnW5frXDg';
const credentials = JSON.parse(Buffer.from(process.env.GOOGLE_SERVICE_ACCOUNT_KEY!,'base64').toString('utf8'));
const auth = new GoogleAuth({ credentials, scopes:['https://www.googleapis.com/auth/spreadsheets.readonly'] });
const token = (await (await auth.getClient()).getAccessToken()).token!;
const range = process.argv[2];
const r = await (await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET}/values/${encodeURIComponent(range)}?valueRenderOption=FORMULA`, { headers:{Authorization:`Bearer ${token}`} })).json();
console.log(JSON.stringify(r.values, null, 1));
