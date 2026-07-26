import { useEffect, useRef, useState } from 'react';
import { SignIn, SignedIn, SignedOut, UserButton, useUser, useClerk } from '@clerk/clerk-react';
import type { TabId, SheetData, TabLeaveGuard } from './types';
import { useSoldiers } from './hooks/useSoldiers';
import { useShavtzak } from './hooks/useShavtzak';
import { useShavtzakAccess } from './hooks/useIsShavtzakAdmin';
import { PersonalSchedule } from './components/PersonalSchedule';
import { UnitSchedule } from './components/UnitSchedule';
import { CompanySummary } from './components/CompanySummary';
import { Shavtzak } from './components/Shavtzak';
import { DraftSchedule } from './components/DraftSchedule';
import { FairnessView } from './components/FairnessView';
import { ExitRequests } from './components/ExitRequests';
import { AdminExits } from './components/AdminExits';
import { HamalSchedule } from './components/HamalSchedule';
import { DayStructure } from './components/DayStructure';
import { Roster } from './components/Roster';
import { TAB_STORAGE_KEY, resolveInitialTab, withTabParam } from './lib/tabParam';

const COMPANY_ROLES = new Set(['מ"פ', 'סמ"פ', 'מ"מ', 'סמל', 'מ"כ']);

// restricted levels: 'company' = command roles only (sheet role);
// 'scheduler' = shavtzak_admins (scheduler DB table) only — NOT command roles;
// 'hamal' = shavtzak_admins OR a חמל-role soldier matched by email (the dedicated חמל tab)
const TABS: { id: TabId; label: string; restricted?: 'company' | 'scheduler' | 'hamal' }[] = [
  { id: 'personal',  label: 'לוז אישי' },
  { id: 'unit',      label: 'לוז יציאות מחלקתי' },
  { id: 'company',   label: 'סיכום פלוגתי', restricted: 'company' },
  { id: 'shavtzak',  label: 'שבצק' },
  { id: 'exitreq',   label: 'יציאה קצרה' },
  { id: 'draft',     label: 'צור שבצק', restricted: 'scheduler' },
  { id: 'fairness',  label: 'הוגנות', restricted: 'scheduler' },
  { id: 'daystructure', label: 'מבנה יומי', restricted: 'scheduler' },
  { id: 'exitadmin', label: 'ניהול יציאות', restricted: 'scheduler' },
  { id: 'roster',    label: 'מצבת חיילים', restricted: 'scheduler' },
  { id: 'hamal',     label: 'חמל', restricted: 'hamal' },
];

const APP_VERSION = '1.0.1';

// ── Selected tab ↔ URL (?tab=) + localStorage ──────────────────────────────
// The URL is the shareable source of truth; localStorage remembers the last
// tab so opening the bare site lands where the user left off (and rewrites
// the URL to match). Pure helpers in src/lib/tabParam.ts.
const TAB_IDS = TABS.map(t => t.id);

function initialTab(): TabId {
  let stored: string | null = null;
  try { stored = localStorage.getItem(TAB_STORAGE_KEY); } catch { /* private mode */ }
  return resolveInitialTab(window.location.search, stored, TAB_IDS, 'personal');
}

// replaceState (not push): the tab is a view, not a navigation step — this keeps
// the back button pointing outside the app instead of unwinding tab clicks.
function persistTab(id: TabId) {
  try { localStorage.setItem(TAB_STORAGE_KEY, id); } catch { /* private mode */ }
  const href = withTabParam(window.location.href, id);
  if (href) window.history.replaceState(window.history.state, '', href);
}

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

// Prompt shown when leaving a tab with unsaved edits (the מבנה יומי guard).
function LeaveGuardPopup({ onSave, onDiscard, onCancel, saving }: {
  onSave: () => void; onDiscard: () => void; onCancel: () => void; saving: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" onClick={onCancel}>
      <div className="bg-white rounded-2xl shadow-2xl p-6 space-y-4 max-w-xs w-full" onClick={e => e.stopPropagation()} dir="rtl">
        <div className="text-lg font-bold text-slate-800">יש שינויים שלא נשמרו</div>
        <div className="text-sm text-gray-500">לשמור את השינויים לפני המעבר?</div>
        <div className="flex flex-col gap-2">
          <button onClick={onSave} disabled={saving}
            className="w-full rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white py-2 text-sm font-semibold">שמור ועבור</button>
          <button onClick={onDiscard} disabled={saving}
            className="w-full rounded-xl border border-gray-200 py-2 text-sm text-gray-600 hover:bg-gray-50">התעלם מהשינויים</button>
          <button onClick={onCancel} disabled={saving}
            className="w-full rounded-xl py-2 text-sm text-gray-400 hover:bg-gray-50">ביטול</button>
        </div>
      </div>
    </div>
  );
}

