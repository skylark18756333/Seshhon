// Messages between friends that Frendzy can't read and doesn't keep (migration 0038_friend_messages).
// Each phone makes its own pair of keys (tweetnacl, "box"): the lock (public key) goes to the database so friends
// can lock a message for you, and the unlock (secret key) stays in this phone's secure storage and never leaves it.
// A message is locked here, sits in the database as scrambled text until your friend's phone collects it, then it
// is deleted there. The history you see is kept on this phone only (AsyncStorage). Lose the phone, lose the chat.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import nacl from 'tweetnacl';
import { decodeBase64, decodeUTF8, encodeBase64, encodeUTF8 } from 'tweetnacl-util';
import type { Friend } from './api';
import Icon from './Icon';
import { Button, Face, Toast } from './Parts';
import { rpc, type ApiError } from './session';
import type { Frendzy } from './useFrendzy';
import { C, F, first, themed } from './theme';

nacl.setPRNG((x, n) => { x.set(Crypto.getRandomBytes(n)); });

type Msg = { id: string; me: boolean; text: string; at: string };
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
  if (!rows.length) return h;
  let next = h;
  for (const r of rows) {
    let text = "Couldn't open this message.";
    try {
      const [n, b] = r.body.split('.');
      const opened = nacl.box.open(decodeBase64(b), decodeBase64(n), decodeBase64(r.key), kp.secretKey);
      if (opened) text = encodeUTF8(opened);
    } catch (_) { /* leave the note */ }
    next = add(next, r.from, { id: r.id, me: false, text, at: r.at });
  }
  saveHistory(uid, next);
  await rpc('got_friend_messages', { p_ids: rows.map((r) => r.id) });
  return next;
}

/* ---------- the screen ---------- */
export default function Messages({ f, onBack }: { f: Frendzy; onBack: () => void }) {
  const me = f.state && f.state.me;
  const friends = (f.state && f.state.friends) || [];
  const uid = me ? me.id : '';
  const [hist, setHist] = useState<History>({ chats: {}, seen: {} });
  const [open, setOpen] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const live = useRef({ hist, uid });
  live.current = { hist, uid };
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
    lockAndSend(uid, open, body.slice(0, 1000)).then((m) => {
      setText('');
      setHist((h) => { const n = add(h, open, m); saveHistory(uid, n); return n; });
    }, (e: ApiError) => { if (!e.signedOut) f.say(e.message || "Couldn't send that."); }).then(() => setBusy(false));
  }, [text, open, busy, uid, f]);

  if (!me) return null;
  const friend: Friend | undefined = open ? friends.find((x) => x.id === open) : undefined;
  const ordered = friends.slice().sort((a, b) => (last(b.id)?.at || '').localeCompare(last(a.id)?.at || '') || a.name.localeCompare(b.name));

  return (
    <View style={styles.fill}>
      <View style={styles.top}>
        <Pressable onPress={() => (open ? setOpen(null) : onBack())} accessibilityRole="button" accessibilityLabel="Back" style={styles.backBtn}>
          <Icon name="back" size={22} colour={C.fg} />
        </Pressable>
        <Text style={[styles.h1, styles.grow]} numberOfLines={1} accessibilityRole="header">{friend ? friend.name : 'Messages'}</Text>
      </View>
      <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {friend ? (
          <>
            <ScrollView ref={scroll} style={styles.fill} contentContainerStyle={styles.view} keyboardShouldPersistTaps="handled">
              <Text style={[styles.muted, styles.small]}>Locked: only you and {first(friend.name)} can read these. Frendzy never keeps them, they live on your phones.</Text>
              {(hist.chats[friend.id] || []).map((m) => (
                <View key={m.id} style={[styles.bubble, m.me ? styles.mine : styles.theirs]}>
                  <Text style={[styles.body, m.me && styles.mineText]}>{m.text}</Text>
                </View>
              ))}
              {!(hist.chats[friend.id] || []).length ? <Text style={styles.muted}>No messages yet. Say hi.</Text> : null}
            </ScrollView>
            <View style={styles.compose}>
              <TextInput
                style={[styles.input, styles.grow]}
                value={text}
                onChangeText={setText}
                placeholder="Message"
                placeholderTextColor={C.muted}
                maxLength={1000}
                multiline
                accessibilityLabel="Message"
              />
              <Button label="Send" small onPress={send} disabled={busy || !text.trim()} />
            </View>
          </>
        ) : (
          <ScrollView style={styles.fill} contentContainerStyle={styles.view}>
            <Text style={[styles.muted, styles.small]}>Messages are locked on your phone. Frendzy can't read them and deletes its copy as soon as your friend's phone has it.</Text>
            {!ordered.length ? <Text style={styles.muted}>Add friends to message them.</Text> : null}
            {ordered.map((fr) => {
              const m = last(fr.id);
              return (
                <Pressable key={fr.id} style={styles.item} onPress={() => openChat(fr.id)} accessibilityRole="button" accessibilityLabel={'Message ' + fr.name}>
                  <Face id={fr.id} name={fr.name} photos={f.photos} size={44} font={16} />
                  <View style={styles.grow}>
                    <Text style={[styles.body, unread(fr.id) && styles.strong]} numberOfLines={1}>{fr.name}</Text>
                    <Text style={[styles.muted, styles.small]} numberOfLines={1}>{m ? (m.me ? 'You: ' : '') + m.text : 'No messages yet'}</Text>
                  </View>
                  {unread(fr.id) ? <View style={styles.dot} /> : null}
                </Pressable>
              );
            })}
          </ScrollView>
        )}
      </KeyboardAvoidingView>
      <Toast text={f.toast} />
    </View>
  );
}

const styles = themed(() => StyleSheet.create({
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
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: C.on },
  bubble: { maxWidth: '82%', borderRadius: 18, paddingHorizontal: 14, paddingVertical: 10 },
  mine: { alignSelf: 'flex-end', backgroundColor: C.accent },
  mineText: { color: C.accentInk },
  theirs: { alignSelf: 'flex-start', backgroundColor: C.surface, borderWidth: 1, borderColor: C.line },
  compose: { flexDirection: 'row', alignItems: 'flex-end', gap: 10, paddingHorizontal: 14, paddingTop: 8, paddingBottom: 10, maxWidth: 440, width: '100%', alignSelf: 'center' },
  input: { minHeight: 48, maxHeight: 120, borderRadius: 16, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface, paddingHorizontal: 14, paddingTop: 12, color: C.fg, fontFamily: F.body, fontSize: 16 }
}));
