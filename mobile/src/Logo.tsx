// The Frendzy name in neon, with the speech bubble of three status lights beside it (see tools/live/icon.html).
// Signed in, the bubble is the status switch: tap a light or slide the lit one along to change your status from the top of any screen.
import React, { useEffect, useRef } from 'react';
import { Animated, PanResponder, StyleSheet, Text, View } from 'react-native';
import type { Colour } from './api';
import { C, COLOURS, F, LABELS, STOPS, themed } from './theme';

const SLOT = 32;   // the width of one light
const PAD = 3;     // the bubble's padding either side

export default function Logo({ status, onPick }: { status?: Colour; onPick?: (c: Colour) => void }) {
  // The lit light slides to the one you pick, and the bubble's outline and glow take that colour.
  const at = Math.max(0, STOPS.indexOf(status as Colour));
  const slide = useRef(new Animated.Value(at)).current;
  useEffect(() => {
    Animated.spring(slide, { toValue: at, useNativeDriver: true, friction: 6, tension: 120 }).start();
  }, [at, slide]);
  const mode = status ? COLOURS[status] : '#fff';
  // One touch area over the whole bubble: a tap picks the light under the finger, and sliding moves the switch.
  const last = useRef(status);
  const pick = useRef(onPick);
  last.current = status; pick.current = onPick;
  const pan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => !!pick.current,
    onMoveShouldSetPanResponder: () => !!pick.current,
    onPanResponderGrant: (e) => choose(e.nativeEvent.locationX),
    onPanResponderMove: (e) => choose(e.nativeEvent.locationX),
  })).current;
  function choose(x: number) {
    const i = Math.max(0, Math.min(STOPS.length - 1, Math.floor((x - PAD) / SLOT)));
    if (STOPS[i] !== last.current && pick.current) { last.current = STOPS[i]; pick.current(STOPS[i]); }
  }
  return (
    <View style={styles.logo}>
      <Text style={styles.wordmark}>frendzy</Text>
      <View style={[styles.bubble, { borderColor: mode, shadowColor: mode }]}>
        {status ? (
          <Animated.View pointerEvents="none" style={[styles.knob, { transform: [{ translateX: slide.interpolate({ inputRange: [0, 1, 2], outputRange: [0, SLOT, SLOT * 2] }) }] }]}>
            <View style={[styles.ring, { borderColor: mode }]} />
            <View style={[styles.dot, styles.dotLit, { backgroundColor: mode, shadowColor: mode }]} />
          </Animated.View>
        ) : null}
        {STOPS.map((k) => (
          <View key={k} style={styles.slot}>
            {k === status ? null : <View style={[styles.dot, { backgroundColor: COLOURS[k], shadowColor: COLOURS[k] }]} />}
          </View>
        ))}
        {onPick ? (
          <View
            {...pan.panHandlers}
            style={styles.touch}
            accessible
            accessibilityRole="adjustable"
            accessibilityLabel={'Status: ' + (status ? LABELS[status] : '')}
            accessibilityHint="Tap a light or slide to switch between Green, Amber and Red"
          />
        ) : null}
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
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: PAD,
    borderWidth: 2, borderColor: C.logo, backgroundColor: C.bubbleBg,
    borderTopLeftRadius: 16, borderTopRightRadius: 16, borderBottomRightRadius: 16, borderBottomLeftRadius: 5,
    shadowColor: C.logo, shadowOpacity: 0.55, shadowRadius: 8, shadowOffset: { width: 0, height: 0 }
  },
  slot: { width: SLOT, height: 36, alignItems: 'center', justifyContent: 'center' },
  // The lit light sits in the first slot and slides along to the others.
  knob: { position: 'absolute', left: PAD, top: 0, bottom: 0, width: SLOT, alignItems: 'center', justifyContent: 'center' },
  touch: { position: 'absolute', left: -6, right: -6, top: -6, bottom: -6 },
  dot: { width: 10, height: 10, borderRadius: 5, shadowOpacity: 0.9, shadowRadius: 6, shadowOffset: { width: 0, height: 0 } },
  dotLit: { width: 14, height: 14, borderRadius: 7 },
  // Your own light is the bigger one, with a ring of its colour around it.
  ring: { position: 'absolute', width: 23, height: 23, borderRadius: 12, borderWidth: 3, backgroundColor: C.dark ? C.bg : C.bubbleBg }
}));