function AppContent({ data }: { data: SheetData }) {
  const [activeTab, setActiveTab] = useState<TabId>(initialTab);
  const [showAbout, setShowAbout] = useState(false);
  // Leave guard: a tab may register {isDirty, save}; switching away while dirty
  // opens a save/discard/cancel popup (used by מבנה יומי).
  const tabLeaveGuardRef = useRef<TabLeaveGuard | null>(null);
  const [pendingTab, setPendingTab] = useState<TabId | null>(null);
  const [guardSaving, setGuardSaving] = useState(false);
  const { user } = useUser();

  const myEmail = user?.primaryEmailAddress?.emailAddress?.toLowerCase() ?? '';
  const mySoldier = data.soldiers.find(s => s.email.toLowerCase() === myEmail) ?? null;
  const myRole = mySoldier?.role ?? '';
  const mySoldierName = mySoldier?.fullName ?? '';
  const canSeeCompany = COMPANY_ROLES.has(myRole);
  const { isShavtzakAdmin, isHamalMember, loaded: accessLoaded } = useShavtzakAccess(myEmail);
  const canSeeScheduler = isShavtzakAdmin;
  const canSeeHamal = isShavtzakAdmin || isHamalMember;

  const tabAllowed = (id: TabId): boolean => {
    const tab = TABS.find(t => t.id === id);
    if (!tab?.restricted) return true;
    if (tab.restricted === 'company') return canSeeCompany;
    if (tab.restricted === 'scheduler') return canSeeScheduler;
    return canSeeHamal;
  };

  // If a restricted tab becomes inaccessible, fall back to personal. Waits for
  // the access lookup — until it answers everything reads as forbidden, which
  // would bounce a legitimate ?tab=roster deep link.
  useEffect(() => {
    if (!accessLoaded) return;
    if (!tabAllowed(activeTab)) setActiveTab('personal');
  }, [activeTab, accessLoaded, canSeeCompany, canSeeScheduler, canSeeHamal]);

  // Keep ?tab= and the remembered tab in sync with the selection (also on first
  // render, so a bare URL gets the query param written for sharing).
  useEffect(() => { persistTab(activeTab); }, [activeTab]);
  const { data: shavtzakAll, loading: shavtzakLoading, error: shavtzakError, reload: reloadShavtzak } = useShavtzak();

  // Switch tabs, but if the current tab has unsaved edits open the leave guard.
  const requestTab = (id: TabId) => {
    if (id === activeTab) return;
    const guard = tabLeaveGuardRef.current;
    if (guard && guard.isDirty()) { setPendingTab(id); return; }
    setActiveTab(id);
  };
  const guardSaveAndGo = async () => {
    const guard = tabLeaveGuardRef.current;
    setGuardSaving(true);
    const ok = guard ? await guard.save() : true;
    setGuardSaving(false);
    if (ok && pendingTab) setActiveTab(pendingTab);
    if (ok) setPendingTab(null);
  };
  const guardDiscardAndGo = () => { if (pendingTab) setActiveTab(pendingTab); setPendingTab(null); };

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
            {TABS.filter(tab => tabAllowed(tab.id)).map((tab) => (
              <button
                key={tab.id}
                onClick={() => requestTab(tab.id)}
                className={`flex-shrink-0 border-b-2 px-4 py-3 text-sm font-medium whitespace-nowrap transition-colors ${
                  activeTab === tab.id
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
                }`}
              >
                {tab.label}{tab.restricted && <span className="mr-1 text-xs opacity-60">🔒</span>}
              </button>
            ))}
          </nav>
        </div>
      </div>

      {showAbout && <AboutPopup onClose={() => setShowAbout(false)} />}
      {pendingTab && (
        <LeaveGuardPopup saving={guardSaving}
          onSave={guardSaveAndGo} onDiscard={guardDiscardAndGo} onCancel={() => setPendingTab(null)} />
      )}

      {/* Content */}
      <main className="mx-auto max-w-6xl px-4 py-6">
        {/* A deep link to a restricted tab waits for the access lookup rather
            than rendering it — the effect above bounces it if not permitted. */}
        {!tabAllowed(activeTab) ? (
          <div className="flex items-center justify-center py-24">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-500 border-t-transparent" />
          </div>
        ) : (<>
          {activeTab === 'personal' && <PersonalSchedule data={data} shavtzakAll={shavtzakAll} />}
          {activeTab === 'unit' && <UnitSchedule data={data} />}
          {activeTab === 'company' && <CompanySummary data={data} shavtzakAll={shavtzakAll} />}
          {activeTab === 'shavtzak' && <Shavtzak soldiers={data.soldiers} shavtzakAll={shavtzakAll} loading={shavtzakLoading} error={shavtzakError} mySoldierName={mySoldierName} />}
          {activeTab === 'draft' && <DraftSchedule soldiers={data.soldiers} mySoldierName={mySoldierName} email={myEmail} />}
          {activeTab === 'fairness' && <FairnessView />}
          {activeTab === 'daystructure' && <DayStructure guardRef={tabLeaveGuardRef} />}
          {activeTab === 'exitreq' && <ExitRequests soldierName={mySoldierName} email={myEmail} />}
          {activeTab === 'exitadmin' && <AdminExits soldiers={data.soldiers} email={myEmail} />}
          {activeTab === 'roster' && <Roster guardRef={tabLeaveGuardRef} />}
          {activeTab === 'hamal' && <HamalSchedule />}
        </>)}
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
