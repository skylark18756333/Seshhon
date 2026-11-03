// The Crewzy logo at the top: a rounded "Cr" (big C, small r) with the three status lights trailing after it, red, amber and green
// from left to right (the app icon is the three lights on their own, see tools/live/phone-icons.mjs).
// Signed in, your own light is lit and glows, and the other two are dimmed. Tapping a light changes your status.
import React, { useEffect, useRef } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import type { Colour } from './api';
import { C, COLOURS, F, LABELS, themed } from './theme';

const LIGHTS: Colour[] = ['off', 'thinking', 'on'];

function Light({ c, status, onPick }: { c: Colour; status?: Colour; onPick?: (c: Colour) => void }) {
  const lit = !status || c === status;
  const grow = useRef(new Animated.Value(c === status ? 1 : 0)).current;
  useEffect(() => {
    Animated.spring(grow, { toValue: c === status ? 1 : 0, useNativeDriver: true, friction: 6, tension: 120 }).start();
  }, [c, status, grow]);
  const dot = (
    <View style={styles.slot}>
      <Animated.View style={[styles.dot, { backgroundColor: COLOURS[c], shadowColor: COLOURS[c], opacity: lit ? 1 : 0.4 },
        c === status && styles.glow, { transform: [{ scale: grow.interpolate({ inputRange: [0, 1], outputRange: [1, 1.35] }) }] }]} />
    </View>
  );
  if (!onPick) return dot;
  return (
    <Pressable onPress={() => onPick(c)} accessibilityRole="button" accessibilityState={{ selected: c === status }}
      accessibilityLabel={'Switch to ' + LABELS[c]} hitSlop={6}>
      {dot}
    </Pressable>
  );
}

export default function Logo({ status, onPick, onHome }: { status?: Colour; onPick?: (c: Colour) => void; onHome?: () => void }) {
  const word = <Text style={styles.word} accessibilityLabel="Crewzy">C<Text style={styles.small}>r</Text></Text>;
  return (
    <View style={styles.logo}>
      {onHome ? (
        <Pressable onPress={onHome} accessibilityRole="button" accessibilityLabel="Crewzy, Home" testID="logo-home">{word}</Pressable>
      ) : word}
      <View style={styles.lights}>
        {LIGHTS.map((c) => <Light key={c} c={c} status={status} onPick={onPick} />)}
      </View>
    </View>
  );
}

const styles = themed(() => StyleSheet.create({
  logo: { flexDirection: 'row', alignItems: 'flex-end', gap: 4 },
  word: { fontFamily: F.logo, fontSize: 46, lineHeight: 48, letterSpacing: -1, color: C.logo, includeFontPadding: false },
  small: { fontSize: 28 },
  lights: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  slot: { width: 17, height: 17, alignItems: 'center', justifyContent: 'center' },
  dot: { width: 10, height: 10, borderRadius: 5 },
  glow: { shadowOpacity: 0.95, shadowRadius: 7, shadowOffset: { width: 0, height: 0 } }
}));
