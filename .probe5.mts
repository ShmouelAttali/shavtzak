/** Run the working-tree availability validator for one op day, print all errors. */
import fs from 'node:fs'; import path from 'node:path'; import vm from 'node:vm';
import { GoogleAuth } from 'google-auth-library';
const REPO='/Users/elyashiv/dev/ShmouelAttali/shavtzak/.claude/worktrees/ops-batch';
for (const f of ['.env','.env.local']) { const p=path.join(REPO,f); if(!fs.existsSync(p))continue;
  for (const l of fs.readFileSync(p,'utf8').split('\n')) { const m=l.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/); if(m&&!process.env[m[1]])process.env[m[1]]=m[2].replace(/^["']|["']$/g,''); } }
const SHEET=process.env.GOOGLE_SHEET_ID!;
const cred=JSON.parse(Buffer.from(process.env.GOOGLE_SERVICE_ACCOUNT_KEY!,'base64').toString('utf8'));
const auth=new GoogleAuth({credentials:cred,scopes:['https://www.googleapis.com/auth/spreadsheets.readonly']});
const token=(await (await auth.getClient()).getAccessToken()).token!;
const tab=async(n:string)=>{const j:any=await(await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET}/values/${encodeURIComponent(n)}`,{headers:{Authorization:`Bearer ${token}`}})).json();return j.values as string[][];};
const scheduleValues=await tab('כל השבצק'); const rosterValues=await tab('מצבת החיילים');
function load(src:string){const ctx:any={console,Date,Math,JSON,String,Number,Boolean,Array,Object,Map,Set,isNaN,parseInt,parseFloat,RegExp,Error,
  SpreadsheetApp:{getUi:()=>({createMenu:()=>({addItem(){return this},addSeparator(){return this},addToUi(){}})})},HtmlService:{}};
  vm.createContext(ctx); vm.runInContext(src+'\n;globalThis.CONFIG=CONFIG;\n',ctx); return ctx;}
const ctx=load(fs.readFileSync(path.join(REPO,'apps-script/plugat-gaash/ShabtzakOps.js'),'utf8'));
const header=scheduleValues[0].map(c=>String(c??'').trim());
const col={date:header.indexOf('תאריך'),position:header.indexOf('העמדה'),type:header.indexOf('סוג'),time:header.indexOf('השעה'),soldier:header.indexOf('החייל')};
let carried:Date|null=null;
const rows=scheduleValues.slice(1).flatMap((r,i)=>{const cell=String(r[col.date]??'').trim();
  if(cell){const[d,m,y]=cell.split('/').map(Number); if(y)carried=new Date(y,m-1,d);}
  const soldier=String(r[col.soldier]??'').trim(); const timeText=String(r[col.time]??'').trim();
  if(!carried||(!soldier&&!timeText))return[];
  return[{rowNumber:i+2,date:carried,timeText,soldier,position:String(r[col.position]??'').trim(),type:String(r[col.type]??'').trim()}];});
const DAY_START=ctx.CONFIG.OPERATIONAL_DAY_START_HOUR*60;
const opDayOf=(r:any)=>{const t=ctx.parseShiftTime_(r,[],'x');return ctx.operationalDayOfDateTime_(r.date,t.hasRealTimeRange?t.startMin%1440:DAY_START);};
const [dd,mm,yy]=process.argv[2].split('/').map(Number);
const day=new Date(yy,mm-1,dd);
const target=rows.filter(r=>ctx.sameDate_(opDayOf(r),day));
console.log(`op day ${process.argv[2]}: ${target.length} schedule rows`);
const parsed=ctx.buildParsedShifts_(target,[],[],'target');
const rosterSheet={getName:()=>'מצבת החיילים',getDataRange:()=>({getValues:()=>rosterValues})};
const roster=ctx.readRoster_(rosterSheet,day,[]);
const errors:string[]=[],warnings:string[]=[];
ctx.validateAvailabilityAndMissingAssignments_(parsed,roster,errors,warnings);
console.log(`\n${errors.length} errors:`); errors.forEach(e=>console.log('  '+e));
console.log(`\n${warnings.length} warnings:`); warnings.forEach(e=>console.log('  '+e));
for(const n of process.argv.slice(3)){
  const s=roster.soldiers.get(n);
  console.log(`\n${n}: ${s?`available ${ctx.availableMinutesInOpDay_(s,roster)} min of the op day; assigned=${target.some(r=>r.soldier===n)}`:'NOT IN ROSTER'}`);
}
