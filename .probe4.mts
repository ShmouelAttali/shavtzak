import fs from 'node:fs'; import path from 'node:path';
import { GoogleAuth } from 'google-auth-library';
const REPO='/Users/elyashiv/dev/ShmouelAttali/shavtzak';
for (const f of ['.env','.env.local']) { const p=path.join(REPO,f); if(!fs.existsSync(p))continue;
  for (const l of fs.readFileSync(p,'utf8').split('\n')) { const m=l.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/); if(m&&!process.env[m[1]])process.env[m[1]]=m[2].replace(/^["']|["']$/g,''); } }
const SHEET=process.env.GOOGLE_SHEET_ID!;
const cred=JSON.parse(Buffer.from(process.env.GOOGLE_SERVICE_ACCOUNT_KEY!,'base64').toString('utf8'));
const auth=new GoogleAuth({credentials:cred,scopes:['https://www.googleapis.com/auth/spreadsheets.readonly']});
const token=(await (await auth.getClient()).getAccessToken()).token!;
const r=await(await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET}/values/${encodeURIComponent('מצבת החיילים')}`,{headers:{Authorization:`Bearer ${token}`}})).json();
const rows:string[][]=r.values||[];
let hr=-1; for(let i=0;i<8;i++) if(rows[i]?.some(c=>String(c).trim()==='שם מלא')){hr=i;break;}
const nameCol=rows[hr].map(c=>String(c).trim()).indexOf('שם מלא');
const dateRow=rows[0].map(c=>String(c).trim());
const dates=['10/08/26','11/08/26','12/08/26','13/08/26','14/08/26','15/08/26'];
const idx=dates.map(d=>({d,i:dateRow.indexOf(d)}));
for(const needle of process.argv.slice(2)){
  for(let i=hr+1;i<rows.length;i++){
    const n=String(rows[i]?.[nameCol]??'').trim();
    if(!n||!n.includes(needle))continue;
    console.log(n.padEnd(20), idx.map(x=>`${x.d}="${x.i===-1?'?':String(rows[i]?.[x.i]??'').trim()}"`).join('  '));
  }
}
