// Emoji reactions on chat messages (Sarah, 2026-11-03): hold a message to pick one, tap a reaction under a message
// to add yours or take it off. One reaction each per message. Fun emojis only, never drinks (WA liquor rules).
// The same six are checked by the database (react_message, migration 0046).
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { C, F, fade, themed } from './theme';

export const REACTIONS = ['❤️', '😂', '🔥', '👍', '😮', '🙌'];

// The row of emojis that pops up over a message you hold.
export function ReactBar({ mine, onPick, onClose }: { mine?: string | null; onPick: (e: string) => void; onClose: () => void }) {
  return (
    <View style={styles.bar} testID="react-bar">
      {REACTIONS.map((e) => (
        <Pressable key={e} onPress={() => onPick(e)} style={[styles.pick, mine === e && styles.pickOn]}
          accessibilityRole="button" accessibilityState={{ selected: mine === e }} accessibilityLabel={'React ' + e} testID={'react-' + e}>
          <Text style={styles.pickText}>{e}</Text>
        </Pressable>
      ))}
      <Pressable onPress={onClose} style={styles.pick} accessibilityRole="button" accessibilityLabel="Close reactions">
        <Text style={styles.close}>✕</Text>
      </Pressable>
    </View>
  );
}

// The reactions under a message: each emoji with how many, yours outlined. Tap one to add or take off yours.
export function ReactChips({ counts, mine, right, onPick }: {
  counts: Record<string, number>; mine?: string | null; right?: boolean; onPick: (e: string) => void;
}) {
  const list = REACTIONS.filter((e) => counts[e] > 0);
  if (!list.length) return null;
  return (
    <View style={[styles.chips, right && styles.chipsRight]}>
      {list.map((e) => (
        <Pressable key={e} onPress={() => onPick(e)} style={[styles.chip, mine === e && styles.chipOn]}
          accessibilityRole="button" accessibilityLabel={e + ' ' + counts[e] + (mine === e ? ', yours. Tap to take it off' : '. Tap to add yours')}>
          <Text style={styles.chipText}>{e}{counts[e] > 1 ? ' ' + counts[e] : ''}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = themed(() => StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', gap: 2, alignSelf: 'flex-start', paddingHorizontal: 6, paddingVertical: 4, borderRadius: 24,
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.line, marginTop: 4 },
  pick: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  pickOn: { backgroundColor: fade(C.on, 0.2) },
  pickText: { fontSize: 22 },
  close: { fontFamily: F.bodyBold, fontSize: 14, color: C.muted },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 4 },
  chipsRight: { justifyContent: 'flex-end' },
  chip: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 12, backgroundColor: C.surface, borderWidth: 1, borderColor: C.line },
  chipOn: { borderColor: C.on, backgroundColor: fade(C.on, 0.15) },
  chipText: { fontFamily: F.bodyBold, fontSize: 13, color: C.fg }
}));
