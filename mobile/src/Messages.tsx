// Messages between friends that Crewzy can't read and doesn't keep (migration 0038_friend_messages).
// Each phone makes its own pair of keys (tweetnacl, "box"): the lock (public key) goes to the database so friends
// can lock a message for you, and the unlock (secret key) stays in this phone's secure storage and never leaves it.
// A message is locked here, sits in the database as scrambled text until your friend's phone collects it, then it
// is deleted there. The history you see is kept on this phone only (AsyncStorage). Lose the phone, lose the chat.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { joinTyping, SHOW_FOR_MS, type TypingLink } from './typing';
import TypingLights from './TypingLights';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import nacl from 'tweetnacl';
import { decodeBase64, decodeUTF8, encodeBase64, encodeUTF8 } from 'tweetnacl-util';
import type { Friend } from './api';
import Icon from './Icon';
import { Button, Face, Toast, setWaiting } from './Parts';
import { ReactBar, ReactChips } from './Reactions';
import KeyboardSafe from './KeyboardSafe';
import Notifications, { seshInvites, useHiddenSeshes, type NewChat } from './Notifications';
import { rpc, type ApiError } from './session';
import type { Frendzy } from './useFrendzy';
import { C, COLOURS, F, LABELS, fade, first, fmtTime, themed } from './theme';

nacl.setPRNG((x, n) => { x.set(Crypto.getRandomBytes(n)); });

type Msg = { id: string; me: boolean; text: string; at: string; myReact?: string; theirReact?: string };
// A reaction travels as a locked message of its own: a hidden marker, the message id and the emoji, then words an
// older app shows instead ("Reacted ❤️"). Nothing about it is stored anywhere but the two phones.
const REACT = '\u2063R:';
function reactText(id: string, emoji: string): string { return REACT + id + ':' + emoji + '\u2063 ' + (emoji ? 'Reacted ' + emoji : 'Took a reaction off'); }
function readReact(text: string): { id: string; emoji: string } | null {
  if (!text.startsWith(REACT)) return null;
  const end = text.indexOf('\u2063', REACT.length);
  const body = text.slice(REACT.length, end < 0 ? undefined : end);
  const at = body.indexOf(':');
  return at < 0 ? null : { id: body.slice(0, at), emoji: body.slice(at + 1) };
}
function setReact(h: History, friend: string, id: string, field: 'myReact' | 'theirReact', emoji: string): History {
  const list = h.chats[friend];
  if (!list || !list.some((x) => x.id === id)) return h;
  return { ...h, chats: { ...h.chats, [friend]: list.map((x) => (x.id === id ? { ...x, [field]: emoji || undefined } : x)) } };
}
type History = { chats: Record<string, Msg[]>; seen: Record<string, string> };
const MAX_KEPT = 300;

/* ---------- keys ---------- */
let published = '';
async function myKeys(uid: string): Promise<nacl.BoxKeyPair> {
  const name = 'dm-secret-' + uid;
  let stored = await SecureStore.getItemAsync(name);
  if (!stored) {
    stored = encodeBase64(nacl.box.keyPair().secretKey);
    await SecureStore.setItemAsync(name, stored);
  }
  return nacl.box.keyPair.fromSecretKey(decodeBase64(stored));
}
// Make sure friends can find my lock.
async function ensureKey(uid: string): Promise<nacl.BoxKeyPair> {
  const kp = await myKeys(uid);
  const pub = encodeBase64(kp.publicKey);
  if (published !== uid + pub) { await rpc('set_message_key', { p_key: pub }); published = uid + pub; }
  return kp;
}

/* ---------- history kept on this phone ---------- */
async function loadHistory(uid: string): Promise<History> {
  try {
    const raw = await AsyncStorage.getItem('dm-history-' + uid);
    if (raw) { const h = JSON.parse(raw); return { chats: h.chats || {}, seen: h.seen || {} }; }
  } catch (_) { /* start empty */ }
  return { chats: {}, seen: {} };
}
function saveHistory(uid: string, h: History): void {
  AsyncStorage.setItem('dm-history-' + uid, JSON.stringify(h)).catch(() => {});
}
function add(h: History, friend: string, m: Msg): History {
  const list = h.chats[friend] || [];
  if (list.some((x) => x.id === m.id)) return h;
  const next = list.concat(m).sort((a, b) => a.at.localeCompare(b.at)).slice(-MAX_KEPT);
  return { ...h, chats: { ...h.chats, [friend]: next } };
}

