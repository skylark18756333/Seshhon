// The browser build of the map, used only by the browser test (tools/live/native.mjs): react-native-maps can't draw a
// map on the web, so this lists the very same markers, circle and stops as text and buttons the test can read and tap.
import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { MapView } from './mapShared';
import { C, F } from './theme';

export default function NativeMap(p: MapView) {
  return (
    <View style={styles.box} testID="map-stub" accessibilityLabel="Map of venues (browser stand-in)">
      <Pressable testID="map-tap" onPress={() => p.onMapPress([-31.9523, 115.8613])} style={styles.tap} accessibilityRole="button" accessibilityLabel="Tap the map at the city centre">
        <Text style={styles.small}>Tap the map (city centre)</Text>
      </Pressable>
      <Text testID="map-circle" style={styles.small}>
        {p.chosen ? `circle ${p.radiusKm} km at ${p.centre[0].toFixed(4)},${p.centre[1].toFixed(4)}${p.mine ? ' (me)' : ''}` : 'no circle'}
      </Text>
      {p.chosen && p.mine ? <Text testID="map-me" style={styles.small}>Me: {p.meName}</Text> : null}
      <Text testID="map-route" style={styles.small}>{p.route.length >= 2 ? `route of ${p.route.length} stops` : 'no route'}</Text>
      <ScrollView contentContainerStyle={styles.list}>
        {p.markers.map((m) => (
          <Pressable key={m.id} testID={'marker-' + m.id} onPress={() => p.onPick(m.id)} accessibilityRole="button" accessibilityLabel={m.name}
            style={[styles.marker, m.kind === 'goal' && styles.goal, m.stop ? styles.stop : null, m.busy ? { borderColor: C.off } : null]}>
            <Text style={styles.name}>{m.stop ? m.stop.n + '. ' : ''}{m.name}</Text>
            <Text style={styles.small}>
              {[m.kind, m.glyph, m.tag, m.busy ? 'busy-' + m.busy : '', m.open === null ? '' : m.open ? 'open' : 'shut', m.stop && m.stop.done ? 'done' : ''].filter(Boolean).join(' | ')}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { flex: 1, backgroundColor: '#1d2230', padding: 10, gap: 6, overflow: 'hidden' },
  tap: { alignSelf: 'flex-start', paddingVertical: 4, paddingHorizontal: 10, borderRadius: 12, borderWidth: 1, borderColor: C.line },
  list: { gap: 6 },
  marker: { padding: 8, borderRadius: 12, borderWidth: 2, borderColor: C.line, backgroundColor: C.surface },
  goal: { borderColor: '#FF4757' },
  stop: { backgroundColor: C.surface2 },
  name: { fontFamily: F.bodyBold, fontSize: 14, color: C.fg },
  small: { fontFamily: F.body, fontSize: 12, color: C.muted }
});
