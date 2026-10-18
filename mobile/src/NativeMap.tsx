// The Map tab's map on the phone: Google Maps (react-native-maps) with the web map's look. Venue bubbles are plain
// Views (a round icon, the venue's name, a tag like "Top pick", a glow where it is busy), with no shadows and no
// gradients, so they draw the same on every Android phone. Markers stop tracking view changes once drawn; a bubble
// that changes (busy, open, picked) gets a new key and is drawn again.
import React, { useEffect, useRef, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import RNMapView, { Circle, Marker, Polyline, PROVIDER_GOOGLE, type Region } from 'react-native-maps';
import Icon from './Icon';
import type { LatLng, MapMarker, MapView } from './mapShared';
import { C, F, fade, themed, useLook } from './theme';

const BLUE = '#1F7BFF', GOAL = '#FF4757', FAR = '#8A90A0', HEAT = '#FF7A1A';
const GLOW_SIZE = [0, 62, 80, 104];   // busy 0..3: the glow behind a bubble grows with how many are heading there
const NAMES_BELOW_DELTA = 0.02;       // about zoom 15 and closer, as the web map's "names" class

// A dark map to match the app (Google's own style JSON; only used with the Google provider).
const DARK_STYLE = [
  { elementType: 'geometry', stylers: [{ color: '#14161c' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#8a90a0' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#14161c' }] },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#262a33' }] },
  { featureType: 'road', elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0b0d12' }] }
];

// The same, for the light look: pale ground, no clutter.
const LIGHT_STYLE = [
  { elementType: 'geometry', stylers: [{ color: '#ECE9E3' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#6B6B73' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#F4F2EE' }] },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#FFFFFF' }] },
  { featureType: 'road', elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#CFE0F0' }] }
];

function Bubble({ m }: { m: MapMarker }) {
  const colour = m.kind === 'goal' ? GOAL : m.kind === 'far' ? FAR : BLUE;
  if (m.stop) {
    return (
      <View style={styles.cell}>
        <View style={[styles.stop, m.stop.done && styles.stopDone]}>
          {m.stop.done ? <Icon name="tick" size={16} colour={C.muted} /> : <Text style={styles.stopText}>{m.stop.n}</Text>}
        </View>
        {m.names || m.kind === 'goal' ? <Text style={styles.name} numberOfLines={1}>{m.name}</Text> : null}
      </View>
    );
  }
  const glow = GLOW_SIZE[Math.min(3, m.busy)];
  return (
    <View style={styles.cell}>
      {glow ? <View style={[styles.glow, { top: TOP + DISC / 2 - glow / 2, left: CELL_W / 2 - glow / 2, width: glow, height: glow, borderRadius: glow / 2, backgroundColor: fade(HEAT, 0.28 + 0.08 * m.busy) }]} /> : null}
      <View style={styles.top}>{m.tag && m.kind !== 'far' ? <Text style={styles.tag} numberOfLines={1}>{m.tag}</Text> : null}</View>
      <View style={[styles.disc, { borderColor: colour }]}>
        <Icon name={m.glyph} size={20} colour={C.ink} />
        {m.open !== null ? <View style={[styles.badge, { backgroundColor: m.open ? C.on : C.off }]} /> : null}
      </View>
      <View style={styles.bottom}>{m.names || m.kind === 'goal' || m.busy ? <Text style={styles.name} numberOfLines={1}>{m.name}</Text> : null}</View>
    </View>
  );
}

function SpotMark({ mine, name }: { mine: boolean; name: string }) {
  if (!mine) return <View style={styles.youOuter}><View style={styles.youDot} /></View>;
  return (
    <View style={styles.cell}>
      <View style={styles.top} />
      <View style={styles.me}><Text style={styles.meText}>{(name || 'Me').trim().charAt(0).toUpperCase()}</Text></View>
      <View style={styles.bottom}><Text style={styles.meLabel}>Me</Text></View>
    </View>
  );
}

// A custom marker has to be drawn once before the map can freeze it into a picture; frozen straight away, Android
// shows a bare default pin. So it tracks its view for a moment, then stops (which keeps 60 of them fast).
function Pin({ children, ...rest }: React.ComponentProps<typeof Marker>) {
  const [track, setTrack] = useState(true);
  useEffect(() => { const t = setTimeout(() => setTrack(false), 800); return () => clearTimeout(t); }, []);
  return <Marker {...rest} tracksViewChanges={track}>{children}</Marker>;
}

const edge = { top: 60, right: 40, bottom: 60, left: 40 };

export default function NativeMap(p: MapView) {
  const map = useRef<RNMapView>(null);
  const names = useRef<boolean | null>(null);
  const first = useRef(true);
  const look = useLook();   // markers are drawn once and frozen, so a new look draws them again

  // Move to show the circle or the search hits when the screen asks for it.
  useEffect(() => {
    if (!p.fit.coords.length) return;
    const t = setTimeout(() => {
      if (!map.current) return;
      if (p.fit.coords.length === 1) {
        map.current.animateToRegion({ latitude: p.fit.coords[0][0], longitude: p.fit.coords[0][1], latitudeDelta: 0.008, longitudeDelta: 0.008 }, first.current ? 0 : 300);
      } else {
        map.current.fitToCoordinates(p.fit.coords.map((c) => ({ latitude: c[0], longitude: c[1] })), { edgePadding: edge, animated: !first.current });
      }
      first.current = false;
    }, 50);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.fit.key]);

  // A venue picked from the list: bring it into view without zooming out.
  useEffect(() => {
    if (!p.focus || !map.current) return;
    map.current.animateCamera({ center: { latitude: p.focus.at[0], longitude: p.focus.at[1] } }, { duration: 250 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.focus && p.focus.key]);

  const onRegion = (r: Region) => {
    const near = r.latitudeDelta < NAMES_BELOW_DELTA;
    if (names.current !== near) { names.current = near; p.onZoom(near); }
  };

  return (
    <RNMapView
      ref={map}
      style={styles.map}
      provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined}
      customMapStyle={Platform.OS === 'android' ? (C.dark ? DARK_STYLE : LIGHT_STYLE) : undefined}
      initialRegion={{ latitude: p.centre[0], longitude: p.centre[1], latitudeDelta: 0.12, longitudeDelta: 0.12 }}
      onPress={(e) => { const c = e.nativeEvent.coordinate; p.onMapPress([c.latitude, c.longitude]); }}
      onRegionChangeComplete={onRegion}
      rotateEnabled={false}
      pitchEnabled={false}
      toolbarEnabled={false}
      showsUserLocation={false}
      showsMyLocationButton={false}
      showsCompass={false}
      accessibilityLabel="Map of venues"
    >
      {p.chosen ? (
        // Keyed on the radius and spot: on Android a Circle given a new radius keeps drawing the old one.
        <Circle key={'circle-' + p.radiusKm + '-' + p.centre.join(',')} center={{ latitude: p.centre[0], longitude: p.centre[1] }} radius={p.radiusKm * 1000} strokeColor={BLUE} strokeWidth={2} fillColor={fade(BLUE, 0.1)} lineDashPattern={[12, 10]} />
      ) : null}
      {p.route.length >= 2 ? (
        <Polyline coordinates={p.route.map((c) => ({ latitude: c[0], longitude: c[1] }))} strokeColor={BLUE} strokeWidth={4} lineDashPattern={[1, 10]} lineCap="round" />
      ) : null}
      {p.chosen ? (
        <Pin key={'spot-' + look + p.mine} coordinate={{ latitude: p.centre[0], longitude: p.centre[1] }} anchor={{ x: 0.5, y: 0.5 }} tappable={false} zIndex={1}>
          <SpotMark mine={p.mine} name={p.meName} />
        </Pin>
      ) : null}
      {p.markers.map((m) => (
        <Pin
          key={[look, m.id, m.kind, m.tag, m.busy, m.open, m.names, m.stop ? m.stop.n + (m.stop.done ? 'd' : '') : ''].join(':')}
          coordinate={{ latitude: m.at[0], longitude: m.at[1] }}
          anchor={{ x: 0.5, y: 0.5 }}
          title={m.name}
          zIndex={m.kind === 'goal' ? 1000 : m.stop ? 500 - m.stop.n : m.busy * 100 + (m.tag ? 50 : 0)}
          onPress={(e) => { e.stopPropagation(); p.onPick(m.id); }}
        >
          <Bubble m={m} />
        </Pin>
      ))}
    </RNMapView>
  );
}

const CELL_W = 116, TOP = 24, DISC = 40, BOTTOM = 24;
const styles = themed(() => StyleSheet.create({
  map: { flex: 1 },
  // The bubble is centred in a fixed box so the marker's anchor (0.5, 0.5) sits on the middle of the round icon.
  cell: { width: CELL_W, height: TOP + DISC + BOTTOM, alignItems: 'center' },
  glow: { position: 'absolute' },
  top: { height: TOP, justifyContent: 'flex-end', alignItems: 'center' },
  bottom: { height: BOTTOM, justifyContent: 'flex-start', alignItems: 'center' },
  tag: { fontFamily: F.bodyBold, fontSize: 10, color: C.ink, backgroundColor: '#FFE16A', paddingVertical: 1, paddingHorizontal: 6, borderRadius: 8, overflow: 'hidden', maxWidth: CELL_W },
  disc: { width: DISC, height: DISC, borderRadius: DISC / 2, backgroundColor: '#fff', borderWidth: 3, alignItems: 'center', justifyContent: 'center' },
  badge: { position: 'absolute', right: -2, bottom: -2, width: 12, height: 12, borderRadius: 6, borderWidth: 2, borderColor: '#fff' },
  name: { fontFamily: F.bodyBold, fontSize: 11, color: '#fff', backgroundColor: 'rgba(11, 11, 13, 0.78)', paddingVertical: 1, paddingHorizontal: 6, borderRadius: 8, overflow: 'hidden', maxWidth: CELL_W, marginTop: 2 },
  stop: { width: 34, height: 34, borderRadius: 17, backgroundColor: BLUE, borderWidth: 2, borderColor: '#fff', alignItems: 'center', justifyContent: 'center', marginTop: TOP + 3 },
  stopDone: { backgroundColor: C.surface2 },
  stopText: { fontFamily: F.display, fontSize: 15, color: '#fff' },
  youOuter: { width: 44, height: 44, borderRadius: 22, backgroundColor: fade(BLUE, 0.25), alignItems: 'center', justifyContent: 'center' },
  youDot: { width: 16, height: 16, borderRadius: 8, backgroundColor: BLUE, borderWidth: 3, borderColor: '#fff' },
  me: { width: DISC, height: DISC, borderRadius: DISC / 2, backgroundColor: C.on, borderWidth: 3, borderColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  meText: { fontFamily: F.display, fontSize: 16, color: C.ink },
  meLabel: { fontFamily: F.bodyBold, fontSize: 11, color: C.ink, backgroundColor: C.on, paddingVertical: 1, paddingHorizontal: 8, borderRadius: 8, overflow: 'hidden' }
}));

export type { LatLng };
