// The Frendzy name in neon, with the speech bubble of three status lights beside it (see tools/live/icon.html).
// Signed in, the bubble is the status switch: tap a light to change your status from the top of any screen.
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { Colour } from './api';
import { C, COLOURS, F, LABELS, STOPS } from './theme';

export default function Logo({ status, onPick }: { status?: Colour; onPick?: (c: Colour) => void }) {
  return (
    <View style={styles.logo}>
      <Text style={styles.wordmark}>frendzy</Text>
      <View style={styles.bubble}>
        {STOPS.map((k) => {
          const lit = k === status;
          const light = (
            <View style={styles.slot}>
              {lit ? <View style={[styles.ring, { borderColor: COLOURS[k] }]} /> : null}
              <View style={[styles.dot, { backgroundColor: COLOURS[k], shadowColor: COLOURS[k] }, lit && styles.dotLit]} />
            </View>
          );
          if (!onPick) return <View key={k}>{light}</View>;
          return (
            <Pressable
              key={k}
              onPress={() => onPick(k)}
              accessibilityRole="button"
              accessibilityState={{ selected: lit }}
              accessibilityLabel={'Switch to ' + LABELS[k]}
            >
              {light}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  logo: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  // The glow around the letters: one soft white halo, as close as a phone gets to the web page's three shadows.
  wordmark: { fontFamily: F.neon, fontSize: 32, lineHeight: 38, color: '#fff', textShadowColor: 'rgba(255, 255, 255, 0.75)', textShadowRadius: 12, textShadowOffset: { width: 0, height: 0 } },
  // The neon speech bubble: white outline, one corner nipped in like a tail.
  bubble: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 3,
    borderWidth: 2, borderColor: '#fff', backgroundColor: 'rgba(5, 5, 6, 0.6)',
    borderTopLeftRadius: 16, borderTopRightRadius: 16, borderBottomRightRadius: 16, borderBottomLeftRadius: 5,
    shadowColor: '#fff', shadowOpacity: 0.55, shadowRadius: 8, shadowOffset: { width: 0, height: 0 }
  },
  slot: { width: 24, height: 30, alignItems: 'center', justifyContent: 'center' },
  dot: { width: 10, height: 10, borderRadius: 5, shadowOpacity: 0.9, shadowRadius: 6, shadowOffset: { width: 0, height: 0 } },
  dotLit: { width: 14, height: 14, borderRadius: 7 },
  // Your own light is the bigger one, with a ring of its colour around it.
  ring: { position: 'absolute', width: 23, height: 23, borderRadius: 12, borderWidth: 3, backgroundColor: C.bg }
});
