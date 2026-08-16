/** For each date column: current K3 count vs the op-day rule. */
import fs from 'node:fs'; import path from 'node:path'; import vm from 'node:vm';
import { GoogleAuth } from 'google-auth-library';
const REPO='/Users/elyashiv/dev/ShmouelAttali/shavtzak/.claude/worktrees/ops-batch';
for (const f of ['.env','.env.local']) { const p=path.join(REPO,f); if(!fs.existsSync(p))continue;
  for (const l of fs.readFileSync(p,'utf8').split('\n')) { const m=l.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/); if(m&&!process.env[m[1]])process.env[m[1]]=m[2].replace(/^["']|["']$/g,''); } }
const SHEET=process.env.GOOGLE_SHEET_ID!;
const cred=JSON.parse(Buffer.from(process.env.GOOGLE_SERVICE_ACCOUNT_KEY!,'base64').toString('utf8'));
const auth=new GoogleAuth({credentials:cred,scopes:['https://www.googleapis.com/auth/spreadsheets.readonly']});
const token=(await (await auth.getClient()).getAccessToken()).token!;
const j:any=await(await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET}/values/${encodeURIComponent('מצבת החיילים')}`,{headers:{Authorization:`Bearer ${token}`}})).json();
const rows:string[][]=j.values;
const ctx:any={console,Date,Math,JSON,String,Number,Boolean,Array,Object,Map,Set,isNaN,parseInt,parseFloat,RegExp,Error,
  SpreadsheetApp:{getUi:()=>({createMenu:()=>({addItem(){return this},addSeparator(){return this},addToUi(){}})})},HtmlService:{}};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(REPO,'apps-script/plugat-gaash/ShabtzakOps.js'),'utf8')+'\n;globalThis.CONFIG=CONFIG;\n',ctx);

// rows: 1 = dates (index 0), 3 = headers (index 2), data from index 3
const dateRow=rows[0]; const hdr=rows[2].map(c=>String(c??'').trim());
const nameCol=hdr.indexOf('שם מלא'), platCol=hdr.indexOf('מחלקה');
const parseD=(s:string)=>{const m=String(s).trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/); if(!m)return null;
  let y=Number(m[3]); if(y<100)y+=2000; return new Date(y,Number(m[2])-1,Number(m[1]));};
const dateCols:{i:number,d:Date}[]=[];
dateRow.forEach((c,i)=>{const d=parseD(c); if(d)dateCols.push({i,d});});
const un=(s:string)=>ctx.CONFIG.UNAVAILABLE_STATUS_WORDS.some((w:string)=>String(s).indexOf(w)!==-1);
const at=(r:number,c:number)=>String(rows[r]?.[c]??'').trim();
const lbl=(d:Date)=>`${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}`;
console.log('date    K3(now)  K3(op-day)  dropped');
for(let k=0;k<dateCols.length;k++){
  const {i,d}=dateCols[k]; const next=dateCols[k+1], prev=dateCols[k-1];
  if(!next) continue;
  let now=0, neu=0; const dropped:string[]=[];
  for(let r=3;r<rows.length;r++){
    const name=at(r,nameCol); if(!name)continue;
    const plat=at(r,platCol); if(!['1','2','3'].includes(plat))continue;
    const T=at(r,i); if(!T||un(T))continue;
    now++;
    const s={name,statusYesterday:prev?at(r,prev.i):'',statusToday:T,statusTomorrow:at(r,next.i),
      unavailableToday:un(T),unavailableTomorrow:un(at(r,next.i)),hasTomorrowColumn:true};
    const min=ctx.availableMinutesInOpDay_(s,{targetDate:d});
    if(min>0)neu++; else dropped.push(`${name}[${T}|${at(r,next.i)}]`);
  }
  if(now!==neu||process.argv[2]==='all')
    console.log(`${lbl(d)}  ${String(now).padStart(4)}   ${String(neu).padStart(6)}      ${dropped.join(', ')||'-'}`);
}
