import { Minutes } from './time.js';

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
}

export interface Position {
  id: number;
  name: string;
  missionClass: 'static' | 'dynamic' | 'readiness' | 'rest' | 'other';
  isScheduled: boolean;
  blocksDay: boolean;
  /** jsonb flags: continuity, same_platoon, staffed_by, open_for_attack... */
  config: Record<string, any>;
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
}

export interface ChainRule {
  targetPosition: number;
  targetStart: string;   // 'HH:MM'
  sourcePosition: number;
  sourceStart: string;
  sourceDayOffset: number;
  pick: 'all' | 'highest_rifle' | 'min_tracker_hours';
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
  /** soldiers unavailable (fully or partially) today: id -> blocked windows */
  blocked: Map<number, [Minutes, Minutes][]>;
  /** locked rows for this day already in DB (kept as-is) */
  lockedShift: { soldierId: number; positionId: number; period: [Minutes, Minutes] }[];
  lockedDay: Map<number, number>; // soldier -> position
  chainRules: ChainRule[];
  config: Record<string, any>;
}
