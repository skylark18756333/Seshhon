// The latest news from the Crewzy team (sent from the Admin page), as a banner on Home until it ends or is closed.
// Closing it is remembered on this phone. An older database without announcements shows nothing.
import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { rpc } from './session';
import { C, F, fade, themed } from './theme';

type Ann = { id: string; title: string; body: string };
const KEY = 'crewzy-ann-closed';

export default function Announcement() {
  const [ann, setAnn] = useState<Ann | null>(null);
  useEffect(() => {
    let live = true;
    Promise.all([rpc('current_announcement').catch(() => null), AsyncStorage.getItem(KEY).catch(() => null)]).then(([a, closed]: any[]) => {
      if (live && a && a.id && a.id !== closed) setAnn(a);
    });
    return () => { live = false; };
  }, []);
  if (!ann) return null;
  const close = () => { AsyncStorage.setItem(KEY, ann.id).catch(() => {}); setAnn(null); };
  return (
    <View style={styles.box} accessibilityRole="summary">
      <View style={styles.grow}>
        <Text style={styles.title}>{ann.title}</Text>
        <Text style={styles.body}>{ann.body}</Text>
      </View>
      <Pressable onPress={close} accessibilityRole="button" accessibilityLabel="Close the announcement" hitSlop={10} style={styles.x}>
        <Text style={styles.xText}>✕</Text>
      </Pressable>
    </View>
  );
}

const styles = themed(() => StyleSheet.create({
  box: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, padding: 14, borderRadius: 16, borderWidth: 1, borderColor: C.accent, backgroundColor: fade(C.accent, 0.12) },
  grow: { flex: 1, gap: 2 },
  title: { color: C.fg, fontFamily: F.bodyBold, fontSize: 15 },
  body: { color: C.fg, fontFamily: F.body, fontSize: 14 },
  x: { padding: 4 },
  xText: { color: C.muted, fontSize: 16 }
}));
