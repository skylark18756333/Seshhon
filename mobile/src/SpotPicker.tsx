// "Where to?": what Go now opens. A map of your area and the popular spots in it (busy tonight, trending, top
// picks, then open now and closest). You pick one and the sesh starts there, locked in, so friends who join can
// see where you're going. Where you are stays on this phone: it only sorts the list and centres the map.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { loadBuzz, type Buzz, type Venue } from './api';
import { MAP_CENTRE, RADIUS_KM } from './config';
import Icon from './Icon';
import NativeMap from './NativeMap';
import type { LatLng, MapMarker } from './mapShared';
import { Button } from './Parts';
import { C, F, fade, themed } from './theme';
import { findMe, fmtKm, km, openState, useMyPlace, type Venues } from './venues';

const AREAS = [2, 5, RADIUS_KM];   // "How far" choices, in km
const SHOW = 8;
const topPick = (x: Venue) => Number(x.ratings || 0) >= 3 && Number(x.average) >= 4.3;
function glyphOf(x: Venue): MapMarker['glyph'] {
  const k = String(x.kind || '').toLowerCase();
  return /club|night|music|live/.test(k) ? 'events' : /restaurant|cafe|food|eat|kitchen/.test(k) ? 'fork' : 'venues';
}

export default function SpotPicker({ v, meName, busy, green, onGo, onCancel }: {
  v: Venues; meName: string; busy: boolean; green: boolean; onGo: (venue: string) => void; onCancel: () => void;
}) {
  const here = useMyPlace(true);
  const [area, setArea] = useState(AREAS[1]);
  const [spot, setSpot] = useState<LatLng | null>(null);   // a spot tapped on the map, instead of where you are
  const [openOnly, setOpenOnly] = useState(false);
  const [query, setQuery] = useState('');
  const [pick, setPick] = useState<string | null>(null);
  const [buzz, setBuzz] = useState<Record<string, Buzz>>({});
  const [names, setNames] = useState(false);
  useEffect(() => { let gone = false; loadBuzz().then((b) => { if (!gone) setBuzz(b); }, () => {}); return () => { gone = true; }; }, []);

  const centre: LatLng = spot || here || MAP_CENTRE;
  const mine = !spot && !!here;
  const pins = v.pins;
  const busyOf = (x: Venue) => (buzz[x.id] && buzz[x.id].busy) || 0;
  const trending = (x: Venue) => !!(buzz[x.id] && buzz[x.id].trending);
  const tagOf = (x: Venue) => busyOf(x) ? 'Busy tonight' : trending(x) ? 'Trending' : topPick(x) ? 'Top pick' : '';
  // How popular a spot is: friends heading there tonight, then trending this week, then well rated.
  const score = (x: Venue) => busyOf(x) * 10 + (trending(x) ? 5 : 0) + (topPick(x) ? 3 : 0) + Math.min(2, Number(x.average || 0) / 2.5);

  const q = query.trim().toLowerCase();
  const spots = useMemo(() => {
    if (!pins) return [];
    return v.list
      .filter((x) => !x.is_example && pins[x.id])
      .map((x) => ({ ven: x, d: km(centre, pins[x.id]), st: openState(x) }))
      .filter((x) => (q ? (x.ven.name + ' ' + (x.ven.kind || '')).toLowerCase().indexOf(q) >= 0 : x.d <= area))
      .filter((x) => !openOnly || (x.st && x.st.open))
      .sort((a, b) => score(b.ven) - score(a.ven) || Number(!!(b.st && b.st.open)) - Number(!!(a.st && a.st.open)) || a.d - b.d)
      .slice(0, SHOW);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v.list, pins, centre[0], centre[1], area, openOnly, q, buzz]);

  const markers: MapMarker[] = spots.map(({ ven, st }) => ({
    id: ven.id, at: pins![ven.id], name: ven.name, kind: pick === ven.id ? 'goal' : 'near', glyph: glyphOf(ven),
    tag: tagOf(ven), busy: busyOf(ven), open: st ? st.open : null, names, stop: null
  }));
  // Show the whole area: its edges north, south, east and west of the centre.
  const dLat = area / 111.32, dLng = area / (111.32 * Math.cos(centre[0] * Math.PI / 180));
  const fitCoords: LatLng[] = q && spots.length ? spots.map((x) => pins![x.ven.id])
    : [[centre[0] + dLat, centre[1]], [centre[0] - dLat, centre[1]], [centre[0], centre[1] + dLng], [centre[0], centre[1] - dLng]];
  const fitKey = [centre[0].toFixed(4), centre[1].toFixed(4), area, q && spots.length ? q : ''].join('|');
  const fit = useMemo(() => ({ key: hash(fitKey), coords: fitCoords }), [fitKey]);   // eslint-disable-line react-hooks/exhaustive-deps
  const focus = useMemo(() => (pick && pins && pins[pick] ? { key: hash(pick), at: pins[pick] } : null), [pick, pins]);
  const onPickPin = useCallback((id: string) => setPick(id), []);
  const onMapPress = useCallback((at: LatLng) => { setSpot(at); setPick(null); }, []);

  const picked = pick ? v.byId[pick] : null;
  return (
    <>
      <View style={styles.headRow}>
        <Pressable onPress={onCancel} accessibilityRole="button" accessibilityLabel="Back" style={styles.round}>
          <Icon name="back" size={18} colour={C.fg} />
        </Pressable>
        <View style={styles.grow}>
          <Text style={[styles.eyebrow, { color: C.on }]}>Go now</Text>
          <Text style={styles.h1}>Where to?</Text>
        </View>
      </View>

      <View style={styles.mapBox}>
        <NativeMap
          centre={centre} radiusKm={area} chosen mine={mine} meName={meName}
          markers={markers} route={[]} fit={fit} focus={focus} onPick={onPickPin} onMapPress={onMapPress} onMapTap={() => setPick(null)} onZoom={setNames}
        />
      </View>
      <Text style={[styles.muted, styles.small]}>
        {spot ? 'Showing around the spot you tapped. ' : mine ? 'Around you. Your location stays on this phone. ' : 'Around the city centre. '}
        Double tap the map to look somewhere else.
      </Text>
      <View style={styles.chips}>
        {AREAS.map((a) => (
          <Pressable key={a} onPress={() => setArea(a)} style={[styles.chip, area === a && styles.chipOn]} accessibilityRole="button" accessibilityState={{ selected: area === a }} accessibilityLabel={'Within ' + a + ' km'}>
            <Text style={[styles.chipText, area === a && styles.chipTextOn]}>{a} km</Text>
          </Pressable>
        ))}
        <Pressable onPress={() => setOpenOnly((o) => !o)} style={[styles.chip, openOnly && styles.chipOn]} accessibilityRole="button" accessibilityState={{ selected: openOnly }} testID="spot-open">
          <Text style={[styles.chipText, openOnly && styles.chipTextOn]}>Open now</Text>
        </Pressable>
        {spot || !here ? (
          <Pressable onPress={() => { setSpot(null); findMe(true); }} style={styles.chip} accessibilityRole="button">
            <Text style={styles.chipText}>Near me</Text>
          </Pressable>
        ) : null}
      </View>
      <View style={styles.search}>
        <Icon name="search" size={18} colour={C.muted} />
        <TextInput
          style={styles.input} value={query} onChangeText={setQuery} placeholder="Search spots" placeholderTextColor={C.muted}
          autoCorrect={false} autoCapitalize="none" returnKeyType="search" accessibilityLabel="Search spots"
        />
      </View>

      <Text style={styles.h2}>{q ? 'Spots matching that' : 'Popular around here'}</Text>
      {!pins ? <Text style={[styles.muted, styles.small]}>Loading spots...</Text> : spots.length ? (
        <View style={styles.list}>
          {spots.map(({ ven, d, st }, i) => {
            const on = pick === ven.id, tag = tagOf(ven);
            return (
              <Pressable key={ven.id} onPress={() => setPick(on ? null : ven.id)} testID={'spot-' + ven.id}
                accessibilityRole="button" accessibilityState={{ selected: on }} accessibilityLabel={ven.name + ', ' + fmtKm(d) + (tag ? ', ' + tag : '')}
                style={[styles.row, on && styles.rowOn]}>
                <View style={[styles.rank, on && { backgroundColor: C.on }]}><Text style={[styles.rankText, on && { color: '#0B0B0D' }]}>{i + 1}</Text></View>
                <View style={styles.grow}>
                  <Text style={styles.name} numberOfLines={1}>{ven.name}</Text>
                  <Text style={[styles.muted, styles.tiny]} numberOfLines={1}>
                    {[fmtKm(d), ven.kind, st ? st.text : '', ven.ratings ? '★ ' + ven.average : ''].filter(Boolean).join(' · ')}
                  </Text>
                </View>
                {tag ? <View style={[styles.tag, busyOf(ven) ? styles.tagHot : null]}><Text style={styles.tagText}>{tag}</Text></View> : null}
              </Pressable>
            );
          })}
        </View>
      ) : (
        <Text style={[styles.muted, styles.small]}>{q ? 'No spots match that.' : openOnly ? 'Nothing open in this area right now. Try further out.' : 'No spots listed in this area. Try further out or tap somewhere else on the map.'}</Text>
      )}

      <View style={{ gap: 6 }}>
        <Button
          label={!picked ? 'Pick a spot to start' : busy ? 'Starting...' : 'Start the sesh at ' + picked.name}
          colour={picked && !busy ? C.on : undefined}
          ink={!!picked && !busy}
          disabled={!picked || busy}
          onPress={() => picked && onGo(picked.id)}
        />
        <Text style={[styles.muted, styles.tiny, { textAlign: 'center' }]}>
          {green ? 'Friends on green and amber can see it and join.' : 'This turns you green so friends can see it and join.'}
        </Text>
      </View>
    </>
  );
}

