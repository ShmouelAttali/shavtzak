import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generate, persist } from './generate.js';
import { validateAndStore, Finding } from './validate.js';
import { pool, query } from './db.js';
import { fmtHM, addDays } from './time.js';
import {
  buildDayInput, buildDayReportHtml, buildWeekReportHtml,
  keyShortages, WeekDaySummary, WeekFairnessRow,
} from './report.js';

function usage(): never {
  console.log(`usage:
  tsx src/cli.ts generate <YYYY-MM-DD> [<to YYYY-MM-DD>] [--dry-run] [--no-report] [--report-dir <dir>]
  tsx src/cli.ts validate <YYYY-MM-DD> [<to YYYY-MM-DD>]

  generate writes an HTML report per day (+ a weekly index for ranges) to
  scheduler/reports/ by default; --no-report skips it, --report-dir overrides
  the output directory. Reports are written on --dry-run too.`);
  process.exit(1);
}

function printFindings(findings: Finding[]) {
  const errs = findings.filter((f) => f.severity === 'error');
  const warns = findings.filter((f) => f.severity === 'warning');
  console.log(`ולידציה: ${errs.length} שגיאות, ${warns.length} אזהרות`);
  for (const f of errs) console.log(`  ❌ [${f.rule}] ${f.message}`);
  for (const f of warns.slice(0, 20)) console.log(`  ⚠ [${f.rule}] ${f.message}`);
  if (warns.length > 20) console.log(`  … ועוד ${warns.length - 20} אזהרות`);
}

/** Week fairness rows for the report index, over the generated range
 *  (schedule days from..to). Columns per owner request (2026-07-19):
 *  שעות לילה = overlap of counted rows (non-readiness, non-night_exempt —
 *  soldier_fairness's night classification) with each day's 00:00–06:00;
 *  שעות התקפי = raw hours on התקפי rows (a standing day = 24h);
 *  סה"כ שעות = counted mission hours, per-row cap at daily_cap_hours.
 *  Soldiers home the ENTIRE range (unavailability covering every evening,
 *  like api/fairness's days-on-base logic) are dropped from the table. */
async function weekFairness(from: string, to: string): Promise<WeekFairnessRow[]> {
  const rows = await query<{
    name: string; platoon: string; role: string;
    night_hours: number; hatkafi_hours: number; total_hours: number;
  }>(`
    with days as (select generate_series($1::date, $2::date, '1 day')::date dd),
    cap as (select coalesce((select (value #>> '{}')::numeric from config
                             where key = 'daily_cap_hours'), 8) h),
    r as (
      select sa.soldier_id, sa.period, sa.day, p.name pos_name, p.mission_class,
             coalesce((p.config->>'night_exempt')::boolean,
                      (p.config->>'daily')::boolean, false) night_exempt
      from shift_assignments sa
      join positions p on p.id = sa.position_id
      where sa.day between $1 and $2 and p.mission_class <> 'rest'
    ),
    b as (select s.id, s.full_name, coalesce(s.platoon, '') platoon, coalesce(s.role, '') role,
        (select count(*) from days
         where not exists (select 1 from unavailability u
           where u.soldier_id = s.id
             and u.period @> (dd + time '20:00')::timestamp))::int days_present
      from soldiers s where s.is_schedulable)
    select b.full_name name, b.platoon, b.role,
      coalesce(sum(hours(r.period * night_range(r.day)))
        filter (where r.period && night_range(r.day)
          and r.mission_class <> 'readiness' and not r.night_exempt), 0)::float night_hours,
      coalesce(sum(hours(r.period)) filter (where r.pos_name = 'התקפי'), 0)::float hatkafi_hours,
      coalesce(sum(least(hours(r.period), cap.h))
        filter (where r.mission_class <> 'readiness'), 0)::float total_hours
    from b cross join cap
    left join r on r.soldier_id = b.id
    where b.days_present > 0
    group by b.full_name, b.platoon, b.role
    order by total_hours desc, name`, [from, to]);
  return rows.map((r) => ({
    name: r.name, platoon: r.platoon, role: r.role,
    nightHours: r.night_hours, hatkafiHours: r.hatkafi_hours, totalHours: r.total_hours,
  }));
}

