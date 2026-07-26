import { useMemo, useState } from 'react';
import type { Soldier } from '../types';
import type { DraftAssignmentMeta, DraftDay, DraftFinding } from '../../api/draft';
import type { StationGroup } from '../../api/shavtzak';
import { seatsForDay, useDraft } from '../hooks/useDraft';
import { GroupsView, buildDisplayGroups, SoldierCtx, NameClickCtx, MyNameCtx, DraftMetaCtx, PendingSeatsCtx, RationaleClickCtx, SoldierInfo } from './Shavtzak';
import { ReplaceSoldierPopup, ReplaceState } from './ReplaceSoldierPopup';
import { RationalePopup, RationalePopupState } from './RationalePopup';
import { DateRangePicker, todayIso, addDaysIso, heDate } from './DateRangePicker';
import { orderCrew } from '../../scheduler/src/crewOrder';
import { conflictLabel, conflictNotes, findSlotConflicts, pendingSeatKeys } from '../lib/draftConflicts';

// Draft-only display ordering (owner request): commander(s) first, then the
// remaining soldiers grouped by מחלקה (platoon) — reuses the SAME generic
// helper the generation report applies (scheduler/src/crewOrder.ts), so a
// crew like התקפי's 1 מפקד + 3 same-platoon soldiers renders the same way
// here as in the report. The live שבצק sheet tab (Shavtzak.tsx's own
// buildSheetDisplayGroups path) never calls this — it has no reliable
// platoon/role data on its rows and this file is never imported there, so
// that tab's rendering is untouched.
export function orderStationGroups(groups: StationGroup[], lookup: Map<string, SoldierInfo>): StationGroup[] {
  const orderNames = (names: string[]): string[] => {
    if (names.length < 2) return names;
    const wrapped = names.map((name, seatIndex) => {
      const info = lookup.get(name);
      return { name, seatIndex, role: info?.role ?? '', platoon: info?.unit ?? '' };
    });
    return orderCrew(wrapped).map((w) => w.name);
  };
  return groups.map((g) => ({
    ...g,
    subTypes: g.subTypes.map((s) => ({
      ...s,
      times: s.times.map((t) => ({ ...t, soldiers: orderNames(t.soldiers) })),
    })),
  }));
}

function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to && out.length < 14; d = addDaysIso(d, 1)) out.push(d);
  return out;
}

const EMPTY_SEATS: Set<string> = new Set();

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  draft: { label: 'טיוטה ריקה', cls: 'bg-gray-100 text-gray-600' },
  generated: { label: 'טיוטה', cls: 'bg-blue-100 text-blue-700' },
  approved: { label: 'מאושר', cls: 'bg-green-100 text-green-700' },
  published: { label: 'פורסם', cls: 'bg-green-200 text-green-800' },
};

/** small mono rule-code chip, matching the report's findingLi tag */
function RuleTag({ rule }: { rule: string }) {
  return (
    <span className="shrink-0 rounded bg-black/5 px-1.5 py-0.5 text-[11px] font-mono text-gray-500" dir="ltr">
      {rule}
    </span>
  );
}

