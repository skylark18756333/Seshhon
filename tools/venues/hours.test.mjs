// Tests for docs/hours.js. Run: node --test tools/venues/hours.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const H = createRequire(import.meta.url)('../../docs/hours.js');
const at = (hours, dow, hhmm) => { const [h, m] = hhmm.split(':').map(Number); const s = H.status(H.parse(hours), dow, h * 60 + m); return s && s.text; };
const MO = 0, TU = 1, FR = 4, SA = 5, SU = 6;

test('open and closing times', () => {
  assert.equal(at('Mo-Su 16:00-01:00', MO, '18:00'), 'Open till 1am');
  assert.equal(at('Mo-Su 16:00-01:00', TU, '00:30'), 'Closes soon, 1am');
  assert.equal(at('Mo-Su 16:00-01:00', TU, '02:00'), 'Opens 4pm');
  assert.equal(at('Mo-Su 11:30-23:30', MO, '12:00'), 'Open till 11:30pm');
  assert.equal(at('Mo-Su 12:00-24:00', MO, '20:00'), 'Open till midnight');
});
test('days, lists and ranges', () => {
  const h = 'Mo-Th 16:00-24:00; Fr,Sa 16:00-02:00; Su off';
  assert.equal(at(h, FR, '23:00'), 'Open till 2am');
  assert.equal(at(h, SA, '00:30'), 'Open till 2am');   // Friday night, still going
  assert.equal(at(h, SU, '01:30'), 'Closes soon, 2am');   // Saturday night
  assert.equal(at(h, SU, '18:00'), 'Opens tomorrow 4pm');
  assert.equal(at('Tu-Su 12:00-24:00; Mo off', MO, '13:00'), 'Opens tomorrow midday');
  assert.equal(at('We-Sa 19:00-24:00', SU, '20:00'), 'Opens Wed 7pm');
  assert.equal(at('Fr-Mo 18:00-22:00', TU, '12:00'), 'Opens Fri 6pm');   // wraps round the week
});
test('split shifts and later rules win', () => {
  assert.equal(at('Mo-Fr 12:00-14:30,17:30-22:00', MO, '15:00'), 'Opens 5:30pm');
  assert.equal(at('Mo-Su 10:00-22:00; Su 12:00-20:00', SU, '11:00'), 'Opens midday');
});
test('always open, and things it will not guess', () => {
  assert.equal(at('24/7', MO, '03:00'), 'Open 24 hours');
  assert.equal(at('Mo-Su 00:00-24:00', MO, '03:00'), 'Open 24 hours');
  assert.equal(at('Mo-Su 16:00-01:00; PH off; Dec 25 off', MO, '18:00'), 'Open till 1am');   // holiday rules skipped
  assert.equal(H.parse('sunrise-sunset'), null);
  assert.equal(H.parse('by appointment'), null);
  assert.equal(H.parse(''), null);
  assert.equal(H.status(null, MO, 0), null);
  assert.equal(at('Mo-Su off', MO, '12:00'), 'Closed');
});
test('the weekly table', () => {
  const t = H.table(H.parse('Mo-Th 16:00-24:00; Fr,Sa 16:00-02:00; Su off'));
  assert.deepEqual(t[0], { day: 'Mon', text: '4pm – midnight' });
  assert.deepEqual(t[4], { day: 'Fri', text: '4pm – 2am' });
  assert.deepEqual(t[6], { day: 'Sun', text: 'Closed' });
});
