// "Someone is typing" in a sesh chat. Nothing is stored: each phone in the sesh joins a Supabase Realtime
// broadcast channel named after the sesh and sends a tiny "typing" note (just its user id) while its owner types.
// The other phones show the typing lights for a few seconds after the last note. Nothing goes in the database,
// so it needs no SQL and nothing is left behind when the sesh ends.
// This talks the Realtime websocket protocol directly (join, heartbeat, broadcast) so the app needs no new
// library. If the socket can't connect, the chat works exactly as before, just without the lights.
import { API_KEY, API_URL } from './config';
import { currentSession } from './session';

const HEARTBEAT_MS = 25000;
const SEND_EVERY_MS = 2000;   // at most one "typing" note every 2 seconds while someone types
export const SHOW_FOR_MS = 4500;   // how long the lights stay on after the last note

type Handlers = { onTyping: (id: string) => void; onStopped: (id: string) => void };

export type TypingLink = { typing: () => void; stopped: () => void; close: () => void };

export function joinTyping(sesh: string, me: string, on: Handlers): TypingLink {
  const topic = 'realtime:crewzy-typing-' + sesh;
  let ws: WebSocket | null = null;
  let joined = false;
  let closed = false;
  let ref = 0;
  let beat: ReturnType<typeof setInterval> | null = null;
  let retry: ReturnType<typeof setTimeout> | null = null;
  let wait = 2000;
  let lastSent = 0;

  const send = (msg: object) => { try { if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg)); } catch (e) {} };
  const say = (event: 'typing' | 'stopped') => {
    if (!joined) return;
    send({ topic, event: 'broadcast', payload: { type: 'broadcast', event, payload: { id: me } }, ref: String(++ref) });
  };

  const connect = () => {
    if (closed) return;
    try {
      ws = new WebSocket(API_URL.replace(/^http/, 'ws') + '/realtime/v1/websocket?apikey=' + encodeURIComponent(API_KEY) + '&vsn=1.0.0');
    } catch (e) { later(); return; }
    ws.onopen = () => {
      wait = 2000;
      const s = currentSession();
      send({ topic, event: 'phx_join', ref: String(++ref), payload: {
        config: { broadcast: { self: false, ack: false }, presence: { key: '' }, private: false },
        ...(s ? { access_token: s.access_token } : {})
      } });
      beat = setInterval(() => send({ topic: 'phoenix', event: 'heartbeat', payload: {}, ref: String(++ref) }), HEARTBEAT_MS);
    };
    ws.onmessage = (e) => {
      let m: any = null;
      try { m = JSON.parse(String(e.data)); } catch (err) { return; }
      if (!m || m.topic !== topic) return;
      if (m.event === 'phx_reply' && m.payload && m.payload.status === 'ok') joined = true;
      if (m.event === 'broadcast' && m.payload) {
        const id = m.payload.payload && typeof m.payload.payload.id === 'string' ? m.payload.payload.id : null;
        if (!id || id === me) return;
        if (m.payload.event === 'typing') on.onTyping(id);
        else if (m.payload.event === 'stopped') on.onStopped(id);
      }
    };
    ws.onerror = () => {};
    ws.onclose = () => { joined = false; if (beat) clearInterval(beat); beat = null; later(); };
  };
  const later = () => {
    if (closed || retry) return;
    retry = setTimeout(() => { retry = null; connect(); }, wait);
    wait = Math.min(wait * 2, 30000);
  };
  connect();

  return {
    typing: () => { const now = Date.now(); if (now - lastSent < SEND_EVERY_MS) return; lastSent = now; say('typing'); },
    stopped: () => { if (!lastSent) return; lastSent = 0; say('stopped'); },
    close: () => {
      closed = true;
      if (retry) clearTimeout(retry);
      if (beat) clearInterval(beat);
      try { if (ws) { ws.onclose = null; ws.close(); } } catch (e) {}
      ws = null;
    }
  };
}
