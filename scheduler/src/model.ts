import { Minutes } from './time.js';
import type { RationaleEntry } from './rationale.js';
import type { Tunables } from './config.js';

export interface Soldier {
  id: number;
  name: string;
  platoon: string;
  role: string;
  rifle: number;
  quals: string[];
  isCommander: boolean;        // מ"מ/סמל/מ"כ/מ"ח
  isSeniorCommander: boolean;  // מ"מ/סמל
  isDudDriver: boolean;
  isTigerDriver: boolean;
  /** H6c: null = unrestricted; else the only positions this soldier may fill
   *  (position NAMES, loaded from the soldier_allowed_positions FK table) */
  allowedPositions: string[] | null;
}

/** One position_candidates row (id-based closed lists, owner decision
 *  2026-07-19): subPositionId NULL = position-level pool (קצין מוצב);
 *  set = named candidate for that seat (חפק). priority NULL = unordered
 *  (fairness-rotated); 1..n = ordered preference (קשר). The name rides along
 *  from the soldiers join for display — never used for matching. */
export interface PositionCandidate {
  subPositionId: number | null;
  soldierId: number;
  name: string;
  priority: number | null;
}

/** EFFECTIVE positions.config (daily-implied keys resolved by
 *  effectiveConfig). A type alias (not interface) on purpose — its implicit
 *  index signature keeps it assignable to the Record<string, any> helpers. */
export type PositionConfig = {
  /** 14:00–14:00 sleeping day duty; implies night_exempt + full_rest_after +
   *  yomi_display (explicit keys override) */
  daily?: boolean;
  continuity?: boolean;
  same_platoon?: boolean;
  night_exempt?: boolean;
  full_rest_after?: boolean;
  yomi_display?: boolean;
  /** H6b seat metadata; the candidate lists live in position_candidates */
  seat_rules?: SeatRule[];
  staff_all_roles?: string[];
  /** H6-pool closed-list MARKER (boolean): membership = the position's
   *  position_candidates rows with sub_position_id NULL */
  candidate_pool?: boolean;
  flex_seats?: { min: number; max: number };
  group_size?: number;
  driver_qual?: string;
  /** H8 carve-out: internally-scheduled daily duty, may be ENTERED with any
   *  rest (מגן/חפק/קצין מוצב); rest after is unchanged */
  no_rest_floor?: boolean;
  /** H9 relaxation: a soldier whose exit windows are all inside 22:00–06:00
   *  may hold this daily position on his exit day (תורנים) */
  night_exit_ok?: boolean;
};

export interface Position {
  id: number;
  name: string;
  missionClass: 'static' | 'dynamic' | 'readiness' | 'rest' | 'other';
  isScheduled: boolean;
  config: PositionConfig;
  /** position_candidates rows for this position (closed pools + named seats) */
  candidates?: PositionCandidate[];
}

/** H6b named-seat rule METADATA (positions.config.seat_rules, e.g. חפק): each
 *  sub-position seat is filled only from its dedicated candidate list — the
 *  soldier list itself is the position_candidates rows for the seat's sub. */
export interface SeatRule {
  sub: string;
  /** role-based candidates, ordered by this list (e.g. מ"פ before סמ"פ) */
  roles?: string[];
  ordered?: boolean;
  /** once the seat is covered, unchosen candidates return to the general pool */
  release_unpicked?: boolean;
  /** the seat's rows are commander seats (is_commander_seat) */
  commander?: boolean;
  /** expected qualification for the seat (e.g. 'חובש', 'נהג דוד'): the named
   *  lists stay authoritative, but a mismatch is flagged (generation issue +
   *  validator warning `seat_qualification`) */
  qual?: string;
}

export interface Slot {
  positionId: number;
  subPositionId: number | null;
  subName: string | null;
  period: [Minutes, Minutes];
  seats: number;
  commanderFirstSeat: boolean;
}

export interface Fairness {
  nightCount7d: number;
  nightCountTotal: number;
  missionHours7d: number;
  weightedHours7d: number;
  readinessHours7d: number;
  trackerHoursTotal: number;
  positionCounts: Record<string, number>;
}

export interface Assignment {
  soldierId: number;
  positionId: number;
  subPositionId: number | null;
  period: [Minutes, Minutes];
  seatIndex: number;
  isCommanderSeat: boolean;
  blocksOverlap: boolean;
  source: 'auto' | 'chain';
  violations: string[];
  /** structured "why picked" entries, snapshotted at decision time */
  rationale: RationaleEntry[];
}

/** Serializable side-channel data for the HTML generation report
 *  (src/report.ts). Assembled by generate() from Context + Level-1 outputs so
 *  the report builders stay pure (no DB, no Gen access). */
