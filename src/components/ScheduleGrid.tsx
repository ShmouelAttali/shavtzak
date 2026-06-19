import type { Soldier } from '../types';
import { getStatusStyle } from '../types';

interface Props {
  soldiers: Soldier[];
  dates: string[];
  dayNames: Record<string, string>;
  showName?: boolean;
}

function parseSheetDate(dateStr: string): Date {
  const [d, m, y] = dateStr.split('/');
  return new Date(2000 + parseInt(y), parseInt(m) - 1, parseInt(d));
}

function formatGregorian(dateStr: string) {
  const [d, m] = dateStr.split('/');
  return `${d}/${m}`;
}

function toHebrewNumeral(n: number): string {
  const ONES = ['', 'א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ז', 'ח', 'ט'];
  const TENS = ['', 'י', 'כ', 'ל'];
  if (n === 15) return 'ט"ו';
  if (n === 16) return 'ט"ז';
  const tens = Math.floor(n / 10);
  const ones = n % 10;
  const letters = TENS[tens] + ONES[ones];
  if (letters.length === 1) return letters + "'";
  return letters[0] + '"' + letters[1];
}

function formatHebrew(dateStr: string): string {
  try {
    const date = parseSheetDate(dateStr);
    const dayNum = parseInt(
      new Intl.DateTimeFormat('en-u-ca-hebrew', { day: 'numeric' }).format(date)
    );
    const monthName = new Intl.DateTimeFormat('he-IL-u-ca-hebrew', { month: 'long' }).format(date);
    return `${toHebrewNumeral(dayNum)} ב${monthName}`;
  } catch {
    return '';
  }
}

function isWeekend(dayName: string) {
  return dayName === 'יום שישי' || dayName === 'יום שבת';
}

export function ScheduleGrid({ soldiers, dates, dayNames, showName = true }: Props) {
  if (!soldiers.length || !dates.length) return null;

  return (
    <div className="overflow-auto rounded-lg border border-gray-200 shadow-sm max-h-[70vh]">
      <table className="border-collapse text-sm" style={{ direction: 'rtl' }}>
        <thead>
          <tr>
            {showName && (
              <th className="sticky right-0 top-0 z-20 bg-gray-50 px-3 py-2 text-right font-medium text-gray-600 border-b border-l border-gray-200 min-w-[130px]">
                שם
              </th>
            )}
            {dates.map((date) => {
              const day = dayNames[date] || '';
              const weekend = isWeekend(day);
              return (
                <th
                  key={date}
                  className={`sticky top-0 z-10 px-1 py-2 text-center font-normal text-xs border-b border-l border-gray-200 min-w-[80px] ${
                    weekend ? 'bg-blue-50 text-blue-700' : 'bg-gray-50 text-gray-500'
                  }`}
                >
                  <div className="font-semibold">{formatGregorian(date)}</div>
                  <div className="text-[10px] opacity-80">{formatHebrew(date)}</div>
                  <div className="text-[10px] opacity-60">{day.replace('יום ', '')}</div>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {soldiers.map((soldier, idx) => (
            <tr
              key={soldier.id}
              className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}
            >
              {showName && (
                <td className="sticky right-0 z-10 px-3 py-2 text-right border-b border-l border-gray-200 bg-inherit whitespace-nowrap">
                  <div className="font-medium text-gray-800">{soldier.fullName}</div>
                  <div className="text-xs text-gray-400">{soldier.role}</div>
                </td>
              )}
              {dates.map((date) => {
                const status = soldier.schedule[date] || '';
                const style = getStatusStyle(status);
                const weekend = isWeekend(dayNames[date] || '');
                return (
                  <td
                    key={date}
                    className={`px-1 py-1.5 text-center border-b border-l border-gray-200 ${
                      weekend ? 'bg-blue-50/30' : ''
                    }`}
                  >
                    {status && (
                      <span
                        className={`inline-block rounded px-1.5 py-0.5 text-xs font-medium ${style.bg} ${style.text}`}
                      >
                        {status}
                      </span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
