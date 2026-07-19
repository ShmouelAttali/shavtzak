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
  // 3 IDENTICAL fresh candidates for 2 seats: no key separates the pick from
  // the runner-up ⇒ the group picks record fairness_pick (a full tie), and the
  // chip tooltip renders the priority-cascade template
  assert.ok(dayHtml.includes('נבחר לפי סדר העדיפויות'), 'fairness_pick tooltip missing');
  // chip tooltip carries the soldier's numbers at pick time
  assert.ok(dayHtml.includes('לילות השבוע:'), 'tooltip numbers missing');
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

test('day report: demand fill is split into granular rounds with the cascade', () => {
  // owner request 2026-07-19: step 9 split — pass A commanders, pass A
  // drivers, pass B platoon crews, pass B general ranked fill
  assert.ok(dayHtml.includes('סבב א׳: מכסת מפקדים'), 'commander-quota step missing');
  assert.ok(dayHtml.includes('סבב א׳: מכסת נהגים'), 'driver-quota step missing');
  assert.ok(dayHtml.includes('סבב ב׳: צוותים מחלקתיים'), 'platoon-crews step missing');
  assert.ok(dayHtml.includes('סבב ב׳: מילוי הוגנות כללי'), 'general-fill step missing');
  assert.ok(!dayHtml.includes('מכסות ואז הוגנות'), 'old merged step 9 still present');
  // the general-fill step documents the exact Level-1 GROUP cascade (sort,
  // not score) — nights (P2) and sub rotation moved to the Level-2 cascade
  assert.ok(dayHtml.includes('סדר העדיפויות המלא'), 'cascade details missing');
  assert.ok(dayHtml.includes('עומס שבועי משוקלל, בדליים של יממת עבודה'), 'P3 cascade item missing');
  assert.ok(dayHtml.includes('מי שצבר הכי הרבה מנוחה — עד 48 שעות (P6)'), 'P6 cascade item missing');
  assert.ok(!dayHtml.includes('מיעוט לילות בשבוע האחרון (P2)'), 'old P2 cascade item still present');
  assert.ok(dayHtml.includes('מוכרעים בתוך הקבוצה בשלב 2'),
    'note about P2/night-spread deciding inside the group at stage 2 missing');
});

test('day report: quota chips carry the pick + why, and leave the general step', () => {
  const input: DayReportInput = {
    day: D, generatedAt: 'עכשיו', dryRun: true,
    soldiers: [
      { id: 1, name: 'מפקד מכסה', platoon: '1', role: 'מ"כ',
        nights7d: 0, weightedHours7d: 0, positionCounts: {}, allowedPositions: null },
      { id: 2, name: 'חייל הוגנות', platoon: '2', role: 'לוחם',
        nights7d: 0, weightedHours7d: 0, positionCounts: {}, allowedPositions: null },
    ],
    positions: [{
      id: 5, name: 'סיור', missionClass: 'dynamic',
      daily: false, chainOverlay: false, staffAllRoles: false,
    }],
    blocked: {}, exits: {}, locks: [], pools: [], seatReserved: [],
    level1: { 1: 5, 2: 5 },
    level1Rationale: {
      1: [
        { code: 'commander_quota', params: { position: 'סיור' } },
        { code: 'decisive_key',
          params: { dim: 'עומס שבועי', mine: '12.0 שעות', next: '18.5 שעות' } },
      ],
      2: [{ code: 'fairness_pick' }],
    },
    demand: { 5: 2 }, demandBefore: { 5: 2 },
    flex: [], assignments: [], issues: [], findings: [],
  };
  const html = buildDayReportHtml(input);
  // the quota chip names the soldier AND the decisive key vs the runner-up
  const cmdStep = html.split('סבב א׳: מכסת מפקדים')[1]?.split('</details>')[0] ?? '';
  assert.ok(cmdStep.includes('מפקד מכסה'), 'quota pick not named in the commander step');
  assert.ok(cmdStep.includes('שובץ במכסת המפקדים של סיור'), 'quota reason missing');
  assert.ok(cmdStep.includes('הוכרע מול הבא בתור לפי עומס שבועי'),
    'why-this-commander decisive fact missing');
  // the quota soldier must NOT reappear in the general-fairness step
  const genStep = html.split('סבב ב׳: מילוי הוגנות כללי')[1]?.split('</details>')[0] ?? '';
  assert.ok(genStep.includes('חייל הוגנות'), 'fairness pick missing from the general step');
  assert.ok(!genStep.includes('מפקד מכסה'), 'quota soldier leaked into the general step');
});

