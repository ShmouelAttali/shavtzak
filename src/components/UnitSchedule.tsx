import { useMemo, useState } from 'react';
import type { SheetData } from '../types';
import { ScheduleGrid } from './ScheduleGrid';

interface Props {
  data: SheetData;
}

function toInputDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

function fromInputDate(s: string) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function parseSheetDate(dateStr: string): Date {
  const [d, m, y] = dateStr.split('/');
  return new Date(2000 + parseInt(y), parseInt(m) - 1, parseInt(d));
}

export function UnitSchedule({ data }: Props) {
  const { soldiers, dates, dayNames } = data;

  const today = new Date();
  const twoWeeksAhead = new Date();
  twoWeeksAhead.setDate(twoWeeksAhead.getDate() + 14);

  const [selectedUnit, setSelectedUnit] = useState(
    () => localStorage.getItem('unit:unit') ?? ''
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

  const filteredDates = useMemo(() => {
    const from = fromInputDate(fromDate);
    const to = fromInputDate(toDate);
    return dates.filter((d) => {
      const dt = parseSheetDate(d);
      return dt >= from && dt <= to;
    });
  }, [dates, fromDate, toDate]);

  const stats = useMemo(() => {
    if (!unitSoldiers.length || !filteredDates.length) return null;
    const presentByDate: Record<string, number> = {};
    for (const date of filteredDates) {
      presentByDate[date] = unitSoldiers.filter((s) => {
        const status = s.schedule[date] || '';
        return status === 'נוכח' || !status;
      }).length;
    }
    return presentByDate;
  }, [unitSoldiers, filteredDates]);

  return (
    <div className="space-y-5">
      {/* Filters */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">מחלקה</label>
          <select
            value={selectedUnit}
            onChange={(e) => {
              setSelectedUnit(e.target.value);
              localStorage.setItem('unit:unit', e.target.value);
            }}
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

      {/* Unit summary chips */}
      {selectedUnit && unitSoldiers.length > 0 && (
        <div className="flex items-center gap-3 text-sm text-gray-600">
          <span className="rounded-full bg-gray-100 px-3 py-1 font-medium">
            {unitSoldiers.length} חיילים
          </span>
        </div>
      )}

      {/* Grid */}
      {selectedUnit && unitSoldiers.length > 0 && filteredDates.length > 0 ? (
        <ScheduleGrid
          soldiers={unitSoldiers}
          dates={filteredDates}
          dayNames={dayNames}
          showName
        />
      ) : selectedUnit && filteredDates.length === 0 ? (
        <p className="text-center text-gray-500">אין תאריכים בטווח שנבחר</p>
      ) : (
        <div className="rounded-xl border-2 border-dashed border-gray-200 py-16 text-center text-gray-400">
          <p className="text-lg">בחר מחלקה להצגת הלוז</p>
        </div>
      )}

      {/* Stats row */}
      {stats && selectedUnit && (
        <div className="rounded-xl bg-gray-50 p-4">
          <h3 className="mb-3 text-sm font-semibold text-gray-700">נוכחים לפי יום</h3>
          <div className="flex flex-wrap gap-2">
            {filteredDates.map((date) => {
              const count = stats[date] ?? 0;
              const total = unitSoldiers.length;
              const pct = total ? Math.round((count / total) * 100) : 0;
              return (
                <div
                  key={date}
                  className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-center text-xs"
                >
                  <div className="font-medium text-gray-800">{date.slice(0, 5)}</div>
                  <div
                    className={`mt-0.5 font-bold ${
                      pct >= 80
                        ? 'text-green-600'
                        : pct >= 50
                        ? 'text-yellow-600'
                        : 'text-red-600'
                    }`}
                  >
                    {count}/{total}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
