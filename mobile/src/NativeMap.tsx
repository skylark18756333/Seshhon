// The Map tab's map on the phone: Google Maps (react-native-maps) with the web map's look. Venue bubbles are plain
// Views (a round icon, the venue's name, a tag like "Top pick", a glow where it is busy), with no shadows and no
// gradients, so they draw the same on every Android phone. Markers stop tracking view changes once drawn; a bubble
// that changes (busy, open, picked) gets a new key and is drawn again.
import { mapOpening } from './mapCrash';
import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, Platform, StyleSheet, Text, View } from 'react-native';
import RNMapView, { Circle, Marker, Polyline, PROVIDER_GOOGLE, type Region } from 'react-native-maps';
import Icon from './Icon';
import type { LatLng, MapMarker, MapView } from './mapShared';
import { useShown } from './Shown';
import { C, F, fade, themed, useLook } from './theme';

const BLUE = '#1F7BFF', GOAL = '#FF4757', FAR = '#8A90A0', HEAT = '#FF7A1A', RADAR = '#3DDC84', GOLD = '#FFC53D';
const GLOW_SIZE = [0, 62, 80, 104];   // busy 0..3: the glow behind a bubble grows with how many are heading there
const NAMES_BELOW_DELTA = 0.02;       // about zoom 15 and closer, as the web map's "names" class
// From this radius up the map is zoomed out far enough that 30 full bubbles (a 116 x 88 box each, all of it tappable
// on Android) cover most of the screen, so a tap meant for the map opened a venue instead of dropping the pin. Out
// there a bubble is just its round icon in a small box, and the venue's name is on its card below the map.
const COMPACT_FROM_KM = 3;

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