test('day report: flex-step totals match the balance table (staff crews at actual size)', () => {
  // חמל-style staff crew: slot cap 5 but only 2 role soldiers present — both
  // the balance table AND step 5 must count it as 2, not the cap (owner
  // question 2026-07-19: the two figures disagreed, 60 vs 57)
  const soldiers = [1, 2, 3, 4].map((id) => ({
    id, name: `חייל ${id}`, platoon: '1', role: id <= 2 ? 'חמל' : 'לוחם',
    nights7d: 0, weightedHours7d: 0, positionCounts: {}, allowedPositions: null,
  }));
  const input: DayReportInput = {
    day: D, generatedAt: 'עכשיו', dryRun: true,
    soldiers,
    positions: [
      { id: 7, name: 'חמל', missionClass: 'readiness',
        daily: false, chainOverlay: false, staffAllRoles: true },
      { id: 5, name: 'סיור', missionClass: 'dynamic',
        daily: false, chainOverlay: false, staffAllRoles: false },
    ],
    blocked: {}, exits: {}, locks: [], pools: [], seatReserved: [],
    level1: { 1: 7, 2: 7, 3: 5, 4: 5 },
    level1Rationale: {},
    demand: { 7: 5, 5: 2 }, demandBefore: { 7: 5, 5: 2 },   // 5 = the staff CAP
    flex: [], assignments: [], issues: [], findings: [],
  };
  const html = buildDayReportHtml(input);
  assert.ok(html.includes('נדרשים 4 חיילים'), 'balance total must count חמל at actual size (2+2)');
  assert.ok(html.includes('דרישת בסיס 4 מול 4 זמינים'),
    'flex-step baseline must use the same convention as the balance table');
  assert.ok(!html.includes('דרישת בסיס 7'), 'flex step still counts the staff cap');
});

test('day report: unabsorbed surplus is called out in red on the flex step', () => {
  // 3 soldiers for 2 seats and no flex-capable position scheduled: the extra
  // soldier ends in מנוחה => step 5 carries a red (.viol) callout naming him
  const m = dayHtml.match(/<span class="viol">⚠ (חייל עודף אחד שלא נקלט — יסומן במנוחה|\d+ חיילים עודפים שלא נקלטו — יסומנו במנוחה): ([^<]+)<\/span>/);
  assert.ok(m, 'red surplus-rester callout missing from flex step');
  assert.ok(m![1].startsWith('חייל עודף אחד'), 'expected the singular wording for one rester');
  assert.ok(m![2].startsWith('זמין'), `unexpected rester name: ${m![2]}`);
  // the callout sits inside step 5 (flex sizing), not only in step 12
  const step5 = dayHtml.split('גמישות מושבים — כולם עובדים')[1]?.split('</details>')[0] ?? '';
  assert.ok(step5.includes('class="viol"'), 'red callout not inside the flex step');
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

test('day report: decisive_key chip is badged with its dimension in stage 1', () => {
  const input: DayReportInput = {
    day: D, generatedAt: 'עכשיו', dryRun: true,
    soldiers: [{
      id: 1, name: 'חייל מוכרע', platoon: '2', role: 'לוחם',
      nights7d: 1, weightedHours7d: 12, positionCounts: {}, allowedPositions: null,
    }],
    positions: [{
      id: 5, name: 'סיור', missionClass: 'dynamic',
      daily: false, chainOverlay: false, staffAllRoles: false,
    }],
    blocked: {}, exits: {}, locks: [], pools: [], seatReserved: [],
    level1: { 1: 5 },
    level1Rationale: {
      1: [{ code: 'decisive_key',
        params: { dim: 'רוטציה מאתמול', mine: 'סיור→מגן', next: 'מגן→מגן' } }],
    },
    demand: { 5: 1 }, demandBefore: { 5: 1 },
    flex: [], assignments: [], issues: [], findings: [],
  };
  const html = buildDayReportHtml(input);
  // stage-1 chip: the badge names the decisive dimension, not a generic label
  assert.ok(html.includes('<span class="badge">רוטציה מאתמול</span>'),
    'decisive_key dim not used as the stage-1 chip badge');
  // the rendered decisive template (my value vs the runner-up's) is present
  assert.ok(html.includes('הוכרע מול הבא בתור לפי רוטציה מאתמול'),
    'decisive_key rendered template missing');
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
