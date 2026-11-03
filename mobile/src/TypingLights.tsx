// The Crewzy speech bubble with its three lights, shown while a friend types in the sesh chat. The lights take
// turns lighting up, red, amber, green, round and round, and the bubble's outline glows in whichever is lit.
// It owns its Animated value, so the loop never stops because another view let go of a shared one.
import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import type { Colour } from './api';
import { C, COLOURS, themed } from './theme';

const LIGHTS: Colour[] = ['off', 'thinking', 'on'];
const STEP_MS = 420;

export default function TypingLights({ size = 1 }: { size?: number }) {
  const t = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.timing(t, { toValue: 3, duration: STEP_MS * 3, easing: Easing.linear, useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [t]);
  const ranges = useMemo(() => LIGHTS.map((_, i) => litFor(t, i)), [t]);
  return (
    <View style={[styles.bubble, { transform: [{ scale: size }] }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {LIGHTS.map((k, i) => (
        <Animated.View key={'o' + k} pointerEvents="none" style={[styles.outline, { borderColor: COLOURS[k], shadowColor: COLOURS[k], opacity: ranges[i] }]} />
      ))}
      {LIGHTS.map((k, i) => (
        <View key={k} style={styles.slot}>
          <View style={[styles.dot, { backgroundColor: COLOURS[k] }]} />
          <Animated.View style={[styles.glow, { backgroundColor: COLOURS[k], shadowColor: COLOURS[k], opacity: ranges[i],
            transform: [{ scale: ranges[i].interpolate({ inputRange: [0, 1], outputRange: [0.7, 1.25] }) }] }]} />
        </View>
      ))}
    </View>
  );
}

// Light i is on during step i of the three (0-1, 1-2, 2-3), with a quick fade at each end.
function litFor(t: Animated.Value, i: number) {
  const a = i, b = i + 1;
  const input = a === 0 ? [0, 0.12, 0.88, 1, 3] : b === 3 ? [0, a, a + 0.12, 2.88, 3] : [0, a, a + 0.12, b - 0.12, b, 3];
  const output = a === 0 ? [0.3, 1, 1, 0, 0] : b === 3 ? [0, 0, 1, 1, 0.3] : [0, 0, 1, 1, 0, 0];
  return t.interpolate({ inputRange: input, outputRange: output });
}

const styles = themed(() => StyleSheet.create({
  bubble: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingHorizontal: 9, paddingVertical: 7, borderRadius: 18, borderBottomLeftRadius: 6,
    borderWidth: 1.5, borderColor: C.line, backgroundColor: C.surface2 },
  outline: { position: 'absolute', top: -1.5, left: -1.5, right: -1.5, bottom: -1.5, borderRadius: 18, borderBottomLeftRadius: 6, borderWidth: 1.5,
    shadowOpacity: 0.9, shadowRadius: 8, shadowOffset: { width: 0, height: 0 } },
  slot: { width: 16, height: 16, alignItems: 'center', justifyContent: 'center' },
  dot: { position: 'absolute', width: 8, height: 8, borderRadius: 4, opacity: 0.35 },
  glow: { width: 11, height: 11, borderRadius: 6, shadowOpacity: 1, shadowRadius: 6, shadowOffset: { width: 0, height: 0 }, elevation: 4 }
}));
