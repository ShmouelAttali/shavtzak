// Pure presence math for the נוכחות tab — no DB, no React, unit-tested in
// tests/presence-plan.test.ts and reused by api/presence.ts.
//
// The `unavailability` table stores SPARSE periods; the tab shows (and edits) a
// per-soldier × per-CALENDAR-day status matrix. The two directions must be
// exact inverses of each other, and both must reproduce what
// scheduler/import/cleanup.py part 3 wrote, so a hand edit and a historical
// import are indistinguishable:
//
//   full-day kind on days X..Y  ⇔  ONE row [X bus(X), Y+1 bus(Y+1))
//   where bus(d) = 08:00 on a Sunday, 06:00 on any other day.
//
// Day attribution (the read direction) therefore is:
//   * full-day kind → the days lower(period).date .. upper(period).date - 1
//     (the run ends at the bus hour of the morning AFTER its last day);
//   * anything else (the partial kinds יציאה בבוקר / ב14:00 / בערב,
//     חזרה ב14:00 / בערב and the short-exit יציאה rows) → the single day
//     lower(period).date.
//
// NOTE — this deliberately does NOT go through the `presence()` DB function:
// that one buckets by `day_range()`, i.e. the 14:00→14:00 SCHEDULE day, so a
// one-day [X 06:00, X+1 06:00) block also lands 8h inside schedule day X-1 and
// would light up TWO cells for one edit. Presence is calendar-day data; the
// schedule-day anchor belongs to the generator, not here.

/** Full-day statuses the tab may write. Order = the order offered in the UI. */
export const FULL_DAY_KINDS = ['חופש', 'מחלה', 'לא מגויס', 'שחרור', 'גיוס'] as const;

/** Alternative spellings kept in the DB constraint, collapsed on read/write. */
const KIND_ALIASES: Record<string, string> = { 'לא מגוייס': 'לא מגויס' };

/** The pseudo-status of a day with no unavailability row. Never stored. */
export const PRESENT = 'נוכח';

export function canonicalKind(kind: string): string {
  return KIND_ALIASES[kind] ?? kind;
}

export function isFullDayKind(kind: string): boolean {
  return (FULL_DAY_KINDS as readonly string[]).includes(canonicalKind(kind));
}

/**
 * The states the editor may offer, derived from the DB: the intersection of
 * FULL_DAY_KINDS with the kinds the `unavailability` kind CHECK constraint
 * still accepts, prefixed by נוכח. The constraint stays the single source, so
 * dropping a kind from the schema drops it from the UI.
 */
export function offeredStates(constraintKinds: string[]): string[] {
  const have = new Set(constraintKinds.map(canonicalKind));
  return [PRESENT, ...FULL_DAY_KINDS.filter((k) => have.has(k))];
}

// ── calendar helpers (ISO YYYY-MM-DD, naive local, DST-proof via UTC math) ───

const MS_DAY = 86_400_000;
const isoMs = (iso: string): number => Date.parse(`${iso}T00:00:00Z`);
const msIso = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

export function addDays(iso: string, n: number): string {
  return msIso(isoMs(iso) + n * MS_DAY);
}

/** 0 = Sunday … 6 = Saturday. */
export function dayOfWeek(iso: string): number {
  return new Date(isoMs(iso)).getUTCDay();
}

/** Bus hour on calendar day `iso`: 08:00 on Sunday, 06:00 otherwise. */
export function busHour(iso: string): number {
  return dayOfWeek(iso) === 0 ? 8 : 6;
}

/** The naive timestamp of `iso`'s bus hour — a full-day run's boundary. */
export function busTs(iso: string): string {
  return `${iso} ${String(busHour(iso)).padStart(2, '0')}:00:00`;
}

