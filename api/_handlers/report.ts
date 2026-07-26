import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getPool, DATE_RE } from '../_db.js';

// Serves the self-contained generation report HTML stored on schedule_days
// (written at persist time — scheduler/src/persist.ts). Read-only, officer-
// gated on the client like the rest of the draft surface (no server auth by
// design — see api/draft.ts).
//
//   GET /api/report?day=YYYY-MM-DD   → that day's stored report_html (404 if none)
//   GET /api/report?from=..&to=..    → single day when from===to; otherwise a
//                                       lightweight index linking to each
//                                       generated day's report in the range.

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

async function dayReport(day: string): Promise<string | null> {
  const pool = getPool();
  const r = await pool.query<{ report_html: string | null }>(
    `select report_html from schedule_days where day = $1`, [day]);
  return r.rows[0]?.report_html ?? null;
}

/** Index page for a multi-day range: one link per day that has a stored
 *  report. Kept deliberately simple (per-day pages hold the full detail). */
async function rangeIndex(from: string, to: string): Promise<string> {
  const pool = getPool();
  const r = await pool.query<{ day: string; has_report: boolean; status: string }>(
    `select day::text, (report_html is not null) has_report, status
     from schedule_days where day between $1 and $2 order by day`, [from, to]);
  const items = r.rows.map((d) => d.has_report
    ? `<li><a href="/api/report?day=${esc(d.day)}">${esc(d.day)}</a> <span class="s">(${esc(d.status)})</span></li>`
    : `<li class="none">${esc(d.day)} <span class="s">— אין דוח</span></li>`).join('\n');
  return `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>דוחות שבצ"ק ${esc(from)} – ${esc(to)}</title>
<style>
  body{font-family:system-ui,-apple-system,"Segoe UI",Arial,sans-serif;background:#f8fafc;color:#0f172a;margin:0;padding:2rem}
  .card{max-width:640px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:1.5rem 2rem}
  h1{font-size:1.25rem;margin:0 0 1rem}
  ul{list-style:none;padding:0;margin:0}
  li{padding:.5rem 0;border-bottom:1px solid #f1f5f9}
  li.none{color:#94a3b8}
  a{color:#2563eb;text-decoration:none;font-weight:600}
  a:hover{text-decoration:underline}
  .s{color:#94a3b8;font-size:.85em;font-weight:400}
</style></head><body>
<div class="card"><h1>דוחות שבצ"ק — ${esc(from)} עד ${esc(to)}</h1>
<ul>${items || '<li class="none">אין ימים בטווח</li>'}</ul></div>
</body></html>`;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'method not allowed' });

  try {
    const day = req.query.day ? String(req.query.day) : '';
    const from = req.query.from ? String(req.query.from) : '';
    const to = req.query.to ? String(req.query.to ?? from) : from;

    if (day) {
      if (!DATE_RE.test(day)) return res.status(400).json({ error: 'day must be YYYY-MM-DD' });
      const html = await dayReport(day);
      if (html === null) return res.status(404).json({ error: 'no report for this day' });
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).send(html);
    }

    if (from) {
      if (!DATE_RE.test(from) || !DATE_RE.test(to)) {
        return res.status(400).json({ error: 'from/to must be YYYY-MM-DD' });
      }
      if (from === to) {
        const html = await dayReport(from);
        if (html === null) return res.status(404).json({ error: 'no report for this day' });
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).send(html);
      }
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).send(await rangeIndex(from, to));
    }

    return res.status(400).json({ error: 'day or from/to required (YYYY-MM-DD)' });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e instanceof Error ? e.message : 'server error' });
  }
}
