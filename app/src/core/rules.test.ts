import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CODE_MS, GREEN_MS, YELLOW_MS, canRedeem, codeIsLive, dealProblems, dealWindow, effectiveStatus,
  formatHour, formatLeft, leader, newCode, ratingAverage, statusExpiry, tally, venueDayProblems,
  type Deal,
} from './rules';
import { DEALS, VENUE_IDS } from '../data/sample';

const food: Deal = { id: 'f', venueId: 'v', type: 'Food', title: '2-for-1 pizzas', fromHour: 17, toHour: 21, alcohol: false };
const happyHour: Deal = { id: 'h', venueId: 'v', type: 'Drinks', title: 'Happy hour', fromHour: 17, toHour: 18, alcohol: true, discountPct: 25 };

test('status expiry: On lasts 4 hours, Thinking 2, Off never', () => {
  assert.equal(statusExpiry('on', 1000), 1000 + GREEN_MS);
  assert.equal(statusExpiry('thinking', 1000), 1000 + YELLOW_MS);
  assert.equal(statusExpiry('off', 1000), 0);
});

test('an expired status reads as Off', () => {
  assert.equal(effectiveStatus('on', 5000, 4999), 'on');
  assert.equal(effectiveStatus('on', 5000, 5000), 'off');
  assert.equal(effectiveStatus('thinking', 5000, 9000), 'off');
  assert.equal(effectiveStatus('off', 0, 1), 'off');
});

test('alcohol deal limits', () => {
  assert.deepEqual(dealProblems(happyHour), []);
  assert.deepEqual(dealProblems(food), []);
  assert.equal(dealProblems({ ...happyHour, discountPct: 51 }).length, 1);
  assert.equal(dealProblems({ ...happyHour, discountPct: 50 }).length, 0);
  assert.equal(dealProblems({ ...happyHour, toHour: 19 }).length, 1); // two hours long
  assert.equal(dealProblems({ ...happyHour, fromHour: 18, toHour: 19 }).length, 0); // ends at 7pm exactly
  assert.equal(dealProblems({ ...happyHour, fromHour: 19, toHour: 20 }).length, 1); // after 7pm
  assert.equal(dealProblems({ ...food, fromHour: 21, toHour: 20 }).length, 1); // ends before it starts
});

test('a venue can run at most two alcohol deals a day', () => {
  const three = [happyHour, { ...happyHour, id: 'h2', fromHour: 12, toHour: 13 }, { ...happyHour, id: 'h3', fromHour: 15, toHour: 16 }];
  assert.equal(venueDayProblems(three).length, 1);
  assert.equal(venueDayProblems(three.slice(0, 2)).length, 0);
});

test('every sample deal passes the rules', () => {
  for (const d of DEALS) assert.deepEqual(dealProblems(d), [], d.title);
  for (const v of VENUE_IDS) assert.deepEqual(venueDayProblems(DEALS.filter((d) => d.venueId === v)), []);
});

test('deal window and hour labels', () => {
  assert.deepEqual(dealWindow(food, 16.9), { active: false, label: 'Starts 5pm' });
  assert.deepEqual(dealWindow(food, 17), { active: true, label: 'Until 9pm' });
  assert.deepEqual(dealWindow(food, 21), { active: false, label: 'Ended 9pm' });
  assert.equal(formatHour(24), 'midnight');
  assert.equal(formatHour(12), '12pm');
  assert.equal(formatHour(0), '12am');
  assert.equal(formatHour(20.5), '8:30pm');
});

test('redeeming: only while running, once per night, never for a deal that breaks the rules', () => {
  assert.deepEqual(canRedeem(food, 18, undefined, 'Fri'), { ok: true });
  assert.deepEqual(canRedeem(food, 22, undefined, 'Fri'), { ok: false, reason: 'not-running' });
  const used = { code: 'SESH-1234', until: 0, usedDay: 'Fri' };
  assert.deepEqual(canRedeem(food, 18, used, 'Fri'), { ok: false, reason: 'used-tonight' });
  assert.deepEqual(canRedeem(food, 18, used, 'Sat'), { ok: true });
  assert.deepEqual(canRedeem({ ...happyHour, discountPct: 80 }, 17.5, undefined, 'Fri'), { ok: false, reason: 'not-allowed' });
});

test('codes: four digits, live for 15 minutes, dead once used', () => {
  assert.equal(newCode(0, 0).code, 'SESH-1000');
  assert.equal(newCode(0, 0.99999).code, 'SESH-9999');
  const c = newCode(1000, 0.5);
  assert.equal(c.until, 1000 + CODE_MS);
  assert.equal(codeIsLive(c, 1000 + CODE_MS - 1, 'Fri'), true);
  assert.equal(codeIsLive(c, 1000 + CODE_MS, 'Fri'), false);
  assert.equal(codeIsLive({ ...c, usedDay: 'Fri' }, 1001, 'Fri'), false);
});

test('votes: counts, leader, ties go to the first venue, unknown venues ignored', () => {
  const ids = ['a', 'b', 'c'];
  const counts = tally({ jess: 'a', tom: 'a', aisha: 'b', me: 'b', dan: null, x: 'zzz' }, ids);
  assert.deepEqual(counts, { a: 2, b: 2, c: 0 });
  assert.equal(leader(counts, ids), 'a');
  assert.equal(leader(tally({ me: 'c' }, ids), ids), 'c');
});

test('rating average includes your stars once', () => {
  assert.deepEqual(ratingAverage(4.6, 212, 0), { avg: 4.6, count: 212 });
  const r = ratingAverage(4, 1, 2);
  assert.equal(r.avg, 3);
  assert.equal(r.count, 2);
});

test('time left formatting', () => {
  assert.equal(formatLeft(GREEN_MS), '4h 0m');
  assert.equal(formatLeft(CODE_MS), '15:00');
  assert.equal(formatLeft(61 * 1000), '01:01');
  assert.equal(formatLeft(-5), '00:00');
});