async function main() {
  const [cmd, from, ...rest] = process.argv.slice(2);
  if (!['generate', 'validate'].includes(cmd) || !from) usage();
  const dry = rest.includes('--dry-run');
  const noReport = rest.includes('--no-report');
  // report directory: scheduler/reports/ by default, --report-dir overrides
  let reportDir = fileURLToPath(new URL('../reports/', import.meta.url));
  const rdi = rest.indexOf('--report-dir');
  const consumed = new Set<number>();
  if (rdi >= 0) {
    const dir = rest[rdi + 1];
    if (!dir || dir.startsWith('--')) usage();
    reportDir = path.resolve(dir);
    consumed.add(rdi + 1);
  }
  const to = rest.find((a, i) => !consumed.has(i) && /^\d{4}-\d{2}-\d{2}$/.test(a)) ?? from;

  if (cmd === 'validate') {
    for (let day = from; day <= to; day = addDays(day, 1)) {
      console.log(`\n═══ ולידציה ${day} ═══`);
      printFindings(await validateAndStore(day));
    }
    await pool.end();
    return;
  }

  if (!noReport) mkdirSync(reportDir, { recursive: true });
  const daySummaries: WeekDaySummary[] = [];

  for (let day = from; day <= to; day = addDays(day, 1)) {
    const res = await generate(day);
    console.log(`\n═══ שבצ"ק ${day} (14:00 → 14:00) ═══`);

    // Level-1 summary
    const byPos = new Map<number, number>();
    for (const pid of res.level1.values()) byPos.set(pid, (byPos.get(pid) ?? 0) + 1);
    const posNames = new Map((await query(`select id, name from positions`)).map((p) => [p.id, p.name]));
    console.log('שיבוץ יומי (Level 1):');
    for (const [pid, n] of [...byPos].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${posNames.get(pid)}: ${n}`);
    }

    console.log(`שיבוצי משמרות (Level 2): ${res.assignments.length} שורות` +
      ` (${res.assignments.filter((a) => a.source === 'chain').length} משורשרות)`);

    // day balance: baseline (pre-flex) demand vs available supply — same
    // computation as the report's מאזן היום table (staff crews at actual size)
    if (res.report) {
      const homeId = String(res.report.homePositionId ?? '');
      const present = [...res.level1.values()].filter((p) => String(p) !== homeId).length;
      const assigned = (pid: number) =>
        [...res.level1.values()].filter((p) => String(p) === String(pid)).length;
      const totalNeed = res.report.positions.reduce((s, p) => {
        if (p.chainOverlay || String(p.id) === homeId
          || String(p.id) === String(res.report!.restPositionId ?? '')) return s;
        const need = p.staffAllRoles ? assigned(p.id) : res.report!.demandBefore[String(p.id)];
        return s + Number(need ?? 0);
      }, 0);
      console.log(`מאזן: דרישה כוללת ${totalNeed} מול ${present} זמינים` +
        (present >= totalNeed ? ` (עודף ${present - totalNeed})` : ` (חסרים ${totalNeed - present})`));
    }

    const withViolations = res.assignments.filter((a) => a.violations.length);
    if (withViolations.length) {
      console.log(`אזהרות על שיבוצים (${withViolations.length}):`);
      for (const a of withViolations.slice(0, 15)) {
        console.log(`  ${posNames.get(a.positionId)} ${fmtHM(a.period[0])}: ${a.violations.join(' | ')}`);
      }
    }
    if (res.issues.length) {
      console.log(`בעיות (${res.issues.length}):`);
      for (const i of res.issues) console.log(`  ⚠ ${i}`);
    }

    let findings: Finding[] = [];
    if (!dry) {
      findings = await persist(res);
      console.log(`נשמר (status=generated).`);
      printFindings(findings);
    } else {
      console.log('(dry-run — לא נשמר)');
    }

    if (!noReport) {
      const input = buildDayInput(res, findings, dry);
      const file = path.join(reportDir, `${day}.html`);
      writeFileSync(file, buildDayReportHtml(input));
      console.log(`דוח יומי: ${file}`);
      daySummaries.push({
        day, file: `${day}.html`,
        errors: findings.filter((f) => f.severity === 'error').length,
        warnings: findings.filter((f) => f.severity === 'warning').length,
        shortages: keyShortages(res.issues),
      });
    }
  }

  if (!noReport && to > from) {
    const file = path.join(reportDir, `week-${from}-${to}.html`);
    writeFileSync(file, buildWeekReportHtml({
      from, to,
      generatedAt: new Date().toLocaleString('he-IL', { hour12: false }),
      days: daySummaries,
      fairness: await weekFairness(from, to),
    }));
    console.log(`\nדוח שבועי: ${file}`);
  }
  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