export interface ReportMeta {
  soldiers: {
    id: number; name: string; platoon: string; role: string;
    /** fairness snapshot as of generation — report chip tooltips */
    nights7d: number; weightedHours7d: number; positionCounts: Record<string, number>;
    allowedPositions: string[] | null;
  }[];
  positions: {
    id: number; name: string; missionClass: string;
    daily: boolean; chainOverlay: boolean; staffAllRoles: boolean;
  }[];
  /** unavailability windows (minutes) intersecting the day, per soldier id */
  blocked: Record<string, [number, number][]>;
  /** H9 half-day exit windows, per soldier id */
  exits: Record<string, [number, number][]>;
  /** honored human locks (process step 1) */
  locks: { soldierId: number; positionName: string; kind: 'day' | 'shift' }[];
  /** closed-list positions: members + who was unavailable today */
  pools: { position: string; members: string[]; unavailable: string[] }[];
  /** soldier ids still reserved to a seat-rule seat (H6b) — by-design rest */
  seatReserved: string[];
  /** soldier id -> Level-1 rationale entries (why he landed in his bucket).
   *  NB: id keys are strings — pg returns bigint columns as strings. */
  level1Rationale: Record<string, RationaleEntry[]>;
  /** position id -> distinct soldiers needed (demand AFTER flex sizing) */
  demand: Record<string, number>;
  /** position id -> baseline demand BEFORE flex sizing (the day's real need —
   *  flex absorbs surplus into מגן / shrinks סיור, masking the raw balance) */
  demandBefore: Record<string, number>;
  /** flex decisions: positions whose per-shift seat count changed (max seats
   *  across the position's slots, before vs after Level 1) */
  flex: { positionId: number; before: number; after: number }[];
  /** the persisted weekly מגן-commander decision (magen_commander_history) —
   *  the commander's display NAME, resolved from his soldier_id at load */
  magenCommander?: string;
  /** sub-position id -> display name */
  subNames: Record<string, string>;
  restPositionId?: number;
  homePositionId?: number;
}

/** One generated day, in memory — persisted by src/persist.ts. */
export interface GenerateResult {
  day: string;
  assignments: Assignment[];
  /** Level-1 buckets: soldier id -> position id */
  level1: Map<number, number>;
  issues: string[];
  /** report-support data (filled by generate(); optional so tests may build
   *  bare results) */
  report?: ReportMeta;
}

export interface ChainRule {
  targetPosition: number;
  targetStart: string;   // 'HH:MM'
  sourcePosition: number;
  sourceStart: string;
  sourceDayOffset: number;
  pick: 'all' | 'min_tracker_hours';
}

export interface Context {
  day: string;
  soldiers: Map<number, Soldier>;
  positions: Map<number, Position>;
  positionByName: Map<string, number>;
  slots: Slot[];
  fairness: Map<number, Fairness>;
  /** existing assignments overlapping [day-8d, day+1 14:00) — history + prior drafts + locks */
  existing: Map<number, { positionId: number; period: [Minutes, Minutes]; missionClass: string }[]>;
  /** yesterday's Level-1 position per soldier */
  yesterdayPosition: Map<number, number>;
  /** consecutive static-only days ending yesterday, per soldier */
  staticStreak: Map<number, number>;
  /** T6 (soft): consecutive days of only static+readiness work (constant
   *  on-call) ending yesterday, per soldier */
  onCallStreak: Map<number, number>;
  /** consecutive nights ending yesterday, per soldier (R6: max 2 in a row) */
  nightStreak: Map<number, number>;
  /** T5 (soft): תורנות count per soldier in the rolling 7 days before `day` */
  toranutCount7d: Map<number, number>;
  /** soldiers unavailable (fully or partially) today: id -> blocked windows */
  blocked: Map<number, [Minutes, Minutes][]>;
  /** H9: approved half-day exit windows intersecting the day (also merged into
   *  `blocked`); presence here means "exit day" — no daily duty, no readiness
   *  row, shifts packed around the window */
  exits: Map<number, [Minutes, Minutes][]>;
  /** locked rows for this day already in DB (kept as-is). sub/seat identify
   *  the exact seat they hold — the generator must not re-fill it (the DB's
   *  seat uniqueness index rejects a duplicated (slot, seat)). */
  lockedShift: { soldierId: number; positionId: number; subPositionId: number | null;
                 seatIndex: number; period: [Minutes, Minutes] }[];
  lockedDay: Map<number, number>; // soldier -> position
  chainRules: ChainRule[];
  /** the מגן-commander decision effective for `day` (magen_commander_history:
   *  latest valid_from <= day), with the display name joined from soldiers */
  magenCommander?: { soldierId: number; name: string };
  /** the INCOMING week's מגן commander — set only when tomorrow is a Sunday;
   *  anchors the arriving crew halves at the Sunday-08:00 changeover */
  nextMagenCommander?: { soldierId: number; name: string };
  config: Record<string, any>;
  /** resolved numeric tunables from `config` (see src/config.ts) */
  tunables: Tunables;
}
