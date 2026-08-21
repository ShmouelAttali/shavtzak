import {test} from 'node:test';
import assert from 'node:assert/strict';
import {packCards} from '../src/lib/pdfPack';

// Geometry mirroring the real export: A4 landscape content 196mm tall,
// ~9mm header, 3mm gaps.
const OPTS = {pageHeight: 196, headerHeight: 9, headerGap: 3, cardGap: 3};
const TOP = 12; // headerHeight + headerGap

test('single card sits below the header on page 0, column 0', () => {
    const [p] = packCards([50], OPTS);
    assert.deepEqual(p, {page: 0, col: 0, y: TOP, height: 50});
});

test('second card goes to the emptier column, not below the first', () => {
    const [, b] = packCards([100, 60], OPTS);
    assert.equal(b.page, 0);
    assert.equal(b.col, 1);
    assert.equal(b.y, TOP);
});

test('cards stack down a column once both columns are seeded', () => {
    // 100 → col 0, 90 → col 1, 40 → col 1 (shorter at 90+gap vs 100+gap)
    const [, , c] = packCards([100, 90, 40], OPTS);
    assert.deepEqual(c, {page: 0, col: 1, y: TOP + 90 + 3, height: 40});
});

test('a card that fits no column opens a new page', () => {
    // both columns hold 150; a 100 card fits neither (12+150+3+100 > 196)
    const [, , c] = packCards([150, 150, 100], OPTS);
    assert.deepEqual(c, {page: 1, col: 0, y: TOP, height: 100});
});

test('a card prefers squeezing into a fuller column over a new page', () => {
    // col0: 150 (ends 165), col1: 120 (ends 135); a 55 card fits only col1
    const [, , c] = packCards([150, 120, 55], OPTS);
    assert.equal(c.page, 0);
    assert.equal(c.col, 1);
});

test('an oversize card is clamped to the column height', () => {
    const [p] = packCards([500], OPTS);
    assert.equal(p.height, 196 - TOP);
    assert.equal(p.page, 0);
});

test('no header means cards start at the top', () => {
    const [p] = packCards([50], {...OPTS, headerHeight: 0});
    assert.equal(p.y, 0);
});

test('column heights track the card gap across many placements', () => {
    // fill col0 with 4×43 (12 + 4*43 + 3*3 = 193 ≤ 196) then overflow to a new page
    const heights = [43, 43, 43, 43, 43, 43, 43, 43, 43];
    const places = packCards(heights, OPTS);
    const page0 = places.filter(p => p.page === 0);
    assert.equal(page0.length, 8); // 4 per column
    assert.equal(places[8].page, 1);
});
