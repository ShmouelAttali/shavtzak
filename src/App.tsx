import { useState } from 'react';
import { SignIn, SignedIn, SignedOut, UserButton, useUser, useClerk } from '@clerk/clerk-react';
import type { TabId, SheetData } from './types';
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

function AppContent({ data }: { data: SheetData }) {
  const [activeTab, setActiveTab] = useState<TabId>('personal');

  return (
    <div className="min-h-screen bg-gray-50" dir="rtl">
      {/* Header */}
      <header className="bg-slate-800 text-white shadow-md">
        <div className="mx-auto max-w-6xl px-4 py-4 flex items-center justify-between">
          <h1 className="text-xl font-bold tracking-wide">מערכת שבצק - פלוגת הגמר גע"ש</h1>
          <div dir="ltr">
            <UserButton afterSignOutUrl="/" />
          </div>
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
        {activeTab === 'personal' && <PersonalSchedule data={data} />}
        {activeTab === 'unit' && <UnitSchedule data={data} />}
        {activeTab === 'company' && <ComingSoon title="סיכום פלוגתי" />}
        {activeTab === 'shavtzak' && <ComingSoon title="שבצק" />}
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
