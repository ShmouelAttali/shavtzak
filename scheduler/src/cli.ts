import { generate, persist } from './generate.js';
import { pool, query } from './db.js';
import { fmtHM, minToDate, addDays } from './time.js';

function usage(): never {
  console.log(`usage:
  tsx src/cli.ts generate <YYYY-MM-DD> [<to YYYY-MM-DD>] [--dry-run]`);
  process.exit(1);
}

async function main() {
  const [cmd, from, ...rest] = process.argv.slice(2);
  if (cmd !== 'generate' || !from) usage();
  const dry = rest.includes('--dry-run');
  const to = rest.find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a)) ?? from;

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

    if (!dry) {
      await persist(res);
      console.log(`נשמר (status=generated).`);
    } else {
      console.log('(dry-run — לא נשמר)');
    }
  }
  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
