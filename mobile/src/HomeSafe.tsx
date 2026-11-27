// "Home safe" in a live sesh: each person ticks when they're in, and anyone can check on the ones who haven't (a push
// that says who asked). No location. The ticks are deleted with the sesh (migration 0049). Hidden until 0049 is run.
import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { Member } from './api';
import { rpc } from './session';
import { C, F, first, themed } from './theme';

export default function HomeSafe({ seshId, members, myId, say }: { seshId: string; members: Member[]; myId: string; say: (m: string) => void }) {
  const [safe, setSafe] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const read = useCallback(() => rpc<string[]>('home_safe_list', { p_sesh: seshId }).then((l) => setSafe(l || []), () => {}), [seshId]);
  useEffect(() => { read(); const t = setInterval(read, 15000); return () => clearInterval(t); }, [read]);
  if (!safe) return null;
  const mine = safe.indexOf(myId) >= 0;
  const waiting = members.filter((m) => m.id !== myId && safe.indexOf(m.id) < 0);
  const tick = () => {
    setBusy(true);
    rpc<string[]>('home_safe', { p_sesh: seshId, p_safe: !mine }).then((l) => { setSafe(l || []); if (!mine) say('Nice. Your crew can see you got home safe.'); },
      (e: { message?: string }) => say((e && e.message) || "Couldn't save that.")).then(() => setBusy(false));
  };
  const nudge = () => {
    rpc<number>('home_safe_nudge', { p_sesh: seshId }).then((n) => say(n ? 'Checked on ' + n + (n === 1 ? ' mate.' : ' mates.') : 'Asked already. Try again in a bit.'),
      (e: { message?: string }) => say((e && e.message) || "Couldn't send that."));
  };
  return (
    <View style={styles.card} testID="home-safe">
      <View style={styles.row}>
        <Text style={styles.title}>🏠 Home safe?</Text>
        <Pressable style={[styles.btn, mine && styles.btnOn]} onPress={tick} disabled={busy} accessibilityRole="button"
          accessibilityState={{ selected: mine }} testID="home-safe-tick">
          <Text style={[styles.btnText, mine && styles.btnTextOn]}>{mine ? "✓ I'm home" : "I'm home safe"}</Text>
        </Pressable>
      </View>
      <Text style={styles.note} numberOfLines={2}>
        {members.filter((m) => safe.indexOf(m.id) >= 0).map((m) => '✓ ' + (m.id === myId ? 'You' : first(m.name))).join('   ') || 'Nobody has ticked yet.'}
      </Text>
      {waiting.length ? (
        <Pressable onPress={nudge} accessibilityRole="button" testID="home-safe-nudge">
          <Text style={styles.link}>Check on {waiting.length === 1 ? first(waiting[0].name) : waiting.length + ' mates'} who haven't ticked</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = themed(() => StyleSheet.create({
  card: { borderRadius: 18, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface, padding: 14, gap: 8 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  title: { color: C.fg, fontFamily: F.bodyBold, fontSize: 16 },
  btn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: C.on },
  btnOn: { backgroundColor: C.on },
  btnText: { color: C.on, fontFamily: F.bodyBold, fontSize: 14 },
  btnTextOn: { color: '#06140C' },
  note: { color: C.muted, fontFamily: F.body, fontSize: 13 },
  link: { color: C.thinking, fontFamily: F.bodyBold, fontSize: 13 }
}));
