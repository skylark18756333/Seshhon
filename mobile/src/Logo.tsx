// The Crewzy name in neon, with the speech bubble of three status lights beside it (see tools/live/icon.html).
// Signed in, the bubble is the status switch: tap a light to change your status from the top of any screen.
import React, { useEffect, useRef } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import type { Colour } from './api';
import { C, COLOURS, F, LABELS, themed } from './theme';

// Red, amber, green from left to right, the same way round as the big switch on Home.
const LIGHTS: Colour[] = ['off', 'thinking', 'on'];
const SLOT = 24;   // the width of one light

export default function Logo({ status, onPick, onHome }: { status?: Colour; onPick?: (c: Colour) => void; onHome?: () => void }) {
  // The lit light slides to the one you pick, and the bubble's outline and glow take that colour.
  const at = Math.max(0, LIGHTS.indexOf(status as Colour));
  const slide = useRef(new Animated.Value(at)).current;
  useEffect(() => {
    Animated.spring(slide, { toValue: at, useNativeDriver: true, friction: 6, tension: 120 }).start();
  }, [at, slide]);
  const mode = status ? COLOURS[status] : '#fff';
  return (
    <View style={styles.logo}>
      {onHome ? (
        <Pressable onPress={onHome} accessibilityRole="button" accessibilityLabel="Home" testID="logo-home">
          <Text style={styles.wordmark}>crewzy</Text>
        </Pressable>
      ) : <Text style={styles.wordmark}>crewzy</Text>}
      <View style={[styles.bubble, { borderColor: mode, shadowColor: mode }]}>
        {status ? (
          <Animated.View pointerEvents="none" style={[styles.knob, { transform: [{ translateX: slide.interpolate({ inputRange: [0, 1, 2], outputRange: [0, SLOT, SLOT * 2] }) }] }]}>
            <View style={[styles.ring, { borderColor: mode }]} />
            <View style={[styles.dot, styles.dotLit, { backgroundColor: mode, shadowColor: mode }]} />
          </Animated.View>
        ) : null}
        {LIGHTS.map((k) => {
          const lit = k === status;
          const light = (
            <View style={styles.slot}>
              {lit ? null : <View style={[styles.dot, { backgroundColor: COLOURS[k], shadowColor: COLOURS[k] }]} />}
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

const styles = themed(() => StyleSheet.create({
  logo: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  // The glow around the letters: one soft white halo, as close as a phone gets to the web page's three shadows.
  wordmark: { fontFamily: F.neon, fontSize: 32, lineHeight: 38, color: C.logo, textShadowColor: C.logoGlow, textShadowRadius: 12, textShadowOffset: { width: 0, height: 0 } },
  // The neon speech bubble: white outline, one corner nipped in like a tail.
  bubble: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 3,
    borderWidth: 2, borderColor: C.logo, backgroundColor: C.bubbleBg,
    borderTopLeftRadius: 16, borderTopRightRadius: 16, borderBottomRightRadius: 16, borderBottomLeftRadius: 5,
    shadowColor: C.logo, shadowOpacity: 0.55, shadowRadius: 8, shadowOffset: { width: 0, height: 0 }
  },
  slot: { width: SLOT, height: 30, alignItems: 'center', justifyContent: 'center' },
  // The lit light sits in the first slot and slides along to the others.
  knob: { position: 'absolute', left: 3, top: 0, bottom: 0, width: SLOT, alignItems: 'center', justifyContent: 'center' },
  dot: { width: 10, height: 10, borderRadius: 5, shadowOpacity: 0.9, shadowRadius: 6, shadowOffset: { width: 0, height: 0 } },
  dotLit: { width: 14, height: 14, borderRadius: 7 },
  // Your own light is the bigger one, with a ring of its colour around it.
  ring: { position: 'absolute', width: 23, height: 23, borderRadius: 12, borderWidth: 3, backgroundColor: C.dark ? C.bg : C.bubbleBg }
}));
