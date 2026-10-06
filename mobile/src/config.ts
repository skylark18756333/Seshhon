// Where the phone app finds its database. The same public values as docs/config.js: the project address and the
// public ("anon" / "publishable") key are meant to be public — the database rules decide what each person can
// see. NEVER put a secret / service_role key or the database password in this file.
// EXPO_PUBLIC_API_URL / EXPO_PUBLIC_API_KEY point the app at a local test database instead (tools/live).
export const API_URL = String(process.env.EXPO_PUBLIC_API_URL || 'https://xfwrhetohauzhqqhkibm.supabase.co').replace(/\/+$/, '');
export const API_KEY = String(process.env.EXPO_PUBLIC_API_KEY || 'sb_publishable_hv2mIG5TfKBI-iXURTd9WQ_FFHRnj-Y');
export const POLL_MS = Number(process.env.EXPO_PUBLIC_POLL_MS) || 5000;   // how often Home asks the database again
export const CHAT_POLL_MS = Number(process.env.EXPO_PUBLIC_CHAT_POLL_MS) || 2500;   // how often an open sesh chat asks for new messages
// Where distances are measured from, as on the web app's map until someone picks a spot: Perth CBD.
export const MAP_CENTRE: [number, number] = [-31.9523, 115.8613];
export const RADIUS_KM = 5;   // the web map's default "How far"
// The Cloudflare Turnstile site key (public) for the "are you human" check on sign-up and login, as captchaSiteKey in docs/config.js.
export const CAPTCHA_SITE_KEY = String(process.env.EXPO_PUBLIC_CAPTCHA_SITE_KEY !== undefined ? process.env.EXPO_PUBLIC_CAPTCHA_SITE_KEY : '0x4AAAAAAFNfIIGCx_1GPNVc');
