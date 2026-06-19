import { useState } from 'react';
import type { TabId } from './types';
import { useSoldiers } from './hooks/useSoldiers';
import { PersonalSchedule } from './components/PersonalSchedule';
import { UnitSchedule } from './components/UnitSchedule';
import { ComingSoon } from './components/ComingSoon';

const TABS: { id: TabId; label: string }[] = [
  { id: 'personal', label: 'לוז יציאות אישי' },
  { id: 'unit', label: 'לוז יציאות מחלקתי' },
  { id: 'company', label: 'סיכום פלוגתי' },
  { id: 'shavtzak', label: 'שבצק' },
];

export default function App() {
  const [activeTab, setActiveTab] = useState<TabId>('personal');
  const { data, loading, error } = useSoldiers();

  return (
    <div className="min-h-screen bg-gray-50" dir="rtl">
      {/* Header */}
      <header className="bg-slate-800 text-white shadow-md">
        <div className="mx-auto max-w-6xl px-4 py-4">
          <h1 className="text-xl font-bold tracking-wide">מערכת שבצק - פלוגת הגמר גע"ש</h1>
        </div>
      </header>

      {/* Tab bar */}
      <div className="sticky top-0 z-20 bg-white shadow-sm">
        <div className="mx-auto max-w-6xl">
          <nav className="flex overflow-x-auto" aria-label="Tabs">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex-shrink-0 border-b-2 px-4 py-3 text-sm font-medium whitespace-nowrap transition-colors ${
                  activeTab === tab.id
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </nav>
        </div>
      </div>

      {/* Content */}
      <main className="mx-auto max-w-6xl px-4 py-6">
        {loading && (
          <div className="flex items-center justify-center py-24">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-500 border-t-transparent" />
            <span className="mr-3 text-gray-600">טוען נתונים...</span>
          </div>
        )}

        {error && (
          <div className="rounded-xl bg-red-50 p-6 text-center text-red-700">
            <p className="font-semibold">שגיאה בטעינת נתונים</p>
            <p className="mt-1 text-sm opacity-80">{error}</p>
          </div>
        )}

        {!loading && !error && data && (
          <>
            {activeTab === 'personal' && <PersonalSchedule data={data} />}
            {activeTab === 'unit' && <UnitSchedule data={data} />}
            {activeTab === 'company' && <ComingSoon title="סיכום פלוגתי" />}
            {activeTab === 'shavtzak' && <ComingSoon title="שבצק" />}
          </>
        )}
      </main>
    </div>
  );
}