/* ---------- send and collect ---------- */
async function lockAndSend(uid: string, to: string, text: string): Promise<Msg> {
  const kp = await ensureKey(uid);
  const theirs: string | null = await rpc('friend_message_key', { p_friend: to });
  if (!theirs) throw Object.assign(new Error("They haven't opened Messages yet, so there's no lock for them. Ask them to open it once."), { shown: true });
  const nonce = nacl.randomBytes(nacl.box.nonceLength);
  const box = nacl.box(decodeUTF8(text), nonce, decodeBase64(theirs), kp.secretKey);
  const id: string = await rpc('send_friend_message', { p_to: to, p_sender_key: encodeBase64(kp.publicKey), p_body: encodeBase64(nonce) + '.' + encodeBase64(box) });
  return { id, me: true, text, at: new Date().toISOString() };
}
type Row = { id: string; from: string; key: string; body: string; at: string };
// Fetch what is waiting, unlock it, keep it here, then tell the database it can delete its copies.
async function collect(uid: string, h: History): Promise<History> {
  const kp = await ensureKey(uid);
  const rows: Row[] = await rpc('my_friend_messages');
  setWaiting(0);   // this screen collects them, so the header's count clears
  if (!rows.length) return h;
  let next = h;
  for (const r of rows) {
    let text = "Couldn't open this message.";
    try {
      const [n, b] = r.body.split('.');
      const opened = nacl.box.open(decodeBase64(b), decodeBase64(n), decodeBase64(r.key), kp.secretKey);
      if (opened) text = encodeUTF8(opened);
    } catch (_) { /* leave the note */ }
    const re = readReact(text);
    next = re ? setReact(next, r.from, re.id, 'theirReact', re.emoji) : add(next, r.from, { id: r.id, me: false, text, at: r.at });
  }
  saveHistory(uid, next);
  await rpc('got_friend_messages', { p_ids: rows.map((r) => r.id) });
  return next;
}

// Opening Messages straight on one friend's chat (the Message button on a friend's profile, or a face on Friends).
let pendingChat: string | null = null;
export function chatWith(id: string | null) { pendingChat = id; }
// Send one message to a friend from another screen (an event suggested from Events): locked the same way, and kept in
// this phone's history so it shows in that chat.
export async function sendToFriend(uid: string, to: string, text: string): Promise<void> {
  const m = await lockAndSend(uid, to, text);
  saveHistory(uid, add(await loadHistory(uid), to, m));
}
const TONIGHT_MS = 12 * 3600000;
function reactCounts(m: Msg): Record<string, number> {
  const out: Record<string, number> = {};
  for (const e of [m.myReact, m.theirReact]) if (e) out[e] = (out[e] || 0) + 1;
  return out;
}   // chats with a message in the last 12 hours sit under "Tonight"

