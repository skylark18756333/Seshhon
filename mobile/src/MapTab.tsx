// The Map tab, native: a Google map of venues, ported from mapTab() and drawMap() in docs/app.js. Snap Map style
// venue bubbles (icon, name, tag, a glow where 2 or more people in live seshes are heading, api_buzz), filter chips,
// search, "Near me", the "How far" radius, the Sesh Map's numbered stops with add and vote from the picked venue,
// and the faces of friends who are out along the bottom (faces only, never where anyone is).
//
// Location rules, same as the web map: nobody's location is shown to anyone. "Near me" asks this phone for its
// position once, keeps it in memory only to work out distances here, and never sends or saves it. Until a spot is
// chosen (tap the map or Near me) no venues are shown, except what a search or filter finds.
//
// If the map can't be shown (no Google Maps key in this build, or it fails), App.tsx shows the web map instead:
// the "simple map" link below the map does that by hand.
import * as Location from 'expo-location';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PanResponder, Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { loadBuzz, seshCrawl, type Buzz, type CrawlStop, type Sesh as SeshT, type Venue } from './api';
import Icon from './Icon';
import type { LatLng, MapMarker } from './mapShared';
import NativeMap from './NativeMap';
import { MAP_CENTRE } from './config';
import { Button, Face, TopBar } from './Parts';
import type { ApiError } from './session';
import { C, COLOURS, F, first, STOPS } from './theme';
import type { Frendzy } from './useFrendzy';
import { fmtKm, hoursLine, km, openState, refreshVenues, useVenues, type Venues } from './venues';

const CRAWL_MAX = 12;
const SEARCH_MAX = 30, SEARCH_LIST = 6;   // pins on the map for a search, cards under the search box
const NEAR_MAX = 60;                      // the most bubbles drawn at once from a circle (the nearest, busiest and tagged first)
const BUZZ_MS = 60000;                    // api_buzz is asked again after a minute, like the web map
const FILTERS: [string, string][] = [['popular', 'Popular'], ['trending', 'Trending'], ['open', 'Open now']];   // 'Deals' joins when deals are switched on (they are off in docs/config.js)

// Kept while the app is open, like ui.radiusKm / geo in the web app.
let savedRadius = 5;

/* ---------- helpers ported from docs/app.js ---------- */
const fold = (t: unknown) => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const topPick = (v: Venue) => Number(v.ratings || 0) >= 3 && Number(v.average) >= 4.3;
function kindGlyph(v: Venue): MapMarker['glyph'] {
  const k = String(v.kind || '').toLowerCase();
  return /club|night|music|live/.test(k) ? 'events' : /restaurant|cafe|food|eat|kitchen/.test(k) ? 'fork' : 'venues';
}
// The corners of the radius circle, for zooming the map to it.
function circleCoords(c: LatLng, rKm: number): LatLng[] {
  const dLat = rKm / 111.2, dLng = rKm / (111.2 * Math.max(0.2, Math.cos(c[0] * Math.PI / 180)));
  return [[c[0] + dLat, c[1]], [c[0] - dLat, c[1]], [c[0], c[1] + dLng], [c[0], c[1] - dLng]];
}

type Hit = { ven: Venue; d: number | null };
type Geo = { centre: LatLng; mine: boolean; busy: boolean; chosen: boolean };

