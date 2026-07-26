import {createContext, useContext, useEffect, useMemo, useRef, useState} from 'react';
import {todayShavtzakStr} from '../hooks/useShavtzak';
import type {ShavtzakAllData, StationGroup, SubType} from '../../api/_handlers/shavtzak';
import type {DraftAssignmentMeta} from '../../api/_handlers/draft';
import type {Soldier} from '../types';
import type {PopupState} from './SoldierPopup';
import {SoldierPopup} from './SoldierPopup';
import {isCaveat} from '../../scheduler/src/rationale';

// ── Soldier lookup context ─────────────────────────────────────────────────
// (exported so other tabs — e.g. the draft schedule — reuse the same
//  name-rendering/popup system and layout renderers)
export interface SoldierInfo {
    unit: string;
    role: string;
    phone: string
}

export const SoldierCtx = createContext<Map<string, SoldierInfo>>(new Map());
// `time` is the clicked slot's label — the live tab's handler ignores it; the
// draft tab needs it to know WHICH assignment was clicked (its meta/rows are
// keyed `${name}|${time}`).
export const NameClickCtx = createContext<(name: string, info: SoldierInfo | undefined, time?: string) => void>(() => {
});
export const MyNameCtx = createContext<string>('');

// Draft-tab only: per-day `${name}|${time}` meta enables the ⓘ/⚠ rationale
// glyph next to each name. The live tab mounts no provider (ctx stays null),
// so it renders exactly as before.
export const DraftMetaCtx = createContext<Record<string, DraftAssignmentMeta> | null>(null);
export const RationaleClickCtx = createContext<(name: string, time: string, meta: DraftAssignmentMeta) => void>(() => {
});

// Draft-tab only: `${name}|${time}` keys of the seats a replacement is
// currently writing (the clicked seat + any seat being force-vacated). They
// render with a spinner and swallow clicks, so a second edit can't collide
// with a row already in flight — everything else stays editable.
export const PendingSeatsCtx = createContext<Set<string>>(new Set());

const BOLD_ROLES = new Set(['מ"מ', 'מ"פ', 'סמ"פ', 'סמל', 'מ"כ']);
const UNIT_COLOR: Record<string, string> = {
    '1': 'text-red-500',
    '2': 'text-green-600',
    '3': 'text-amber-600',
    'מפל"ג': 'text-purple-700',
    'חמ"ל': 'text-blue-500',
};

function SoldierName({name, time}: { name: string; time?: string }) {
    const lookup = useContext(SoldierCtx);
    const onCLick = useContext(NameClickCtx);
    const myName = useContext(MyNameCtx);
    const draftMeta = useContext(DraftMetaCtx);
    const onRationale = useContext(RationaleClickCtx);
    const pending = useContext(PendingSeatsCtx).has(`${name}|${time ?? ''}`);
    // draft API pads under-filled slots with this marker — render as a red badge
    if (name === 'לא מאויש') {
        return (
            <span className="text-sm whitespace-nowrap leading-snug select-none font-bold text-red-600 bg-red-50 ring-1 ring-red-300 rounded px-1.5 py-0.5">
                ⚠ לא מאויש
            </span>
        );
    }
    const info = lookup.get(name);
    const bold = info ? BOLD_ROLES.has(info.role) : false;
    const color = info ? (UNIT_COLOR[info.unit] ?? 'text-gray-800') : 'text-gray-800';
    const isMe = myName !== '' && name === myName;
    const meta = draftMeta && time !== undefined ? draftMeta[`${name}|${time}`] : undefined;
    const warn = meta ? meta.violations.length > 0 || meta.rationale.some(isCaveat) : false;
    if (pending) {
        return (
            <span
                title="מתבצעת החלפה בשיבוץ זה"
                className={`text-sm whitespace-nowrap leading-snug select-none opacity-50 cursor-wait ${color} ${bold ? 'font-bold' : 'font-medium'}`}
            >
                <span className="animate-spin inline-block ml-0.5 text-blue-500">↺</span>{name}
            </span>
        );
    }
    return (
        <span
            onClick={() => onCLick(name, info, time)}
            className={`text-sm whitespace-nowrap leading-snug select-none cursor-pointer active:opacity-70 ${isMe ? `font-bold ${color} bg-yellow-200 ring-1 ring-yellow-400 rounded px-1.5 py-0.5` : `${color} ${bold ? 'font-bold' : 'font-medium'}`}`}
        >
      {name}
            {meta && (
                <button
                    onClick={e => {
                        e.stopPropagation();
                        onRationale(name, time!, meta);
                    }}
                    title="למה שובץ?"
                    className={`mr-0.5 align-super text-[10px] leading-none font-bold ${warn ? 'text-orange-500' : 'text-blue-500'}`}
                >{warn ? '⚠' : 'ⓘ'}</button>
            )}
    </span>
    );
}

// SoldierPopup is imported from ./SoldierPopup

// ── Helpers ────────────────────────────────────────────────────────────────
// `date` may be "DD/MM/YYYY" (Shavtzak tab, from the sheet) or "YYYY-MM-DD"
// (draft tab, from the DB) — detect by separator and parse to a local Date
// at midnight.
function parseAnyDate(date: string): Date {
    if (date.includes('-')) {
        const [y, m, d] = date.split('-').map(Number);
        return new Date(y, m - 1, d);
    }
    const [d, m, y] = date.split('/').map(Number);
    return new Date(y, m - 1, d);
}

