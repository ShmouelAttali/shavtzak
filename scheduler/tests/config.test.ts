// Pure unit tests for config helpers — no DB.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { requiredSeats } from '../src/config.js';

test('requiredSeats: non-flex positions need every seat', () => {
  assert.equal(requiredSeats(10, null), 10);
  assert.equal(requiredSeats(4, {}), 4);
  assert.equal(requiredSeats(3, { flex_seats: {} }), 3);      // no min → full count
});

test('requiredSeats: flex positions may shrink to flex_seats.min', () => {
  assert.equal(requiredSeats(12, { flex_seats: { min: 10 } }), 10);  // מגן 10-12
  assert.equal(requiredSeats(4, { flex_seats: { min: 3 } }), 3);     // סיור 3-4
});

test('requiredSeats: flexMin above the seat count never enlarges demand', () => {
  assert.equal(requiredSeats(3, { flex_seats: { min: 5 } }), 3);
});