export default function MapTab({ f, onVenue, onOpenWeb, onWebMap }: {
  f: Frendzy; onVenue: (id: string) => void; onOpenWeb: (tab: string) => void; onWebMap: () => void;
}) {
  const me = f.state && f.state.me;
  const seshes = (f.state && f.state.seshes) || [];
  const friends = (f.state && f.state.friends) || [];
  const v = useVenues();
  const pins = v.pins;
  const { height: screenH } = useWindowDimensions();

  const [geo, setGeo] = useState<Geo>({ centre: MAP_CENTRE, mine: false, busy: false, chosen: false });
  const [radius, setRadius] = useState(savedRadius);
  const [filter, setFilter] = useState('');
  const [query, setQuery] = useState('');
  const [pick, setPick] = useState<string | null>(null);
  const [list, setList] = useState(false);
  const [names, setNames] = useState(false);
  const [note, setNote] = useState('');
  const [fit, setFit] = useState<{ key: number; coords: LatLng[] }>({ key: 0, coords: [] });
  const [focus, setFocus] = useState<{ key: number; at: LatLng } | null>(null);
  const [buzz, setBuzz] = useState<Record<string, Buzz>>({});
  const [crawl, setCrawl] = useState<{ sesh: string | null; stops: CrawlStop[]; off: boolean }>({ sesh: null, stops: [], off: false });

  /* ---------- busy and trending venues: counts only, never who ---------- */
  useEffect(() => {
    let gone = false;
    const ask = () => loadBuzz().then((b) => { if (!gone) setBuzz(b); });
    ask();
    const t = setInterval(ask, BUZZ_MS);
    return () => { gone = true; clearInterval(t); };
  }, []);

  /* ---------- the Sesh Map's stops for the sesh you're in tonight (as Sesh.tsx reads them) ---------- */
  const mine: SeshT | null = seshes.filter((s) => s.am_member && !(s.planned && s.starts_at && new Date(s.starts_at).getTime() > Date.now()))[0] || null;
  const mineId = mine ? mine.id : null;
  useEffect(() => {
    if (!mineId || crawl.off) { if (crawl.stops.length) setCrawl((c) => ({ ...c, sesh: null, stops: [] })); return; }
    let gone = false;
    seshCrawl(mineId).then((l) => { if (!gone) setCrawl((c) => (JSON.stringify(c.stops) === JSON.stringify(l) && c.sesh === mineId ? c : { sesh: mineId, stops: l, off: false })); },
      (e: ApiError) => { if (!gone && e.missing) setCrawl({ sesh: null, stops: [], off: true }); });
    return () => { gone = true; };
    // f.state is a new object after every read, so this follows the five-second refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mineId, f.state, crawl.off]);
  const stops = mine && crawl.sesh === mine.id ? crawl.stops : [];
  const stopOf = (id: string) => stops.filter((c) => c.venue_id === id)[0] || null;

  /* ---------- which venues ---------- */
  const busyOf = (x: Venue) => (buzz[x.id] && buzz[x.id].busy) || 0;
  const trending = (x: Venue) => !!(buzz[x.id] && buzz[x.id].trending);
  const tagOf = (x: Venue) => busyOf(x) ? 'Busy tonight' : trending(x) ? 'Trending this week' : topPick(x) ? 'Top pick' : '';
  const filterOk = (x: Venue) => {
    if (!filter) return true;
    if (filter === 'popular') return busyOf(x) > 0 || topPick(x);
    if (filter === 'trending') return trending(x);
    const st = openState(x); return !!(st && st.open);
  };
  const filterName = (FILTERS.filter((x) => x[0] === filter)[0] || ['', ''])[1];

  const words = fold(query).split(' ').filter(Boolean);
  // A search finds venues by name or kind anywhere, whatever the radius; with a filter on and no spot chosen, the filter does the same.
  let hits: Hit[] | null = null;
  if (words.length) {
    const q = fold(query);
    hits = v.list.filter((x) => { const t = ' ' + fold(x.name + ' ' + (x.kind || '')); return words.every((w) => t.indexOf(' ' + w) >= 0) && filterOk(x); })
      .map((x) => ({ ven: x, d: pins && pins[x.id] && geo.chosen ? km(geo.centre, pins[x.id]) : null }));
    hits.sort((a, b) => {
      const sa = fold(a.ven.name).indexOf(q) === 0 ? 0 : 1, sb = fold(b.ven.name).indexOf(q) === 0 ? 0 : 1;
      if (sa !== sb) return sa - sb;
      if (a.d !== null && b.d !== null) return a.d - b.d;
      return a.ven.name.localeCompare(b.ven.name);
    });
  } else if (filter && !geo.chosen) {
    hits = v.list.filter(filterOk).map((x) => ({ ven: x, d: null }))
      .sort((a, b) => busyOf(b.ven) - busyOf(a.ven) || (b.ven.ratings || 0) - (a.ven.ratings || 0) || a.ven.name.localeCompare(b.ven.name));
  }

  const shown: { ven: Venue; at: LatLng; d: number | null; inside: boolean }[] = useMemo(() => {
    if (!pins) return [];
    const out: { ven: Venue; at: LatLng; d: number | null; inside: boolean }[] = [];
    if (hits) {
      const ids: Record<string, boolean> = {};
      hits.slice(0, SEARCH_MAX).forEach((h) => { ids[h.ven.id] = true; });
      v.list.forEach((x) => { const at = pins[x.id]; if (at && (ids[x.id] || pick === x.id)) out.push({ ven: x, at, d: geo.chosen ? km(geo.centre, at) : null, inside: true }); });
      return out;
    }
    const near: typeof out = [];
    v.list.forEach((x) => {
      const at = pins[x.id];
      if (!at) return;
      const d = geo.chosen ? km(geo.centre, at) : null;
      const inside = d !== null && d <= radius;
      if (pick === x.id) out.push({ ven: x, at, d, inside });
      else if (inside && filterOk(x)) near.push({ ven: x, at, d, inside });
    });
    // Hundreds of bubbles would swamp a phone, so a crowded circle shows the busiest and nearest.
    near.sort((a, b) => busyOf(b.ven) - busyOf(a.ven) || (tagOf(b.ven) ? 1 : 0) - (tagOf(a.ven) ? 1 : 0) || (a.d as number) - (b.d as number));
    return out.concat(near.slice(0, NEAR_MAX));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v.list, pins, geo, radius, filter, query, pick, buzz]);

  // Stops are always on the map (even outside the circle), drawn as numbered circles.
  const markers: MapMarker[] = shown.map(({ ven, at, inside }) => {
    const c = stopOf(ven.id), st = openState(ven);
    return {
      id: ven.id, at, name: ven.name, kind: pick === ven.id ? 'goal' : inside ? 'near' : 'far', glyph: kindGlyph(ven),
      tag: tagOf(ven), busy: busyOf(ven), open: st ? st.open : null, names, stop: c ? { n: c.position, done: c.done } : null
    } as MapMarker;
  });
  const have: Record<string, boolean> = {};
  markers.forEach((m) => { have[m.id] = true; });
  stops.forEach((c) => {
    const at = pins && pins[c.venue_id], ven = v.byId[c.venue_id];
    if (at && ven && !have[c.venue_id]) markers.push({ id: ven.id, at, name: ven.name, kind: pick === ven.id ? 'goal' : 'near', glyph: kindGlyph(ven), tag: '', busy: 0, open: null, names, stop: { n: c.position, done: c.done } });
  });
  const route: LatLng[] = stops.map((c) => pins && pins[c.venue_id]).filter((x): x is [number, number] => !!x);

  const pickVen = pick ? v.byId[pick] : null;

  /* ---------- taps ---------- */
  const refit = (coords: LatLng[]) => setFit((o) => ({ key: o.key + 1, coords }));
  const choose = useCallback((at: LatLng, isMine: boolean) => setGeo({ centre: at, mine: isMine, busy: false, chosen: true }), []);

  const locate = async () => {
    if (geo.busy) return;
    setGeo((g) => ({ ...g, busy: true }));
    setNote('');
    try {
      const ask = await Location.requestForegroundPermissionsAsync();
      if (ask.status !== 'granted') throw new Error('denied');
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const at: LatLng = [pos.coords.latitude, pos.coords.longitude];   // kept in memory only, never sent anywhere
      choose(at, true);
      refit(circleCoords(at, radius));
    } catch (e) {
      setGeo((g) => ({ ...g, busy: false }));
      setNote('Could not get your location. Tap the map to pick a spot instead.');
    }
  };

  // After a filter or search with no spot chosen, zoom to what it found (fitHits in drawMap).
  const lastFit = useRef('');
  useEffect(() => {
    if (!hits || geo.chosen || !pins) { lastFit.current = ''; return; }
    const ids = hits.slice(0, SEARCH_MAX).map((h) => h.ven.id).join(',');
    if (ids === lastFit.current) return;
    lastFit.current = ids;
    const coords = hits.slice(0, SEARCH_MAX).map((h) => pins[h.ven.id]).filter(Boolean) as LatLng[];
    if (coords.length && filter) refit(coords);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter, geo.chosen, pins, buzz]);

  const showOnMap = (id: string) => {
    setPick(id);
    setQuery('');
    setList(false);
    const at = pins && pins[id];
    if (at) setFocus((o) => ({ key: (o ? o.key : 0) + 1, at }));
  };

  const crawlRun = (fn: string, venue: string, okMsg?: string) => {
    if (!mine) return;
    const id = mine.id;
    f.act(fn, { p_sesh: id, p_venue: venue }, okMsg).then((l) => { if (Array.isArray(l)) setCrawl({ sesh: id, stops: l, off: false }); });
  };
  const rate = (ven: Venue, stars: number) => {
    f.act('rate_venue', { p_venue: ven.id, p_stars: stars, p_tags: ven.my_tags || [] }, 'Thanks, rating saved.').then(() => refreshVenues());
  };

  if (!me) return null;
  const out = me.colour === 'off' ? [] : friends.filter((x) => x.colour === 'on' || x.colour === 'thinking')
    .sort((x, y) => STOPS.indexOf(x.colour) - STOPS.indexOf(y.colour));
  const count = shown.filter((x) => x.inside).length;
  const lines = geo.busy ? 'Finding you...' : geo.mine ? 'Searching around you. Your location stays on this phone and is never saved or shown to friends.'
    : geo.chosen ? 'Tap the map to search somewhere else, or the arrow to search near you.' : 'Tap the map to pick a spot, or the arrow to search near you.';

  return (
    <View style={styles.fill}>
      <TopBar f={f} onOpenWeb={onOpenWeb} />
      <View style={styles.head}>
        <View style={styles.search}>
          <Icon name="search" size={18} colour={C.muted} />
          <TextInput
            style={styles.input} value={query} onChangeText={setQuery} placeholder="Search venues" placeholderTextColor={C.muted}
            autoCorrect={false} autoCapitalize="none" returnKeyType="search" accessibilityLabel="Search venues" testID="venue-search"
          />
          {query ? (
            <Pressable onPress={() => setQuery('')} accessibilityRole="button" accessibilityLabel="Clear search" style={styles.clear}>
              <Icon name="close" size={16} colour={C.muted} />
            </Pressable>
          ) : null}
        </View>
        <View style={styles.chips} accessibilityRole="radiogroup" accessibilityLabel="Show only">
          {FILTERS.map(([key, name]) => (
            <Pressable key={key} onPress={() => setFilter(filter === key ? '' : key)} testID={'chip-' + key} accessibilityRole="button" accessibilityLabel={name}
              accessibilityState={{ selected: filter === key }} style={[styles.chip, filter === key && styles.chipOn]}>
              <Text style={[styles.chipText, filter === key && styles.chipTextOn]}>{name}</Text>
            </Pressable>
          ))}
          <Pressable onPress={() => setList((x) => !x)} testID="map-list-toggle" accessibilityRole="button" accessibilityLabel={list ? 'Show the map' : 'Show a list'} style={[styles.chip, list && styles.chipOn]}>
            <Text style={[styles.chipText, list && styles.chipTextOn]}>{list ? 'Map' : 'List'}</Text>
          </Pressable>
        </View>
      </View>

      {hits ? (
        <View style={styles.results} accessibilityLiveRegion="polite" testID="search-results">
          <Text style={styles.small}>
            {hits.length ? <Text style={styles.strong}>{hits.length} venue{hits.length === 1 ? '' : 's'}</Text> : 'No venues '}{hits.length ? ' match' + (hits.length === 1 ? 'es' : '') : 'match '}
            {query.trim() ? <Text style={styles.strong}> {query.trim()}</Text> : null}{filter ? <Text>{query.trim() ? ' and ' : ' '}<Text style={styles.strong}>{filterName}</Text></Text> : null}
            {hits.length > SEARCH_LIST && query ? '. Showing the closest matches, so type more to narrow it down.' : ''}
          </Text>
          {query ? hits.slice(0, SEARCH_LIST).map((h) => <VenueRow key={h.ven.id} h={h} v={v} onShow={showOnMap} onOpen={onVenue} onMap />) : null}
        </View>
      ) : null}

      <View style={styles.mapBox}>
        {list ? (
          <ScrollView style={styles.fill} contentContainerStyle={styles.listBody} testID="venue-list">
            {!geo.chosen && !hits ? (
              <View style={styles.card}><Text style={styles.title}>Choose where to look</Text><Text style={styles.small}>Tap the arrow to search near you, or tap the map to pick a spot. Or search for a venue by name above.</Text></View>
            ) : null}
            {shown.map((x) => <VenueRow key={x.ven.id} h={{ ven: x.ven, d: x.d }} v={v} onShow={showOnMap} onOpen={onVenue} onMap />)}
            {geo.chosen && !shown.length ? <Text style={styles.small}>No venues here{filter ? ' for ' + filterName : ''}. Try a bigger radius.</Text> : null}
          </ScrollView>
        ) : (
          <>
            <NativeMap
              centre={geo.centre} radiusKm={radius} chosen={geo.chosen} mine={geo.mine} meName={me.name}
              markers={markers} route={route} fit={fit} focus={focus} onPick={(id) => { setPick(id); }}
              onMapPress={(at) => { choose(at, false); setPick(null); }} onZoom={setNames}
            />
            {out.length ? (
              <View style={styles.friends} accessibilityLabel="Friends out tonight" pointerEvents="none">
                {out.slice(0, 6).map((x) => (
                  <View key={x.id} style={styles.mini}>
                    <View style={{ borderRadius: 24, borderWidth: 2, borderColor: COLOURS[x.colour] }}><Face id={x.id} name={x.name} photos={f.photos} size={34} font={12} /></View>
                    <Text style={styles.miniName} numberOfLines={1}>{first(x.name)}</Text>
                  </View>
                ))}
              </View>
            ) : null}
          </>
        )}
        <Pressable onPress={locate} disabled={geo.busy} testID="map-near-me" accessibilityRole="button" accessibilityLabel={geo.busy ? 'Finding you' : 'Near me'}
          accessibilityState={{ selected: geo.mine, disabled: geo.busy }} style={[styles.fab, geo.mine && styles.fabOn]}>
          <Icon name="arrow" size={20} colour={geo.mine ? C.accentInk : C.fg} />
        </Pressable>
      </View>

      <ScrollView style={[styles.panel, { maxHeight: Math.round(screenH * 0.36) }]} contentContainerStyle={styles.panelBody} keyboardShouldPersistTaps="handled">
        {pickVen ? (
          <PickCard
            ven={pickVen} v={v} geo={geo} mine={mine} stop={stopOf(pickVen.id)} crawlOff={crawl.off} crawlFull={stops.length >= CRAWL_MAX}
            onClose={() => setPick(null)} onOpen={() => onVenue(pickVen.id)} onRate={(n) => rate(pickVen, n)}
            onVote={() => mine && f.act('cast_vote', { p_sesh: mine.id, p_venue: pickVen.id }, 'Your vote is in.')}
            onAdd={() => crawlRun('crawl_add', pickVen.id, 'Added to the Sesh Map.')} onStop={() => onOpenWeb('sesh')}
          />
        ) : null}
        <View style={styles.radius}>
          <View style={styles.between}>
            <Text style={styles.eyebrow}>How far</Text>
            <Text style={styles.num} testID="radius-label">{radius}<Text style={styles.numUnit}> km</Text></Text>
          </View>
          <Slider value={radius} min={1} max={25} onChange={(n) => { savedRadius = n; setRadius(n); }} onDone={() => { if (geo.chosen) refit(circleCoords(geo.centre, radius)); }} />
          <View style={styles.between}><Text style={styles.scale}>1 km</Text><Text style={styles.scale}>25 km</Text></View>
        </View>
        <Text style={styles.small} testID="map-note">{note || lines}</Text>
        {geo.chosen && !hits ? <Text style={styles.small} testID="venue-count">{count} venue{count === 1 ? '' : 's'}{filter ? ' ' + filterName.toLowerCase() : ''} within {radius} km{geo.mine ? ' of you' : ' of the pin'}{count >= NEAR_MAX ? '. Showing the busiest and nearest ' + NEAR_MAX + '.' : ''}</Text> : null}
        <Pressable onPress={onWebMap} accessibilityRole="button" accessibilityLabel="Map not loading? Use the simple map" testID="map-simple" style={styles.simple}>
          <Text style={styles.simpleText}>Map not loading? Use the simple map</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

/* ---------- pieces ---------- */
// A venue under the search box or in the list (venueCard in docs/app.js).
function VenueRow({ h, v, onShow, onOpen, onMap }: { h: Hit; v: Venues; onShow: (id: string) => void; onOpen: (id: string) => void; onMap?: boolean }) {
  const ven = h.ven, onPin = !!(v.pins && v.pins[ven.id]);
  return (
    <View style={styles.card}>
      <View style={styles.row}>
        <View style={styles.grow}>
          {ven.is_example ? <Text style={styles.eyebrow}>Example venue</Text> : null}
          <Text style={styles.title}>{ven.name}</Text>
          <Text style={styles.small}>{[ven.kind, hoursLine(ven)].filter(Boolean).join(', ')}</Text>
          <Text style={styles.small}>
            {h.d !== null ? <Text style={styles.strong}>{fmtKm(h.d)} </Text> : null}{h.d !== null ? 'away, ' : ''}
            {ven.ratings ? <Text><Text style={styles.strong}>{Number(ven.average).toFixed(1)}</Text> from {ven.ratings} rating{ven.ratings === 1 ? '' : 's'}</Text> : 'no ratings yet'}
          </Text>
        </View>
        <Button small ghost label={onMap && onPin ? 'Show' : 'Open'} testID={'show-' + ven.id} onPress={() => (onMap && onPin ? onShow(ven.id) : onOpen(ven.id))} />
      </View>
    </View>
  );
}

// The venue picked on the map, shown under it (mapPick in docs/app.js).
function PickCard({ ven, v, geo, mine, stop, crawlOff, crawlFull, onClose, onOpen, onRate, onVote, onAdd, onStop }: {
  ven: Venue; v: Venues; geo: Geo; mine: SeshT | null; stop: CrawlStop | null; crawlOff: boolean; crawlFull: boolean;
  onClose: () => void; onOpen: () => void; onRate: (n: number) => void; onVote: () => void; onAdd: () => void; onStop: () => void;
}) {
  const at = v.pins && v.pins[ven.id];
  const away = geo.chosen && at ? fmtKm(km(geo.centre, at)) + (geo.mine ? ' away' : geo.centre[0] === MAP_CENTRE[0] && geo.centre[1] === MAP_CENTRE[1] ? ' from the city centre' : ' from the map pin') : '';
  return (
    <View style={styles.card} testID="map-pick">
      <View style={styles.row}>
        <View style={styles.grow}>
          {ven.is_example ? <Text style={styles.eyebrow}>Example venue</Text> : null}
          <Text style={styles.h2}>{ven.name}</Text>
          <Text style={styles.small}>{[ven.kind, hoursLine(ven), away].filter(Boolean).join(', ')}</Text>
        </View>
        <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" style={styles.round}><Icon name="close" size={18} colour={C.fg} /></Pressable>
      </View>
      <Text style={styles.small}>{ven.ratings ? Number(ven.average).toFixed(1) + ' ★ on Frendzy (' + ven.ratings + ')' : 'No Frendzy ratings yet'}</Text>
      <View style={styles.stars} accessibilityLabel={'Rate ' + ven.name}>
        {[1, 2, 3, 4, 5].map((n) => (
          <Pressable key={n} onPress={() => onRate(n)} testID={'star-' + n} accessibilityRole="button" accessibilityLabel={'Rate ' + n + ' star' + (n > 1 ? 's' : '')}
            accessibilityState={{ selected: (ven.my_stars || 0) >= n }} style={styles.star}>
            <Text style={[styles.starText, (ven.my_stars || 0) >= n && styles.starOn]}>★</Text>
          </Pressable>
        ))}
      </View>
      <View style={styles.row}>
        <Button small label="Open venue" testID="pick-open" onPress={onOpen} />
        {mine && !mine.locked_venue ? <Button small ghost label="Vote for it" testID="pick-vote" onPress={onVote} /> : null}
      </View>
      {mine && !crawlOff ? (
        stop ? <Button small ghost label={'Stop ' + stop.position + ' on the Sesh Map'} testID="pick-stop" onPress={onStop} />
          : crawlFull ? null : <Button small ghost label="Add to the Sesh Map" testID="pick-add" onPress={onAdd} />
      ) : null}
    </View>
  );
}

// The "How far" slider, 1 to 25 km. Touch or drag anywhere on the bar.
function Slider({ value, min, max, onChange, onDone }: { value: number; min: number; max: number; onChange: (n: number) => void; onDone: () => void }) {
  const width = useRef(1);
  const set = useRef(onChange); set.current = onChange;
  const done = useRef(onDone); done.current = onDone;
  const at = (x: number) => Math.min(max, Math.max(min, Math.round(min + (x / width.current) * (max - min))));
  const pan = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: (e) => set.current(at(e.nativeEvent.locationX)),
    onPanResponderMove: (e) => set.current(at(e.nativeEvent.locationX)),
    onPanResponderRelease: () => done.current()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), []);
  const part = (value - min) / (max - min);
  return (
    <View
      style={styles.sliderHit} onLayout={(e) => { width.current = Math.max(1, e.nativeEvent.layout.width); }} {...pan.panHandlers}
      testID="radius" accessible accessibilityRole="adjustable" accessibilityLabel="How far" accessibilityValue={{ min, max, now: value, text: value + ' km' }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(e) => { onChange(Math.min(max, Math.max(min, value + (e.nativeEvent.actionName === 'increment' ? 1 : -1)))); done.current(); }}
    >
      <View style={styles.track} pointerEvents="none">
        <View style={[styles.trackFill, { width: `${part * 100}%` }]} />
      </View>
      <View style={[styles.knob, { left: `${part * 100}%` }]} pointerEvents="none" />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  head: { paddingHorizontal: 16, gap: 8, paddingBottom: 8 },
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44, paddingHorizontal: 14, borderRadius: 22, backgroundColor: C.surface, borderWidth: 1, borderColor: C.line },
  input: { flex: 1, fontFamily: F.body, fontSize: 15, color: C.fg, paddingVertical: 8 },
  clear: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { minHeight: 36, paddingHorizontal: 14, borderRadius: 18, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface, alignItems: 'center', justifyContent: 'center' },
  chipOn: { backgroundColor: C.accent, borderColor: C.accent },
  chipText: { fontFamily: F.bodyBold, fontSize: 13, color: C.fg },
  chipTextOn: { color: C.accentInk },
  results: { paddingHorizontal: 16, gap: 8, paddingBottom: 8, maxHeight: 280 },
  mapBox: { flex: 1, minHeight: 180, backgroundColor: '#14161c' },
  fab: { position: 'absolute', right: 12, top: 12, width: 48, height: 48, borderRadius: 24, backgroundColor: 'rgba(18, 18, 22, 0.86)', borderWidth: 1, borderColor: C.line, alignItems: 'center', justifyContent: 'center' },
  fabOn: { backgroundColor: C.accent },
  friends: { position: 'absolute', left: 10, bottom: 10, right: 10, flexDirection: 'row', gap: 10 },
  mini: { alignItems: 'center', width: 52 },
  miniName: { fontFamily: F.bodyBold, fontSize: 10, color: '#fff', marginTop: 2, backgroundColor: 'rgba(11, 11, 13, 0.7)', paddingHorizontal: 4, borderRadius: 6, overflow: 'hidden' },
  listBody: { padding: 16, gap: 10 },
  panel: { flexGrow: 0 },
  panelBody: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 6, gap: 10 },
  card: { backgroundColor: C.surface, borderRadius: 18, paddingVertical: 14, paddingHorizontal: 16, gap: 8, borderWidth: 1, borderColor: C.line },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  between: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  grow: { flex: 1, minWidth: 140 },
  title: { fontFamily: F.bodyBold, fontSize: 16, color: C.fg },
  h2: { fontFamily: F.display, fontSize: 20, color: C.fg },
  eyebrow: { fontFamily: F.bodyBold, fontSize: 11, letterSpacing: 0.8, textTransform: 'uppercase', color: C.muted },
  small: { fontFamily: F.body, fontSize: 13, lineHeight: 18, color: C.muted },
  strong: { fontFamily: F.bodyBold, color: C.fg },
  round: { width: 40, height: 40, borderRadius: 20, backgroundColor: C.surface2, alignItems: 'center', justifyContent: 'center' },
  stars: { flexDirection: 'row', gap: 2 },
  star: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  starText: { fontSize: 26, color: C.muted },
  starOn: { color: C.thinking },
  radius: { gap: 6, backgroundColor: C.surface, borderRadius: 18, paddingVertical: 12, paddingHorizontal: 16, borderWidth: 1, borderColor: C.line },
  num: { fontFamily: F.display, fontSize: 22, color: C.fg },
  numUnit: { fontFamily: F.body, fontSize: 13, color: C.muted },
  scale: { fontFamily: F.body, fontSize: 11, color: C.muted },
  sliderHit: { height: 40, justifyContent: 'center' },
  track: { height: 6, borderRadius: 3, backgroundColor: C.trackLine, overflow: 'hidden' },
  trackFill: { height: 6, backgroundColor: '#1F7BFF' },
  knob: { position: 'absolute', top: 8, marginLeft: -12, width: 24, height: 24, borderRadius: 12, backgroundColor: C.accent, borderWidth: 3, borderColor: '#1F7BFF' },
  simple: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  simpleText: { fontFamily: F.bodyMid, fontSize: 13, color: C.muted, textDecorationLine: 'underline' }
});
