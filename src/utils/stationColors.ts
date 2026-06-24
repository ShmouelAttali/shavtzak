export interface BadgeColors { bg: string; text: string; border: string }

const STATION_BADGES: [string, BadgeColors][] = [
  ['סיור',        { bg: 'bg-blue-100',   text: 'text-blue-800',   border: 'border-blue-200' }],
  ['עמדות הגנה', { bg: 'bg-slate-100',  text: 'text-slate-700',  border: 'border-slate-200' }],
  ['חפק',         { bg: 'bg-orange-100', text: 'text-orange-800', border: 'border-orange-200' }],
  ['חמ',          { bg: 'bg-sky-100',    text: 'text-sky-800',    border: 'border-sky-200' }],
  ['מגן',         { bg: 'bg-purple-100', text: 'text-purple-800', border: 'border-purple-200' }],
  ['זימות',       { bg: 'bg-teal-100',   text: 'text-teal-800',   border: 'border-teal-200' }],
  ['תגבורות',     { bg: 'bg-red-100',    text: 'text-red-800',    border: 'border-red-200' }],
  ['נוספים',      { bg: 'bg-indigo-100', text: 'text-indigo-800', border: 'border-indigo-200' }],
];

const FALLBACK: BadgeColors = { bg: 'bg-gray-100', text: 'text-gray-700', border: 'border-gray-200' };

export function getStationBadgeColors(stationName: string): BadgeColors {
  for (const [key, colors] of STATION_BADGES) {
    if (stationName.includes(key)) return colors;
  }
  return FALLBACK;
}
