// Runs the main flow of the phone app's code in a browser and reports what happened.
// Usage: node tools/preview/build.mjs && node tools/preview/check.mjs
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const here = dirname(fileURLToPath(import.meta.url));
const shots = process.env.SHOTS;
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (detail ? '  [' + detail + ']' : '')); };

const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const page = await browser.newPage({ viewport: { width: 400, height: 844 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const id = (t) => '[data-testid="' + t + '"]';
const text = async (t) => (await page.textContent(id(t))) || '';
const seen = () => page.evaluate(() => document.getElementById('root').innerText);
const shot = async (n) => { if (shots) await page.screenshot({ path: resolve(shots, n + '.png') }); };

await page.goto('file://' + resolve(here, 'dist/index.html'));
await page.waitForSelector(id('join'));

await page.click(id('join'));
check('sign-up needs a name', (await text('join-error')).includes('first name'));
await page.fill(id('name'), 'Sarah');
await page.click(id('join'));
check('sign-up needs the 18+ box', (await text('join-error')).includes('18'));
await page.click(id('adult'));
await page.click(id('join'));
await page.waitForSelector(id('status-word'));
check('starts Off', (await text('status-word')) === "You're off.");
check('friends hidden while Off', !(await seen()).includes('Jess M'));

await page.click(id('status-on'));
check('goes On', (await text('status-word')) === "You're on.");
check('On shows a 4 hour countdown', /Back to off in (4h 0m|3h 59m)/.test(await seen()));
check('friends shown while On', (await seen()).includes('Jess M'));
await shot('home');

await page.click(id('go-sesh'));
await page.click(id('vote-bodega'));
check('your vote is counted', (await seen()).includes('4 votes in'));
check('tie goes to the first venue', (await text('lock')) === 'Lock in Lowtide Bar');
await shot('sesh');
await page.waitForFunction(() => document.getElementById('root').innerText.includes('Dan just went on too.'), null, { timeout: 9000 });
check('a friend turning On joins the vote', (await seen()).includes('5 votes in'));
await page.click(id('vote-bodega'));
await page.click(id('vote-lantern'));
check('moving your vote re-counts and a tie still goes to the first venue', (await seen()).includes('2 votes') && (await text('lock')) === 'Lock in Lowtide Bar');
await page.click(id('lock'));
check('venue locks in', /locked in/i.test(await seen()));

await page.click(id('locked-venue'));
await page.click(id('star-2'));
check('rating updates the average', (await seen()).includes('from 213 ratings'));
await shot('venue');

await page.click(id('tab-deals'));
const disabled = async (t) => page.$eval(id(t), (e) => e.disabled);
check('drinks happy hour is closed at 8:30pm', await disabled('use-d2'));
check('food deal is open at 8:30pm', !(await disabled('use-d1')));
await shot('deals');
await page.click(id('use-d1'));
check('code has the right shape', /^SESH-\d{4}$/.test(await text('code')));
check('code shows a 15 minute countdown', /(15:00|14:5\d)/.test(await seen()));
await shot('redeem');
await page.click(id('confirm'));
check('confirmed deal shows as used', (await seen()).includes('Deal used'));
await page.click(id('tab-deals'));
check('used deal cannot be used again tonight', (await disabled('use-d1')) && (await text('use-d1')) === 'Used tonight');

await page.reload();
await page.waitForSelector(id('status-word'));
check('state survives a restart', (await text('status-word')) === "You're on.");

await page.click(id('status-off'));
check('going Off hides friends', !(await seen()).includes('Jess M'));
await page.click(id('tab-sesh'));
check('going Off ends the sesh', /no sesh yet/i.test(await seen()));

await page.click(id('tab-you'));
await page.click(id('reset'));
await page.waitForSelector(id('join'));
check('reset returns to sign-up', true);
check('no script errors', errors.length === 0, errors.join(' | '));
check('no sideways scrolling', (await page.evaluate(() => document.documentElement.scrollWidth)) <= 400);

await browser.close();
const failed = results.filter((r) => !r).length;
console.log('\n' + (results.length - failed) + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
