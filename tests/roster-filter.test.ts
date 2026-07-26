// Unit tests for the מצבת חיילים tab's pure filtering (src/lib/rosterFilter.ts):
// the active/removed split, free-text search over name/מספר אישי/email, the
// מפקדים pseudo-role, and the הסמכה filter — which deliberately reuses the
// generator's hasQualification(), so a qualification spelled only inside the
// free-text תפקיד still matches.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  filterRoster, qualStuckInRole, EMPTY_FILTERS,
  ROLE_COMMANDERS, QUAL_RESTRICTED, QUAL_POOL_PREFIX,
} from '../src/lib/rosterFilter';
import type { RosterSoldier } from '../api/_handlers/roster';

const s = (over: Partial<RosterSoldier> & { id: number; fullName: string }): RosterSoldier => ({
  personalNumber: `900${over.id}`, platoon: '1', role: 'לוחם', rifleLevel: 70,
  phone: '', email: '', isSchedulable: true, notes: '', archivedAt: null, isAdmin: false,
  quals: [], allowedPositionIds: [], candidacies: [], ...over,
});

const OFFICER_POOL = 9;   // קצין מוצב position id in the seed

const ROSTER: RosterSoldier[] = [
  s({ id: 1, fullName: 'אבי כהן', role: 'מ"כ', quals: ['נהג דוד'], email: 'avi@example.com' }),
  s({ id: 2, fullName: 'בן לוי' }),
  s({ id: 3, fullName: 'גד נחמיה', role: 'נהג דוד' }),                       // qual only in the role text
  s({ id: 4, fullName: 'דן מוגבל', allowedPositionIds: [2, 7] }),
  s({ id: 5, fullName: 'הראל קצין', role: 'סמל',
      candidacies: [{ positionId: OFFICER_POOL, subPositionId: null, priority: null }] }),
  s({ id: 6, fullName: 'ותיק שהוסר', archivedAt: '2026-07-20T14:00:00' }),
];

const f = (over: Partial<typeof EMPTY_FILTERS>) => filterRoster(ROSTER, { ...EMPTY_FILTERS, ...over });
const names = (xs: RosterSoldier[]) => xs.map((x) => x.fullName);

test('the active/removed split is exclusive', () => {
  assert.equal(f({}).length, 5);
  assert.ok(!names(f({})).includes('ותיק שהוסר'));
  assert.deepEqual(names(f({ archived: true })), ['ותיק שהוסר']);
});

test('free text matches name, מספר אישי and email', () => {
  assert.deepEqual(names(f({ text: 'לוי' })), ['בן לוי']);
  assert.deepEqual(names(f({ text: '9001' })), ['אבי כהן']);
  assert.deepEqual(names(f({ text: 'AVI@example' })), ['אבי כהן']);
  assert.equal(f({ text: 'אין כזה' }).length, 0);
});

test('quote marks in the name do not break the search', () => {
  const roster = [s({ id: 9, fullName: 'רס"ר פלוני' })];
  assert.equal(filterRoster(roster, { ...EMPTY_FILTERS, text: 'רסר' }).length, 1);
  assert.equal(filterRoster(roster, { ...EMPTY_FILTERS, text: 'רס"ר' }).length, 1);
});

test('the role filter takes an exact role or the מפקדים pseudo-option', () => {
  assert.deepEqual(names(f({ role: 'מ"כ' })), ['אבי כהן']);
  assert.deepEqual(names(f({ role: ROLE_COMMANDERS })), ['אבי כהן', 'הראל קצין']);
});

test('the הסמכה filter also sees a qualification spelled in the תפקיד', () => {
  // אבי כהן has the qualification row; גד נחמיה only has it in his role text —
  // both must match, because that is what the generator's H6d/P5 checks do.
  assert.deepEqual(names(f({ qual: 'נהג דוד' })), ['אבי כהן', 'גד נחמיה']);
  assert.equal(f({ qual: 'חובש' }).length, 0);
});

test('the הסמכה filter carries the closed-list and whitelist pseudo-options', () => {
  assert.deepEqual(names(f({ qual: `${QUAL_POOL_PREFIX}${OFFICER_POOL}` })), ['הראל קצין']);
  assert.deepEqual(names(f({ qual: QUAL_RESTRICTED })), ['דן מוגבל']);
});

test('filters compose', () => {
  assert.deepEqual(names(f({ role: ROLE_COMMANDERS, qual: 'נהג דוד' })), ['אבי כהן']);
  assert.equal(f({ text: 'לוי', role: 'מ"כ' }).length, 0);
});

test('qualStuckInRole flags a qualification the תפקיד text still implies', () => {
  assert.equal(qualStuckInRole('נהג דוד', 'נהג דוד'), true);
  assert.equal(qualStuckInRole('לוחם', 'נהג דוד'), false);
  assert.equal(qualStuckInRole('מ"כ', 'מכ'), true, 'quote marks are normalized away');
});
