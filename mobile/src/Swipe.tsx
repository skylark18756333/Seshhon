// Swipe left or right to move between Home, Sesh, Map and Events. On the native screens (Home, Sesh) a swipe anywhere
// works; on the map and the packed web screens it only starts from the very edge of the screen, so panning the map
// and scrolling the pages keep working.
import React, { useRef } from 'react';
import { PanResponder, StyleSheet, View, useWindowDimensions } from 'react-native';

const ORDER = ['home', 'sesh', 'map', 'events'];
const EDGE = 28;

export default function Swipe({ tab, onPick, children }: { tab: string; onPick: (tab: string) => void; children: React.ReactNode }) {
  const { width } = useWindowDimensions();
  const live = useRef({ tab, onPick, width });
  live.current = { tab, onPick, width };
  const pan = useRef(PanResponder.create({
    // Taking a touch from the edge, before anything under it does.
    onStartShouldSetPanResponderCapture: (e) => {
      const { tab: t, width: w } = live.current;
      const x = e.nativeEvent.pageX;
      return ORDER.indexOf(t) >= 0 && (x < EDGE || x > w - EDGE);
    },
    // A sideways drag nothing else wanted (not a vertical scroll, not a text field).
    onMoveShouldSetPanResponder: (_e, g) => {
      const t = live.current.tab;
      return (t === 'home' || t === 'sesh') && Math.abs(g.dx) > 18 && Math.abs(g.dx) > Math.abs(g.dy) * 2;
    },
    onPanResponderTerminationRequest: () => false,
    onPanResponderRelease: (_e, g) => {
      const { tab: t, onPick: pick } = live.current;
      const at = ORDER.indexOf(t);
      if (at < 0 || Math.abs(g.dx) < 60 || Math.abs(g.dx) < Math.abs(g.dy) * 1.5) return;
      const next = ORDER[at + (g.dx < 0 ? 1 : -1)];
      if (next) pick(next);
    }
  })).current;
  return <View style={styles.fill} {...pan.panHandlers}>{children}</View>;
}

const styles = StyleSheet.create({ fill: { flex: 1 } });