/* ---------- the screen ---------- */
export default function Messages({ f, onBack, onSesh }: { f: Frendzy; onBack: () => void; onSesh: () => void }) {
  const me = f.state && f.state.me;
  const friends = (f.state && f.state.friends) || [];
  const uid = me ? me.id : '';
  const [hist, setHist] = useState<History>({ chats: {}, seen: {} });
  const [open, setOpen] = useState<string | null>(() => { const p = pendingChat; pendingChat = null; return p; });
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const live = useRef({ hist, uid });
  live.current = { hist, uid };

  // Typing lights in an open chat: the Crewzy bubble shows while your friend types (Realtime broadcast on a channel
  // for the two of you, nothing stored; see typing.ts). They go when the message arrives or they stop.
  const typingLink = useRef<TypingLink | null>(null);
  const [theyTypeUntil, setTheyTypeUntil] = useState(0);
  useEffect(() => {
    setTheyTypeUntil(0);
    if (!uid || !open) return;
    const pair = [uid, open].sort().join('-');
    const l = joinTyping('dm-' + pair, uid, {
      onTyping: (id) => { if (id === open) setTheyTypeUntil(Date.now() + SHOW_FOR_MS); },
      onStopped: (id) => { if (id === open) setTheyTypeUntil(0); }
    });
    typingLink.current = l;
    return () => { l.stopped(); l.close(); if (typingLink.current === l) typingLink.current = null; };
  }, [uid, open]);
  // The lights go off on their own a few seconds after the last note. One timer for that, instead of redrawing the
  // whole chat every second.
  useEffect(() => {
    if (!theyTypeUntil) return;
    const t = setTimeout(() => setTheyTypeUntil((u) => (u <= Date.now() ? 0 : u)), Math.max(0, theyTypeUntil - Date.now()) + 50);
    return () => clearTimeout(t);
  }, [theyTypeUntil]);
  const theyType = theyTypeUntil > Date.now();
  const onText = (v: string) => {
    setText(v);
    if (typingLink.current) { if (v.trim()) typingLink.current.typing(); else typingLink.current.stopped(); }
  };
  const scroll = useRef<ScrollView>(null);

  // Load the history kept on this phone, then check for new messages every few seconds while this screen is open.
  useEffect(() => {
    if (!uid) return;
    let gone = false;
    const tick = async () => {
      try {
        const base = live.current.hist;
        const next = await collect(uid, base);
        if (!gone && next !== base) setHist((cur) => (cur === base ? next : { ...cur, chats: next.chats }));
      } catch (_) { /* offline or not set up yet: try again next time */ }
    };
    loadHistory(uid).then((h) => { if (gone) return; setHist(h); live.current.hist = h; tick(); });
    const timer = setInterval(tick, 4000);
    return () => { gone = true; clearInterval(timer); };
  }, [uid]);

  const last = (id: string): Msg | undefined => { const l = hist.chats[id]; return l && l[l.length - 1]; };
  const unread = (id: string): boolean => { const m = last(id); return !!m && !m.me && m.at > (hist.seen[id] || ''); };
  const openChat = (id: string) => {
    setOpen(id);
    const m = last(id);
    if (m) setHist((h) => { const n = { ...h, seen: { ...h.seen, [id]: m.at } }; saveHistory(uid, n); return n; });
  };
  useEffect(() => { if (open) setTimeout(() => scroll.current?.scrollToEnd({ animated: false }), 50); }, [open, hist.chats[open || '']?.length]);

  const send = useCallback(() => {
    const body = text.trim();
    if (!open || !body || busy) return;
    setBusy(true);
    if (typingLink.current) typingLink.current.stopped();
    lockAndSend(uid, open, body.slice(0, 1000)).then((m) => {
      setText('');
      setHist((h) => { const n = add(h, open, m); saveHistory(uid, n); return n; });
    }, (e: ApiError) => { if (!e.signedOut) f.say(e.message || "Couldn't send that."); }).then(() => setBusy(false));
  }, [text, open, busy, uid, f]);

  // Emoji reactions: hold a message to pick one; the same one again takes it off.
  const [reacting, setReacting] = useState<string | null>(null);
  // The switch at the top of Chats: your messages, or everything waiting on you (Notifications.tsx).
  const [side, setSide] = useState<'messages' | 'alerts'>('messages');
  const [hiddenSeshes, hideSesh] = useHiddenSeshes();
  const react = (m: Msg, e: string) => {
    if (!open) return;
    setReacting(null);
    const emoji = m.myReact === e ? '' : e;
    const friendId = open;
    lockAndSend(uid, friendId, reactText(m.id, emoji)).then(() => {
      setHist((h) => { const n = setReact(h, friendId, m.id, 'myReact', emoji); saveHistory(uid, n); return n; });
    }, (x: ApiError) => { if (!x.signedOut) f.say(x.message || "Couldn't send that."); });
  };

  if (!me) return null;
  const friend: Friend | undefined = open ? friends.find((x) => x.id === open) : undefined;
  const ordered = friends.slice().sort((a, b) => (last(b.id)?.at || '').localeCompare(last(a.id)?.at || '') || a.name.localeCompare(b.name));
  const since = new Date(Date.now() - TONIGHT_MS).toISOString();
  const tonight = ordered.filter((fr) => { const m = last(fr.id); return !!m && m.at >= since; });
  const earlier = ordered.filter((fr) => { const m = last(fr.id); return !!m && m.at < since; });
  const quiet = ordered.filter((fr) => !last(fr.id));
  // Red friends are never shown as red: only green and amber friends get a chat head.
  const heads = friends.filter((fr) => fr.colour === 'on').concat(friends.filter((fr) => fr.colour === 'thinking'));
  const seshes = (f.state && f.state.seshes) || [];
  const newChats: NewChat[] = ordered.filter((fr) => unread(fr.id)).map((fr) => { const m = last(fr.id)!; return { id: fr.id, name: fr.name, text: m.text, at: m.at }; });
  const alerts = ((f.state && f.state.requests_in) || []).length + seshInvites(f, hiddenSeshes).length + newChats.length;
  const liveSesh = seshes.filter((x) => x.am_member && !(x.planned && x.starts_at && new Date(x.starts_at).getTime() > Date.now()))[0] || null;
  const row = (fr: Friend) => {
    const m = last(fr.id), un = unread(fr.id);
    return (
      <Pressable key={fr.id} style={styles.row} onPress={() => openChat(fr.id)} accessibilityRole="button" accessibilityLabel={'Message ' + fr.name + (un ? ', new message' : '')}>
        <View>
          <Face id={fr.id} name={fr.name} photos={f.photos} size={50} font={17} />
          {fr.colour === 'on' ? <View style={[styles.onDot, { backgroundColor: C.on }]} /> : null}
        </View>
        <View style={styles.grow}>
          <View style={styles.titleRow}>
            <Text style={[styles.body, styles.strong, styles.shrink]} numberOfLines={1}>{fr.name}</Text>
            {m ? <Text style={[styles.muted, styles.tiny]}>{fmtTime(m.at)}</Text> : null}
          </View>
          <Text style={[styles.muted, styles.small, un && styles.unreadText]} numberOfLines={1}>{m ? (m.me ? 'You: ' : '') + m.text : 'Say hi'}</Text>
        </View>
        {un ? <View style={styles.dot} /> : null}
      </Pressable>
    );
  };

  return (
    <View style={styles.fill}>
      <View style={styles.top}>
        <Pressable onPress={() => (open ? setOpen(null) : onBack())} accessibilityRole="button" accessibilityLabel="Back" style={styles.backBtn}>
          <Icon name="back" size={22} colour={C.fg} />
        </Pressable>
        <Text style={[styles.h1, styles.grow]} numberOfLines={1} accessibilityRole="header">{friend ? friend.name : 'Messages'}</Text>
      </View>
      {!friend ? (
        <View style={styles.switch} accessibilityRole="tablist">
          {(['messages', 'alerts'] as const).map((k) => (
            <Pressable key={k} style={[styles.switchBtn, side === k && styles.switchOn]} onPress={() => setSide(k)}
              accessibilityRole="tab" accessibilityState={{ selected: side === k }} testID={'chats-' + k}>
              <Text style={[styles.switchText, side === k && styles.switchTextOn]}>{k === 'messages' ? 'Messages' : 'Notifications'}</Text>
              {k === 'alerts' && alerts ? <View style={styles.count}><Text style={styles.countText}>{alerts > 9 ? '9+' : alerts}</Text></View> : null}
            </Pressable>
          ))}
        </View>
      ) : null}
      <KeyboardSafe style={styles.fill}>
        {friend ? (
          <>
            <ScrollView ref={scroll} style={styles.fill} contentContainerStyle={[styles.view, styles.bottomUp]} keyboardShouldPersistTaps="handled"
              onScrollBeginDrag={() => setReacting(null)} onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: false })}>
              <Text style={[styles.muted, styles.small]}>Locked: only you and {first(friend.name)} can read these. Crewzy never keeps them, they live on your phones.</Text>
              {(hist.chats[friend.id] || []).map((m) => (
                <View key={m.id} style={m.me ? styles.mineWrap : styles.theirsWrap}>
                  {reacting === m.id ? <ReactBar mine={m.myReact} right={m.me} onPick={(e) => react(m, e)} onClose={() => setReacting(null)} /> : null}
                  <Pressable style={[styles.bubble, m.me ? styles.mine : styles.theirs]} onLongPress={() => setReacting(reacting === m.id ? null : m.id)}
                    delayLongPress={300} accessibilityHint="Hold to react" accessibilityActions={[{ name: 'longpress', label: 'React' }]}
                    onAccessibilityAction={() => setReacting(m.id)} testID={'dm-msg-' + m.id}>
                    <Text style={[styles.body, m.me && styles.mineText]}>{m.text}</Text>
                  </Pressable>
                  <ReactChips counts={reactCounts(m)} mine={m.myReact} right={m.me} onPick={(e) => react(m, e)} />
                </View>
              ))}
              {!(hist.chats[friend.id] || []).length ? <Text style={styles.muted}>No messages yet. Say hi.</Text> : null}
              {theyType ? (
                <View style={styles.typingRow} accessibilityLabel={first(friend.name) + ' is typing'} testID="dm-typing">
                  <TypingLights />
                  <Text style={[styles.muted, styles.small]}>{first(friend.name)} is typing...</Text>
                </View>
              ) : null}
            </ScrollView>
            <View style={styles.compose}>
              <TextInput
                style={[styles.input, styles.grow]}
                value={text}
                onChangeText={onText}
                placeholder="Message"
                placeholderTextColor={C.muted}
                maxLength={1000}
                multiline
                onFocus={() => setTimeout(() => scroll.current?.scrollToEnd({ animated: true }), 300)}
                accessibilityLabel="Message"
              />
              {/* A round send button with the paper plane, the same as the sesh chat's. */}
              <Pressable style={[styles.send, (busy || !text.trim()) && styles.sendOff]} onPress={send} disabled={busy || !text.trim()}
                accessibilityRole="button" accessibilityLabel="Send" accessibilityState={{ disabled: busy || !text.trim() }} testID="dm-send">
                <Icon name="send" size={22} colour={C.accentInk} />
              </Pressable>
            </View>
          </>
        ) : side === 'alerts' ? (
          <ScrollView style={styles.fill} contentContainerStyle={styles.view}>
            <Notifications f={f} chats={newChats} hidden={hiddenSeshes} hide={hideSesh} onChat={openChat} onSesh={onSesh} />
          </ScrollView>
        ) : (
          <ScrollView style={styles.fill} contentContainerStyle={styles.view}>
            {/* Chat heads: friends who are green (or amber and letting you see), one tap to chat. */}
            {heads.length ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.heads}>
                {heads.map((fr) => (
                  <Pressable key={fr.id} style={styles.head} onPress={() => openChat(fr.id)} accessibilityRole="button" accessibilityLabel={'Message ' + fr.name + ', ' + LABELS[fr.colour]}>
                    <View style={[styles.headRing, { borderColor: COLOURS[fr.colour], shadowColor: COLOURS[fr.colour] }]}>
                      <Face id={fr.id} name={fr.name} photos={f.photos} size={52} font={18} />
                    </View>
                    <Text style={styles.headName} numberOfLines={1}>{first(fr.name)}</Text>
                  </Pressable>
                ))}
              </ScrollView>
            ) : null}

            {liveSesh || tonight.length ? <Text style={styles.group}>Tonight</Text> : null}
            {liveSesh ? (
              <Pressable style={styles.row} onPress={onSesh} accessibilityRole="button" accessibilityLabel="Open tonight's sesh chat" testID="messages-sesh">
                <View style={[styles.seshIcon, { backgroundColor: C.heroTo }]}><View style={[styles.seshIconIn, { backgroundColor: C.heroFrom }]}><Icon name="bolt" size={20} colour="#fff" /></View></View>
                <View style={styles.grow}>
                  <View style={styles.titleRow}>
                    <Text style={[styles.body, styles.strong, styles.shrink]} numberOfLines={1}>{liveSesh.mine ? 'Your sesh' : first(liveSesh.creator_name) + "'s sesh"}</Text>
                    <Text style={styles.livePin}>LIVE</Text>
                  </View>
                  <Text style={[styles.muted, styles.small]} numberOfLines={1}>{liveSesh.members.length} in. Tap to open the sesh chat</Text>
                </View>
              </Pressable>
            ) : null}
            {tonight.map(row)}
            {earlier.length ? <Text style={styles.group}>Earlier</Text> : null}
            {earlier.map(row)}
            {quiet.length ? <Text style={styles.group}>Start a chat</Text> : null}
            {quiet.map(row)}
            {!friends.length ? <Text style={styles.muted}>Add friends to message them.</Text> : null}
            <View style={styles.lockLine}>
              <Icon name="lock" size={12} colour={C.muted} />
              <Text style={[styles.muted, styles.tiny]}>Locked on your phone. Crewzy can't read them and deletes its copy once your friend's phone has it.</Text>
            </View>
          </ScrollView>
        )}
      </KeyboardSafe>
      <Toast text={f.toast} />
    </View>
  );
}

