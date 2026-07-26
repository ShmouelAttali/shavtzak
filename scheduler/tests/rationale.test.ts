// Pure unit tests for the rationale catalog — no DB.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TEMPLATES, RATIONALE_CODES, isCaveat, renderRationale, RationaleEntry,
  violationCoveredByRationale, RationaleCode,
} from '../src/rationale.js';

test('every code has a non-empty Hebrew template', () => {
  assert.ok(RATIONALE_CODES.length > 0);
  for (const code of RATIONALE_CODES) {
    assert.ok(TEMPLATES[code] && TEMPLATES[code].trim().length > 0, `empty template: ${code}`);
  }
});

test('interpolation fills every {param} — no residue', () => {
  for (const code of RATIONALE_CODES) {
    const params: Record<string, string | number> = {};
    for (const m of TEMPLATES[code].matchAll(/\{(\w+)\}/g)) params[m[1]] = 'X';
    const out = renderRationale({ code, params });
    assert.ok(!/\{|\}/.test(out), `${code}: residue in "${out}"`);
  }
});

test('missing params are left visible (not silently dropped)', () => {
  const e: RationaleEntry = { code: 'rotation_switch' }; // template needs {yesterday}/{today}
  assert.match(renderRationale(e), /\{yesterday\}/);
});

test('isCaveat: caveat_* codes and only them', () => {
  for (const code of RATIONALE_CODES) {
    assert.equal(isCaveat({ code }), code.startsWith('caveat_'), code);
  }
  const caveats = RATIONALE_CODES.filter((c) => c.startsWith('caveat_'));
  assert.ok(caveats.length >= 5, 'caveat catalog unexpectedly small');
});

test('violationCoveredByRationale: each mapped violation matches only with its code', () => {
  const set = (...c: RationaleCode[]) => new Set<RationaleCode>(c);
  // covered when the matching code is present
  assert.ok(violationCoveredByRationale('הושלם ממנוחה', set('pulled_from_rest')));
  assert.ok(violationCoveredByRationale('פחות מ-4 שעות מנוחה לפני המשמרת', set('caveat_rest_lt4')));
  assert.ok(violationCoveredByRationale('פחות מ-8 שעות מנוחה לפני משימה ארוכה', set('caveat_rest_lt8_long')));
  assert.ok(violationCoveredByRationale('מנוחה קצרה: 5 שעות בלבד', set('caveat_short_rest')));
  // NOT covered when the code is absent
  assert.ok(!violationCoveredByRationale('הושלם ממנוחה', set('caveat_rest_lt4')));
  assert.ok(!violationCoveredByRationale('פחות מ-4 שעות מנוחה לפני המשמרת', set()));
  // an unmapped violation is never covered
  assert.ok(!violationCoveredByRationale('אין נהג דוד בצוות', set('pulled_from_rest', 'caveat_short_rest')));
});