/** Inclusive list of days from..to (empty when to < from). */
export function dayRange(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

// ── rows ────────────────────────────────────────────────────────────────────

/** One `unavailability` row, timestamps as naive 'YYYY-MM-DD HH:MM:SS'. */
export interface UnavailRow {
  id: number;
  kind: string;
  start: string;
  end: string;
}

const tsMs = (ts: string): number => Date.parse(`${ts.slice(0, 10)}T${ts.slice(11, 19) || '00:00:00'}Z`);

/** The calendar days a row occupies — see the attribution rule at the top. */
export function rowDays(r: UnavailRow): string[] {
  const first = r.start.slice(0, 10);
  if (!isFullDayKind(r.kind)) return [first];
  const last = addDays(r.end.slice(0, 10), -1);
  return last < first ? [first] : dayRange(first, last);
}

/** Hours of `r` inside calendar day `day` (0 when disjoint). */
function overlapHours(r: UnavailRow, day: string): number {
  const from = tsMs(`${day} 00:00:00`);
  const to = from + MS_DAY;
  return Math.max(0, Math.min(tsMs(r.end), to) - Math.max(tsMs(r.start), from)) / 3_600_000;
}

/**
 * Read direction: the status of every day in `days` for ONE soldier.
 * When several rows claim the same day (a cross-kind overlay is legal — a
 * return-day partial sits on the tail of a full block) the one covering most of
 * the calendar day wins, full-day kinds before partials, lowest id last.
 * Kinds are NOT canonicalized: partial kinds are shown verbatim.
 */
export function presenceMatrix(days: string[], rows: UnavailRow[]): Record<string, string> {
  const byDay = new Map<string, UnavailRow[]>();
  for (const r of rows) {
    for (const d of rowDays(r)) {
      const list = byDay.get(d);
      if (list) list.push(r); else byDay.set(d, [r]);
    }
  }
  const out: Record<string, string> = {};
  for (const d of days) {
    const cands = byDay.get(d);
    if (!cands || !cands.length) { out[d] = PRESENT; continue; }
    const best = [...cands].sort((a, b) =>
      overlapHours(b, d) - overlapHours(a, d)
      || Number(isFullDayKind(b.kind)) - Number(isFullDayKind(a.kind))
      || a.id - b.id)[0];
    out[d] = isFullDayKind(best.kind) ? canonicalKind(best.kind) : best.kind;
  }
  return out;
}

// ── write ───────────────────────────────────────────────────────────────────

export interface PresencePlan {
  /** Rows to remove (they are re-emitted by `insert` where still wanted). */
  deleteIds: number[];
  insert: { kind: string; start: string; end: string }[];
}

/**
 * Write direction: turn "these days now have these statuses" into a delete +
 * insert plan for ONE soldier.
 *
 * `existing` must be every row of that soldier that overlaps the touched days
 * OR abuts them (api/presence.ts fetches [minDay-1 00:00, maxDay+2 00:00)) —
 * the neighbours are what lets a new run MERGE into an adjacent same-kind row
 * instead of abutting a duplicate.
 *
 * Semantics:
 *  * every full-day row handed in is rebuilt from scratch (delete + re-emit),
 *    so runs merge and split naturally in day space;
 *  * a partial row is dropped when its day is touched (choosing חופש or נוכח on
 *    a cell showing יציאה בבוקר replaces it) and left completely alone
 *    otherwise;
 *  * consecutive days of the same kind collapse into ONE row
 *    [firstDay bus, lastDay+1 bus); a נוכח day in the middle of a block splits
 *    it into two rows.
 */
export function planPresenceWrite(
  desired: { day: string; status: string }[],
  existing: UnavailRow[],
): PresencePlan {
  const touched = new Map<string, string>();
  for (const d of desired) touched.set(d.day, canonicalKind(d.status));
  if (!touched.size) return { deleteIds: [], insert: [] };

  const deleteIds: number[] = [];
  const dayKind = new Map<string, string>();

  for (const r of existing) {
    if (isFullDayKind(r.kind)) {
      deleteIds.push(r.id);
      for (const d of rowDays(r)) dayKind.set(d, canonicalKind(r.kind));
    } else if (touched.has(r.start.slice(0, 10))) {
      deleteIds.push(r.id);
    }
  }
  for (const [day, status] of touched) dayKind.set(day, status);

  const runs: { kind: string; first: string; last: string }[] = [];
  for (const day of [...dayKind.keys()].sort()) {
    const kind = dayKind.get(day)!;
    if (kind === PRESENT) continue;
    const prev = runs[runs.length - 1];
    if (prev && prev.kind === kind && addDays(prev.last, 1) === day) prev.last = day;
    else runs.push({ kind, first: day, last: day });
  }

  return {
    deleteIds,
    insert: runs.map((r) => ({
      kind: r.kind, start: busTs(r.first), end: busTs(addDays(r.last, 1)),
    })),
  };
}
