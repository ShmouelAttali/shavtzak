// Selected-tab ↔ URL (?tab=) + localStorage plumbing, kept pure so it can be
// unit-tested without a DOM: App.tsx owns the actual window/localStorage reads
// and passes their values in.
//
// Precedence on load: ?tab= (a shared link always wins) → the remembered tab
// (a bare URL reopens where the user left off) → fallback.
import type { TabId } from '../types';

export const TAB_PARAM = 'tab';
export const TAB_STORAGE_KEY = 'shavtzak:activeTab';

/** The value as a TabId, or null when absent/unknown (stale link, renamed tab). */
export function parseTabId(value: string | null | undefined, valid: readonly TabId[]): TabId | null {
  return value && (valid as readonly string[]).includes(value) ? (value as TabId) : null;
}

/** `search` is a location.search string ("?tab=roster"); `stored` the remembered tab. */
export function resolveInitialTab(
  search: string, stored: string | null, valid: readonly TabId[], fallback: TabId,
): TabId {
  return parseTabId(new URLSearchParams(search).get(TAB_PARAM), valid)
    ?? parseTabId(stored, valid)
    ?? fallback;
}

/** `href` with ?tab=<id>, or null when it already says exactly that (nothing to
 *  write — avoids a pointless history entry on every render). Other query
 *  params and the hash (Clerk's sign-in routing) are preserved. */
export function withTabParam(href: string, id: TabId): string | null {
  const url = new URL(href);
  if (url.searchParams.get(TAB_PARAM) === id) return null;
  url.searchParams.set(TAB_PARAM, id);
  return url.toString();
}
