import './env.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { pool, query } from '../src/db.js';

const sqlPath = (f: string) => fileURLToPath(new URL(`../db/${f}`, import.meta.url));

/** Recreate the test database schema + template seed. */
export async function freshSchema(): Promise<void> {
  // ensure the test database exists (connect to the container's default db)
  const adminUrl = process.env.SCHEDULER_DATABASE_URL!.replace(/\/[^/]+$/, '/postgres');
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  const { rowCount } = await admin.query(`select 1 from pg_database where datname = 'shavtzak_test'`);
  if (!rowCount) await admin.query('create database shavtzak_test');
  await admin.end();

  await query('drop schema public cascade; create schema public');
  await query(readFileSync(sqlPath('schema.sql'), 'utf8'));
  await query(readFileSync(sqlPath('seed.sql'), 'utf8'));
}

/**
 * Synthetic roster: 60 schedulable soldiers.
 *  - 6 static commanders (מ"כ), 2 senior (סמל), 2 senior (מ"מ)
 *  - 4 נהג דוד, 2 נהג טיגריס (H6d hard driver rule: 3 patrol shifts need 3
 *    free נהג דוד every day, plus rotation slack)
 *  - platoons cycle 1/2/3, rifle levels vary
 * seed.sql's קצין מוצב carries the candidate_pool MARKER; its id-based member
 * rows (position_candidates, normally seed-candidates.sql over the real
 * roster) are seeded here from the synthetic senior commanders so generated
 * days stay fully staffable (suites seed חפק's seat candidates themselves
 * when they need staffed seats).
 */
export async function seedSoldiers(): Promise<void> {
  const values: string[] = [];
  for (let i = 1; i <= 60; i++) {
    const role = i <= 6 ? 'מ"כ' : i <= 8 ? 'סמל' : i <= 10 ? 'מ"מ' : 'לוחם';
    const platoon = String((i % 3) + 1);
    const rifle = 2 + (i % 8);
    values.push(`('T${String(i).padStart(3, '0')}', 'חייל ${String(i).padStart(2, '0')}', '${platoon}', '${role}', ${rifle})`);
  }
  await query(`insert into soldiers (personal_number, full_name, platoon, role, rifle_level)
               values ${values.join(',')}`);
  await query(`insert into soldier_qualifications (soldier_id, qualification)
               select id, 'נהג דוד' from soldiers where full_name in ('חייל 11','חייל 12','חייל 15','חייל 16')`);
  await query(`insert into soldier_qualifications (soldier_id, qualification)
               select id, 'נהג טיגריס' from soldiers where full_name in ('חייל 13','חייל 14')`);
  await addCandidates('קצין מוצב', null, ['חייל 07', 'חייל 08', 'חייל 09', 'חייל 10']);
}

/** Insert position_candidates rows by NAME lookup (testing policy: never
 *  hardcode seed ids). sub = null → position-level closed pool (candidate_pool
 *  membership); a sub name → the named candidates of that H6b seat.
 *  ordered = true stores priority 1..n (the list order); else unordered. */
export async function addCandidates(position: string, sub: string | null,
                                    names: string[], ordered = false): Promise<void> {
  for (let i = 0; i < names.length; i++) {
    const priority = ordered ? i + 1 : null;
    const inserted = sub === null
      ? await query(`
          insert into position_candidates (position_id, sub_position_id, soldier_id, priority)
          select p.id, null, s.id, $3
          from positions p cross join soldiers s
          where p.name = $1 and s.full_name = $2
          returning id`, [position, names[i], priority])
      : await query(`
          insert into position_candidates (position_id, sub_position_id, soldier_id, priority)
          select p.id, sp.id, s.id, $4
          from positions p
          join sub_positions sp on sp.position_id = p.id and sp.name = $3
          cross join soldiers s
          where p.name = $1 and s.full_name = $2
          returning id`, [position, names[i], sub, priority]);
    if (inserted.length !== 1) {
      throw new Error(`addCandidates: no match for ${position}/${sub ?? '-'}/${names[i]}`);
    }
  }
}

/** Set / replace the H6c whitelist (soldier_allowed_positions) by name. */
export async function setAllowedPositions(name: string, positions: string[] | null): Promise<void> {
  const sid = await soldierId(name);
  await query(`delete from soldier_allowed_positions where soldier_id = $1`, [sid]);
  for (const p of positions ?? []) {
    await query(`insert into soldier_allowed_positions (soldier_id, position_id)
                 select $1, id from positions where name = $2`, [sid, p]);
  }
}

export async function soldierId(name: string): Promise<number> {
  const r = await query<{ id: number }>(`select id from soldiers where full_name = $1`, [name]);
  if (!r.length) throw new Error(`no soldier ${name}`);
  return r[0].id;
}

export async function closePool(): Promise<void> {
  await pool.end();
}

export { query };