function Bubble({ m, compact }: { m: MapMarker; compact: boolean }) {
  const colour = m.kind === 'goal' ? GOAL : m.kind === 'far' ? FAR : m.kind === 'mid' ? GOLD : BLUE;
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
  if (compact && m.kind !== 'goal') {
    const g = glow ? SMALL : 0;
    return (
      <View style={styles.small}>
        {g ? <View style={[styles.glow, { top: 0, left: 0, width: g, height: g, borderRadius: g / 2, backgroundColor: fade(HEAT, 0.28 + 0.08 * m.busy) }]} /> : null}
        <View style={[styles.disc, { borderColor: colour }]}>
          <Icon name={m.glyph} size={20} colour={C.ink} />
          {m.open !== null ? <View style={[styles.badge, { backgroundColor: m.open ? C.on : C.off }]} /> : null}
        </View>
      </View>
    );
  }
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
// sig: what the bubble shows. When it changes the same marker tracks again briefly to redraw its picture, instead of
// being thrown away and made again (remounting markers on Android was a likely cause of the map closing the app).
function Pin({ children, sig, ...rest }: React.ComponentProps<typeof Marker> & { sig?: string }) {
  const [track, setTrack] = useState(true);
  useEffect(() => { setTrack(true); const t = setTimeout(() => setTrack(false), 800); return () => clearTimeout(t); }, [sig]);
  return <Marker {...rest} tracksViewChanges={track}>{children}</Marker>;
}

// One venue on the map. Drawn again only when its own bubble changes, so the rest of the screen redrawing (a friend
// going green, the five-second refresh) never makes the map update all 60 markers at once.
const VenuePin = memo(function VenuePin({ m, sig, compact, onPick }: { m: MapMarker; sig: string; compact: boolean; onPick: (id: string) => void }) {
  const press = useCallback((e: { stopPropagation: () => void }) => { e.stopPropagation(); onPick(m.id); }, [m.id, onPick]);
  const coordinate = { latitude: m.at[0], longitude: m.at[1] };
  return (
    <Pin
      sig={sig}
      coordinate={coordinate}
      anchor={CENTRE}
      title={m.name}
      zIndex={m.kind === 'goal' ? 1000 : m.stop ? 500 - m.stop.n : m.busy * 100 + (m.tag ? 50 : 0)}
      onPress={press}
    >
      <Bubble m={m} compact={compact} />
    </Pin>
  );
}, (a, b) => a.sig === b.sig && a.compact === b.compact && a.onPick === b.onPick && a.m.id === b.m.id && a.m.at[0] === b.m.at[0] && a.m.at[1] === b.m.at[1] && a.m.name === b.m.name);
// (Everything else a bubble shows is in sig, so a change there redraws the same marker.)

/* ---------- the radar sweep (Map tab) ---------- */
// A green beam goes round the radius circle every few seconds, and each venue blips (a glowing ring that pops and
// fades) as the beam passes it. It is a see-through layer over the map: the map's own pins never change, so tapping
// stays easy and nothing on the map is redrawn. Everything moves on the native animation driver from one value, so
// the JS thread does no work per frame. The layer is worked out again only when the map stops moving, and hidden
// while it moves.
const SWEEP_MS = 4000, FAN = 9, FAN_DEG = 4.5, FADE = 0.65, BLIPS_MAX = 12, SETTLE_MS = 180;
type Px = { x: number; y: number };
type Blip = { id: string; x: number; y: number; at: number };   // at: where round the circle, 0 to 1 clockwise from east

// Opacity (or size) over one turn for a blip that the beam reaches at `at`: full when the beam passes, then fading.
function blipCurve(at: number, peak: number, rest: number) {
  const value = (t: number) => { const d = (t - at + 1) % 1; return d < FADE ? peak - (peak - rest) * (d / FADE) : rest; };
  const pts = new Set<number>([0, 1]);
  for (let i = 1; i < 12; i++) pts.add(i / 12);
  const just = Math.max(0, at - 0.002);
  pts.add(just); pts.add(at); pts.add(Math.min(1, (at + FADE) % 1));
  const input = Array.from(pts).sort((a, b) => a - b).filter((x, i, a) => i === 0 || x > a[i - 1]);
  return { inputRange: input, outputRange: input.map((t) => (t === just && just !== at ? rest : value(t))) };
}

// The radar owns its turning value and starts it when it appears. (A value shared with the map stopped for good
// the first time the map moved: hiding the layer detaches the value, and detaching an Animated value stops it.)
const Radar = memo(function Radar({ centre, r, blips, active }: { centre: Px; r: number; blips: Blip[]; active: boolean }) {
  const turn = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!active) return;
    const loop = Animated.loop(Animated.timing(turn, { toValue: 1, duration: SWEEP_MS, easing: Easing.linear, useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [active, turn]);
  // Made once (and once per set of blips), so a redraw never swaps the nodes the turning value drives.
  const spin = useMemo(() => turn.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }), [turn]);
  const anims = useMemo(() => blips.map((b) => ({ b, op: turn.interpolate(blipCurve(b.at, 1, 0.12)), sc: turn.interpolate(blipCurve(b.at, 1.5, 0.8)) })), []); // eslint-disable-line react-hooks/exhaustive-deps
  const box = { position: 'absolute' as const, left: centre.x - r, top: centre.y - r, width: r * 2, height: r * 2 };
  // Fades in once the map has settled, so it never pops in at the wrong place.
  const shownIn = useRef(new Animated.Value(0)).current;
  useEffect(() => { Animated.timing(shownIn, { toValue: 1, duration: 260, useNativeDriver: true }).start(); }, [shownIn]);
  return (
    <Animated.View style={[StyleSheet.absoluteFill, { opacity: shownIn }]} pointerEvents="none">
      <Animated.View style={[box, { transform: [{ rotate: spin }] }]}>
        {Array.from({ length: FAN }).map((_, i) => (
          // The beam's bright edge, then a fan of fainter lines trailing behind it.
          <View key={i} style={[StyleSheet.absoluteFill, { transform: [{ rotate: -i * FAN_DEG + 'deg' }] }]}>
            <View style={{ position: 'absolute', left: r, top: r - (i ? 1.5 : 1), width: r, height: i ? 3 : 2, borderRadius: 2,
              backgroundColor: i ? fade(RADAR, 0.32 * (1 - i / FAN)) : '#B8FFD6' }} />
          </View>
        ))}
      </Animated.View>
      {anims.map(({ b, op, sc }) => (
        <Animated.View key={b.id} style={[styles.blip, { left: b.x - BLIP / 2, top: b.y - BLIP / 2, opacity: op, transform: [{ scale: sc }] }]} />
      ))}
    </Animated.View>
  );
});

const CENTRE = { x: 0.5, y: 0.5 };
const edge = { top: 60, right: 40, bottom: 60, left: 40 };

