import { useEffect, useState } from 'react';
import { SignIn, SignedIn, SignedOut, UserButton, useUser, useClerk } from '@clerk/clerk-react';
import type { TabId, SheetData } from './types';
import { useSoldiers } from './hooks/useSoldiers';
import { useShavtzak } from './hooks/useShavtzak';
import { PersonalSchedule } from './components/PersonalSchedule';
import { UnitSchedule } from './components/UnitSchedule';
import { CompanySummary } from './components/CompanySummary';
import { Shavtzak } from './components/Shavtzak';
import { DraftSchedule } from './components/DraftSchedule';
import { FairnessView } from './components/FairnessView';

const COMPANY_ROLES = new Set(['מ"פ', 'סמ"פ', 'מ"מ', 'סמל', 'מ"כ']);

const TABS: { id: TabId; label: string; restricted?: true }[] = [
  { id: 'personal',  label: 'לוז אישי' },
  { id: 'unit',      label: 'לוז יציאות מחלקתי' },
  { id: 'company',   label: 'סיכום פלוגתי', restricted: true },
  { id: 'shavtzak',  label: 'שבצק' },
  { id: 'draft',     label: 'שבצק חדש (טיוטה)', restricted: true },
  { id: 'fairness',  label: 'הוגנות', restricted: true },
];

const APP_VERSION = '1.0.1';

function AboutPopup({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl p-8 text-center space-y-3 max-w-xs w-full" onClick={e => e.stopPropagation()} dir="rtl">
        <div className="text-2xl font-bold text-slate-800">מערכת שבצק</div>
        <div className="text-sm text-gray-500">פלוגת הגמר גע"ש</div>
        <div className="border-t border-gray-100 pt-3 space-y-1">
          <div className="text-sm text-gray-600">גרסה <span className="font-semibold text-slate-700">{APP_VERSION}</span></div>
          <div className="text-sm text-gray-600">פותח על ידי <span className="font-semibold text-slate-700">שמואל אטלי</span></div>
        </div>
        <button onClick={onClose} className="mt-2 w-full rounded-xl border border-gray-200 py-2 text-sm text-gray-500 hover:bg-gray-50">
          סגור
        </button>
      </div>
    </div>
  );
}

function AppContent({ data }: { data: SheetData }) {
  const [activeTab, setActiveTab] = useState<TabId>('personal');
  const [showAbout, setShowAbout] = useState(false);
  const { user } = useUser();

  const myEmail = user?.primaryEmailAddress?.emailAddress?.toLowerCase() ?? '';
  const mySoldier = data.soldiers.find(s => s.email.toLowerCase() === myEmail) ?? null;
  const myRole = mySoldier?.role ?? '';
  const mySoldierName = mySoldier?.fullName ?? '';
  const canSeeCompany = COMPANY_ROLES.has(myRole);

  // If a restricted tab becomes inaccessible, fall back to personal
  useEffect(() => {
    if (['company', 'draft', 'fairness'].includes(activeTab) && !canSeeCompany) setActiveTab('personal');
  }, [activeTab, canSeeCompany]);
  const { data: shavtzakAll, loading: shavtzakLoading, error: shavtzakError, reload: reloadShavtzak } = useShavtzak();

  return (
    <div className="min-h-screen bg-gray-50" dir="rtl">
      {/* Header */}
      <header className="bg-slate-800 text-white shadow-md">
        <div className="mx-auto max-w-6xl px-4 py-4 flex items-center justify-between">
          <h1
            className="text-xl font-bold tracking-wide cursor-pointer select-none hover:opacity-80 transition-opacity"
            onClick={() => setShowAbout(true)}
          >מערכת שבצק - פלוגת הגמר גע"ש</h1>
          <div className="flex items-center gap-3" dir="ltr">
            <button
              onClick={reloadShavtzak}
              disabled={shavtzakLoading}
              title="טען מחדש"
              className="rounded-lg border border-white/30 bg-white/10 hover:bg-white/20 px-3 py-1.5 text-sm font-medium text-white transition-colors disabled:opacity-50 flex items-center gap-1.5"
            >
              <span className={shavtzakLoading ? 'animate-spin inline-block' : ''}>↺</span>
              טען מחדש
            </button>
            <a
              href="https://s25qjhg6wm.zite.so"
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-lg bg-blue-500 hover:bg-blue-400 px-3 py-1.5 text-sm font-semibold text-white transition-colors whitespace-nowrap"
              dir="rtl"
            >
              הגש בקשה ליציאה
            </a>
            <UserButton afterSignOutUrl="/" />
          </div>
        </div>
      </header>

      {/* Tab bar */}
      <div className="sticky top-0 z-20 bg-white shadow-sm">
        <div className="mx-auto max-w-6xl">
          <nav className="flex overflow-x-auto" aria-label="Tabs">
            {TABS.filter(tab => !tab.restricted || canSeeCompany).map((tab) => (
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

      {showAbout && <AboutPopup onClose={() => setShowAbout(false)} />}

      {/* Content */}
      <main className="mx-auto max-w-6xl px-4 py-6">
        {activeTab === 'personal' && <PersonalSchedule data={data} shavtzakAll={shavtzakAll} />}
        {activeTab === 'unit' && <UnitSchedule data={data} />}
        {activeTab === 'company' && <CompanySummary data={data} shavtzakAll={shavtzakAll} />}
        {activeTab === 'shavtzak' && <Shavtzak soldiers={data.soldiers} shavtzakAll={shavtzakAll} loading={shavtzakLoading} error={shavtzakError} mySoldierName={mySoldierName} />}
        {activeTab === 'draft' && <DraftSchedule soldiers={data.soldiers} mySoldierName={mySoldierName} />}
        {activeTab === 'fairness' && <FairnessView />}
      </main>
    </div>
  );
}

function AccessDenied() {
  const { signOut } = useClerk();
  const { user } = useUser();
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center" dir="rtl">
      <div className="rounded-xl bg-white p-10 shadow-md text-center max-w-sm">
        <div className="text-4xl mb-4">🚫</div>
        <h2 className="text-xl font-bold text-gray-800">אין גישה</h2>
        <p className="mt-2 text-gray-500 text-sm">
          החשבון <span className="font-medium">{user?.primaryEmailAddress?.emailAddress}</span> אינו מורשה לגשת למערכת.
        </p>
        <button
          onClick={() => signOut()}
          className="mt-6 rounded-lg bg-slate-800 px-5 py-2 text-sm font-medium text-white hover:bg-slate-700"
        >
          התנתק
        </button>
      </div>
    </div>
  );
}

function AuthGate() {
  const { user } = useUser();
  const { data, loading } = useSoldiers();

  if (loading || !data) return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-500 border-t-transparent" />
    </div>
  );

  // If no emails configured in the sheet — allow everyone
  if (data.allowedEmails.length === 0) return <AppContent data={data} />;

  const email = user?.primaryEmailAddress?.emailAddress?.toLowerCase() ?? '';
  if (data.allowedEmails.includes(email)) return <AppContent data={data} />;

  return <AccessDenied />;
}

export default function App() {
  return (
    <>
      <SignedIn>
        <AuthGate />
      </SignedIn>
      <SignedOut>
        <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center" dir="rtl">
          <div className="mb-8 text-center">
            <h1 className="text-2xl font-bold text-slate-800">מערכת שבצק - פלוגת הגמר גע"ש</h1>
            <p className="mt-2 text-gray-500">יש להתחבר כדי להמשיך</p>
          </div>
          <div dir="ltr">
            <SignIn routing="hash" />
          </div>
        </div>
      </SignedOut>
    </>
  );
}
