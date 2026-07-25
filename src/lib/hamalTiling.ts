// Pure tiling math for the חמל tab.
//
// The חמל day runs on its OWN cycle: it starts at 10:00 and covers a contiguous
// 24h to 10:00 the next day. The tab's shifts must ALWAYS form an exact
// partition of that day — no gaps, no overlaps: the first shift starts at 10:00,
// the last ends at 10:00 (next day), and every internal boundary is shared by
// two adjacent shifts.
//
// Internally we work in "minutes-from-10:00" offsets in [0, 1440]:
//   10:00 -> 0, 18:00 -> 480, 02:00 -> 960, next-day 10:00 -> 1440.
// A shift is the half-open offset segment [startOff, endOff). A tiling is the
// list of segments b0=0 < b1 < ... < b_{n-1} < 1440 (bn = 1440), each carrying a
// soldierId (or null when empty). All functions take and return clock-string
// shifts and re-normalize, so the contiguity invariant always holds on output.

export interface HamalTileShift {
  start: string;       // "HH:MM"
  end: string;         // "HH:MM"
  soldierId: number | null;
}

/** Wall clock "HH:MM" -> minutes-from-10:00 in [0, 1439]. 10:00 -> 0. */
export function clockToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return ((((h || 0) * 60 + (m || 0)) - 600) % 1440 + 1440) % 1440;
}

/** minutes-from-10:00 -> wall clock "HH:MM". Both 0 and 1440 render as "10:00". */
export function minutesToClock(off: number): string {
  const wall = (((Math.round(off) % 1440) + 1440) % 1440 + 600) % 1440;
  const h = Math.floor(wall / 60), m = wall % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

const DAY = 1440;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(v, hi));

/** A shift's END offset: like clockToMinutes but "10:00" means end-of-day (1440),
 *  not 0 — an end can legitimately be the day's closing boundary. */
function endOffset(hhmm: string): number {
  const m = clockToMinutes(hhmm);
  return m === 0 ? DAY : m;
}

interface Seg { startOff: number; endOff: number; soldierId: number | null }

/** Parse arbitrary (possibly non-contiguous / unsorted / overlapping) shifts into
 *  a contiguous [0,1440] tiling of segments. Deterministic normalization:
 *   - order shifts by their start offset;
 *   - drop duplicate starts (keep the first);
 *   - the first shift is anchored at 10:00 (offset 0) and the last ends at 10:00
 *     (offset 1440); every other shift's end is its successor's start.
 *  This fills gaps and clips overlaps: only the start offsets carry information,
 *  the ends are derived, so any stored windows collapse to one clean tiling. */
function parse(shifts: HamalTileShift[]): Seg[] {
  if (shifts.length === 0) return [];
  const items = shifts
    .map((s) => ({ off: clockToMinutes(s.start), soldierId: s.soldierId ?? null }))
    .sort((a, b) => a.off - b.off);
  const uniq: typeof items = [];
  for (const it of items) {
    if (uniq.length && uniq[uniq.length - 1].off === it.off) continue;
    uniq.push(it);
  }
  const segs: Seg[] = [];
  for (let i = 0; i < uniq.length; i++) {
    segs.push({
      startOff: i === 0 ? 0 : uniq[i].off,
      endOff: i === uniq.length - 1 ? DAY : uniq[i + 1].off,
      soldierId: uniq[i].soldierId,
    });
  }
  return segs;
}

function build(segs: Seg[]): HamalTileShift[] {
  return segs.map((s) => ({
    start: minutesToClock(s.startOff),
    end: minutesToClock(s.endOff),
    soldierId: s.soldierId,
  }));
}

/** Normalize any shift list into a valid contiguous 10:00→10:00 tiling. */
export function normalizeTiling(shifts: HamalTileShift[]): HamalTileShift[] {
  return build(parse(shifts));
}

/** Move the shared boundary between shift `index` and the next shift to `newEnd`.
 *  Shift `index`'s end AND the next shift's start both become the clamped value.
 *  Reducing this shift grows its neighbor; extending it shrinks the neighbor.
 *  Clamped strictly inside (this shift's start, the next shift's end) so neither
 *  shift inverts or is swallowed. No-op on the last shift (its end, 10:00, and the
 *  first shift's start, 10:00, are fixed). Both shifts survive → soldiers kept. */
export function moveBoundary(shifts: HamalTileShift[], index: number, newEnd: string): HamalTileShift[] {
  const segs = parse(shifts);
  if (index < 0 || index >= segs.length - 1) return build(segs);
  const cur = segs[index], next = segs[index + 1];
  const b = clamp(clockToMinutes(newEnd), cur.startOff + 1, next.endOff - 1);
  cur.endOff = b;
  next.startOff = b;
  return build(segs);
}

/** Insert a new empty shift spanning [from, to] and re-tile:
 *   - insert boundaries at X=from and Y=to;
 *   - drop any internal boundary strictly inside (X, Y);
 *   - the segment [X, Y] becomes the new (empty) shift;
 *   - a neighbor truncated at X or Y keeps its soldier; a shift fully absorbed
 *     inside [X, Y] loses its soldier.
 *  The day stays fully covered. If [from,to] is empty/inverted after clamping to
 *  the day it is a no-op (returns the normalized input). */
export function addShift(shifts: HamalTileShift[], from: string, to: string): HamalTileShift[] {
  const segs = parse(shifts);
  const x = clamp(clockToMinutes(from), 0, DAY - 1);
  const y = clamp(endOffset(to), x + 1, DAY);
  if (y <= x) return build(segs);

  // soldierId of the original segment covering offset `off`.
  const ownerAt = (off: number): number | null => {
    for (const s of segs) if (off >= s.startOff && off < s.endOff) return s.soldierId;
    return null;
  };

  // boundary set: day ends + existing starts + X + Y, minus anything inside (X,Y).
  const bounds = new Set<number>([0, DAY, x, y]);
  for (const s of segs) bounds.add(s.startOff);
  const sorted = [...bounds].filter((b) => b <= x || b >= y).sort((a, c) => a - c);

  const out: Seg[] = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const p = sorted[i], q = sorted[i + 1];
    const soldierId = p === x && q === y ? null : ownerAt((p + q) / 2);
    out.push({ startOff: p, endOff: q, soldierId });
  }
  return build(out);
}

/** Remove shift `index`, merging its span into an adjacent shift so the day stays
 *  fully covered: the previous shift's end extends over it, or — if it is the
 *  first shift — the next shift's start extends back to 10:00. The surviving
 *  neighbor keeps its own soldier; the removed shift's soldier is dropped. No-op
 *  when only one shift remains (a day always keeps at least one shift). */
export function removeShift(shifts: HamalTileShift[], index: number): HamalTileShift[] {
  const segs = parse(shifts);
  if (segs.length <= 1 || index < 0 || index >= segs.length) return build(segs);
  if (index === 0) {
    segs[1].startOff = 0;
  } else {
    segs[index - 1].endOff = segs[index].endOff;
  }
  segs.splice(index, 1);
  return build(segs);
}
