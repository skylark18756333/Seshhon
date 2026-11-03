// The Sesh Map's live map: a real map of the crawl (numbered stops joined in order) that you can move and zoom,
// with venues near the last stop (or wherever you tap) shown as bubbles. Tap one to add it as the next stop, so the
// crawl can grow as you go. Nothing new is stored: stops are the Sesh Map's (crawl_add, migration 0027).
// Where you are stays on the phone: it's only used, if the phone already knows it, to pick which venues to show.
import React, { useCallback, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { CrawlStop, Venue } from './api';
import NativeMap from './NativeMap';
import { mapIsOff } from './mapCrash';
import type { LatLng, MapMarker } from './mapShared';
import { Button } from './Parts';
import { C, F, themed } from './theme';
import { fmtKm, km, myPlace, type Venues } from './venues';

const NEAR_KM = 1.2, NEAR_MAX = 20, HEIGHT = 300;
const noZoom = () => {};

function glyph(v: Venue): MapMarker['glyph'] {
  const k = String(v.kind || '').toLowerCase();
  return /club|night|music|live/.test(k) ? 'events' : /restaurant|cafe|food|eat|kitchen/.test(k) ? 'fork' : 'venues';
}

export default function CrawlMap({ stops, v, canAdd, meName, onVenue, onAdd }: {
  stops: CrawlStop[]; v: Venues; canAdd: boolean; meName: string;
  onVenue: (id: string) => void; onAdd: (id: string) => void;
}) {
  const pins = v.pins;
  const [around, setAround] = useState<LatLng | null>(null);   // a spot tapped on the map
  const [pick, setPick] = useState<string | null>(null);

  const coords: LatLng[] = useMemo(() => stops.map((c) => pins && pins[c.venue_id]).filter((x): x is LatLng => !!x), [stops, pins]);
  const sig = coords.map((c) => c.join(',')).join(';');
  const fit = useMemo(() => ({ key: Date.now(), coords }), [sig]); // eslint-disable-line react-hooks/exhaustive-deps
  const last = coords.length ? coords[coords.length - 1] : null;
  const from: LatLng | null = around || last || myPlace();

  const inCrawl = useMemo(() => { const s: Record<string, boolean> = {}; stops.forEach((c) => { s[c.venue_id] = true; }); return s; }, [stops]);

  const markers: MapMarker[] = useMemo(() => {
    const list: MapMarker[] = [];
    stops.forEach((c) => {
      const at = pins && pins[c.venue_id], ven = v.byId[c.venue_id];
      if (at) list.push({ id: c.venue_id, at, name: ven ? ven.name : 'A venue', kind: 'near', glyph: ven ? glyph(ven) : 'venues', tag: '', busy: 0, open: null, names: true, stop: { n: c.position, done: !!c.done } });
    });
    if (canAdd && from && pins) {
      v.list
        .filter((x) => !inCrawl[x.id] && pins[x.id])
        .map((x) => ({ x, d: km(from, pins[x.id]) }))
        .filter((o) => o.d <= NEAR_KM)
        .sort((a, b) => a.d - b.d)
        .slice(0, NEAR_MAX)
        .forEach(({ x }) => list.push({ id: x.id, at: pins[x.id], name: x.name, kind: pick === x.id ? 'goal' : 'near', glyph: glyph(x), tag: '', busy: 0, open: null, names: pick === x.id, stop: null }));
    }
    return list;
  }, [stops, pins, v.byId, v.list, canAdd, from && from.join(','), inCrawl, pick]); // eslint-disable-line react-hooks/exhaustive-deps

  const onPick = useCallback((id: string) => {
    if (inCrawl[id]) { onVenue(id); return; }
    setPick(id);
  }, [inCrawl, onVenue]);
  const onMapPress = useCallback((at: LatLng) => { setAround(at); setPick(null); }, []);

  const pickVen = pick ? v.byId[pick] : null;
  const pickAway = pickVen && last && pins && pins[pickVen.id] ? fmtKm(km(last, pins[pickVen.id])) + ' from stop ' + stops.length : '';

  return (
    <View style={styles.wrap}>
      {mapIsOff() ? (
        <Text style={styles.muted}>The live map is switched off on this phone because it closed the app. Stops are listed below.</Text>
      ) : (
      <View style={styles.map} testID="crawl-map">
        <NativeMap
          centre={from || (coords[0] as LatLng) || [-31.9523, 115.8613]}
          radiusKm={NEAR_KM}
          chosen={false}
          mine={false}
          meName={meName}
          markers={markers}
          route={coords}
          fit={fit}
          focus={null}
          onPick={onPick}
          onMapPress={onMapPress}
          onMapTap={() => setPick(null)}
          onZoom={noZoom}
        />
      </View>
      )}
      {pickVen ? (
        <View style={styles.card}>
          <View style={styles.grow}>
            <Text style={styles.title} numberOfLines={1}>{pickVen.name}</Text>
            <Text style={styles.muted} numberOfLines={1}>{[pickVen.kind, pickAway].filter(Boolean).join(', ')}</Text>
          </View>
          <Button small label={'Add as stop ' + (stops.length + 1)} testID="crawl-map-add" onPress={() => { onAdd(pickVen.id); setPick(null); }} />
        </View>
      ) : canAdd ? (
        <Text style={styles.muted}>Tap a venue on the map to add it as the next stop. Double tap anywhere else to see what's near there.</Text>
      ) : null}
    </View>
  );
}

const styles = themed(() => StyleSheet.create({
  wrap: { gap: 10 },
  map: { height: HEIGHT, borderRadius: 20, overflow: 'hidden', borderWidth: 1, borderColor: C.line, backgroundColor: C.surface },
  card: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 16, backgroundColor: C.surface, borderWidth: 1, borderColor: C.line },
  grow: { flex: 1, minWidth: 0 },
  title: { fontFamily: F.bodyBold, fontSize: 16, color: C.fg },
  muted: { fontFamily: F.body, fontSize: 13, color: C.muted }
}));