function hash(s: string): number { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h; }

const styles = themed(() => StyleSheet.create({
  headRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  round: { width: 40, height: 40, borderRadius: 20, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface, alignItems: 'center', justifyContent: 'center' },
  grow: { flex: 1, minWidth: 0 },
  eyebrow: { fontFamily: F.bodyBold, fontSize: 12, letterSpacing: 1.4, textTransform: 'uppercase' },
  h1: { fontFamily: F.display, fontSize: 26, lineHeight: 30, letterSpacing: -0.5, color: C.fg },
  h2: { fontFamily: F.display, fontSize: 19, color: C.fg },
  muted: { fontFamily: F.body, fontSize: 16, lineHeight: 22, color: C.muted },
  small: { fontSize: 14, lineHeight: 20 },
  tiny: { fontSize: 12.5, lineHeight: 17 },
  mapBox: { height: 260, borderRadius: 22, overflow: 'hidden', borderWidth: 1, borderColor: C.line, backgroundColor: C.surface },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 999, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface },
  chipOn: { backgroundColor: C.on, borderColor: C.on },
  chipText: { fontFamily: F.bodyBold, fontSize: 14, color: C.fg },
  chipTextOn: { color: '#0B0B0D' },
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, height: 48, borderRadius: 16, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface, paddingHorizontal: 14 },
  input: { flex: 1, color: C.fg, fontFamily: F.body, fontSize: 16 },
  list: { gap: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 18, borderWidth: 1.5, borderColor: C.line, backgroundColor: C.surface },
  rowOn: { borderColor: C.on, backgroundColor: fade(C.on, 0.12) },
  rank: { width: 30, height: 30, borderRadius: 15, backgroundColor: C.surface2, alignItems: 'center', justifyContent: 'center' },
  rankText: { fontFamily: F.display, fontSize: 14, color: C.fg },
  name: { fontFamily: F.bodyBold, fontSize: 16, color: C.fg },
  tag: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, backgroundColor: '#FFE16A' },
  tagHot: { backgroundColor: '#FF7A1A' },
  tagText: { fontFamily: F.bodyBold, fontSize: 10.5, color: '#0B0B0D' }
}));
