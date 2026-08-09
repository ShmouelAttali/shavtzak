import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';

/**
 * The two rotation groups, and the תורנות fairness weighting.
 *
 * Rotation groups: סטטיות + תורנות + כונן גשש are one group ("static"),
 * סיור + התקפי the other ("dynamic"). After a day in one group the engine
 * should push the soldier to the other — so סטטיות followed by תורנות is
 * NOT a rotation, both are the same group.
 *
 * This was broken by a spelling trap: the sheet writes "תורנים" with a
 * regular nun, the code searched for "תורן" with a final nun, and the 108
 * תורנות rows in כל השבצק fell through to day_blocking with no group at all.
 */
const DIR = path.join(process.cwd(), 'apps-script/plugat-gaash');
const ctx: any = {
  console, Date, Math, JSON, String, Number, Boolean, Array, Object, Map, Set,
  isNaN, parseInt, parseFloat, RegExp, Error,
  SpreadsheetApp: {
    getUi: () => ({ createMenu: () => ({ addItem() { return this; }, addSeparator() { return this; }, addToUi() {} }) }),
  },
  HtmlService: {},
};
vm.createContext(ctx);
for (const f of ['ShabtzakOps.js', 'ShavtzakRecommendation.js']) {
  vm.runInContext(fs.readFileSync(path.join(DIR, f), 'utf8'), ctx);
}
vm.runInContext(';globalThis.REC = SHABTZAK_REC_CONFIG;', ctx);
const REC = ctx.REC;

const classOf = (position: string, type: string, time = 'יומי') => {
  const category = ctx.getTaskCategory_(position, type, time, REC);
  return { category, missionClass: ctx.getMissionClass_(category, REC, { position, type }) };
};

/* ------------------------- the two groups ------------------------- */

test('תורנים — the spelling the sheet actually uses — is a תורנות, and static', () => {
  const { category, missionClass } = classOf('תורנים', 'נוספים', '14:00-14:00');
  assert.equal(category, 'daily_duty');
  assert.equal(missionClass, 'static');
});

test('both spellings of תורנות are recognised', () => {
  // regular nun (תורנים / תורנות) and final nun (תורן)
  for (const position of ['תורנים', 'תורנות', 'תורן מטבח', 'תורן רס"פ']) {
    assert.equal(classOf(position, 'נוספים').category, 'daily_duty', position);
    assert.equal(classOf(position, 'נוספים').missionClass, 'static', position);
  }
});

test('a partial-time תורנות is still a תורנות', () => {
  // 4 such rows exist in כל השבצק, e.g. 07:30-09:00
  const { category, missionClass } = classOf('תורנים', 'נוספים', '07:30-09:00');
  assert.equal(category, 'daily_duty');
  assert.equal(missionClass, 'static');
});

test('גשש wins over תורן: "כונן גשש ותורן רס״פ" is a tracker shift', () => {
  const { category, missionClass } = classOf('כונן גשש ותורן רס"פ', 'נוספים');
  assert.equal(category, 'tracker');
  assert.equal(missionClass, 'static', 'tracker still belongs to the static group');
});

test('the static group: עמדות הגנה, תורנות and גשש together', () => {
  const members = [
    ['שג', 'עמדות הגנה'],
    ['בונקר', 'עמדות הגנה'],
    ['מזרחית', 'עמדות הגנה'],
    ['דרומית', 'עמדות הגנה'],
    ['תורנים', 'נוספים'],
    ['כונן גשש', 'נוספים'],
  ];
  for (const [position, type] of members) {
    assert.equal(classOf(position, type).missionClass, 'static', `${position} / ${type}`);
  }
});

test('the dynamic group: סיור and התקפי together', () => {
  for (const [position, type] of [['סיור', 'סיור'], ['התקפי', 'התקפי']]) {
    assert.equal(classOf(position, type).missionClass, 'dynamic', `${position} / ${type}`);
  }
});

test('סטטיות then תורנות is NOT a rotation — same group', () => {
  assert.equal(classOf('שג', 'עמדות הגנה').missionClass, classOf('תורנים', 'נוספים').missionClass);
});

test('סטטיות then סיור IS a rotation — opposite groups', () => {
  assert.notEqual(classOf('שג', 'עמדות הגנה').missionClass, classOf('סיור', 'סיור').missionClass);
});

/* ------------- what the grouping does to yesterday's match ------------- */

const at = (d: number, h: number) => new Date(2026, 7, d, h, 0, 0, 0);

/** an assignment on the previous operational day (11/08 14:00 → 12/08 14:00) */
function yesterday(position: string, type: string, category: string) {
  return {
    soldierKey: 'x', position, type, category,
    start: at(11, 18), end: at(11, 22),
  };
}

