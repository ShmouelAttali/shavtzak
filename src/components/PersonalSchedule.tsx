import { useMemo, useState } from 'react';
import type { SheetData } from '../types';
import { ScheduleGrid } from './ScheduleGrid';
import { ScheduleLegend } from './ScheduleLegend';
import { getStationBadgeColors } from '../utils/stationColors';
import { todayShavtzakStr } from '../hooks/useShavtzak';
import { timeOfDayMinutes } from './Shavtzak';
import type { ShavtzakAllData, ShavtzakData } from '../../api/_handlers/shavtzak';

interface Mission {
  station: string;
  subType: string;
  time: string;
}

export function findMissions(soldierName: string, shavtzak: ShavtzakData): Mission[] {
  const missions: Mission[] = [];
  for (const group of shavtzak.groups) {
    for (const sub of group.subTypes) {
      for (const slot of sub.times) {
        if (slot.soldiers.includes(soldierName)) {
          missions.push({ station: group.name, subType: sub.sug, time: slot.time || 'יומי' });
        }
      }
    }
  }
  // The שבצק sheet's own date is always the literal, correct day (no
  // 14:00/06:00-anchored rollover) — a plain ascending sort by hour is
  // correct within one day; there's no "night belongs to a later slot".
  return missions.sort((a, b) => timeOfDayMinutes(a.time) - timeOfDayMinutes(b.time));
}

interface Props {
  data: SheetData;
  shavtzakAll: ShavtzakAllData | null;
}

/** מחלקה sentinel: the default — every soldier in the company, no filter.
 *  A real מחלקה value is never '*' (they are digits/letters from the sheet). */
export const ALL_UNITS = '*';

/** Soldiers offered in the חייל dropdown for a chosen מחלקה. ALL_UNITS (and a
 *  legacy empty stored value) means the whole company. */
export function soldiersForUnit<T extends { unit: string; fullName: string }>(
  soldiers: T[],
  unit: string
): T[] {
  const inUnit =
    unit === ALL_UNITS || unit === '' ? soldiers.slice() : soldiers.filter((s) => s.unit === unit);
  return inUnit.sort((a, b) => a.fullName.localeCompare(b.fullName, 'he'));
}

function toDateStr(d: Date) {
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yy = String(d.getFullYear()).slice(2);
  return `${dd}/${mm}/${yy}`;
}

// "25/06/26" (schedule grid) → "25/06/2026" (שבצק byDate key)
function schedDateToShavtzakKey(d: string): string {
  const [dd, mm, yy] = d.split('/');
  return `${dd}/${mm}/20${yy}`;
}

function parseSheetDate(dateStr: string): Date {
  const [d, m, y] = dateStr.split('/');
  return new Date(2000 + parseInt(y), parseInt(m) - 1, parseInt(d));
}

function toInputDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

