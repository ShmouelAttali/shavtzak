// Unit tests for the tab ↔ URL/localStorage plumbing (src/lib/tabParam.ts):
// ?tab= wins over the remembered tab, unknown/absent values fall back, and
// writing the param leaves the rest of the URL (other params, the hash Clerk
// signs in on) alone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTabId, resolveInitialTab, withTabParam } from '../src/lib/tabParam';
import type { TabId } from '../src/types';

const VALID: TabId[] = ['personal', 'unit', 'shavtzak', 'draft', 'roster'];

test('parseTabId accepts known ids only', () => {
  assert.equal(parseTabId('roster', VALID), 'roster');
  assert.equal(parseTabId('nope', VALID), null);
  assert.equal(parseTabId('', VALID), null);
  assert.equal(parseTabId(null, VALID), null);
});

test('resolveInitialTab: ?tab= wins over the remembered tab', () => {
  assert.equal(resolveInitialTab('?tab=draft', 'roster', VALID, 'personal'), 'draft');
});

test('resolveInitialTab: bare URL reopens the remembered tab', () => {
  assert.equal(resolveInitialTab('', 'roster', VALID, 'personal'), 'roster');
  assert.equal(resolveInitialTab('?other=1', 'shavtzak', VALID, 'personal'), 'shavtzak');
});

test('resolveInitialTab: falls back when both are missing or stale', () => {
  assert.equal(resolveInitialTab('', null, VALID, 'personal'), 'personal');
  assert.equal(resolveInitialTab('?tab=gone', null, VALID, 'personal'), 'personal');
  assert.equal(resolveInitialTab('', 'gone', VALID, 'personal'), 'personal');
  // a stale ?tab= still defers to a valid remembered tab rather than the fallback
  assert.equal(resolveInitialTab('?tab=gone', 'unit', VALID, 'personal'), 'unit');
});

test('withTabParam sets the param and preserves everything else', () => {
  assert.equal(withTabParam('https://x.site/', 'roster'), 'https://x.site/?tab=roster');
  assert.equal(withTabParam('https://x.site/?a=1#/sign-in', 'draft'),
    'https://x.site/?a=1&tab=draft#/sign-in');
  assert.equal(withTabParam('https://x.site/?tab=unit', 'draft'), 'https://x.site/?tab=draft');
});

test('withTabParam returns null when the URL already names that tab', () => {
  assert.equal(withTabParam('https://x.site/?tab=draft', 'draft'), null);
  assert.equal(withTabParam('https://x.site/?a=1&tab=draft#/x', 'draft'), null);
});
