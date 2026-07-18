import './env.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { freshSchema, closePool, query } from './helpers.js';
import { generate, persist } from '../src/generate.js';
import {
  buildDayInput, buildDayReportHtml, buildWeekReportHtml, keyShortages, DayReportInput,
} from '../src/report.js';

const D = '2026-08-10';

// HTML generation report — controlled scenario: only תורנים (2 seats,
// 14:00→14:00) is generated. Roster: three available soldiers (one with
// HTML-hostile characters in his name, one commander) and one soldier blocked
// for the whole schedule day (בבית). Three candidates for two seats ⇒ the
// ranked fill records comparative fairness rationale; the leftover soldier
// rests ⇒ a generation issue + a rest_bucket finding — all must show in the
// HTML.
let dayHtml = '';
let issues: string[] = [];

before(async () => {
  await freshSchema();
  await query(`update positions set is_scheduled = false
               where name not in ('תורנים', 'מנוחה', 'בבית')`);
  await query(`insert into soldiers (personal_number, full_name, platoon, role, rifle_level) values
    ('P001', 'זמין <ראשון> "מצוטט"', '1', 'לוחם', 3),
    ('P002', 'זמין שני', '2', 'מ"כ', 3),
    ('P003', 'זמין שלישי', '3', 'לוחם', 3),
    ('P004', 'חסום כליל', '1', 'לוחם', 3)`);
  await query(`insert into unavailability (soldier_id, period, kind)
               select id, tsrange('2026-08-09 00:00', '2026-08-13 00:00'), 'חופש'
               from soldiers where full_name = 'חסום כליל'`);
  const res = await generate(D);
  issues = res.issues;
  const findings = await persist(res);
  dayHtml = buildDayReportHtml(buildDayInput(res, findings, false));
});
after(closePool);

test('day report: RTL document with balance, process and stage sections', () => {
  assert.ok(dayHtml.includes('dir="rtl"'), 'missing dir="rtl"');
  assert.ok(dayHtml.includes('lang="he"'), 'missing lang="he"');
  assert.ok(dayHtml.includes('מאזן היום — דרישה מול מצבה'), 'missing balance section');
  assert.ok(dayHtml.includes('נדרשים 2 חיילים'), 'balance demand total wrong');
  assert.ok(dayHtml.includes('זמינים 3'), 'balance supply total wrong');
  assert.ok(dayHtml.includes('ניתוח התהליך — צעד אחר צעד'), 'missing process section');
  assert.ok(dayHtml.includes('מילוי לפי דרישה'), 'missing demand-fill step');
  assert.ok(dayHtml.includes('אף חייל לא הושפע היום'), 'muted (no-op) steps missing');
  assert.ok(dayHtml.includes('שלב 1 — חלוקה יומית לעמדות'), 'missing stage-1 section');
  assert.ok(dayHtml.includes('שלב 2 — איוש משמרות'), 'missing stage-2 section');
  assert.ok(dayHtml.includes('שרשורים'), 'missing chains section');
  assert.ok(dayHtml.includes('חריגות'), 'missing exceptions section');
});

test('day report: position table + header chips reflect the day', () => {
  assert.ok(dayHtml.includes('תורנים'), 'position name missing');
  assert.ok(dayHtml.includes('נוכחים בבסיס: 3'), 'present chip wrong');
  assert.ok(dayHtml.includes('בבית: 1'), 'home chip wrong');
});

test('day report: specific fairness badges + tooltips with pick-time numbers', () => {
  // 3 candidates for 2 seats: the ranked fill records a comparative claim
  // (everyone at 0 nights => fewest_nights) — the chip badge must be specific
  assert.ok(dayHtml.includes('מעט לילות'), 'specific fairness badge missing');
  // chip tooltip carries the soldier's numbers at pick time
  assert.ok(dayHtml.includes('לילות (7 ימים):'), 'tooltip numbers missing');
  assert.ok(dayHtml.includes('פעמים בעמדה זו:'), 'tooltip position count missing');
});

test('day report: rationale line rendered from the shared TEMPLATES', () => {
  // no prior shift on a fresh DB => the no_prior template text must appear
  assert.ok(dayHtml.includes('ללא משמרת קודמת סמוכה — מנוחה מלאה'),
    'no_prior rationale line missing');
});

test('day report: soldier names use the שבצק color scheme', () => {
  assert.ok(/class="pl-1[" ]/.test(dayHtml), 'platoon-1 color class missing');
  assert.ok(dayHtml.includes('cmd-name'), 'commander bold class missing');
  assert.ok(dayHtml.includes('#ef4444'), 'platoon-1 hex missing from CSS');
});

