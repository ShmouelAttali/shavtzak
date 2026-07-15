import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getPool, DATE_RE } from './_db.js';
import type { StationGroup, SubType, TimeSlot } from './shavtzak.js';

// ── Types (imported by the frontend as ../../api/draft) ────────────────────
export interface DraftFinding {
  severity: 'error' | 'warning';
  rule: string;
  message: string;
  soldierId?: number;
}

export interface DraftAssignmentMeta {
  source: string;               // auto | chain | manual | import
  locked: boolean;
  violations: string[];
}

export interface DraftDay {
  day: string;                  // YYYY-MM-DD (schedule day, starts 14:00)
  status: string;               // draft | generated | approved | published
  generatedAt: string | null;
  validation: DraftFinding[];
  groups: StationGroup[];       // same shape the existing Shavtzak layouts render
  /** key = `${soldierName}|${timeLabel}` for ⚠ markers */
  meta: Record<string, DraftAssignmentMeta>;
  /** Level-1 buckets: position -> soldier names (incl. מנוחה) */
  dayAssignments: Record<string, string[]>;
}

export interface DraftResponse { days: DraftDay[] }
export interface GenerateResponse {
  day: string;
  rows: number;
  issues: string[];
  validation: DraftFinding[];
}

const hm = (d: Date) =>
  `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

async function getDrafts(from: string, to: string): Promise<DraftResponse> {
  const pool = getPool();
  const [daysRes, rowsRes, dayAssignRes] = await Promise.all([
    pool.query(
      `select day::text, status, generated_at, validation
       from schedule_days where day between $1 and $2 order by day`, [from, to]),
    pool.query(
      `select sa.day::text, p.name pos_name, sp.name sub_name, s.full_name,
              lower(sa.period) p_start, upper(sa.period) p_end,
              sa.source, sa.locked, sa.violations, sa.seat_index
       from shift_assignments sa
       join positions p on p.id = sa.position_id
       left join sub_positions sp on sp.id = sa.sub_position_id
       left join soldiers s on s.id = sa.soldier_id
       where sa.day between $1 and $2
       order by sa.day, p.id, lower(sa.period), sa.seat_index`, [from, to]),
    pool.query(
      `select da.day::text, p.name pos_name, s.full_name
       from day_assignments da
       join positions p on p.id = da.position_id
       join soldiers s on s.id = da.soldier_id
       where da.day between $1 and $2
       order by da.day, p.id, s.full_name`, [from, to]),
  ]);

  const days = new Map<string, DraftDay>();
  for (const d of daysRes.rows) {
    days.set(d.day, {
      day: d.day, status: d.status,
      generatedAt: d.generated_at ? new Date(d.generated_at).toISOString() : null,
      validation: d.validation ?? [], groups: [], meta: {}, dayAssignments: {},
    });
  }

  // group rows: position -> subType (sub-position or position) -> time -> soldiers
  const grouping = new Map<string, Map<string, Map<string, string[]>>>();
  for (const r of rowsRes.rows) {
    const day = days.get(r.day);
    if (!day) continue;
    const start = new Date(r.p_start), end = new Date(r.p_end);
    const time = `${hm(start)}-${hm(end)}`;
    const station = r.pos_name as string;
    const sug = (r.sub_name as string | null) ?? station;
    const gKey = `${r.day}|${station}`;
    const bySug = grouping.get(gKey) ?? new Map();
    grouping.set(gKey, bySug);
    const byTime = bySug.get(sug) ?? new Map();
    bySug.set(sug, byTime);
    const soldiers = byTime.get(time) ?? [];
    byTime.set(time, soldiers);
    const name = r.full_name ?? '?';
    soldiers.push(name);
    const violations: string[] = Array.isArray(r.violations) ? r.violations : [];
    if (violations.length || r.locked || r.source === 'manual') {
      day.meta[`${name}|${time}`] = { source: r.source, locked: r.locked, violations };
    }
  }
  for (const [gKey, bySug] of grouping) {
    const [dayKey, station] = gKey.split('|');
    const day = days.get(dayKey)!;
    const subTypes: SubType[] = [...bySug.entries()].map(([sug, byTime]) => ({
      sug,
      times: [...byTime.entries()].map(([time, soldiers]): TimeSlot => ({ time, soldiers })),
    }));
    day.groups.push({ name: station, subTypes } as StationGroup);
  }
  for (const r of dayAssignRes.rows) {
    const day = days.get(r.day);
    if (!day) continue;
    (day.dayAssignments[r.pos_name] ??= []).push(r.full_name);
  }
  return { days: [...days.values()] };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    if (req.method === 'GET') {
      const from = String(req.query.from ?? '');
      const to = String(req.query.to ?? from);
      if (!DATE_RE.test(from) || !DATE_RE.test(to)) {
        return res.status(400).json({ error: 'from/to required (YYYY-MM-DD)' });
      }
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json(await getDrafts(from, to));
    }

    if (req.method === 'POST') {
      const { day } = (req.body ?? {}) as { day?: string };
      if (!day || !DATE_RE.test(day)) {
        return res.status(400).json({ error: 'day required (YYYY-MM-DD)' });
      }
      // One day per request (Vercel time limit); the UI iterates ranges.
      const { generate, persist } = await import('../scheduler/src/generate.js');
      const result = await generate(day);
      const validation = await persist(result);
      const out: GenerateResponse = {
        day, rows: result.assignments.length, issues: result.issues,
        validation: validation as DraftFinding[],
      };
      return res.status(200).json(out);
    }

    return res.status(405).json({ error: 'method not allowed' });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e instanceof Error ? e.message : 'server error' });
  }
}
