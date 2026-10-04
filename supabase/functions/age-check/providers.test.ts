// Run: npm test   (checks the provider adapters against recorded-style answers; no real calls are made)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { didit, estimateBuffer, pickReturnUrl, provider, yoti } from './providers.ts';

const env = (vars: Record<string, string>) => (k: string) => vars[k];
type Call = { url: string; init: any };
function fakeFetch(answers: Array<{ status?: number; body: unknown }>) {
  const calls: Call[] = [];
  const f = (async (url: string, init: any = {}) => {
    calls.push({ url, init });
    const a = answers.shift() || { body: {} };
    return new Response(JSON.stringify(a.body), { status: a.status || 200 });
  }) as unknown as typeof fetch;
  return { f, calls };
}

const yotiEnv = env({ YOTI_API_KEY: 'k', YOTI_SDK_ID: 'sdk-1' });
const diditEnv = env({ DIDIT_API_KEY: 'dk', DIDIT_WORKFLOW_ID: 'wf-1' });

test('Yoti: starts a selfie-first check with ID as the fallback, and builds the check page address', async () => {
  const { f, calls } = fakeFetch([{ body: { id: 'sess-9', status: 'PENDING' } }]);
  const out = await yoti(yotiEnv, f).start('user-1', 'https://x.test/?age_check=done');
  assert.equal(out.session, 'sess-9');
  assert.equal(out.url, 'https://age.yoti.com?sessionId=sess-9&sdkId=sdk-1');
  assert.equal(calls[0].url, 'https://age.yoti.com/api/v1/sessions');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer k');
  assert.equal(calls[0].init.headers['Yoti-SDK-Id'], 'sdk-1');
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.type, 'OVER');
  assert.equal(body.age_estimation.threshold, 25, 'face estimate must say 25+ to pass without ID');
  assert.equal(body.doc_scan.threshold, 18);
  assert.equal(body.reference_id, 'user-1');
  assert.equal(body.callback.url, 'https://x.test/?age_check=done');
});

test('Yoti: reads results', async () => {
  const cases: Array<[unknown, string, string | null]> = [
    [{ status: 'COMPLETE', method: 'AGE_ESTIMATION' }, 'passed', 'face_estimate'],
    [{ status: 'COMPLETE', method: 'DOC_SCAN' }, 'passed', 'id_document'],
    [{ status: 'IN_PROGRESS' }, 'pending', null],
    [{ status: 'PENDING' }, 'pending', null],
    [{ status: 'FAIL', method: 'AGE_ESTIMATION' }, 'failed', 'age_estimation'],
    [{ status: 'EXPIRED' }, 'failed', null],
    [{ status: 'CANCELLED' }, 'failed', null]
  ];
  for (const [body, result, method] of cases) {
    const { f, calls } = fakeFetch([{ body }]);
    const out = await yoti(yotiEnv, f).result('sess-9', 'user-1');
    assert.equal(out.result, result, JSON.stringify(body));
    assert.equal(out.method, method, JSON.stringify(body));
    assert.equal(calls[0].url, 'https://age.yoti.com/api/v1/sessions/sess-9/result');
  }
});

test('Didit: starts a session for the workflow, tagged with the person', async () => {
  const { f, calls } = fakeFetch([{ status: 201, body: { session_id: 's-1', url: 'https://verify.didit.me/en/session/abc' } }]);
  const out = await didit(diditEnv, f).start('user-1', 'https://x.test/?age_check=done');
  assert.deepEqual(out, { session: 's-1', url: 'https://verify.didit.me/en/session/abc' });
  assert.equal(calls[0].url, 'https://verification.didit.me/v3/session/');
  assert.equal(calls[0].init.headers['x-api-key'], 'dk');
  assert.deepEqual(JSON.parse(calls[0].init.body), { workflow_id: 'wf-1', vendor_data: 'user-1', callback: 'https://x.test/?age_check=done' });
});

test('Didit: double-checks the age on an approved result', async () => {
  const cases: Array<[unknown, string, string | null]> = [
    [{ status: 'Approved', vendor_data: 'user-1', liveness_checks: [{ age_estimation: 31.2 }] }, 'passed', 'face_estimate'],
    [{ status: 'Approved', vendor_data: 'user-1', liveness_checks: [{ age_estimation: 21.5 }] }, 'failed', 'face_estimate'],
    [{ status: 'Approved', vendor_data: 'user-1', liveness_checks: [{ age_estimation: 19 }], id_verifications: [{ age: 19 }] }, 'passed', 'id_document'],
    [{ status: 'Approved', vendor_data: 'user-1', id_verifications: [{ age: 17 }] }, 'failed', 'id_document'],
    [{ status: 'Approved', vendor_data: 'user-1' }, 'failed', null],
    [{ status: 'Approved', vendor_data: 'someone-else', liveness_checks: [{ age_estimation: 40 }] }, 'failed', null],
    [{ status: 'In Review', vendor_data: 'user-1' }, 'pending', null],
    [{ status: 'In Progress', vendor_data: 'user-1' }, 'pending', null],
    [{ status: 'Declined', vendor_data: 'user-1' }, 'failed', null],
    [{ status: 'Abandoned', vendor_data: 'user-1' }, 'failed', null]
  ];
  for (const [body, result, method] of cases) {
    const { f, calls } = fakeFetch([{ body }]);
    const out = await didit(diditEnv, f).result('s-1', 'user-1');
    assert.equal(out.result, result, JSON.stringify(body));
    assert.equal(out.method, method, JSON.stringify(body));
    assert.equal(calls[0].url, 'https://verification.didit.me/v3/session/s-1/decision/');
  }
});

test('Didit: deletes its copy of the photos once decided', async () => {
  const { f, calls } = fakeFetch([{ body: {} }]);
  await didit(diditEnv, f).purge('s-1');
  assert.equal(calls[0].url, 'https://verification.didit.me/v3/session/s-1/delete/');
  assert.equal(calls[0].init.method, 'DELETE');
});

test('a provider error is reported, and missing keys say what is missing', async () => {
  const { f } = fakeFetch([{ status: 401, body: { detail: 'bad key' } }]);
  await assert.rejects(() => yoti(yotiEnv, f).start('u', 'https://x.test/'), /Yoti session failed \(401\)/);
  await assert.rejects(() => didit(env({}), f).start('u', 'https://x.test/'), /missing DIDIT_/);
  assert.throws(() => provider('nobody', yotiEnv), /Unknown age check provider/);
});

test('people are only sent back to Seshhon addresses', () => {
  const e = env({ AGE_CHECK_RETURN_URLS: 'https://a.test/Seshhon/, https://b.test/' });
  assert.equal(pickReturnUrl(e, 'https://b.test/'), 'https://b.test/?age_check=done');
  assert.equal(pickReturnUrl(e, 'https://b.test/?invite=X#y'), 'https://b.test/?age_check=done');
  assert.equal(pickReturnUrl(e, 'https://evil.test/'), 'https://a.test/Seshhon/?age_check=done');
  assert.throws(() => pickReturnUrl(env({}), 'https://a.test/'), /AGE_CHECK_RETURN_URLS/);
});

test('the estimate buffer can be raised but never set below 18', () => {
  assert.equal(estimateBuffer(env({})), 25);
  assert.equal(estimateBuffer(env({ AGE_ESTIMATE_MIN: '28' })), 28);
  assert.equal(estimateBuffer(env({ AGE_ESTIMATE_MIN: '16' })), 25);
  assert.equal(estimateBuffer(env({ AGE_ESTIMATE_MIN: 'x' })), 25);
});
