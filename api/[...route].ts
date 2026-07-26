// The single Serverless Function that serves every /api/* endpoint — see
// api/_routes.ts for why (Hobby plan: max 12 functions per deployment).
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { ROUTES, routeKey } from './_routes.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // req.url first: it is the path as received, so routing survives whatever
  // the platform does (or fails to do) with the [...route] param — see routeKey.
  const key = routeKey(req.url) || routeKey(req.query.route as string | string[] | undefined);
  const load = ROUTES[key];
  if (!load) { res.status(404).json({ error: `unknown endpoint: /api/${key}` }); return; }
  return (await load()).default(req, res);
}