function ValidationPanel({ findings }: { findings: DraftFinding[] }) {
  const [open, setOpen] = useState(false);
  const errors = findings.filter((f) => f.severity === 'error');
  const warnings = findings.filter((f) => f.severity === 'warning');
  if (!findings.length) {
    return <div className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">✓ הולידציה עברה ללא הערות</div>;
  }
  const header = [
    errors.length ? `❌ ${errors.length} שגיאות` : '',
    warnings.length ? `⚠ ${warnings.length} אזהרות` : '',
  ].filter(Boolean).join(' · ');
  return (
    <div className={`rounded-lg border ${errors.length ? 'border-red-200 bg-red-50' : 'border-yellow-200 bg-yellow-50'}`}>
      <button onClick={() => setOpen(!open)} className="w-full px-3 py-2 text-right text-sm font-semibold flex justify-between items-center">
        <span className={errors.length ? 'text-red-700' : 'text-yellow-700'}>
          {header}
        </span>
        <span className="text-gray-400">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <ul className="px-4 pb-3 space-y-1 text-sm">
          {errors.map((f, i) => (
            <li key={`e${i}`} className="text-red-700 flex gap-1.5 items-start">
              <span className="shrink-0">❌</span><RuleTag rule={f.rule} /><span>{f.message}</span>
            </li>
          ))}
          {warnings.map((f, i) => (
            <li key={`w${i}`} className="text-yellow-700 flex gap-1.5 items-start">
              <span className="shrink-0">⚠</span><RuleTag rule={f.rule} /><span>{f.message}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function RestList({ day }: { day: DraftDay }) {
  const sections: [string, string, string[]][] = [
    ['מנוחה', '😴', day.dayAssignments['מנוחה'] ?? []],
    ['בבית', '🏠', day.dayAssignments['בבית'] ?? []],
  ];
  return (
    <>
      {sections.map(([label, icon, names]) => names.length > 0 && (
        <RestSection key={label} label={`${icon} ${label}`} names={names} />
      ))}
    </>
  );
}

function RestSection({ label, names }: { label: string; names: string[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border border-gray-200 bg-white">
      <button onClick={() => setOpen(!open)} className="w-full px-3 py-2 text-right text-sm font-semibold text-gray-600 flex justify-between items-center">
        <span>{label} ({names.length})</span>
        <span className="text-gray-400">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="px-4 pb-3 flex flex-wrap gap-x-3 gap-y-1 text-sm text-gray-700">
          {names.map((n) => <span key={n}>{n}</span>)}
        </div>
      )}
    </div>
  );
}

function DayViolations({ day }: { day: DraftDay }) {
  const entries = Object.entries(day.meta).filter(([, m]) => m.violations.length);
  if (!entries.length) return null;
  return (
    <div className="rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 text-sm text-orange-800 space-y-0.5">
      <div className="font-semibold">שיבוצים עם הערות:</div>
      {entries.map(([key, m]) => {
        const [name, time] = key.split('|');
        return <div key={key}>⚠ {name} ({time}): {m.violations.join(' | ')}</div>;
      })}
    </div>
  );
}

function DaySection({ day, onGenerate, onPublish, onUnpublish, onDelete, generating, busyDay, pendingSeats, soldierLookup, onNameClick }: {
  day: DraftDay; onGenerate: (d: string) => void;
  onPublish: (d: string) => void; onUnpublish: (d: string) => void;
  onDelete: (d: string) => void;
  generating: string | null; busyDay: string | null;
  /** `${name}|${time}` seats of THIS day currently being replaced */
  pendingSeats: Set<string>;
  soldierLookup: Map<string, SoldierInfo>;
  onNameClick: (day: DraftDay, name: string, time: string, meta?: DraftAssignmentMeta) => void;
}) {
  const badge = STATUS_BADGE[day.status] ?? STATUS_BADGE.draft;
  const isEmpty = day.groups.length === 0;
  const published = day.status === 'published';
  // a seat-level replacement blocks only this day's WHOLESALE actions
  const busy = generating !== null || busyDay !== null || pendingSeats.size > 0;
  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <h2 className="text-lg font-bold text-slate-800">
          {heDate(day.day)} <span className="text-sm font-normal text-gray-500">(14:00 → 14:00 למחרת)</span>
        </h2>
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${badge.cls}`}>{badge.label}</span>
        {day.generatedAt && (
          <span className="text-xs text-gray-400">נוצר {new Date(day.generatedAt).toLocaleString('he-IL')}</span>
        )}
        {published && day.approvedBy && (
          <span className="text-xs text-green-700">פורסם ע"י {day.approvedBy}</span>
        )}
        <div className="mr-auto flex items-center gap-2">
          {day.hasReport && (
            <a href={`/api/report?day=${day.day}`} target="_blank" rel="noreferrer"
              className="rounded-lg border border-slate-300 hover:bg-slate-50 px-3 py-1.5 text-sm font-semibold text-slate-700">
              פתח דוח
            </a>
          )}
          {published ? (
            <button
              onClick={() => onUnpublish(day.day)} disabled={busy}
              className="rounded-lg border border-red-300 text-red-700 hover:bg-red-50 disabled:opacity-50 px-3 py-1.5 text-sm font-semibold"
            >
              {busyDay === day.day ? '⏳...' : 'בטל פרסום'}
            </button>
          ) : (
            <>
              {day.status === 'generated' && (
                <button
                  onClick={() => onPublish(day.day)} disabled={busy}
                  className="rounded-lg bg-green-600 hover:bg-green-500 disabled:opacity-50 px-3 py-1.5 text-sm font-semibold text-white"
                >
                  {busyDay === day.day ? '⏳...' : 'פרסם'}
                </button>
              )}
              {!isEmpty && (
                <button
                  onClick={() => onDelete(day.day)} disabled={busy}
                  className="rounded-lg border border-red-300 text-red-700 hover:bg-red-50 disabled:opacity-50 px-3 py-1.5 text-sm font-semibold"
                >
                  {busyDay === day.day ? '⏳...' : 'מחק טיוטה'}
                </button>
              )}
              <button
                onClick={() => onGenerate(day.day)} disabled={busy}
                className="rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 px-3 py-1.5 text-sm font-semibold text-white"
              >
                {generating === day.day ? '⏳ מחולל...' : isEmpty ? 'צור שבצ"ק' : 'חולל מחדש'}
              </button>
            </>
          )}
        </div>
      </div>
      {!isEmpty && <ValidationPanel findings={day.validation} />}
      {!isEmpty && <DayViolations day={day} />}
      {isEmpty ? (
        <div className="rounded-xl border-2 border-dashed border-gray-200 py-12 text-center text-gray-400">
          אין טיוטה ליום זה — לחץ "צור שבצ"ק"
        </div>
      ) : (
        <>
          {/* per-day click handler: a click carries the day it happened on
              plus the clicked slot's meta (rationale ⇒ driver/commander seat) */}
          <DraftMetaCtx.Provider value={day.meta}>
            <PendingSeatsCtx.Provider value={pendingSeats}>
              <NameClickCtx.Provider value={(name, _info, time) =>
                onNameClick(day, name, time ?? '', day.meta[`${name}|${time ?? ''}`])}>
                <GroupsView groups={buildDisplayGroups(day.day, orderStationGroups(day.groups, soldierLookup), null)} />
              </NameClickCtx.Provider>
            </PendingSeatsCtx.Provider>
          </DraftMetaCtx.Provider>
          <RestList day={day} />
        </>
      )}
    </section>
  );
}

// ── Main ────────────────────────────────────────────────────────────────────
export function DraftSchedule({ soldiers, mySoldierName = '', email = '' }: {
  soldiers: Soldier[]; mySoldierName?: string; email?: string;
}) {
  const [from, setFrom] = useState(todayIso());
  const [multiDay, setMultiDay] = useState(false);
  const [to, setTo] = useState(todayIso());
  const [replacing, setReplacing] = useState<ReplaceState | null>(null);
  const [replaceErrors, setReplaceErrors] = useState<string[]>([]);   // failed replacements (popup is already closed)
  const [rationalePopup, setRationalePopup] = useState<RationalePopupState | null>(null);
  const effectiveTo = multiDay && to >= from ? to : from;
  const { data, loading, error, generating, busyDay, pendingSeats, generateRange, publish, unpublish, deleteDraft, replaceSoldier } = useDraft(from, effectiveTo);

  const lookup = useMemo(() => {
    const map = new Map<string, SoldierInfo>();
    for (const s of soldiers) {
      if (s.fullName) map.set(s.fullName, { unit: s.unit, role: s.role, phone: s.phone });
    }
    return map;
  }, [soldiers]);

  const roster = data?.roster ?? [];
  const idByName = useMemo(
    () => new Map(roster.map((s) => [s.name, s.id])),
    [roster],
  );

  // Clicking a name in the draft opens the REPLACEMENT popup (not the phone
  // card of the live שבצק tab): this view is the officer's editing surface.
  const handleNameClick = (day: DraftDay, name: string, time: string, meta?: DraftAssignmentMeta) => {
    // what everyone else is doing that day — shown next to each candidate
    const busyNote: Record<string, string> = {};
    for (const [position, names] of Object.entries(day.dayAssignments)) {
      for (const n of names) busyNote[n] = position;
    }
    setReplacing({
      day: day.day, name, time, meta,
      soldierId: idByName.get(name) ?? null,
      published: day.status === 'published',
      busyNote,
      // ⚠ hint per candidate: he already holds a blocking seat in these hours
      conflictNote: conflictNotes(day, {
        time, outgoing: name, blocks: meta?.blocksOverlap ?? true,
      }),
    });
  };

  // Picking a candidate who is already booked in the target hours would hit the
  // DB's no_double_booking — so ask first, naming the seat that gets vacated,
  // and let the server do remove-then-assign in one transaction (`force`).
  // The popup closes on the pick: the round trip is shown ON the touched seats
  // (spinner + clicks swallowed, incl. the seat being force-vacated), leaving
  // the rest of the day editable — several replacements may run at once.
  const doReplace = async (toSoldierId: number) => {
    if (!replacing?.soldierId) return;
    const target = { ...replacing, soldierId: replacing.soldierId };
    const day = data?.days.find((d) => d.day === target.day);
    const candidate = roster.find((s) => s.id === toSoldierId);
    const slot = { time: target.time, outgoing: target.name, blocks: target.meta?.blocksOverlap ?? true };
    const conflicts = day && candidate ? findSlotConflicts(day, candidate.name, slot) : [];
    if (conflicts.length) {
      const where = conflicts.map(conflictLabel).join('\n• ');
      const ok = window.confirm(
        `${candidate!.name} משובץ באותן שעות ב:\n• ${where}\n\n` +
        `להסיר אותו משם ולשבץ אותו כאן?\n(המקום שיתפנה יסומן "לא מאויש".)`);
      if (!ok) return;
    }
    setReplacing(null);
    const err = await replaceSoldier({
      day: target.day, time: target.time,
      fromSoldierId: target.soldierId, toSoldierId, force: conflicts.length > 0,
      seats: pendingSeatKeys(slot, candidate?.name ?? '', conflicts),
    });
    if (err) setReplaceErrors((prev) => [...prev, `${heDate(target.day)} · ${target.name} (${target.time}): ${err}`]);
  };

  const days = daysBetween(from, effectiveTo);
  const dayPending = useMemo(
    () => new Map(days.map((d) => [d, seatsForDay(pendingSeats, d)])),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pendingSeats, days.join()],
  );
  const generateAll = () => {
    const existing = data?.days.some((d) => d.groups.length > 0);
    if (existing && !window.confirm('קיימת כבר טיוטה בטווח — לחולל מחדש? שיבוצים נעולים/ידניים יישמרו.')) return;
    void generateRange(days);
  };
  const generateOne = (day: string) => {
    const d = data?.days.find((x) => x.day === day);
    if (d && d.groups.length > 0 && !window.confirm(`לחולל מחדש את ${heDate(day)}? שיבוצים נעולים/ידניים יישמרו.`)) return;
    void generateRange([day]);
  };
  const publishOne = (day: string) => {
    if (!window.confirm(`לפרסם את ${heDate(day)}? היום יינעל לחילול מחדש עד לביטול הפרסום.`)) return;
    void publish(day, email);
  };
  const unpublishOne = (day: string) => {
    if (!window.confirm(`לבטל את פרסום ${heDate(day)}?`)) return;
    void unpublish(day);
  };
  // Discarding a draft is destructive and includes the officer's manual edits —
  // spell that out in the confirmation.
  const deleteOne = (day: string) => {
    if (!window.confirm(
      `למחוק את טיוטת ${heDate(day)}?\n\nכל השיבוצים של היום יימחקו — כולל החלפות ידניות ושיבוצים נעולים. ` +
      `יישאר מה שפורסם. (חמל ושיבוצי היסטוריה מיובאת אינם נמחקים.)`)) return;
    void deleteDraft(day);
  };

  return (
    <SoldierCtx.Provider value={lookup}>
      <MyNameCtx.Provider value={mySoldierName}>
        <RationaleClickCtx.Provider value={(name, time, meta) => setRationalePopup({ name, time, meta })}>
          <div className="space-y-5">
            {/* Controls */}
            <DateRangePicker from={from} to={to} setFrom={setFrom} setTo={setTo} multiDay={multiDay} setMultiDay={setMultiDay}>
              {days.length > 1 && (
                <button onClick={generateAll} disabled={generating !== null}
                  className="rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 px-4 py-2 text-sm font-semibold text-white" dir="rtl">
                  {generating ? `⏳ מחולל ${heDate(generating)}...` : `צור שבצ"ק לכל הטווח (${days.length} ימים)`}
                </button>
              )}
              {loading && <span className="text-sm text-gray-400"><span className="animate-spin inline-block">↺</span></span>}
            </DateRangePicker>

            {error && (
              <div className="rounded-xl bg-red-50 p-4 text-center text-red-700 text-sm">{error}</div>
            )}
            {/* a replacement that failed after its popup already closed */}
            {replaceErrors.map((msg, i) => (
              <div key={i} className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700 flex items-center gap-2" dir="rtl">
                <span className="flex-1">❌ {msg}</span>
                <button onClick={() => setReplaceErrors((prev) => prev.filter((_, j) => j !== i))}
                  className="rounded px-2 py-0.5 text-red-500 hover:bg-red-100">✕</button>
              </div>
            ))}

            {/* Days */}
            {days.map((day) => {
              const d = data?.days.find((x) => x.day === day)
                ?? { day, status: 'draft', generatedAt: null, publishedAt: null, approvedBy: null, hasReport: false, validation: [], groups: [], meta: {}, dayAssignments: {} };
              return <DaySection key={day} day={d} onGenerate={generateOne}
                onPublish={publishOne} onUnpublish={unpublishOne} onDelete={deleteOne}
                generating={generating} busyDay={busyDay}
                pendingSeats={dayPending.get(day) ?? EMPTY_SEATS} soldierLookup={lookup}
                onNameClick={handleNameClick} />;
            })}
          </div>
          {replacing && (
            <ReplaceSoldierPopup
              info={replacing} roster={roster}
              onReplace={doReplace} onClose={() => setReplacing(null)} />
          )}
          {rationalePopup && <RationalePopup info={rationalePopup} onClose={() => setRationalePopup(null)} />}
        </RationaleClickCtx.Provider>
      </MyNameCtx.Provider>
    </SoldierCtx.Provider>
  );
}
