// The age check providers Seshhon can use. Which one is live is set in the database
// (public.app_settings.age_check_provider); each needs its own keys as Edge Function secrets.
//
// Both run the same kind of check, which is what eSafety and the Australian Age Assurance Technology
// Trial describe as the privacy-friendly approach: estimate age from a live selfie first, and ask for
// ID plus a selfie only when the estimate is too close to 18 to be sure (the "buffer").

export type Result = 'pending' | 'passed' | 'failed';
export type Outcome = { result: Result; method: string | null; reason?: string };
export type Env = (name: string) => string | undefined;
type Fetch = typeof fetch;

export interface Provider {
  /** Starts a check for this person and returns the page to send them to. */
  start(userId: string, returnUrl: string): Promise<{ session: string; url: string }>;
  /** Asks the provider how the check went. */
  result(session: string, userId: string): Promise<Outcome>;
  /** Deletes the provider's copy of the photos and ID once we have the outcome. Best effort. */
  purge(session: string): Promise<void>;
}

// A face estimate must say at least this age to pass without ID. Anyone who looks younger is asked for ID.
// 25 matches the "Challenge 25" rule Australian venues already use for alcohol.
export function estimateBuffer(env: Env): number {
  const n = Number(env('AGE_ESTIMATE_MIN') || 25);
  return Number.isFinite(n) && n >= 18 ? n : 25;
}

function need(env: Env, name: string): string {
  const v = env(name);
  if (!v) throw new Error(`Age check is not set up yet (missing ${name}).`);
  return v;
}

async function json(res: Response, what: string): Promise<any> {
  const text = await res.text();
  if (!res.ok) throw new Error(`${what} failed (${res.status}): ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : {};
}

// ---------------------------------------------------------------- Yoti (https://developers.yoti.com/age-verification)
export function yoti(env: Env, f: Fetch = fetch): Provider {
  const base = 'https://age.yoti.com/api/v1';
  const headers = () => ({
    Authorization: 'Bearer ' + need(env, 'YOTI_API_KEY'),
    'Yoti-SDK-Id': need(env, 'YOTI_SDK_ID'),
    'Content-Type': 'application/json'
  });
  return {
    async start(userId, returnUrl) {
      const body = {
        type: 'OVER',
        ttl: 900,
        // Selfie first. Yoti only passes it if the estimate is over the buffer age...
        age_estimation: { allowed: true, threshold: estimateBuffer(env), level: 'PASSIVE', retry_limit: 1 },
        // ...otherwise the person can show ID (photo matched to their face) or use a Digital ID app, at 18.
        doc_scan: { allowed: true, threshold: 18 },
        digital_id: { allowed: true, threshold: 18 },
        reference_id: userId,
        callback: { url: returnUrl, auto: true }
      };
      const data = await json(await f(base + '/sessions', { method: 'POST', headers: headers(), body: JSON.stringify(body) }), 'Yoti session');
      if (!data.id) throw new Error('Yoti did not return a session.');
      const url = 'https://age.yoti.com?sessionId=' + encodeURIComponent(data.id) + '&sdkId=' + encodeURIComponent(need(env, 'YOTI_SDK_ID'));
      return { session: data.id, url };
    },
    async result(session) {
      const data = await json(await f(base + '/sessions/' + encodeURIComponent(session) + '/result', { headers: headers() }), 'Yoti result');
      const status = String(data.status || '').toUpperCase();
      const method = data.method ? String(data.method).toLowerCase() : null;
      if (status === 'COMPLETE') {
        const m = method === 'age_estimation' ? 'face_estimate' : method === 'doc_scan' ? 'id_document' : method === 'digital_id' ? 'digital_id' : method;
        return { result: 'passed', method: m };
      }
      if (status === 'PENDING' || status === 'IN_PROGRESS') return { result: 'pending', method: null };
      return { result: 'failed', method, reason: status || 'unknown' }; // FAIL, ERROR, CANCELLED, EXPIRED
    },
    async purge() {
      // Yoti deletes the selfie as soon as the estimate is made; set the retention for ID scans in the Yoti Hub.
    }
  };
}

// ---------------------------------------------------------------- Didit (https://docs.didit.me)
// Needs a workflow in the Didit console with: age estimation (minimum age 18) with liveness, and the
// adaptive ID fallback switched on for anyone who looks under 25.
export function didit(env: Env, f: Fetch = fetch): Provider {
  const base = 'https://verification.didit.me/v3/session/';
  const headers = () => ({ 'x-api-key': need(env, 'DIDIT_API_KEY'), 'Content-Type': 'application/json' });
  return {
    async start(userId, returnUrl) {
      const body = { workflow_id: need(env, 'DIDIT_WORKFLOW_ID'), vendor_data: userId, callback: returnUrl };
      const data = await json(await f(base, { method: 'POST', headers: headers(), body: JSON.stringify(body) }), 'Didit session');
      if (!data.session_id || !data.url) throw new Error('Didit did not return a session.');
      return { session: data.session_id, url: data.url };
    },
    async result(session, userId) {
      const data = await json(await f(base + encodeURIComponent(session) + '/decision/', { headers: headers() }), 'Didit result');
      if (data.vendor_data && data.vendor_data !== userId) return { result: 'failed', method: null, reason: 'session belongs to someone else' };
      const status = String(data.status || '');
      if (['Declined', 'Expired', 'Abandoned', 'Kyc Expired'].includes(status)) return { result: 'failed', method: null, reason: status };
      if (status !== 'Approved') return { result: 'pending', method: null }; // Not Started, In Progress, In Review...
      // Approved: check the age ourselves too, so a mis-set workflow can never let someone under 18 through.
      const idAges = (data.id_verifications || []).map((v: any) => v && v.age).filter((a: any) => typeof a === 'number');
      if (idAges.length) {
        return Math.min(...idAges) >= 18 ? { result: 'passed', method: 'id_document' } : { result: 'failed', method: 'id_document', reason: 'under 18 on ID' };
      }
      const estimates = (data.liveness_checks || []).map((v: any) => v && v.age_estimation).filter((a: any) => typeof a === 'number');
      if (estimates.length) {
        return Math.min(...estimates) >= estimateBuffer(env)
          ? { result: 'passed', method: 'face_estimate' }
          : { result: 'failed', method: 'face_estimate', reason: 'estimate under the buffer and no ID was checked' };
      }
      return { result: 'failed', method: null, reason: 'the Didit workflow returned no age; add age estimation to it' };
    },
    async purge(session) {
      await f(base + encodeURIComponent(session) + '/delete/', { method: 'DELETE', headers: headers() }).catch(() => {});
    }
  };
}

export function provider(name: string, env: Env, f: Fetch = fetch): Provider {
  if (name === 'yoti') return yoti(env, f);
  if (name === 'didit') return didit(env, f);
  throw new Error('Unknown age check provider: ' + name);
}

/** Only send people back to Seshhon's own pages, never to an address someone slipped in. */
export function pickReturnUrl(env: Env, asked: unknown): string {
  const allowed = String(env('AGE_CHECK_RETURN_URLS') || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!allowed.length) throw new Error('Age check is not set up yet (missing AGE_CHECK_RETURN_URLS).');
  const want = typeof asked === 'string' ? asked.split(/[?#]/)[0] : '';
  const base = allowed.includes(want) ? want : allowed[0];
  return base + '?age_check=done';
}
