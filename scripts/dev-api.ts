// Local API server for `npm run dev` (vite proxies /api -> :3001).
// Serves ALL api/ handlers without needing `vercel dev`.
// Usage: npx tsx scripts/dev-api.ts   (reads .env.local)
import http from 'node:http';
import { parse } from 'node:url';
import { readFileSync } from 'node:fs';

// minimal .env / .env.local loader (no dotenv dep; .env.local wins)
for (const f of ['../.env', '../.env.local']) {
  try {
    for (const line of readFileSync(new URL(f, import.meta.url), 'utf8').split('\n')) {
      const m = line.match(/^([A-Z_]+)=(.*)$/);
      if (m) process.env[m[1]] = m[2];
    }
  } catch { /* file absent */ }
}

const handlers: Record<string, () => Promise<{ default: Function }>> = {
  '/api/soldiers': () => import('../api/soldiers.js'),
  '/api/shavtzak': () => import('../api/shavtzak.js'),
  '/api/exits': () => import('../api/exits.js'),
  '/api/draft': () => import('../api/draft.js'),
  '/api/fairness': () => import('../api/fairness.js'),
};

http.createServer(async (req, res) => {
  const url = parse(req.url ?? '', true);
  const load = handlers[url.pathname ?? ''];
  if (!load) { res.statusCode = 404; return res.end('not found'); }
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const raw = Buffer.concat(chunks).toString();
  const vreq: any = Object.assign(req, {
    query: url.query,
    body: raw && (req.headers['content-type'] ?? '').includes('json') ? JSON.parse(raw) : raw || undefined,
  });
  const vres: any = res;
  vres.status = (code: number) => { res.statusCode = code; return vres; };
  vres.json = (obj: unknown) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(obj)); return vres; };
  vres.send = (body: string) => { res.end(body); return vres; };
  try {
    await (await load()).default(vreq, vres);
  } catch (e) {
    console.error(e);
    if (!res.headersSent) { res.statusCode = 500; res.end(JSON.stringify({ error: String(e) })); }
  }
}).listen(3001, () => console.log('dev api on http://localhost:3001'));
