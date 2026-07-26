import type { VercelRequest, VercelResponse } from '@vercel/node';
import { parseDay, unpublishDay } from './publish.js';

// Draft lifecycle — unpublish route (Task 7A). Shares the logic in publish.ts;
// exists as its own file so /api/unpublish is a real Vercel route.
//   POST /api/unpublish { day }  — 'published' -> 'generated'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });
  try {
    const day = parseDay(req);
    if (!day) return res.status(400).json({ error: 'day required (YYYY-MM-DD)' });
    return await unpublishDay(res, day);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e instanceof Error ? e.message : 'server error' });
  }
}
