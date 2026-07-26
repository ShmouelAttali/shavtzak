// Client-side double-booking detection for the צור שבצק replacement popup
// (owner 2026-07-26). Assigning a soldier who already holds a BLOCKING row in
// the same hours is rejected by the DB (no_double_booking), so the tab must
// spot it BEFORE the request and ask whether to vacate the other seat — naming
// it. Everything here is derived from what the tab already has in hand: the
// day's groups (position → sub → time label → names) and its `meta` map.
//
// The server is still the arbiter: what the officer approves travels as
// `force`, and api/draft.ts re-finds the overlapping rows itself (a conflict
// this file cannot see — e.g. a row belonging to the adjacent schedule day —
// is caught there, either as an eviction or as the usual 409).
import type { DraftDay } from '../../api/draft';

/** Minutes from the schedule day's 14:00 anchor (SPEC: day = 14:00 → 14:00). */
export interface SlotSpan { start: number; end: number }

const DAY_MINUTES = 24 * 60;
const ANCHOR = 14 * 60;
const TOMORROW = ' (למחרת)';

/** Offset of a wall-clock time inside the schedule day. Mirrors the ordering
 *  convention of api/draft.ts's timeVal / the UI's timeToVal: an hour before
 *  14:00 is the day's TAIL, i.e. tomorrow morning. */
function offsetOf(h: number, min: number): number {
  return (h < 14 ? h + 24 : h) * 60 + min - ANCHOR;
}

/** Parse a rendered slot label into its span, or null when unparseable.
 *  'יומי' (a daily duty — מגן/חפק/תורנים/מפלג, a 14:00→14:00 row) covers the
 *  whole day, so it overlaps everything. */
export function parseSlotSpan(label: string): SlotSpan | null {
  const t = label.replace(TOMORROW, '').trim();
  if (!t || t === 'יומי') return { start: 0, end: DAY_MINUTES };
  const m = /^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/.exec(t);
  if (!m) return null;
  const [h1, m1, h2, m2] = m.slice(1).map(Number);
  const start = offsetOf(h1, m1);
  let dur = (h2 * 60 + m2) - (h1 * 60 + m1);
  if (dur <= 0) dur += DAY_MINUTES;            // wraps past midnight (18:00-02:00)
  return { start, end: start + dur };
}

export const spansOverlap = (a: SlotSpan, b: SlotSpan): boolean =>
  a.start < b.end && b.start < a.end;

/** One seat the incoming soldier already holds during the target hours. */
export interface SlotConflict {
  position: string;      // station group (סיור / עמדות הגנה / מגן …)
  sub: string;           // sub-position, when the group has named posts
  time: string;          // the other slot's rendered label
}

/** The clicked seat: its label, who sits in it now, and whether its rows block
 *  overlap at all (a readiness overlay — כרמל/גשש/התקפי — legally shares its
 *  hours, so nothing can conflict with it). */
export interface ReplaceTarget {
  time: string;
  outgoing: string;
  blocks?: boolean;      // default true: prompt rather than hit a DB error
}

const key = (c: SlotConflict) => `${c.position}|${c.sub}|${c.time}`;

/** Every blocking seat `candidate` holds that overlaps the target slot's hours.
 *  Empty when the target itself is non-blocking. The clicked slot is skipped —
 *  a candidate found THERE is already in that shift, which the server reports
 *  as such (a no-op, not something to evict). */
export function findSlotConflicts(day: DraftDay, candidate: string, target: ReplaceTarget): SlotConflict[] {
  if (target.blocks === false) return [];
  const span = parseSlotSpan(target.time);
  if (!span) return [];
  const out = new Map<string, SlotConflict>();
  for (const group of day.groups) {
    for (const sub of group.subTypes) {
      for (const slot of sub.times) {
        if (!slot.soldiers.includes(candidate)) continue;
        // the clicked slot itself: same label AND the outgoing soldier sits there
        if (slot.time === target.time && slot.soldiers.includes(target.outgoing)) continue;
        const other = parseSlotSpan(slot.time);
        if (!other || !spansOverlap(other, span)) continue;
        // a readiness overlay of HIS may share the hours (blocks_overlap=false)
        if (day.meta[`${candidate}|${slot.time}`]?.blocksOverlap === false) continue;
        const c: SlotConflict = { position: group.name, sub: sub.sug, time: slot.time };
        out.set(key(c), c);
      }
    }
  }
  return [...out.values()];
}

/** "סיור — נהג (18:00-02:00)" — what the confirmation names as the seat that
 *  will be vacated. */
export function conflictLabel(c: SlotConflict): string {
  const where = c.sub && c.sub !== c.position ? `${c.position} — ${c.sub}` : c.position;
  return `${where} (${c.time === 'יומי' ? 'יומי' : c.time})`;
}

/** soldier name -> conflict hint, for every candidate the picker will list, so
 *  the officer sees the clash BEFORE clicking. */
export function conflictNotes(day: DraftDay, target: ReplaceTarget): Record<string, string> {
  const names = new Set<string>();
  for (const g of day.groups) for (const s of g.subTypes) for (const t of s.times) {
    for (const n of t.soldiers) names.add(n);
  }
  const out: Record<string, string> = {};
  for (const name of names) {
    if (name === target.outgoing) continue;
    const conflicts = findSlotConflicts(day, name, target);
    if (conflicts.length) out[name] = conflicts.map(conflictLabel).join(' + ');
  }
  return out;
}
