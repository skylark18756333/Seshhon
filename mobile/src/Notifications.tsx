// The Notifications side of the Chats tab: everything waiting on you in one list. Friend requests (accept or
// decline), seshes friends have invited you to or started (join, or hide it from this list), and new messages
// (tap to open the chat). Nothing new is stored on the server: it reads what the app already has, and the seshes
// you hide are remembered on this phone only.
import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Sesh } from './api';
import Icon from './Icon';
import { Button, Face } from './Parts';
import type { Frendzy } from './useFrendzy';
import { C, F, first, fmtTime, themed } from './theme';

export type NewChat = { id: string; name: string; text: string; at: string };

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
function when(s: Sesh): string {
  if (!s.starts_at) return '';
  const d = new Date(s.starts_at);
  if (d.getTime() <= Date.now()) return '';
  const today = new Date();
  const day = d.toDateString() === today.toDateString() ? 'Today' : DAYS[d.getDay()] + ' ' + d.getDate() + '/' + (d.getMonth() + 1);
  return day + ', ' + fmtTime(s.starts_at);
}

// Seshes waiting on you: ones you're not in yet. Shared with the Chats tab's count.
export function seshInvites(f: Frendzy, hidden: Record<string, true>): Sesh[] {
  const st = f.state;
  if (!st || !st.me) return [];
  return (st.seshes || []).filter((s) => !s.am_member && !hidden[s.id] && (st.me.colour !== 'off' || !!s.private || !!when(s)));
}

const HIDDEN_KEY = 'notif-hidden-seshes';
export function useHiddenSeshes(): [Record<string, true>, (id: string) => void] {
  const [hidden, setHidden] = useState<Record<string, true>>({});
  useEffect(() => {
    AsyncStorage.getItem(HIDDEN_KEY).then((raw) => { if (raw) setHidden(JSON.parse(raw)); }).catch(() => {});
  }, []);
  const hide = (id: string) => setHidden((h) => {
    const n = { ...h, [id]: true as const };
    AsyncStorage.setItem(HIDDEN_KEY, JSON.stringify(n)).catch(() => {});
    return n;
  });
  return [hidden, hide];
}

export default function Notifications({ f, chats, hidden, hide, onChat, onSesh }: {
  f: Frendzy; chats: NewChat[]; hidden: Record<string, true>; hide: (id: string) => void;
  onChat: (id: string) => void; onSesh: () => void;
}) {
  const requests = (f.state && f.state.requests_in) || [];
  const seshes = seshInvites(f, hidden);
  const join = (s: Sesh) => f.act('join_sesh', { p_sesh: s.id }, when(s) ? "You're in. It goes live at the planned time." : "You're in.").then((r) => { if (r) onSesh(); });

  if (!requests.length && !seshes.length && !chats.length) {
    return (
      <View style={styles.empty}>
        <Icon name="tick" size={28} colour={C.muted} />
        <Text style={styles.muted}>You're all caught up. Sesh invites, friend requests and new messages show here.</Text>
      </View>
    );
  }
  return (
    <>
      {requests.length ? <Text style={styles.group}>Friend requests</Text> : null}
      {requests.map((r) => (
        <View key={r.friendship} style={styles.card}>
          <View style={styles.row}>
            <Face id={r.friendship} name={r.name} photos={{}} size={44} font={15} />
            <Text style={[styles.body, styles.grow]}><Text style={styles.strong}>{r.name}</Text> wants to add you</Text>
          </View>
          <View style={styles.buttons}>
            <Button label="Accept" small onPress={() => f.answer(r.friendship, true)} />
            <Button label="Decline" small ghost onPress={() => f.answer(r.friendship, false)} />
          </View>
        </View>
      ))}

      {seshes.length ? <Text style={styles.group}>Seshes</Text> : null}
      {seshes.map((s) => {
        const who = first(s.creator_name) || 'A friend';
        const at = when(s);
        const line = s.private ? who + ' invited you to a sesh' : at ? who + ' planned a sesh' : who + ' is out for a sesh';
        return (
          <View key={s.id} style={styles.card} testID={'notif-sesh-' + s.id}>
            <View style={styles.row}>
              <View style={[styles.icon, { backgroundColor: C.heroFrom }]}><Icon name="bolt" size={20} colour="#fff" /></View>
              <View style={styles.grow}>
                <Text style={styles.body}><Text style={styles.strong}>{line}</Text></Text>
                <Text style={[styles.muted, styles.small]} numberOfLines={1}>{(at ? at + ' · ' : '') + s.members.length + ' in'}</Text>
              </View>
            </View>
            <View style={styles.buttons}>
              <Button label="Join" small onPress={() => join(s)} />
              <Button label="Not now" small ghost onPress={() => hide(s.id)} />
            </View>
          </View>
        );
      })}

      {chats.length ? <Text style={styles.group}>New messages</Text> : null}
      {chats.map((c) => (
        <Pressable key={c.id} style={[styles.card, styles.row]} onPress={() => onChat(c.id)} accessibilityRole="button" accessibilityLabel={'New message from ' + c.name}>
          <Face id={c.id} name={c.name} photos={f.photos} size={44} font={15} />
          <View style={styles.grow}>
            <Text style={[styles.body, styles.strong]} numberOfLines={1}>{c.name}</Text>
            <Text style={[styles.muted, styles.small]} numberOfLines={1}>{c.text}</Text>
          </View>
          <Text style={[styles.muted, styles.tiny]}>{fmtTime(c.at)}</Text>
        </Pressable>
      ))}
    </>
  );
}

const styles = themed(() => StyleSheet.create({
  empty: { alignItems: 'center', gap: 10, paddingVertical: 40, paddingHorizontal: 20 },
  group: { fontFamily: F.bodyBold, fontSize: 12, letterSpacing: 1.4, textTransform: 'uppercase', color: C.muted, marginTop: 6 },
  card: { backgroundColor: C.surface, borderRadius: 18, borderWidth: 1, borderColor: C.line, padding: 12, gap: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  buttons: { flexDirection: 'row', gap: 8 },
  grow: { flex: 1, minWidth: 0 },
  icon: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  body: { fontFamily: F.body, fontSize: 16, color: C.fg },
  strong: { fontFamily: F.bodyBold },
  muted: { fontFamily: F.body, fontSize: 16, lineHeight: 22, color: C.muted, textAlign: 'center' },
  small: { fontSize: 14, lineHeight: 20, textAlign: 'left' },
  tiny: { fontSize: 12, lineHeight: 16 }
}));
