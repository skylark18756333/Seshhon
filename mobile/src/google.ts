// Google ratings from the google-rating Edge Function, which holds the Google key (googleRating in docs/app.js).
// Google's terms don't allow storing ratings, so they live in memory only and go when the app closes.
// Until the key is set up the function answers { enabled: false } and the app stops asking for the rest of the run.
import { useEffect, useState } from 'react';
import { API_KEY, API_URL } from './config';
import { currentSession, refreshSession } from './session';

export type GoogleRating = { rating: number; count: number; url: string | null };
type Entry = 'loading' | GoogleRating | null;

let on = true;
const cache: Record<string, Entry> = {};
const waiting: Record<string, Array<() => void>> = {};
const GOOGLE_URL = /^https:\/\/(maps\.google\.com|www\.google\.com|maps\.app\.goo\.gl)\//;

async function lookUp(id: string): Promise<GoogleRating | null> {
  let s = currentSession();
  if (s && s.expires_at - Date.now() / 1000 < 60) { await refreshSession(); s = currentSession(); }
  if (!s) return null;
  const res = await fetch(API_URL + '/functions/v1/google-rating', {
    method: 'POST',
    headers: { apikey: API_KEY, Authorization: 'Bearer ' + s.access_token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ venue: id })
  });
  if (res.status === 404) { on = false; return null; }   // the function isn't deployed yet
  const r = res.ok ? await res.json().catch(() => null) : null;
  if (r && r.enabled === false) on = false;
  if (!r || !r.found || typeof r.rating !== 'number') return null;
  return { rating: r.rating, count: Number(r.count) || 0, url: GOOGLE_URL.test(r.url || '') ? r.url : null };
}

// The venue's Google rating, or null while loading, when Google doesn't know it, or when ratings are off.
export function useGoogleRating(id: string | null): GoogleRating | null {
  const [, bump] = useState(0);
  useEffect(() => {
    if (!id || !on) return;
    const done = () => bump((n) => n + 1);
    if (!(id in cache)) {
      cache[id] = 'loading';
      waiting[id] = [];
      lookUp(id).then((g) => { cache[id] = g; }, () => { cache[id] = null; })
        .then(() => { (waiting[id] || []).forEach((fn) => fn()); delete waiting[id]; });
    }
    if (cache[id] === 'loading') {
      waiting[id].push(done);
      return () => { waiting[id] = (waiting[id] || []).filter((fn) => fn !== done); };
    }
  }, [id]);
  const g = id ? cache[id] : null;
  return g && g !== 'loading' ? g : null;
}