test('day report: generation issues + validation findings are shown', () => {
  // 3 soldiers for 2 seats: the leftover rests => everyone-works issue
  assert.ok(issues.some((i) => i.includes('נותר במנוחה')), JSON.stringify(issues));
  assert.ok(keyShortages(issues).length >= 1, 'leftover not classified as key shortage');
  assert.ok(dayHtml.includes('נותר במנוחה'), 'leftover issue not in HTML');
  // persist ran the validator: the resting soldier is a rest_bucket warning
  assert.ok(dayHtml.includes('rest_bucket'), 'rest_bucket finding rule tag missing');
  assert.ok(dayHtml.includes('ממצאי ולידציה'), 'validation findings section missing');
});

test('day report: soldier names are HTML-escaped', () => {
  assert.ok(!dayHtml.includes('<ראשון>'), 'unescaped < from a soldier name');
  assert.ok(dayHtml.includes('&lt;ראשון&gt;'), 'escaped name missing from report');
  assert.ok(dayHtml.includes('&quot;מצוטט&quot;'), 'quotes in name not escaped');
});

test('day report: ids resolve to names (pg bigint-as-string keys)', () => {
  // an unresolved id renders as "#<id>" inside a soldier chip — must not happen
  assert.ok(!/<span class="soldier">#\d/.test(dayHtml), 'unresolved soldier id chip');
  assert.ok(!/<td><b>#\d/.test(dayHtml), 'unresolved position id row');
});

test('day report: generic chip tooltip explains the priority cascade', () => {
  const input: DayReportInput = {
    day: D, generatedAt: 'עכשיו', dryRun: true,
    soldiers: [{
      id: 1, name: 'סתם חייל', platoon: '2', role: 'לוחם',
      nights7d: 1, weightedHours7d: 12, positionCounts: {}, allowedPositions: null,
    }],
    positions: [{
      id: 5, name: 'סיור', missionClass: 'dynamic',
      daily: false, chainOverlay: false, staffAllRoles: false,
    }],
    blocked: {}, exits: {}, locks: [], pools: [], seatReserved: [],
    level1: { 1: 5 }, level1Rationale: {}, demand: { 5: 1 }, demandBefore: { 5: 1 },
    flex: [], assignments: [], issues: [], findings: [],
  };
  const html = buildDayReportHtml(input);
  assert.ok(html.includes('נבחר לפי סדר העדיפויות'), 'cascade tooltip missing');
});

test('week report: cards, sortable fairness table with the three hour columns', () => {
  const html = buildWeekReportHtml({
    from: D, to: '2026-08-11',
    generatedAt: 'עכשיו',
    days: [
      { day: D, file: `${D}.html`, errors: 1, warnings: 2, shortages: ['תורנים: חסרים 1 חיילים'] },
      { day: '2026-08-11', file: '2026-08-11.html', errors: 0, warnings: 0, shortages: [] },
    ],
    fairness: [
      { name: 'זמין <ראשון> "מצוטט"', platoon: '1', role: 'לוחם', nightHours: 6, hatkafiHours: 0, totalHours: 16 },
      { name: 'זמין שני', platoon: '2', role: 'מ"כ', nightHours: 0, hatkafiHours: 24, totalHours: 8 },
    ],
  });
  assert.ok(html.includes('dir="rtl"'));
  assert.ok(html.includes(`href="${D}.html"`), 'day link missing');
  assert.ok(html.includes('שגיאות: 1'), 'error chip missing');
  assert.ok(html.includes('תורנים: חסרים 1 חיילים'), 'shortage bullet missing');
  // exactly the owner's three metric columns (no shifts / nights-count / days)
  assert.ok(html.includes('שעות לילה'), 'night-hours column missing');
  assert.ok(html.includes('שעות התקפי'), 'hatkafi-hours column missing');
  assert.ok(html.includes('סה"כ שעות'), 'total-hours column missing');
  assert.ok(!html.includes('<th>משמרות</th>'), 'old shifts column still present');
  // sortable headers + pinned stats footer
  assert.ok(html.includes('table class="sortable"'), 'sortable table class missing');
  assert.ok(html.includes('sort-arrow'), 'sort script missing');
  assert.ok(html.includes('<tfoot>'), 'stats footer missing');
  assert.ok(html.includes('סטיית תקן'), 'SD footer row missing');
  assert.ok(html.includes('ממוצע'), 'avg footer row missing');
  // name coloring + escaping
  assert.ok(/class="pl-1[" ]/.test(html), 'platoon color missing in fairness table');
  assert.ok(html.includes('cmd-name'), 'commander bold missing in fairness table');
  assert.ok(!html.includes('<ראשון>'), 'unescaped soldier name in week report');
});
