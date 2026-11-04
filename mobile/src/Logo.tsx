// The Crewzy logo at the top: the whole word "Crewzy" in Syne ExtraBold, with the three status lights sitting above "ewzy",
// red, amber and green from left to right (Sarah picked this look on 2026-11-04; the app icon is still the three lights on their
// own, see tools/live/phone-icons.mjs). Signed in, your own light is lit and glows, and the other two are dimmed. Tapping a light
// changes your status; tapping the word goes Home.
import React, { useEffect, useRef } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import type { Colour } from './api';
import { C, COLOURS, F, LABELS, themed } from './theme';

const LIGHTS: Colour[] = ['off', 'thinking', 'on'];

function Light({ c, status, onPick }: { c: Colour; status?: Colour; onPick?: (c: Colour) => void }) {
  const lit = !status || c === status;
  const grow = useRef(new Animated.Value(c === status ? 1 : 0)).current;
  useEffect(() => {
    Animated.spring(grow, { toValue: c === status ? 1 : 0, useNativeDriver: false, friction: 6, tension: 120 }).start();
  }, [c, status, grow]);
  const dot = (
    <View style={styles.slot}>
      <Animated.View style={[styles.dot, { backgroundColor: COLOURS[c], shadowColor: COLOURS[c], opacity: lit ? 1 : 0.4 },
        c === status && styles.glow, { transform: [{ scale: grow.interpolate({ inputRange: [0, 1], outputRange: [1, 1.3] }) }] }]} />
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
  const head = <Text style={styles.word} accessibilityLabel="Crewzy">Cr</Text>;
  const tail = <Text style={styles.word} accessibilityElementsHidden importantForAccessibility="no">ewzy</Text>;
  return (
    <View style={styles.logo}>
      {onHome ? (
        <Pressable onPress={onHome} accessibilityRole="button" accessibilityLabel="Crewzy, Home" testID="logo-home">{head}</Pressable>
      ) : head}
      <View style={styles.tail}>
        <View style={styles.lights}>
          {LIGHTS.map((c) => <Light key={c} c={c} status={status} onPick={onPick} />)}
        </View>
        {onHome ? <Pressable onPress={onHome} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">{tail}</Pressable> : tail}
      </View>
    </View>
  );
}

const styles = themed(() => StyleSheet.create({
  logo: { flexDirection: 'row', alignItems: 'flex-end', paddingTop: 12 },
  word: { fontFamily: F.logo, fontSize: 30, lineHeight: 34, letterSpacing: -0.6, color: C.logo, includeFontPadding: false,
    textShadowColor: C.logoGlow, textShadowRadius: 10, textShadowOffset: { width: 0, height: 0 } },
  tail: { position: 'relative' },
  lights: { position: 'absolute', left: 0, right: 0, top: -12, zIndex: 2, flexDirection: 'row', justifyContent: 'center', gap: 1 },
  slot: { width: 16, height: 16, alignItems: 'center', justifyContent: 'center' },
  dot: { width: 12, height: 12, borderRadius: 6 },
  glow: { shadowOpacity: 0.95, shadowRadius: 7, shadowOffset: { width: 0, height: 0 }, elevation: 4 }
}));
