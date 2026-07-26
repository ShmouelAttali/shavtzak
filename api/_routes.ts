// The one route table for the whole API.
//
// Vercel's Hobby plan caps a deployment at 12 Serverless Functions, and every
// file directly under api/ becomes one — so the handlers live in api/_handlers/
// (underscore ⇒ Vercel does not route it) and api/[...route].ts dispatches to
// them through this table as a SINGLE function. scripts/dev-api-server.ts uses
// the same table, so local dev and production route identically by construction.
//
// Adding an endpoint = a file in api/_handlers/ + one line here. Nothing else.
import type { VercelRequest, VercelResponse } from '@vercel/node';

export type ApiHandler = (req: VercelRequest, res: VercelResponse) => unknown | Promise<unknown>;

// Lazy imports: only the handler actually being hit gets evaluated, so one
// request never pays for parsing the other thirteen.
export const ROUTES: Record<string, () => Promise<{ default: ApiHandler }>> = {
  'soldiers': () => import('./_handlers/soldiers.js'),
  'shavtzak': () => import('./_handlers/shavtzak.js'),
  'exits': () => import('./_handlers/exits.js'),
  'draft': () => import('./_handlers/draft.js'),
  'fairness': () => import('./_handlers/fairness.js'),
  'admins': () => import('./_handlers/admins.js'),
  'exit-requests': () => import('./_handlers/exit-requests.js'),
  'report': () => import('./_handlers/report.js'),
  'publish': () => import('./_handlers/publish.js'),
  'unpublish': () => import('./_handlers/unpublish.js'),
  'hamal': () => import('./_handlers/hamal.js'),
  'day-structure': () => import('./_handlers/day-structure.js'),
  'roster': () => import('./_handlers/roster.js'),
  'presence': () => import('./_handlers/presence.js'),
};

/** '/api/draft' | 'draft' | ['draft'] → 'draft'; anything unroutable → ''. */
export function routeKey(path: string | string[] | undefined): string {
  const raw = Array.isArray(path) ? path.join('/') : (path ?? '');
  return raw.replace(/^\/?(api\/)?/, '').replace(/\/+$/, '').split('?')[0];
}
