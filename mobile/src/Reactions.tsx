// Emoji reactions on chat messages (Sarah, 2026-11-03): hold a message and a small bar pops up just above it, like
// Messenger. Tap one of the six, or + to pick any emoji from your phone's keyboard. One reaction each per message;
// tap a reaction under a message to add yours or take it off. Never drinks (WA liquor rules): the quick six are fun ones.
// The database checks a reaction is a short emoji (react_message, migrations 0046 and 0047).
import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { C, F, fade, themed } from './theme';

export const REACTIONS = ['❤️', '😂', '🔥', '👍', '😮', '🙌'];

// Keeps only an emoji typed on the phone's keyboard: no letters, numbers or spaces, and short (one emoji, maybe with
// a skin tone or a joined family). Returns '' for anything else.
export function cleanEmoji(text: string): string {
  const t = text.trim();
  if (!t || t.length > 16 || /[A-Za-z0-9\s]/.test(t) || /^[\x20-\x7E]+$/.test(t)) return '';
  return t;
}

// The bar that pops up above a message you hold.
export function ReactBar({ mine, right, onPick, onClose }: { mine?: string | null; right?: boolean; onPick: (e: string) => void; onClose: () => void }) {
  const [typing, setTyping] = useState(false);
  const [bad, setBad] = useState(false);
  return (
    <View style={[styles.bar, right && styles.barRight]} testID="react-bar">
      {typing ? (
        <View style={styles.typeRow}>
          <TextInput
            style={styles.typeBox}
            autoFocus
            placeholder={bad ? 'Emojis only' : 'Any emoji'}
            placeholderTextColor={bad ? C.off : C.muted}
            onChangeText={(t) => {
              const e = cleanEmoji(t);
              if (e) onPick(e); else if (t.trim()) setBad(true);
            }}
            onBlur={onClose}
            maxLength={16}
            accessibilityLabel="Pick any emoji from your keyboard"
            testID="react-any-input"
          />
        </View>
      ) : (
        <>
          {REACTIONS.map((e) => (
            <Pressable key={e} onPress={() => onPick(e)} style={[styles.pick, mine === e && styles.pickOn]} hitSlop={2}
              accessibilityRole="button" accessibilityState={{ selected: mine === e }} accessibilityLabel={'React ' + e} testID={'react-' + e}>
              <Text style={styles.pickText}>{e}</Text>
            </Pressable>
          ))}
          <Pressable onPress={() => setTyping(true)} style={[styles.pick, styles.plus]} accessibilityRole="button"
            accessibilityLabel="Pick any emoji from your keyboard" testID="react-any">
            <Text style={styles.plusText}>+</Text>
          </Pressable>
        </>
      )}
    </View>
  );
}

// The reactions under a message: each emoji with how many, yours outlined. Tap one to add or take off yours.
export function ReactChips({ counts, mine, right, onPick }: {
  counts: Record<string, number>; mine?: string | null; right?: boolean; onPick: (e: string) => void;
}) {
  const list = Object.keys(counts).filter((e) => counts[e] > 0).sort((a, b) => counts[b] - counts[a]);
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
  // A small floating pill with a shadow, sitting just above the message it belongs to.
  bar: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', paddingHorizontal: 4, paddingVertical: 2, borderRadius: 22,
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.line, marginBottom: 4,
    shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 6 },
  barRight: { alignSelf: 'flex-end' },
  pick: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  pickOn: { backgroundColor: fade(C.on, 0.2) },
  pickText: { fontSize: 22 },
  plus: { backgroundColor: fade(C.fg, 0.08) },
  plusText: { fontFamily: F.bodyBold, fontSize: 20, color: C.fg, marginTop: -2 },
  typeRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 6 },
  typeBox: { minWidth: 150, height: 36, fontSize: 20, color: C.fg, fontFamily: F.body, paddingVertical: 0 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 4 },
  chipsRight: { justifyContent: 'flex-end' },
  chip: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 12, backgroundColor: C.surface, borderWidth: 1, borderColor: C.line },
  chipOn: { borderColor: C.on, backgroundColor: fade(C.on, 0.15) },
  chipText: { fontFamily: F.bodyBold, fontSize: 13, color: C.fg }
}));
