export interface Soldier {
  id: string;
  firstName: string;
  lastName: string;
  fullName: string;
  phone: string;
  role: string;
  unit: string;
  notes: string;
  vacationCount: number;
  schedule: Record<string, string>; // date string "21/06/26" -> status
}

export interface SheetData {
  soldiers: Soldier[];
  dates: string[]; // ordered list of date strings
  dayNames: Record<string, string>; // date -> Hebrew day name
}

export type TabId = 'personal' | 'unit' | 'company' | 'shavtzak';

export const STATUS_COLORS: Record<string, { bg: string; text: string; label: string }> = {
  'נוכח': { bg: 'bg-green-100', text: 'text-green-800', label: 'נוכח' },
  'חופש': { bg: 'bg-blue-100', text: 'text-blue-800', label: 'חופש' },
  'שחרור': { bg: 'bg-purple-100', text: 'text-purple-800', label: 'שחרור' },
  'שחרר': { bg: 'bg-purple-100', text: 'text-purple-800', label: 'שחרר' },
  'לא מגיע': { bg: 'bg-red-100', text: 'text-red-800', label: 'לא מגיע' },
  'יציאה בערב': { bg: 'bg-orange-100', text: 'text-orange-800', label: 'יציאה בערב' },
  'שחרור שבועי': { bg: 'bg-indigo-100', text: 'text-indigo-800', label: 'שחרור שבועי' },
};

export function getStatusStyle(status: string) {
  if (!status) return { bg: 'bg-gray-50', text: 'text-gray-400', label: '' };
  for (const [key, val] of Object.entries(STATUS_COLORS)) {
    if (status.includes(key)) return val;
  }
  return { bg: 'bg-gray-100', text: 'text-gray-600', label: status };
}
