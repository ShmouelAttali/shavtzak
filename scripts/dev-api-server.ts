// The dev API's HTTP server, extracted so tests can exercise the REAL request
// path (query parsing, JSON body parsing, handler routing) over an ephemeral
// port — the handler-level suites bypass this seam with mock req/res objects.
// Deliberately NO .env loading here: the entry script (dev-api.ts) owns that,
// and tests must keep their pinned SCHEDULER_DATABASE_URL.
import http from 'node:http';
import { parse } from 'node:url';

const handlers: Record<string, () => Promise<{ default: Function }>> = {
  '/api/soldiers': () => import('../api/soldiers.js'),
  '/api/shavtzak': () => import('../api/shavtzak.js'),
  '/api/exits': () => import('../api/exits.js'),
  '/api/draft': () => import('../api/draft.js'),
  '/api/fairness': () => import('../api/fairness.js'),
  '/api/admins': () => import('../api/admins.js'),
  '/api/exit-requests': () => import('../api/exit-requests.js'),
};

export function createDevApiServer(): http.Server {
  return http.createServer(async (req, res) => {
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
  });
}
