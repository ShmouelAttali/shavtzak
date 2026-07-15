import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getPool, DATE_RE } from './_db.js';

// ── Types (imported by the frontend as ../../api/fairness) ─────────────────
export interface FairnessRow {
  soldierId: number;
  name: string;
  platoon: string;
  role: string;
  nightCount7d: number;
  nightCountTotal: number;
  missionHours7d: number;
  weightedHours7d: number;
  readinessHours7d: number;
  trackerHoursTotal: number;
  positionCounts: Record<string, number>;
}

export interface SpreadStat { min: number; max: number; avg: number; stddev: number }

export interface FairnessResponse {
  date: string;                 // window = 7 days ending at this schedule day
  rows: FairnessRow[];
  spread: { nights: SpreadStat; weightedHours: SpreadStat };
}

function spread(values: number[]): SpreadStat {
  if (!values.length) return { min: 0, max: 0, avg: 0, stddev: 0 };
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, b) => a + (b - avg) ** 2, 0) / values.length;
  const r = (x: number) => Math.round(x * 10) / 10;
  return { min: r(Math.min(...values)), max: r(Math.max(...values)), avg: r(avg), stddev: r(Math.sqrt(variance)) };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method !== 'GET') return res.status(405).json({ error: 'method not allowed' });
  const date = String(req.query.date ?? '');
  if (!DATE_RE.test(date)) return res.status(400).json({ error: 'date required (YYYY-MM-DD)' });

  try {
    const { rows } = await getPool().query(
      `select f.soldier_id, s.full_name, s.platoon, coalesce(s.role,'') role,
              f.night_count_7d, f.night_count_total, f.mission_hours_7d,
              f.weighted_hours_7d, f.readiness_hours_7d, f.tracker_hours_total,
              f.position_counts
       from soldier_fairness($1) f
       join soldiers s on s.id = f.soldier_id
       where s.is_schedulable
       order by s.full_name collate "C"`, [date]);

    const out: FairnessResponse = {
      date,
      rows: rows.map((r) => ({
        soldierId: Number(r.soldier_id), name: r.full_name, platoon: r.platoon, role: r.role,
        nightCount7d: Number(r.night_count_7d),
        nightCountTotal: Number(r.night_count_total),
        missionHours7d: Math.round(Number(r.mission_hours_7d) * 10) / 10,
        weightedHours7d: Math.round(Number(r.weighted_hours_7d) * 10) / 10,
        readinessHours7d: Math.round(Number(r.readiness_hours_7d) * 10) / 10,
        trackerHoursTotal: Math.round(Number(r.tracker_hours_total) * 10) / 10,
        positionCounts: r.position_counts ?? {},
      })),
      spread: {
        nights: spread(rows.map((r) => Number(r.night_count_7d))),
        weightedHours: spread(rows.map((r) => Number(r.weighted_hours_7d))),
      },
    };
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json(out);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e instanceof Error ? e.message : 'server error' });
  }
}