const styles = themed(() => StyleSheet.create({
  typingRow: { flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start' },
  fill: { flex: 1 },
  top: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingTop: 12, paddingBottom: 6, maxWidth: 440, width: '100%', alignSelf: 'center' },
  backBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  view: { paddingHorizontal: 18, paddingTop: 12, paddingBottom: 24, gap: 12, maxWidth: 440, width: '100%', alignSelf: 'center' },
  grow: { flex: 1, minWidth: 0 },
  h1: { fontFamily: F.display, fontSize: 24, lineHeight: 28, letterSpacing: -0.5, color: C.fg },
  body: { fontFamily: F.body, fontSize: 16, color: C.fg },
  strong: { fontFamily: F.bodyBold },
  muted: { fontFamily: F.body, fontSize: 16, lineHeight: 22, color: C.muted },
  small: { fontSize: 14, lineHeight: 20 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: C.surface, borderRadius: 18, borderWidth: 1, borderColor: C.line, padding: 12 },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: C.accent },
  tiny: { fontSize: 12, lineHeight: 16 },
  shrink: { flexShrink: 1 },
  heads: { gap: 14, paddingVertical: 6, paddingRight: 8 },
  head: { alignItems: 'center', gap: 6, width: 66 },
  headRing: { borderWidth: 2.5, borderRadius: 32, padding: 3, shadowOpacity: C.dark ? 0.8 : 0, shadowRadius: 10, shadowOffset: { width: 0, height: 0 } },
  headName: { fontFamily: F.bodyBold, fontSize: 13, color: C.fg, maxWidth: 66 },
  group: { fontFamily: F.bodyBold, fontSize: 12, letterSpacing: 1.4, textTransform: 'uppercase', color: C.muted, marginTop: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 4 },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  unreadText: { color: C.fg, fontFamily: F.bodyBold },
  onDot: { position: 'absolute', right: 0, bottom: 0, width: 14, height: 14, borderRadius: 7, borderWidth: 2.5, borderColor: C.bg },
  seshIcon: { width: 50, height: 50, borderRadius: 25, overflow: 'hidden' },
  seshIconIn: { position: 'absolute', top: 0, left: 0, right: 12, bottom: 12, borderRadius: 25, alignItems: 'center', justifyContent: 'center', width: 50, height: 50 },
  livePin: { fontFamily: F.bodyBold, fontSize: 10, letterSpacing: 1, color: '#fff', backgroundColor: C.off, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, overflow: 'hidden' },
  lockLine: { flexDirection: 'row', alignItems: 'center', gap: 6, justifyContent: 'center', marginTop: 10 },
  bottomUp: { flexGrow: 1, justifyContent: 'flex-end' },   // newest messages sit at the bottom, by the typing box
  mineWrap: { alignItems: 'flex-end' },
  theirsWrap: { alignItems: 'flex-start' },
  bubble: { maxWidth: '82%', borderRadius: 18, paddingHorizontal: 14, paddingVertical: 10 },
  mine: { alignSelf: 'flex-end', backgroundColor: C.accent },
  mineText: { color: C.accentInk },
  theirs: { alignSelf: 'flex-start', backgroundColor: C.surface, borderWidth: 1, borderColor: C.line },
  compose: { flexDirection: 'row', alignItems: 'flex-end', gap: 10, paddingHorizontal: 14, paddingTop: 8, paddingBottom: 10, maxWidth: 440, width: '100%', alignSelf: 'center' },
  input: { minHeight: 48, maxHeight: 120, borderRadius: 16, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface, paddingHorizontal: 14, paddingTop: 12, color: C.fg, fontFamily: F.body, fontSize: 16 },
  send: { width: 46, height: 46, borderRadius: 23, backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center' },
  sendOff: { opacity: 0.45 },
  switch: { flexDirection: 'row', gap: 4, padding: 4, marginHorizontal: 18, borderRadius: 22, backgroundColor: C.surface, borderWidth: 1, borderColor: C.line, maxWidth: 404, width: '100%', alignSelf: 'center' },
  switchBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, height: 38, borderRadius: 18 },
  switchOn: { backgroundColor: C.accent },
  switchText: { fontFamily: F.bodyBold, fontSize: 14, color: C.muted },
  switchTextOn: { color: C.accentInk },
  count: { minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 5, backgroundColor: C.off, alignItems: 'center', justifyContent: 'center' },
  countText: { fontFamily: F.bodyBold, fontSize: 11, color: '#fff' }
}));