// Memoised: the map is only touched when what it shows changes.
export default memo(NativeMap);
function NativeMap(p: MapView) {
  const map = useRef<RNMapView>(null);
  useEffect(() => mapOpening(), []);   // see mapCrash.ts: a phone whose map crashes the app gets the simple map
  const onPickRef = useRef(p.onPick); onPickRef.current = p.onPick;
  const onPick = useCallback((id: string) => onPickRef.current(id), []);
  const names = useRef<boolean | null>(null);
  const first = useRef(true);
  const look = useLook();   // markers are drawn once and frozen, so a new look draws them again

  // The radar layer: where the circle and the venues are on the screen, read when the map stops moving.
  const shown = useShown();
  const moving = useRef(false);
  const settle = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [geom, setGeom] = useState<{ key: string; c: Px; r: number; blips: Blip[] } | null>(null);
  const [calm, setCalm] = useState(false);   // the phone asks for less motion
  useEffect(() => { AccessibilityInfo.isReduceMotionEnabled().then(setCalm, () => {}); }, []);
  const radarOn = !!p.radar && p.chosen && !calm;
  // Only the first few venues blip (the busiest and nearest), and only when that set changes is anything read again.
  const blipKey = p.markers.filter((m) => m.kind === 'near' && !m.stop).slice(0, BLIPS_MAX).map((m) => m.id + '@' + m.at.join(',')).join('|');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const blipList = useMemo(() => p.markers.filter((m) => m.kind === 'near' && !m.stop).slice(0, BLIPS_MAX), [blipKey]);
  const measure = useCallback(async () => {
    const m = map.current;
    if (!m || !radarOn) return;
    try {
      const dLat = p.radiusKm / 111.2;
      const [c, e] = await Promise.all([
        m.pointForCoordinate({ latitude: p.centre[0], longitude: p.centre[1] }),
        m.pointForCoordinate({ latitude: p.centre[0] + dLat, longitude: p.centre[1] })
      ]);
      const r = Math.hypot(e.x - c.x, e.y - c.y);
      const pts = await Promise.all(blipList.map((b) => m.pointForCoordinate({ latitude: b.at[0], longitude: b.at[1] })));
      const blips = blipList.map((b, i) => {
        const a = Math.atan2(pts[i].y - c.y, pts[i].x - c.x);
        return { id: b.id, x: pts[i].x, y: pts[i].y, at: ((a / (2 * Math.PI)) + 1) % 1 };
      });
      if (!moving.current) setGeom({ key: [Math.round(c.x), Math.round(c.y), Math.round(r)].map(String).concat(blips.map((b) => b.id + Math.round(b.x) + ',' + Math.round(b.y))).join('|'), c, r, blips });   // a move that started meanwhile wins: it is read again when it stops
    } catch (err) { /* the map isn't ready yet: the next stop tries again */ }
  }, [radarOn, p.radiusKm, p.centre, blipList]);
  const measureSoon = useCallback(() => {
    if (settle.current) clearTimeout(settle.current);
    settle.current = setTimeout(() => { settle.current = null; if (!moving.current) measure(); }, SETTLE_MS);
  }, [measure]);
  useEffect(() => { measureSoon(); }, [measureSoon]);
  useEffect(() => () => { if (settle.current) clearTimeout(settle.current); }, []);

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

  const compact = p.radiusKm >= COMPACT_FROM_KM;
  const padding = useMemo(() => (p.pad ? { top: p.pad.top, bottom: p.pad.bottom, left: 0, right: 0 } : undefined), [p.pad]);
  const onRegion = (r: Region) => {
    const near = r.latitudeDelta < NAMES_BELOW_DELTA;
    if (names.current !== near) { names.current = near; p.onZoom(near); }
    moving.current = false;
    measureSoon();
  };
  // Hide the radar while the map moves (it would lag behind the map), once per move, not on every frame. It comes
  // back, fading in at the right place, a moment after the map stops.
  const onMove = () => { if (!moving.current) { moving.current = true; if (settle.current) { clearTimeout(settle.current); settle.current = null; } setGeom(null); } };

  return (
    <View style={styles.map}>
    <RNMapView
      ref={map}
      style={styles.map}
      provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined}
      customMapStyle={Platform.OS === 'android' ? (C.dark ? DARK_STYLE : LIGHT_STYLE) : undefined}
      initialRegion={{ latitude: p.centre[0], longitude: p.centre[1], latitudeDelta: 0.12, longitudeDelta: 0.12 }}
      // Sarah: a single tap shouldn't move your spot (too easy to do by accident). A double tap moves the pin there
      // (instead of zooming in), and so does a long press, even on top of a venue bubble. A single tap just closes
      // whatever card is open.
      onPress={() => { if (p.onMapTap) p.onMapTap(); }}
      onDoublePress={(e) => { const c = e.nativeEvent && e.nativeEvent.coordinate; if (c) p.onMapPress([c.latitude, c.longitude]); }}
      onLongPress={(e) => { const c = e.nativeEvent && e.nativeEvent.coordinate; if (c) p.onMapPress([c.latitude, c.longitude]); }}
      zoomTapEnabled={false}
      onRegionChangeComplete={onRegion}
      mapPadding={padding}
      onRegionChange={radarOn ? onMove : undefined}
      rotateEnabled={false}
      pitchEnabled={false}
      toolbarEnabled={false}
      showsUserLocation={false}
      showsMyLocationButton={false}
      showsCompass={false}
      accessibilityLabel="Map of venues"
    >
      {p.chosen && !p.radar ? (
        // Keyed on the radius and spot: on Android a Circle given a new radius keeps drawing the old one.
        <Circle key={'circle-' + p.radiusKm + '-' + p.centre.join(',')} center={{ latitude: p.centre[0], longitude: p.centre[1] }} radius={p.radiusKm * 1000} strokeColor={BLUE} strokeWidth={2} fillColor={fade(BLUE, 0.1)} lineDashPattern={[12, 10]} />
      ) : null}
      {p.chosen && p.radar ? [
        // The radar: a soft glow ring, the green edge, and two faint rings inside (all plain circles, cheap to draw).
        <Circle key={'glow-' + p.radiusKm + '-' + p.centre.join(',')} center={{ latitude: p.centre[0], longitude: p.centre[1] }} radius={p.radiusKm * 1000} strokeColor={fade(RADAR, 0.25)} strokeWidth={14} fillColor={fade(RADAR, 0.08)} />,
        <Circle key={'edge-' + p.radiusKm + '-' + p.centre.join(',')} center={{ latitude: p.centre[0], longitude: p.centre[1] }} radius={p.radiusKm * 1000} strokeColor={RADAR} strokeWidth={2.5} fillColor="transparent" />,
        <Circle key={'r2-' + p.radiusKm + '-' + p.centre.join(',')} center={{ latitude: p.centre[0], longitude: p.centre[1] }} radius={p.radiusKm * 667} strokeColor={fade(RADAR, 0.35)} strokeWidth={1} fillColor={fade(RADAR, 0.04)} />,
        <Circle key={'r1-' + p.radiusKm + '-' + p.centre.join(',')} center={{ latitude: p.centre[0], longitude: p.centre[1] }} radius={p.radiusKm * 333} strokeColor={fade(RADAR, 0.35)} strokeWidth={1} fillColor={fade(RADAR, 0.05)} />
      ] : null}
      {p.route.length >= 2 ? (
        <Polyline coordinates={p.route.map((c) => ({ latitude: c[0], longitude: c[1] }))} strokeColor={BLUE} strokeWidth={4} lineDashPattern={[1, 10]} lineCap="round" />
      ) : null}
      {p.chosen ? (
        <Pin key={'spot-' + look + p.mine} coordinate={{ latitude: p.centre[0], longitude: p.centre[1] }} anchor={{ x: 0.5, y: 0.5 }} tappable={false} zIndex={1}>
          <SpotMark mine={p.mine} name={p.meName} />
        </Pin>
      ) : null}
      {p.markers.map((m) => (
        <VenuePin
          // A marker whose picture changes size (the small zoomed-out box, or a picked venue's full bubble) is made
          // again; changing a custom marker's size in place on Android closed the app. Same-size changes redraw in place.
          key={m.id + (compact && m.kind !== 'goal' && !m.stop ? ':s' : ':f')}
          sig={[look, m.kind, m.tag, m.busy, m.open, m.names, m.stop ? m.stop.n + (m.stop.done ? 'd' : '') : ''].join(':')}
          m={m}
          compact={compact}
          onPick={onPick}
        />
      ))}
    </RNMapView>
    {radarOn && geom ? (
      // Keyed on the picture: new blips make a fresh radar (new value, new nodes) rather than re-wiring the animated
      // nodes of one whose loop is running on the native side, which can close the app on Android.
      <Radar key={geom.key} centre={geom.c} r={geom.r} blips={geom.blips} active={shown} />
    ) : null}
    </View>
  );
}

const CELL_W = 116, TOP = 24, DISC = 40, BOTTOM = 24, BLIP = 30, SMALL = 48;
const styles = themed(() => StyleSheet.create({
  map: { flex: 1 },
  blip: { position: 'absolute', width: BLIP, height: BLIP, borderRadius: BLIP / 2, borderWidth: 2, borderColor: RADAR, backgroundColor: fade(RADAR, 0.25) },
  // The bubble is centred in a fixed box so the marker's anchor (0.5, 0.5) sits on the middle of the round icon.
  cell: { width: CELL_W, height: TOP + DISC + BOTTOM, alignItems: 'center' },
  small: { width: SMALL, height: SMALL, alignItems: 'center', justifyContent: 'center' },
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
