// Swipe left or right on the Home page to move to the next or last tab (Home, Map, Events). It only fires on a clear,
// long, mostly sideways drag, so scrolling, the friends row and the status switch keep working, and nothing starts
// from the screen edge (that is Android's own back gesture). The map and the web screens don't use it, so panning
// and scrolling there are never taken over; use the tab bar for those.
import React, { useRef } from 'react';
import { PanResponder, StyleSheet, View } from 'react-native';

const ORDER = ['home', 'map', 'events'];

export default function Swipe({ tab, onPick, children }: { tab: string; onPick: (tab: string) => void; children: React.ReactNode }) {
  const live = useRef({ tab, onPick });
  live.current = { tab, onPick };
  const pan = useRef(PanResponder.create({
    onMoveShouldSetPanResponder: (_e, g) => live.current.tab === 'home' && Math.abs(g.dx) > 30 && Math.abs(g.dx) > Math.abs(g.dy) * 3,
    onPanResponderTerminationRequest: () => true,
    onPanResponderRelease: (_e, g) => {
      const { tab: t, onPick: pick } = live.current;
      const at = ORDER.indexOf(t);
      if (at < 0 || t !== 'home' || Math.abs(g.dx) < 90 || Math.abs(g.dx) < Math.abs(g.dy) * 3) return;
      const next = ORDER[at + (g.dx < 0 ? 1 : -1)];
      if (next) pick(next);
    }
  })).current;
  return <View style={styles.fill} {...pan.panHandlers}>{children}</View>;
}

const styles = StyleSheet.create({ fill: { flex: 1 } });
