import { useMemo, useState } from 'react';
import type { SheetData } from '../types';
import { ScheduleGrid } from './ScheduleGrid';
import { useShavtzak, todayShavtzakStr } from '../hooks/useShavtzak';
import { getStationBadgeColors } from '../utils/stationColors';
import type { ShavtzakData } from '../../api/shavtzak';

interface Mission {
  station: string;
  subType: string;
  time: string;
}

function findMissions(soldierName: string, shavtzak: ShavtzakData): Mission[] {
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
  return missions;
}

interface Props {
  data: SheetData;
}

function toDateStr(d: Date) {
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yy = String(d.getFullYear()).slice(2);
  return `${dd}/${mm}/${yy}`;
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

export function PersonalSchedule({ data }: Props) {
  const { soldiers, dates, dayNames } = data;
  const { data: shavtzakAll } = useShavtzak();
  const shavtzak = shavtzakAll?.byDate[todayShavtzakStr()] ?? null;

  const today = new Date();
  const twoWeeksAhead = new Date();
  twoWeeksAhead.setDate(twoWeeksAhead.getDate() + 14);

  const [selectedUnit, setSelectedUnit] = useState(
    () => localStorage.getItem('personal:unit') ?? ''
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
    () =>
      (selectedUnit ? soldiers.filter((s) => s.unit === selectedUnit) : [])
        .sort((a, b) => a.fullName.localeCompare(b.fullName, 'he')),
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
            <option value="">-- בחר מחלקה --</option>
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
            disabled={!selectedUnit}
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
        <div className="rounded-xl border border-blue-100 bg-blue-50 p-4 space-y-3">
          <div className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
            <InfoField label="שם מלא" value={selectedSoldier.fullName} />
            <InfoField label="מספר טלפון" value={selectedSoldier.phone} />
            <InfoField label="מחלקה" value={`מחלקה ${selectedSoldier.unit}`} />
            <InfoField label="תפקיד" value={selectedSoldier.role} />
          </div>

          {/* Daily missions from שבצק */}
          <MissionsRow soldierName={selectedSoldier.fullName} shavtzak={shavtzak} />

        </div>
      )}

      {/* Schedule */}
      {selectedSoldier && filteredDates.length > 0 && (
        <ScheduleGrid
          soldiers={[selectedSoldier]}
          dates={filteredDates}
          dayNames={dayNames}
          showName={false}
        />
      )}

      {selectedSoldier && filteredDates.length === 0 && (
        <p className="text-center text-gray-500">אין תאריכים בטווח שנבחר</p>
      )}

      {!selectedSoldier && (
        <div className="rounded-xl border-2 border-dashed border-gray-200 py-16 text-center text-gray-400">
          <p className="text-lg">בחר מחלקה וחייל להצגת הלוז</p>
        </div>
      )}

      {/* Legend */}
      <Legend />
    </div>
  );
}

function MissionsRow({ soldierName, shavtzak }: { soldierName: string; shavtzak: ShavtzakData | null }) {
  if (!shavtzak) return null;

  const missions = findMissions(soldierName, shavtzak);

  return (
    <div className="border-t border-blue-100 pt-3">
      <dt className="text-xs font-medium text-gray-500 mb-2">
        שבצק יומי{shavtzak.date ? ` — ${shavtzak.date}` : ''}
      </dt>
      {missions.length === 0 ? (
        <span className="text-sm text-gray-400 italic">אין שבצק היום</span>
      ) : (
        <div className="flex flex-wrap gap-2">
          {missions.map((m, i) => {
            const c = getStationBadgeColors(m.station);
            const timePart = m.time && m.time !== 'יומי' ? ` • ${m.time}` : '';
            const label = m.subType && m.subType !== m.station
              ? `${m.station} / ${m.subType}${timePart}`
              : `${m.station}${timePart}`;
            return (
              <span
                key={i}
                className={`inline-flex items-center rounded-full border px-3 py-1 text-sm font-semibold ${c.bg} ${c.text} ${c.border}`}
              >
                {label}
              </span>
            );
          })}
        </div>
      )}
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

function Legend() {
  const items = [
    { bg: 'bg-green-100', text: 'text-green-800', label: 'נוכח' },
    { bg: 'bg-blue-100', text: 'text-blue-800', label: 'חופש' },
    { bg: 'bg-purple-100', text: 'text-purple-800', label: 'שחרור' },
    { bg: 'bg-red-100', text: 'text-red-800', label: 'לא מגיע' },
    { bg: 'bg-orange-100', text: 'text-orange-800', label: 'יציאה בערב' },
  ];
  return (
    <div className="flex flex-wrap gap-2 text-xs">
      {items.map((i) => (
        <span key={i.label} className={`rounded px-2 py-0.5 font-medium ${i.bg} ${i.text}`}>
          {i.label}
        </span>
      ))}
    </div>
  );
}

export { toDateStr };