function fromInputDate(s: string) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function PersonalSchedule({ data, shavtzakAll }: Props) {
  const { soldiers, dates, dayNames } = data;

  const today = new Date();
  const twoWeeksAhead = new Date();
  twoWeeksAhead.setDate(twoWeeksAhead.getDate() + 14);

  const [selectedUnit, setSelectedUnit] = useState(
    () => localStorage.getItem('personal:unit') || ALL_UNITS
  );
  const [selectedId, setSelectedId] = useState(
    () => localStorage.getItem('personal:soldier') ?? ''
  );
  const [fromDate, setFromDate] = useState(toInputDate(today));
  const [toDate, setToDate] = useState(toInputDate(twoWeeksAhead));

  const units = useMemo(() => {
    const set = new Set(soldiers.map((s) => s.unit).filter(Boolean));
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'he'));
  }, [soldiers]);

  const unitSoldiers = useMemo(
    () => soldiersForUnit(soldiers, selectedUnit),
    [soldiers, selectedUnit]
  );

  const selectedSoldier = useMemo(
    () => soldiers.find((s) => s.id === selectedId) ?? null,
    [soldiers, selectedId]
  );

  const filteredDates = useMemo(() => {
    const from = fromInputDate(fromDate);
    const to = fromInputDate(toDate);
    return dates.filter((d) => {
      const dt = parseSheetDate(d);
      return dt >= from && dt <= to;
    });
  }, [dates, fromDate, toDate]);

  function handleUnitChange(unit: string) {
    setSelectedUnit(unit);
    localStorage.setItem('personal:unit', unit);
    setSelectedId('');
    localStorage.removeItem('personal:soldier');
  }

  function handleSoldierChange(id: string) {
    setSelectedId(id);
    localStorage.setItem('personal:soldier', id);
  }

  return (
    <div className="space-y-5">
      {/* Filters */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">מחלקה</label>
          <select
            value={selectedUnit}
            onChange={(e) => handleUnitChange(e.target.value)}
            className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            <option value={ALL_UNITS}>כלל הפלוגה</option>
            {units.map((u) => (
              <option key={u} value={u}>
                מחלקה {u}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">חייל</label>
          <select
            value={selectedId}
            onChange={(e) => handleSoldierChange(e.target.value)}
            className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50"
          >
            <option value="">-- בחר חייל --</option>
            {unitSoldiers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.fullName}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">מתאריך</label>
          <input
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">עד תאריך</label>
          <input
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
      </div>

      {/* Soldier info card */}
      {selectedSoldier && (
        <div className="rounded-xl border border-blue-100 bg-blue-50 p-4">
          <div className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
            <InfoField label="שם מלא" value={selectedSoldier.fullName} />
            <InfoField label="מספר טלפון" value={selectedSoldier.phone} />
            <InfoField label="מחלקה" value={`מחלקה ${selectedSoldier.unit}`} />
            <InfoField label="תפקיד" value={selectedSoldier.role} />
          </div>
        </div>
      )}

      {/* Next shift */}
      {selectedSoldier && shavtzakAll && (
        <NextShiftCard soldierName={selectedSoldier.fullName} shavtzakAll={shavtzakAll} />
      )}

      {/* Per-day missions */}
      {selectedSoldier && filteredDates.length > 0 && shavtzakAll && (
        <MissionsTimeline
          soldierName={selectedSoldier.fullName}
          filteredDates={filteredDates}
          shavtzakAll={shavtzakAll}
        />
      )}

      {/* Schedule */}
      {selectedSoldier && filteredDates.length > 0 && (
        <>
          <ScheduleGrid
            soldiers={[selectedSoldier]}
            dates={filteredDates}
            dayNames={dayNames}
            showName={false}
          />
          <ScheduleLegend soldiers={[selectedSoldier]} dates={filteredDates} />
        </>
      )}

      {selectedSoldier && filteredDates.length === 0 && (
        <p className="text-center text-gray-500">אין תאריכים בטווח שנבחר</p>
      )}

      {!selectedSoldier && (
        <div className="rounded-xl border-2 border-dashed border-gray-200 py-16 text-center text-gray-400">
          <p className="text-lg">בחר חייל להצגת הלוז</p>
        </div>
      )}
    </div>
  );
}

function dateToNum(d: string): number {
  const [dd, mm, yyyy] = d.split('/').map(Number);
  return (yyyy ?? 0) * 10000 + (mm ?? 0) * 100 + (dd ?? 0);
}

function dateLabel(d: string): string {
  const todayNum = dateToNum(todayShavtzakStr());
  const num = dateToNum(d);
  if (num === todayNum) return 'היום';
  if (num === todayNum + 1) return 'מחר';
  const [dd, mm] = d.split('/');
  return `${dd}/${mm}`;
}

function NextShiftCard({
  soldierName,
  shavtzakAll,
}: {
  soldierName: string;
  shavtzakAll: ShavtzakAllData;
}) {
  const todayNum = dateToNum(todayShavtzakStr());
  const now = new Date();
  const nowVal = now.getHours() * 60 + now.getMinutes();

  let result: { date: string; mission: Mission } | null = null;
  for (const date of shavtzakAll.dates) {
    const dateNum = dateToNum(date);
    if (dateNum < todayNum) continue;
    const dayData = shavtzakAll.byDate[date];
    if (!dayData) continue;
    let missions = findMissions(soldierName, dayData);
    if (dateNum === todayNum) {
      missions = missions.filter(m => timeOfDayMinutes(m.time) > nowVal);
    }
    if (missions.length > 0) { result = { date, mission: missions[0] }; break; }
  }

  if (!result) return null;
  const { date, mission } = result;
  const c = getStationBadgeColors(mission.station);
  const label = dateLabel(date);
  const subLabel = mission.subType && mission.subType !== mission.station ? mission.subType : null;

  return (
    <div className="rounded-xl border-2 border-blue-200 bg-blue-50 px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
      <div>
        <div className="text-xs font-semibold text-blue-400 mb-1">המשמרת הבאה</div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`inline-flex items-center rounded-full border px-3 py-0.5 text-sm font-semibold ${c.bg} ${c.text} ${c.border}`}>
            {mission.station}{subLabel ? ` / ${subLabel}` : ''}
          </span>
        </div>
      </div>
      <div className="text-right">
        <div className="text-lg font-bold text-blue-700">{mission.time !== 'יומי' ? mission.time : 'יומי'}</div>
        <div className="text-sm text-blue-500">{label}</div>
      </div>
    </div>
  );
}

function MissionsTimeline({
  soldierName,
  filteredDates,
  shavtzakAll,
}: {
  soldierName: string;
  filteredDates: string[];
  shavtzakAll: import('../../api/_handlers/shavtzak').ShavtzakAllData;
}) {
  const days = filteredDates
    .map(d => ({ label: d, shavtzak: shavtzakAll.byDate[schedDateToShavtzakKey(d)] ?? null }))
    .filter(({ shavtzak }) => shavtzak && findMissions(soldierName, shavtzak).length > 0);

  if (days.length === 0) return (
    <div className="rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-400 text-center">
      אין שבצק בטווח התאריכים שנבחר
    </div>
  );

  return (
    <div className="rounded-xl border border-gray-200 bg-white divide-y divide-gray-100">
      {days.map(({ label, shavtzak }) => {
        const missions = findMissions(soldierName, shavtzak!);
        return (
          <div key={label} className="flex items-start gap-3 px-4 py-3 flex-wrap">
            <span className="text-sm font-semibold text-gray-500 whitespace-nowrap pt-0.5 min-w-[6rem]">{label}</span>
            <div className="flex flex-wrap gap-2">
              {missions.map((m, i) => {
                const c = getStationBadgeColors(m.station);
                const timePart = m.time && m.time !== 'יומי' ? ` • ${m.time}` : '';
                const badge = m.subType && m.subType !== m.station
                  ? `${m.station} / ${m.subType}${timePart}`
                  : `${m.station}${timePart}`;
                return (
                  <span key={i} className={`inline-flex items-center rounded-full border px-3 py-0.5 text-sm font-semibold ${c.bg} ${c.text} ${c.border}`}>
                    {badge}
                  </span>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}


function InfoField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-medium text-gray-500">{label}</dt>
      <dd className="text-sm font-semibold text-gray-800">{value || '—'}</dd>
    </div>
  );
}

export { toDateStr };
