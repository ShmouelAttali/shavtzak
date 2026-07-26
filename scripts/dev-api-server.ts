// The dev API's HTTP server, extracted so tests can exercise the REAL request
// path (query parsing, JSON body parsing, handler routing) over an ephemeral
// port — the handler-level suites bypass this seam with mock req/res objects.
// Deliberately NO .env loading here: the entry script (dev-api.ts) owns that,
// and tests must keep their pinned SCHEDULER_DATABASE_URL.
import http from 'node:http';
import { parse } from 'node:url';
import { ROUTES, routeKey } from '../api/_routes.js';

export function createDevApiServer(): http.Server {
  return http.createServer(async (req, res) => {
    const url = parse(req.url ?? '', true);
    // Same table + same key derivation as the deployed api/[...route].ts, so a
    // route that works locally cannot be missing in production.
    const load = ROUTES[routeKey(url.pathname ?? '')];
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