const pad2 = (n: number) => String(n).padStart(2, '0');

// Formats `d` in the same style as `template` ("DD/MM/YYYY" or "YYYY-MM-DD").
function formatLikeTemplate(template: string, d: Date): string {
    return template.includes('-')
        ? `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
        : `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`;
}

const shortDate = (d: Date) => `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}`;

// Shifts a date string by `deltaDays` calendar days, same format in and
// out — used to look up the adjacent schedule day's record when merging in
// its tail.
function shiftDateStr(date: string, deltaDays: number): string {
    const base = parseAnyDate(date);
    const shifted = new Date(base.getFullYear(), base.getMonth(), base.getDate() + deltaDays);
    return formatLikeTemplate(date, shifted);
}

// A schedule day covers `recordDate` 14:00 → the next day's 14:00. Parses a
// slot's time string into its start (hour, minute) plus whether the slot
// can "roll over" past midnight — i.e. can actually land on the calendar
// day after `recordDate` when its start hour is before 14:00. Only a bare
// clock time ("HH:MM") or an overnight range whose end wraps past its
// start ("22:00-6:00", כרמל חטיבה's night block) roll over; a same-day
// range ("7:30-20:30", תורנים) and anything unparseable (יומי) are anchored
// to `recordDate` itself and never roll over.
function parseSlotStart(time: string): { h: number; m: number; canRollOver: boolean } | null {
    const bare = /^(\d{1,2}):(\d{2})$/.exec(time);
    if (bare) return {h: parseInt(bare[1]), m: parseInt(bare[2]), canRollOver: true};
    const range = /^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/.exec(time);
    if (range) {
        const startMin = parseInt(range[1]) * 60 + parseInt(range[2]);
        const endMin = parseInt(range[3]) * 60 + parseInt(range[4]);
        return {h: parseInt(range[1]), m: parseInt(range[2]), canRollOver: endMin <= startMin};
    }
    return null;
}

// Minutes-of-day for a slot's start time (a bare "HH:MM", or the leading
// "HH:MM" of a range like "22:00-6:00"/"7:30-20:30") — for chronological
// sort/comparison purely within one literal day. No day-boundary offset:
// the שבצק sheet's own תאריך is always the correct day already (see
// buildSheetDisplayGroups below), so an early hour is exactly that early
// hour, not a later slot in disguise. Returns Infinity for unparseable
// strings (יומי), sorting them last. Exported for other views (e.g.
// PersonalSchedule's "next shift" card) that need the same, non-buggy
// hour extraction instead of re-deriving their own.
export function timeOfDayMinutes(time: string): number {
    const start = parseSlotStart(time);
    return start ? start.h * 60 + start.m : Infinity;
}

// Resolves a slot's actual calendar moment given the schedule day it came
// from — the real date+hour it happens at, computed once so every ordering
// and gray/dated decision downstream just compares against it. Returns
// null for slots with no parseable start time (יומי): those have no real
// hour to place on the timeline.
function slotMoment(recordDate: string, time: string): { dateStr: string; short: string; ms: number } | null {
    const start = parseSlotStart(time);
    if (!start) return null;
    const base = parseAnyDate(recordDate);
    const dayOffset = start.canRollOver && start.h < 14 ? 1 : 0;
    const dt = new Date(base.getFullYear(), base.getMonth(), base.getDate() + dayOffset, start.h, start.m);
    return {dateStr: formatLikeTemplate(recordDate, dt), short: shortDate(dt), ms: dt.getTime()};
}

// Shared hour-label renderer: normal styling for same-day hours, grayed +
// dated for hours that land on a different calendar day than the one being
// viewed. `gray`/`dateLabel` are precomputed per slot (see slotMoment)
// rather than re-derived here, since the same clock hour (e.g. "06:00") can
// appear twice once the previous day's tail is merged in — once as this
// morning, once as tomorrow morning — and only real date comparison tells
// them apart.
function TimeLabel({time, gray, dateLabel, activeClass, futureClass = 'text-gray-400'}: {
    time: string; gray: boolean; dateLabel: string; activeClass: string; futureClass?: string;
}) {
    const label = time || 'יומי';
    return (
        <span className={gray ? futureClass : activeClass}>
            {label}
            {gray && dateLabel && (
                <span className="text-[10px] font-normal opacity-80"> ({dateLabel})</span>
            )}
        </span>
    );
}

// ── Display model ───────────────────────────────────────────────────────────
// Presentation view of a day's groups, every slot sorted chronologically and
// tagged gray/not. Two distinct builders below, because the two tabs' data
// sources disagree about what a row's date means:
//   - buildDisplayGroups: the draft tab's scheduler DB genuinely anchors a
//     schedule day at 14:00→14:00, so an early hour in a day's own data can
//     really belong to the calendar day after — resolved via slotMoment and
//     (when an adjacent day's data is passed) merged with the previous
//     schedule day's own tail so the page reads as one ordinary day.
//   - buildSheetDisplayGroups: the live tab's שבצק sheet has no such
//     concept — its own תאריך is always the literal, correct day for every
//     row — so today's own slots are just sorted by literal hour, never
//     gray. A bounded look-ahead into tomorrow's own record (its shifts
//     starting before 14:00) is appended, grayed and dated, as a preview.
interface DisplaySlot {
    time: string;
    gray: boolean;
    dateLabel: string;
    soldiers: string[];
    ms: number;
}

interface DisplaySubType {
    sug: string;
    times: DisplaySlot[]
}

interface DisplayGroup {
    name: string;
    subTypes: DisplaySubType[];
    tier: Tier
}

// Tags every slot against its own record's date, with no cross-day merge —
// used for the draft tab (no adjacent-day fetch) and for layout-tier
// decisions (which must reflect a group's own unmerged shape).
function toDisplaySubTypes(recordDate: string, subTypes: SubType[]): DisplaySubType[] {
    return subTypes.map(s => ({
        sug: s.sug,
        times: s.times.map(t => {
            const moment = slotMoment(recordDate, t.time);
            if (!moment) return {time: t.time, gray: false, dateLabel: '', soldiers: t.soldiers, ms: Infinity};
            const gray = moment.dateStr !== recordDate;
            return {time: t.time, gray, dateLabel: gray ? moment.short : '', soldiers: t.soldiers, ms: moment.ms};
        }),
    }));
}

function allUniqueSlots(subTypes: DisplaySubType[]): DisplaySlot[] {
    const map = new Map<string, DisplaySlot>();
    for (const s of subTypes) for (const t of s.times) {
        const key = `${t.gray ? 1 : 0}:${t.time}`;
        if (!map.has(key)) map.set(key, t);
    }
    return Array.from(map.values()).sort((a, b) => a.ms - b.ms);
}

function isYomiOnly(subTypes: DisplaySubType[]): boolean {
    return subTypes.every(s =>
        s.times.length === 1 && (!s.times[0].time || s.times[0].time === 'יומי')
    );
}

// True when most (sug × time) cells are empty — a "pool of missions" where each
// mission is staffed at its own times, rather than a dense shift table. A wide
// grid wastes space on dashes here; a per-mission card list is more compact.
function isSparseMultiType(subTypes: DisplaySubType[]): boolean {
    if (subTypes.length < 3) return false;
    const slots = allUniqueSlots(subTypes);
    if (slots.length === 0) return false;
    let filled = 0;
    for (const sub of subTypes) {
        for (const slot of slots) {
            const found = sub.times.find(t => t.time === slot.time && t.gray === slot.gray);
            if (found && found.soldiers.length > 0) filled++;
        }
    }
    return filled / (subTypes.length * slots.length) <= 0.4;
}

// Merge in the previous schedule day's own tail (slots whose real moment
// lands on `selDate`) as normal entries ahead of the day's 14:00 block;
// `current`'s own tail (slots whose real moment lands on the day after)
// stays the grayed lookahead into tomorrow. `prevDaySource` null (draft tab
// — no adjacent-day fetch) just tags the day's own tail gray, same as
// before. Layout tier is decided from each group's own unmerged shape, so
// borrowing the previous day's tail never changes which stations render
// compact vs. full-width.
export function buildDisplayGroups(selDate: string, current: StationGroup[], prevDaySource: StationGroup[] | null): DisplayGroup[] {
    const prevDate = shiftDateStr(selDate, -1);

    const names: string[] = [];
    const seenNames = new Set<string>();
    for (const g of current) if (!seenNames.has(g.name)) {
        seenNames.add(g.name);
        names.push(g.name);
    }
    if (prevDaySource) for (const g of prevDaySource) if (!seenNames.has(g.name)) {
        seenNames.add(g.name);
        names.push(g.name);
    }

    const curByName = new Map(current.map(g => [g.name, g]));
    const prevByName = new Map((prevDaySource ?? []).map(g => [g.name, g]));

    return names.map(name => {
        const curGroup = curByName.get(name);
        const prevGroup = prevByName.get(name);

        const sugs: string[] = [];
        const seenSugs = new Set<string>();
        for (const s of curGroup?.subTypes ?? []) if (!seenSugs.has(s.sug)) {
            seenSugs.add(s.sug);
            sugs.push(s.sug);
        }
        for (const s of prevGroup?.subTypes ?? []) if (!seenSugs.has(s.sug)) {
            seenSugs.add(s.sug);
            sugs.push(s.sug);
        }

        const subTypes: DisplaySubType[] = sugs.map(sug => {
            const curSub = curGroup?.subTypes.find(s => s.sug === sug);
            const prevSub = prevGroup?.subTypes.find(s => s.sug === sug);
            const times: DisplaySlot[] = [];
            for (const t of prevSub?.times ?? []) {
                const moment = slotMoment(prevDate, t.time);
                if (moment && moment.dateStr === selDate) {
                    times.push({time: t.time, gray: false, dateLabel: '', soldiers: t.soldiers, ms: moment.ms});
                }
            }
            for (const t of curSub?.times ?? []) {
                const moment = slotMoment(selDate, t.time);
                if (!moment) {
                    times.push({time: t.time, gray: false, dateLabel: '', soldiers: t.soldiers, ms: Infinity});
                    continue;
                }
                const gray = moment.dateStr !== selDate;
                times.push({time: t.time, gray, dateLabel: gray ? moment.short : '', soldiers: t.soldiers, ms: moment.ms});
            }
            times.sort((a, b) => a.ms - b.ms);
            return {sug, times};
        });

        const tier = getTier(toDisplaySubTypes(selDate, (curGroup ?? prevGroup)?.subTypes ?? []), name);
        return {name, subTypes, tier};
    })
        // A position with nobody assigned at all today or in tomorrow's
        // lookahead is a leftover row (e.g. a one-off meeting that isn't
        // happening this cycle) — don't render an empty box for it.
        .filter(g => g.subTypes.some(s => s.times.some(t => t.soldiers.length > 0)));
}

// Tags a raw day's own subTypes with no gray/merge at all — used for the
// live tab's own literal-hour sort and for its layout-tier decisions (which
// must reflect a group's own shape, not one inflated by tomorrow's preview).
function rawSlotsOnly(subTypes: SubType[]): DisplaySubType[] {
    return subTypes.map(s => ({
        sug: s.sug,
        times: s.times.map(t => ({time: t.time, gray: false, dateLabel: '', soldiers: t.soldiers, ms: timeOfDayMinutes(t.time)})),
    }));
}

// Always larger than any single day's minutes-of-day (max 1439), so
// tomorrow's preview sorts after all of today regardless of hour.
const TOMORROW_OFFSET = 10_000;

// The שבצק sheet's own תאריך is always the literal, correct calendar day for
// every row (confirmed by the owner) — unlike the newer scheduler DB the
// draft tab reads, this data source has no 14:00-anchored "this early hour
// actually belongs to tomorrow" concept. So today's own rows are just
// sorted by their literal start hour, never gray. On top of that, a bounded
// look-ahead into `nextDaySource` (tomorrow's own record) is appended,
// grayed and dated — only its shifts starting before 14:00, per the owner —
// as a preview of what's coming, without reinterpreting any of today's own
// rows.
export function buildSheetDisplayGroups(current: StationGroup[], nextDaySource: StationGroup[] | null, nextDateShort: string): DisplayGroup[] {
    const names: string[] = [];
    const seenNames = new Set<string>();
    for (const g of current) if (!seenNames.has(g.name)) {
        seenNames.add(g.name);
        names.push(g.name);
    }
    if (nextDaySource) for (const g of nextDaySource) if (!seenNames.has(g.name)) {
        seenNames.add(g.name);
        names.push(g.name);
    }

    const curByName = new Map(current.map(g => [g.name, g]));
    const nextByName = new Map((nextDaySource ?? []).map(g => [g.name, g]));

    return names.map(name => {
        const curGroup = curByName.get(name);
        const nextGroup = nextByName.get(name);

        const sugs: string[] = [];
        const seenSugs = new Set<string>();
        for (const s of curGroup?.subTypes ?? []) if (!seenSugs.has(s.sug)) {
            seenSugs.add(s.sug);
            sugs.push(s.sug);
        }
        for (const s of nextGroup?.subTypes ?? []) if (!seenSugs.has(s.sug)) {
            seenSugs.add(s.sug);
            sugs.push(s.sug);
        }

        const subTypes: DisplaySubType[] = sugs.map(sug => {
            const curSub = curGroup?.subTypes.find(s => s.sug === sug);
            const nextSub = nextGroup?.subTypes.find(s => s.sug === sug);
            const times: DisplaySlot[] = [];
            for (const t of curSub?.times ?? []) {
                times.push({time: t.time, gray: false, dateLabel: '', soldiers: t.soldiers, ms: timeOfDayMinutes(t.time)});
            }
            for (const t of nextSub?.times ?? []) {
                const start = parseSlotStart(t.time);
                if (!start || start.h >= 14) continue; // only tomorrow's early look-ahead, before 14:00
                times.push({
                    time: t.time, gray: true, dateLabel: nextDateShort, soldiers: t.soldiers,
                    ms: TOMORROW_OFFSET + start.h * 60 + start.m,
                });
            }
            times.sort((a, b) => a.ms - b.ms);
            return {sug, times};
        });

        const tier = getTier(rawSlotsOnly((curGroup ?? nextGroup)?.subTypes ?? []), name);
        return {name, subTypes, tier};
    })
        // A position with nobody assigned at all today or in tomorrow's
        // look-ahead is a leftover row (e.g. a one-off meeting that isn't
        // happening this cycle) — don't render an empty box for it.
        .filter(g => g.subTypes.some(s => s.times.some(t => t.soldiers.length > 0)));
}

// ── Color palette ──────────────────────────────────────────────────────────
type Colors = { border: string; header: string; bg: string; rowAlt: string; colHeader: string };
const PALETTE: [string, Colors][] = [
    ['סיור', {
        border: 'border-blue-300',
        header: 'bg-blue-700 text-white',
        bg: 'bg-white',
        rowAlt: 'bg-blue-50/60',
        colHeader: 'bg-blue-50'
    }],
    ['עמדות הגנה', {
        border: 'border-slate-300',
        header: 'bg-slate-600 text-white',
        bg: 'bg-white',
        rowAlt: 'bg-slate-50',
        colHeader: 'bg-slate-100'
    }],
    ['חפק', {
        border: 'border-orange-300',
        header: 'bg-orange-600 text-white',
        bg: 'bg-white',
        rowAlt: 'bg-orange-50/40',
        colHeader: 'bg-orange-50'
    }],
    ['חמ', {
        border: 'border-sky-300',
        header: 'bg-sky-600 text-white',
        bg: 'bg-white',
        rowAlt: 'bg-sky-50/40',
        colHeader: 'bg-sky-50'
    }],
    ['מגן', {
        border: 'border-purple-300',
        header: 'bg-purple-700 text-white',
        bg: 'bg-white',
        rowAlt: 'bg-purple-50/40',
        colHeader: 'bg-purple-50'
    }],
    ['זימות', {
        border: 'border-teal-300',
        header: 'bg-teal-700 text-white',
        bg: 'bg-white',
        rowAlt: 'bg-teal-50/40',
        colHeader: 'bg-teal-50'
    }],
    ['תגבורות', {
        border: 'border-red-300',
        header: 'bg-red-700 text-white',
        bg: 'bg-white',
        rowAlt: 'bg-red-50/40',
        colHeader: 'bg-red-50'
    }],
    ['נוספים', {
        border: 'border-indigo-300',
        header: 'bg-indigo-700 text-white',
        bg: 'bg-white',
        rowAlt: 'bg-indigo-50/40',
        colHeader: 'bg-indigo-50'
    }],
];

// Cycle colors for any station not matched above
const CYCLE_COLORS: Colors[] = [
    {
        border: 'border-cyan-300',
        header: 'bg-cyan-700 text-white',
        bg: 'bg-white',
        rowAlt: 'bg-cyan-50/40',
        colHeader: 'bg-cyan-50'
    },
    {
        border: 'border-rose-300',
        header: 'bg-rose-700 text-white',
        bg: 'bg-white',
        rowAlt: 'bg-rose-50/40',
        colHeader: 'bg-rose-50'
    },
    {
        border: 'border-lime-300',
        header: 'bg-lime-700 text-white',
        bg: 'bg-white',
        rowAlt: 'bg-lime-50/40',
        colHeader: 'bg-lime-50'
    },
    {
        border: 'border-amber-300',
        header: 'bg-amber-600 text-white',
        bg: 'bg-white',
        rowAlt: 'bg-amber-50/40',
        colHeader: 'bg-amber-50'
    },
    {
        border: 'border-violet-300',
        header: 'bg-violet-700 text-white',
        bg: 'bg-white',
        rowAlt: 'bg-violet-50/40',
        colHeader: 'bg-violet-50'
    },
];

const colorCache = new Map<string, Colors>();
let cycleIdx = 0;

function getColors(name: string): Colors {
    if (colorCache.has(name)) return colorCache.get(name)!;
    for (const [key, val] of PALETTE) {
        if (name.includes(key)) {
            colorCache.set(name, val);
            return val;
        }
    }
    const c = CYCLE_COLORS[cycleIdx++ % CYCLE_COLORS.length];
    colorCache.set(name, c);
    return c;
}

// ── Layout 1: יומי-only ────────────────────────────────────────────────────
function YomiGrid({subTypes, bg, groupName = ''}: { subTypes: DisplaySubType[]; bg: string; groupName?: string }) {
    if (subTypes.length > 1) {
        return (
            // overflow-x-auto + per-column min-w-max: columns never squeeze a
            // name past its width — the card scrolls instead of clipping it
            // (the card itself is overflow-hidden).
            <div className={`${bg} flex overflow-x-auto`} dir="rtl">
                {subTypes.map((sub, si) => {
                    const soldiers = sub.times[0]?.soldiers ?? [];
                    const innerCols = soldiers.length > 5 ? 2 : 1;
                    return (
                        <div
                            key={sub.sug}
                            className={`flex-1 min-w-max p-3 ${si < subTypes.length - 1 ? 'border-l border-gray-100' : ''}`}
                        >
                            {sub.sug && (
                                <div
                                    className="text-sm font-bold text-gray-600 mb-1.5 pb-1 border-b border-gray-200">{sub.sug}</div>
                            )}
                            <div className="grid gap-x-4 gap-y-0.5"
                                 style={{gridTemplateColumns: `repeat(${innerCols}, auto)`}}>
                                {soldiers.map((name, i) => (
                                    <SoldierName key={i} name={name} time={sub.times[0]?.time}/>
                                ))}
                            </div>
                        </div>
                    );
                })}
            </div>
        );
    }

    const first = subTypes[0];
    const soldiers = first?.times[0]?.soldiers ?? [];
    const sug = first?.sug ?? '';
    const showSug = sug && sug !== groupName;
    const cols = soldiers.length <= 6 ? 2 : soldiers.length <= 12 ? 3 : 4;
    return (
        <div className={`p-3 overflow-x-auto ${bg}`}>
            {showSug && (
                <div className="text-xs font-semibold text-gray-500 mb-1.5 pb-1 border-b border-gray-200 text-center">
                    {sug}
                </div>
            )}
            <div className="grid w-max min-w-full gap-x-6 gap-y-0.5" style={{gridTemplateColumns: `repeat(${cols}, auto)`}}>
                {soldiers.map((name, i) => (
                    <SoldierName key={i} name={name} time={first?.times[0]?.time}/>
                ))}
            </div>
        </div>
    );
}

// ── Layout 2: single sub-type, timed → times as columns ───────────────────
function TransposedTable({sub, bg, rowAlt, colHeader, groupName = ''}: {
    sub: DisplaySubType; bg: string; rowAlt: string; colHeader: string; groupName?: string;
}) {
    const maxRows = Math.max(...sub.times.map(t => t.soldiers.length), 0);
    return (
        <div className={`overflow-x-auto ${bg}`}>
            <table className="w-full border-collapse" dir="rtl">
                <thead>
                {sub.sug && sub.sug !== groupName && (
                    <tr>
                        <td
                            colSpan={sub.times.length}
                            className={`py-1 px-2 text-center text-xs font-semibold text-gray-500 border-b border-gray-200 ${colHeader}`}
                        >
                            {sub.sug}
                        </td>
                    </tr>
                )}
                <tr>
                    {sub.times.map(slot => (
                        <th key={`${slot.gray ? 1 : 0}:${slot.time}`}
                            className={`py-2 px-2 sm:px-4 text-center text-sm font-semibold border-b-2 border-gray-200 ${colHeader}`}>
                            <TimeLabel time={slot.time} gray={slot.gray} dateLabel={slot.dateLabel}
                                       activeClass="text-gray-700"/>
                        </th>
                    ))}
                </tr>
                </thead>
                <tbody>
                {Array.from({length: maxRows}).map((_, rowIdx) => (
                    <tr key={rowIdx} className={rowIdx % 2 === 1 ? rowAlt : ''}>
                        {sub.times.map(slot => (
                            <td key={`${slot.gray ? 1 : 0}:${slot.time}`}
                                className="py-1.5 px-2 sm:px-4 text-center border-b border-gray-100">
                                {slot.soldiers[rowIdx] ?
                                    <SoldierName name={slot.soldiers[rowIdx]} time={slot.time}/> : ''}
                            </td>
                        ))}
                    </tr>
                ))}
                </tbody>
            </table>
        </div>
    );
}

// ── Layout 3: multiple sub-types, times as rows ────────────────────────────
function MultiTypeTable({subTypes, bg, rowAlt, colHeader}: {
    subTypes: DisplaySubType[]; bg: string; rowAlt: string; colHeader: string;
}) {
    const slots = allUniqueSlots(subTypes);
    const lookup: Record<string, Record<string, string[]>> = {};
    for (const sub of subTypes) {
        lookup[sub.sug] = {};
        for (const slot of sub.times) lookup[sub.sug][`${slot.gray ? 1 : 0}:${slot.time}`] = slot.soldiers;
    }
    return (
        <div className={`overflow-x-auto ${bg}`}>
            <table className="w-full border-collapse" dir="rtl">
                <thead>
                <tr>
                    <th className={`py-2 px-2 sm:px-4 text-right text-sm font-semibold text-gray-500 border-b-2 border-gray-200 ${colHeader} whitespace-nowrap w-12 sm:w-16`}>
                        שעה
                    </th>
                    {subTypes.map(sub => (
                        <th key={sub.sug}
                            className={`py-2 px-4 text-center text-sm font-bold text-gray-700 border-b-2 border-gray-200 ${colHeader}`}>
                            {sub.sug}
                        </th>
                    ))}
                </tr>
                </thead>
                <tbody>
                {slots.map((slot, idx) => {
                    const key = `${slot.gray ? 1 : 0}:${slot.time}`;
                    return (
                        <tr key={key} className={`border-b border-gray-100 ${idx % 2 === 1 ? rowAlt : ''}`}>
                            <td className="py-2 px-4 text-sm font-bold whitespace-nowrap">
                                <TimeLabel time={slot.time} gray={slot.gray} dateLabel={slot.dateLabel}
                                           activeClass="text-gray-600"/>
                            </td>
                            {subTypes.map(sub => {
                                const soldiers = lookup[sub.sug]?.[key] ?? [];
                                return (
                                    <td key={sub.sug} className="py-2 px-4 text-center">
                                        {soldiers.length > 0
                                            ? soldiers.map((name, i) => <div key={i}><SoldierName name={name}
                                                                                                  time={slot.time}/></div>)
                                            : <span className="text-gray-300 text-sm">—</span>}
                                    </td>
                                );
                            })}
                        </tr>
                    );
                })}
                </tbody>
            </table>
        </div>
    );
}

// ── Layout 4: sparse multi sub-type "mission pool" → one card per mission ──
function MissionCards({subTypes, colHeader}: {
    subTypes: DisplaySubType[]; colHeader: string;
}) {
    const missions = subTypes
        .map(sub => ({
            sug: sub.sug,
            entries: [...sub.times]
                .filter(t => t.soldiers.length > 0)
                .sort((a, b) => a.ms - b.ms),
        }))
        .filter(m => m.entries.length > 0);

    return (
        <div className="flex flex-wrap gap-3 p-3 overflow-x-auto">
            {missions.map(mission => (
                <div key={mission.sug}
                     className="flex-1 min-w-[170px] rounded-lg border border-gray-200 overflow-hidden">
                    <div
                        className={`px-3 py-1.5 text-xs font-bold text-gray-600 border-b border-gray-200 ${colHeader}`}>
                        {mission.sug}
                    </div>
                    <div className="divide-y divide-gray-100">
                        {mission.entries.map(entry => (
                            <div key={`${entry.gray ? 1 : 0}:${entry.time}`} className="px-3 py-1.5">
                                <div className="text-[11px] font-semibold text-gray-400 mb-0.5">
                                    <TimeLabel time={entry.time} gray={entry.gray} dateLabel={entry.dateLabel}
                                               activeClass="text-gray-400"/>
                                </div>
                                <div className="flex flex-wrap gap-x-2 gap-y-0.5">
                                    {entry.soldiers.map((name, i) => <SoldierName key={i} name={name}
                                                                                  time={entry.time}/>)}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            ))}
        </div>
    );
}

// ── Layout tiers ──────────────────────────────────────────────────────────
// small  → half-width box (2 per row): compact stations
// medium → half-width box (2 per row): יומי multi-sub groups (e.g. מגן, נוספים)
// wide   → full-width: complex timed tables (e.g. עמדות הגנה)

const FORCE_SMALL_NAMES = ['חמ"ל', 'חמל', 'חפק', 'רכב', 'סיור'];

// Display order within each tier (first = rightmost in RTL grid)
const SMALL_ORDER = ['סיור', 'רכב', 'חפק', 'חמ"ל', 'חמל'];

// Excluded from the "לוחמים במשימות" headcount — staff/duty desks, not
// field missions.
const NON_MISSION_NAMES = ['חפק', 'חמ"ל', 'חמל'];

// Both headcounts are for today only — the grayed tomorrow-morning
// lookahead doesn't count toward either.
export function computeTodayHeadcounts(groups: DisplayGroup[]): { total: number; combat: number } {
    const todaySoldiers = (gs: DisplayGroup[]) =>
        new Set(gs.flatMap(g => g.subTypes.flatMap(s => s.times.filter(t => !t.gray).flatMap(t => t.soldiers))));
    const total = todaySoldiers(groups).size;
    const combat = todaySoldiers(groups.filter(g => !NON_MISSION_NAMES.some(k => g.name.includes(k)))).size;
    return {total, combat};
}

type Tier = 'small' | 'medium' | 'wide';

function getTier(subTypes: DisplaySubType[], name: string): Tier {
    if (FORCE_SMALL_NAMES.some(k => name.includes(k))) return 'small';
    const yomi = isYomiOnly(subTypes);
    if (yomi) return 'medium'; // יומי multi-sub → side-by-side pairs
    // timed single sub-type with few time slots → small
    if (subTypes.length === 1 && allUniqueSlots(subTypes).length <= 4) return 'small';
    return 'wide';
}

function sortByOrder(groups: DisplayGroup[], order: string[]): DisplayGroup[] {
    return [...groups].sort((a, b) => {
        const ai = order.findIndex(k => a.name.includes(k));
        const bi = order.findIndex(k => b.name.includes(k));
        return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
    });
}

// ── Group card ─────────────────────────────────────────────────────────────
function GroupCard({group}: { group: DisplayGroup }) {
    const c = getColors(group.name);
    const totalSoldiers = new Set(
        group.subTypes.flatMap(s => s.times.flatMap(t => t.soldiers))
    ).size;
    const multiType = group.subTypes.length > 1;
    const yomiOnly = isYomiOnly(group.subTypes);
    const sparse = multiType && !yomiOnly && isSparseMultiType(group.subTypes);

    return (
        <div className={`rounded-xl border-2 overflow-hidden ${c.border}`}>
            <div className={`px-4 py-2.5 font-bold text-base flex items-center justify-between ${c.header}`}>
                <span>{group.name}</span>
                <span className="font-normal opacity-80 text-sm">{totalSoldiers} חיילים</span>
            </div>
            {yomiOnly ? (
                <YomiGrid subTypes={group.subTypes} bg={c.bg} groupName={group.name}/>
            ) : sparse ? (
                <MissionCards subTypes={group.subTypes} colHeader={c.colHeader}/>
            ) : multiType ? (
                <MultiTypeTable subTypes={group.subTypes} bg={c.bg} rowAlt={c.rowAlt}
                                 colHeader={c.colHeader}/>
            ) : (
                <TransposedTable sub={group.subTypes[0]} bg={c.bg} rowAlt={c.rowAlt}
                                 colHeader={c.colHeader} groupName={group.name}/>
            )}
        </div>
    );
}

// ── Groups renderer (shared by date view; also used by the draft tab) ──────
export function GroupsView({groups}: { groups: DisplayGroup[] }) {
    const smallGroups = sortByOrder(groups.filter(g => g.tier === 'small'), SMALL_ORDER);
    const mediumGroups = groups.filter(g => g.tier === 'medium');
    const wideGroups = groups.filter(g => g.tier === 'wide');

    return (
        <div className="space-y-3">
            {smallGroups.length > 0 && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-start">
                    {smallGroups.map(g => <GroupCard key={g.name} group={g}/>)}
                </div>
            )}
            {wideGroups.map(g => <GroupCard key={g.name} group={g}/>)}
            {mediumGroups.length > 0 && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-start">
                    {mediumGroups.map(g => <GroupCard key={g.name} group={g}/>)}
                </div>
            )}
        </div>
    );
}

// ── Main ───────────────────────────────────────────────────────────────────
export function Shavtzak({soldiers, shavtzakAll: data, loading, error, mySoldierName = ''}: {
    soldiers: Soldier[];
    shavtzakAll: ShavtzakAllData | null;
    loading: boolean;
    error: string | null;
    mySoldierName?: string;
}) {
    const [selectedDate, setSelectedDate] = useState<string>('');
    const [popup, setPopup] = useState<PopupState | null>(null);
    const initializedRef = useRef(false);

    // On first load, default to today (or nearest past date). On later reloads
    // (e.g. "טען מחדש"), keep the currently selected date if it's still present.
    useEffect(() => {
        if (!data?.dates.length) return;
        setSelectedDate(prev => {
            if (initializedRef.current && prev && data.dates.includes(prev)) return prev;
            initializedRef.current = true;
            const today = todayShavtzakStr();
            if (data.dates.includes(today)) return today;
            const past = data.dates.filter(d => d <= today);
            return past.length ? past[past.length - 1] : data.dates[0];
        });
    }, [data]);

    const lookup = useMemo(() => {
        const map = new Map<string, SoldierInfo>();
        for (const s of soldiers) {
            if (s.fullName) map.set(s.fullName, {unit: s.unit, role: s.role, phone: s.phone});
        }
        return map;
    }, [soldiers]);


    const handleNameClick = (name: string, info: SoldierInfo | undefined) => {
        setPopup({name, phone: info?.phone ?? ''});
    };

    if (loading && !data) return (
        <div className="flex items-center justify-center py-24">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-500 border-t-transparent"/>
            <span className="mr-3 text-gray-600">טוען שבצק...</span>
        </div>
    );

    if (error) return (
        <div className="rounded-xl bg-red-50 p-6 text-center text-red-700">
            <p className="font-semibold">שגיאה בטעינת שבצק</p>
            <p className="mt-1 text-sm opacity-80">{error}</p>
        </div>
    );

    if (!data?.dates.length) return (
        <div className="rounded-xl border-2 border-dashed border-gray-200 py-16 text-center text-gray-400">
            <p className="text-lg">לא נמצאו נתוני שבצק</p>
        </div>
    );

    const idx = data.dates.indexOf(selectedDate);
    const canPrev = idx > 0;
    const canNext = idx < data.dates.length - 1;
    const dayData = data.byDate[selectedDate] ?? null;

    const nextDayData = dayData ? data.byDate[shiftDateStr(selectedDate, 1)] ?? null : null;
    const nextDateShort = dayData ? shortDate(parseAnyDate(shiftDateStr(selectedDate, 1))) : '';
    const displayGroups = dayData ? buildSheetDisplayGroups(dayData.groups, nextDayData?.groups ?? null, nextDateShort) : [];

    const {total: totalDistinct, combat: combatCount} = computeTodayHeadcounts(displayGroups);

    // "DD/MM/YYYY" ↔ "YYYY-MM-DD" for <input type="date">
    const toInputVal = (d: string) => {
        const [dd, mm, yyyy] = d.split('/');
        return `${yyyy}-${mm}-${dd}`;
    };
    const fromInputVal = (s: string) => {
        const [yyyy, mm, dd] = s.split('-');
        return `${dd}/${mm}/${yyyy}`;
    };

    function handlePickerChange(inputVal: string) {
        if (!inputVal || !data) return;
        const picked = fromInputVal(inputVal);
        if (data.dates.includes(picked)) {
            setSelectedDate(picked);
            return;
        }
        // Snap to nearest available date
        const sorted = [...data.dates].sort((a, b) => {
            const diff = (d: string) => Math.abs(new Date(toInputVal(d)).getTime() - new Date(inputVal).getTime());
            return diff(a) - diff(b);
        });
        if (sorted[0]) setSelectedDate(sorted[0]);
    }

    return (
        <SoldierCtx.Provider value={lookup}>
            <NameClickCtx.Provider value={handleNameClick}>
                <MyNameCtx.Provider value={mySoldierName}>
                    <div className="space-y-3">
                        {/* Header bar */}
                        <div className="flex items-center gap-2 flex-wrap" dir="ltr">
                            <button
                                onClick={() => canPrev && setSelectedDate(data.dates[idx - 1])}
                                disabled={!canPrev}
                                className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-700 hover:bg-gray-50 disabled:opacity-30 font-bold text-lg leading-none"
                                title="יום קודם"
                            >‹
                            </button>

                            <input
                                type="date"
                                value={selectedDate ? toInputVal(selectedDate) : ''}
                                min={data.dates[0] ? toInputVal(data.dates[0]) : undefined}
                                max={data.dates[data.dates.length - 1] ? toInputVal(data.dates[data.dates.length - 1]) : undefined}
                                onChange={e => handlePickerChange(e.target.value)}
                                className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-slate-800 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                            />

                            <button
                                onClick={() => canNext && setSelectedDate(data.dates[idx + 1])}
                                disabled={!canNext}
                                className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-700 hover:bg-gray-50 disabled:opacity-30 font-bold text-lg leading-none"
                                title="יום הבא"
                            >›
                            </button>

                            <span className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-bold text-white">
            {totalDistinct} חיילים
          </span>

                            <span className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-bold text-white">
            {combatCount} חיילים ללא חפק וחמל
          </span>

                            {loading && (
                                <span className="ml-auto text-sm text-gray-400 flex items-center gap-1.5">
              <span className="animate-spin inline-block">↺</span>
              טוען...
            </span>
                            )}
                        </div>

                        {/* Day content */}
                        {dayData ? (
                            <GroupsView groups={displayGroups}/>
                        ) : (
                            <div
                                className="rounded-xl border-2 border-dashed border-gray-200 py-16 text-center text-gray-400">
                                <p className="text-lg">אין נתונים לתאריך זה</p>
                            </div>
                        )}
                    </div>
                    {popup && <SoldierPopup info={popup} onClose={() => setPopup(null)}/>}
                </MyNameCtx.Provider>
            </NameClickCtx.Provider>
        </SoldierCtx.Provider>
    );
}