const matchFor = (task: any, assignments: any[]) =>
  ctx.findPreviousOperationalDayTaskMatch_(assignments, task, REC);

test('yesterday סטטית + today תורנות → same class, so it is penalised not rewarded', () => {
  const task = { position: 'תורנים', type: 'נוספים', category: 'daily_duty', start: at(12, 14), end: at(13, 14) };
  const match = matchFor(task, [yesterday('שג', 'עמדות הגנה', 'static')]);

  assert.ok(match.sameMissionClass, 'must register as the same rotation group');
  assert.equal(match.oppositeMissionClass, null, 'must not count as a rotation');
  assert.equal(match.missionClass, 'static');
});

test('yesterday סטטית + today סיור → opposite class, the rotation bonus case', () => {
  const task = { position: 'סיור', type: 'סיור', category: 'tour', start: at(12, 14), end: at(12, 22) };
  const match = matchFor(task, [yesterday('שג', 'עמדות הגנה', 'static')]);

  assert.equal(match.sameMissionClass, null);
  assert.ok(match.oppositeMissionClass, 'must register as a rotation');
  assert.equal(match.yesterdayClass, 'static');
});

test('yesterday תורנות + today סיור → also a rotation', () => {
  const task = { position: 'סיור', type: 'סיור', category: 'tour', start: at(12, 14), end: at(12, 22) };
  const match = matchFor(task, [yesterday('תורנים', 'נוספים', 'daily_duty')]);

  assert.ok(match.oppositeMissionClass);
  assert.equal(match.yesterdayClass, 'static');
});

/* --------------------- תורנות fairness --------------------- */

const HISTORY_COLS = (date: string, position: string, type: string, time: string, soldier: string) =>
  [date, position, type, time, soldier];

test('countToranutHistory_ counts תורנים per soldier across the whole sheet', () => {
  const rows = [
    HISTORY_COLS('25/06/2026', 'תורנים', 'נוספים', 'יומי', 'שלמה כהן'),
    HISTORY_COLS('26/06/2026', 'תורנים', 'נוספים', 'יומי', 'שלמה כהן'),
    HISTORY_COLS('27/06/2026', 'תורנים', 'נוספים', '07:30-09:00', 'ארי פריי'),
    HISTORY_COLS('28/06/2026', 'סיור', 'סיור', '14:00', 'שלמה כהן'),
    HISTORY_COLS('29/06/2026', 'כונן גשש ותורן רס"פ', 'נוספים', 'יומי', 'ארי פריי'),
    HISTORY_COLS('30/06/2026', 'תורנים', 'נוספים', 'יומי', ''),
  ];
  const counts = ctx.countToranutHistory_(rows, REC);

  assert.equal(counts[ctx.normalizeNameKey_('שלמה כהן')], 2, 'סיור does not count');
  assert.equal(counts[ctx.normalizeNameKey_('ארי פריי')], 1, 'the גשש row does not count');
  assert.equal(Object.keys(counts).length, 2, 'a row with no soldier is skipped');
});

function scoreFor(count: number, category = 'daily_duty') {
  const result = { score: 0, reasons: [], warnings: [], toranutHistoryCount: 0 };
  const soldier = { nameKey: 'k' };
  const context = { toranutHistoryCounts: { k: count } };
  ctx.applyToranutFairnessScoring_(result, soldier, { category }, context, REC);
  return result;
}

test('each past תורנות adds a penalty, so the soldier who did fewest ranks first', () => {
  const none = scoreFor(0);
  const one = scoreFor(1);
  const three = scoreFor(3);

  assert.equal(none.score, 0);
  assert.equal(one.score, REC.scoring.toranutHistoryWeight);
  assert.equal(three.score, 3 * REC.scoring.toranutHistoryWeight);
  assert.ok(none.score < one.score && one.score < three.score, 'monotonic in past תורנות');
});

test('a soldier who never did one is called out explicitly', () => {
  assert.deepEqual(scoreFor(0).reasons, ['✓ לא עשה תורנות עד היום']);
  assert.deepEqual(scoreFor(2).reasons, ['2 תורנויות בעבר']);
});

test('the penalty is capped so a heavy history is not a permanent ban', () => {
  const cap = REC.scoring.toranutHistoryCap;
  const capped = cap * REC.scoring.toranutHistoryWeight;

  assert.equal(scoreFor(cap).score, capped);
  assert.equal(scoreFor(18).score, capped, 'the real-world maximum is clamped');
  // still recorded truthfully for display
  assert.equal(scoreFor(18).toranutHistoryCount, 18);
});

test('the fairness weight applies to תורנות only', () => {
  for (const category of ['tour', 'attack', 'static', 'tracker', 'carmel']) {
    assert.equal(scoreFor(5, category).score, 0, category);
  }
});
