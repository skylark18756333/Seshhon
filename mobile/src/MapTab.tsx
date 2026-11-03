// The Map tab, native: a full-screen Google map of venues with a radar-style "How far" circle (Sarah's mix of the
// swipe-cards and radar designs, 2026-11-02, mock-up https://claude.ai/artifact/Luhz2ceLfXDUzdGNcemZxU).
//  - Up top: Around me / Middle, search, the km buttons (1 to 25 km) and filter chips.
//  - On the map: venue bubbles (busy glow from api_buzz), the glowing green radius circle, the Sesh Map's numbered
//    stops. Tap anywhere to drop a pin there and search around it; the arrow goes back to you.
//  - Along the bottom: the venues inside the circle as cards you swipe sideways. Tap one to find it on the map and
//    open its card (ratings, vote, add to the Sesh Map).
//  - Middle (in a live sesh): Meet in the middle (migration 0037). Everyone who switches it on shares roughly where
//    they are for that sesh only, and the map shows only the venues that are fair for everyone, in gold.
//
// Location rules: nobody's location is shown to anyone. Your own position (Near me) or a dropped pin stays in this
// phone's memory and is never sent or saved. Middle sends your position rounded to about 500 m, only when you
// switch it on, and it is deleted when you switch it off, leave or the sesh ends.
//
// Speed: only the nearest/busiest 30 venues get a bubble, their names never change on zoom, and nothing on the map
// is redrawn by the 5-second refresh, so the screen stays responsive on Android.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { loadBuzz, meetShare, meetStop, meetVenues, seshCrawl, type Buzz, type CrawlStop, type Meet, type Sesh as SeshT, type Venue } from './api';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from './Icon';
import type { LatLng, MapMarker } from './mapShared';
import NativeMap from './NativeMap';
import { MAP_CENTRE, RADIUS_KM } from './config';
import { useGoogleRating } from './google';
import { Button, TopBar } from './Parts';
import type { ApiError } from './session';
import { useOnShow, useShownRef } from './Shown';
import { C, F, fade, themed } from './theme';
import type { Frendzy } from './useFrendzy';
import { findMe, fmtKm, hoursLine, km, myPlace, openState, refreshVenues, useVenues, type Venues } from './venues';

const CRAWL_MAX = 12;
const SEARCH_MAX = 30, SEARCH_LIST = 6;   // pins on the map for a search, rows under the search box
const NEAR_MAX = 30, NEAR_FAR_MAX = 18;   // fewer when zoomed out wide (10 km and up): easier to tap the map, less for the phone to draw
                      // the most bubbles drawn at once from the circle (busiest and nearest first)
const NAMED = 8;                          // the first few bubbles always carry their name (no redraw of every marker on zoom)
const BUZZ_MS = 60000;                    // api_buzz is asked again after a minute
const MEET_MS = 15000;                    // Middle asks again this often while it is on show, so a mate's share shows up
const KMS = [1, 2, 3, 5, 10, 25];
const FILTERS: [string, string][] = [['', 'Nearest'], ['open', 'Open now'], ['popular', 'Popular'], ['trending', 'Trending']];
const RADAR = '#3DDC84', GOLD = '#FFC53D';
const noZoom = () => {};

// Kept while the app is open.
let savedRadius = RADIUS_KM;

/* ---------- helpers ---------- */
const fold = (t: unknown) => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const topPick = (v: Venue) => Number(v.ratings || 0) >= 3 && Number(v.average) >= 4.3;
function kindGlyph(v: Venue): MapMarker['glyph'] {
  const k = String(v.kind || '').toLowerCase();
  return /club|night|music|live/.test(k) ? 'events' : /restaurant|cafe|food|eat|kitchen/.test(k) ? 'fork' : 'venues';
}
// The edges of the radius circle, for zooming the map to it.
function circleCoords(c: LatLng, rKm: number): LatLng[] {
  const dLat = rKm / 111.2, dLng = rKm / (111.2 * Math.max(0.2, Math.cos(c[0] * Math.PI / 180)));
  return [[c[0] + dLat, c[1]], [c[0] - dLat, c[1]], [c[0], c[1] + dLng], [c[0], c[1] - dLng]];
}
const walkText = (d: number) => { const m = Math.round(d / 4.8 * 60); return m <= 30 ? Math.max(1, m) + ' min walk' : ''; };
const isLater = (s: SeshT) => !!(s.planned && s.starts_at && new Date(s.starts_at).getTime() > Date.now());

const NO_STOPS: CrawlStop[] = [];

type Hit = { ven: Venue; d: number | null };
type Geo = { centre: LatLng; mine: boolean; busy: boolean; chosen: boolean };
type Spot = { ven: Venue; at: LatLng; d: number | null; inside: boolean };

export default function MapTab({ f, onVenue, onOpenWeb, onWebMap }: {
  f: Frendzy; onVenue: (id: string) => void; onOpenWeb: (tab: string) => void; onWebMap: () => void;
}) {
  const me = f.state && f.state.me;
  const seshes = (f.state && f.state.seshes) || [];
  const v = useVenues();
  const pins = v.pins;
  const { height: screenH } = useWindowDimensions();
  const inset = useSafeAreaInsets();
  const [headH, setHeadH] = useState(64);
  const pad = useMemo(() => ({ top: headH + 96, bottom: TABS_H + inset.bottom + 96 }), [headH, inset.bottom]);

  const [geo, setGeo] = useState<Geo>(() => {
    const at = myPlace();
    return at ? { centre: at, mine: true, busy: false, chosen: true } : { centre: MAP_CENTRE, mine: false, busy: false, chosen: false };
  });
  const [radius, setRadius] = useState(savedRadius);
  const [filter, setFilter] = useState('');
  const [query, setQuery] = useState('');
  const [pick, setPick] = useState<string | null>(null);
  const [mode, setMode] = useState<'me' | 'mid'>('me');
  const [note, setNote] = useState('');
  const [fit, setFit] = useState<{ key: number; coords: LatLng[] }>({ key: 0, coords: [] });
  const [focus, setFocus] = useState<{ key: number; at: LatLng } | null>(null);
  const [buzz, setBuzz] = useState<Record<string, Buzz>>({});
  const [crawl, setCrawl] = useState<{ sesh: string | null; stops: CrawlStop[]; off: boolean }>({ sesh: null, stops: [], off: false });
  const deck = useRef<ScrollView>(null);

  /* ---------- busy and trending venues: counts only, never who ---------- */
  const shownRef = useShownRef();
  const buzzAt = useRef(0);
  const buzzKey = useRef('');
  const askBuzz = useCallback(() => {
    buzzAt.current = Date.now();
    return loadBuzz().then((b) => {
      const k = JSON.stringify(b);
      if (k !== buzzKey.current) { buzzKey.current = k; setBuzz(b); }   // unchanged counts don't redraw the map
    }, () => {});
  }, []);
  useEffect(() => {
    askBuzz();
    const t = setInterval(() => { if (shownRef.current) askBuzz(); }, BUZZ_MS);
    return () => clearInterval(t);
  }, [askBuzz, shownRef]);
  useOnShow(() => { if (Date.now() - buzzAt.current > BUZZ_MS) askBuzz(); });

  /* ---------- your sesh: tonight's first, else a planned one (crawl stops work on both) ---------- */
  const targets = seshes.filter((s) => s.am_member).sort((a, b) => Number(isLater(a)) - Number(isLater(b)));
  const mine: SeshT | null = targets[0] || null;
  const live: SeshT | null = mine && !isLater(mine) ? mine : null;
  const mineId = mine ? mine.id : null;
  useEffect(() => {
    if (!mineId || crawl.off) { if (crawl.stops.length) setCrawl((c) => ({ ...c, sesh: null, stops: [] })); return; }
    let gone = false;
    const load = () => seshCrawl(mineId).then((l) => { if (!gone) setCrawl((c) => (JSON.stringify(c.stops) === JSON.stringify(l) && c.sesh === mineId ? c : { sesh: mineId, stops: l, off: false })); },
      (e: ApiError) => { if (!gone && e.missing) setCrawl({ sesh: null, stops: [], off: true }); });
    load();
    const stop = f.everyRead(() => { if (shownRef.current) load(); });
    return () => { gone = true; stop(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mineId, crawl.off, f.everyRead]);
  const stops = mine && crawl.sesh === mine.id ? crawl.stops : NO_STOPS;
  const stopOf = (id: string) => stops.filter((c) => c.venue_id === id)[0] || null;

  /* ---------- Middle: Meet in the middle for the live sesh ---------- */
  const [meet, setMeet] = useState<Meet | null>(null);
  const [meetOff, setMeetOff] = useState(false);
  const [meetBusy, setMeetBusy] = useState(false);
  const liveId = live ? live.id : null;
  const meetKey = useRef('');
  useEffect(() => {
    if (mode !== 'mid' || !liveId || meetOff) return;
    let gone = false;
    const ask = () => meetVenues(liveId).then((m) => {
      const k = JSON.stringify(m);
      if (!gone && k !== meetKey.current) { meetKey.current = k; setMeet(m); }
    }, (e: ApiError) => { if (!gone && e && e.missing) setMeetOff(true); });
    ask();
    const t = setInterval(() => { if (shownRef.current) ask(); }, MEET_MS);
    return () => { gone = true; clearInterval(t); };
  }, [mode, liveId, meetOff, shownRef]);
  const meetFailed = (e: ApiError) => { if (e && e.missing) setMeetOff(true); else setNote((e && e.message) || 'Something went wrong. Try again.'); };
  const shareMeet = async (on: boolean) => {
    if (!liveId) return;
    setMeetBusy(true); setNote('');
    if (on) {
      const at = await findMe(true, true);
      if (!at) { setMeetBusy(false); setNote('Could not get your location, so nothing was shared.'); return; }
      await meetShare(liveId, at).then(setMeet, meetFailed);
    } else {
      await meetStop(liveId).then(setMeet, meetFailed);
    }
    setMeetBusy(false);
  };
  const midIds = useMemo(() => (mode === 'mid' && meet ? meet.venues.filter((id) => v.byId[id]) : []), [mode, meet, v.byId]);

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

  // A search finds venues by name or kind anywhere, whatever the radius; a filter with no spot chosen does the same.
  const words = fold(query).split(' ').filter(Boolean);
  let hits: Hit[] | null = null;
  if (mode === 'me' && words.length) {
    const q = fold(query);
    hits = v.list.filter((x) => { const t = ' ' + fold(x.name + ' ' + (x.kind || '')); return words.every((w) => t.indexOf(' ' + w) >= 0) && filterOk(x); })
      .map((x) => ({ ven: x, d: pins && pins[x.id] && geo.chosen ? km(geo.centre, pins[x.id]) : null }));
    hits.sort((a, b) => {
      const sa = fold(a.ven.name).indexOf(q) === 0 ? 0 : 1, sb = fold(b.ven.name).indexOf(q) === 0 ? 0 : 1;
      if (sa !== sb) return sa - sb;
      if (a.d !== null && b.d !== null) return a.d - b.d;
      return a.ven.name.localeCompare(b.ven.name);
    });
  } else if (mode === 'me' && filter && !geo.chosen) {
    hits = v.list.filter(filterOk).map((x) => ({ ven: x, d: null }))
      .sort((a, b) => busyOf(b.ven) - busyOf(a.ven) || (b.ven.ratings || 0) - (a.ven.ratings || 0) || a.ven.name.localeCompare(b.ven.name));
  }

  // What is on the map (and in the cards): the search hits, the Middle venues, or the venues inside the circle.
  const shown: Spot[] = useMemo(() => {
    if (!pins) return [];
    const from = geo.chosen ? geo.centre : null;
    const spot = (x: Venue, inside: boolean): Spot | null => { const at = pins[x.id]; return at ? { ven: x, at, d: from ? km(from, at) : null, inside } : null; };
    if (mode === 'mid') {
      const out: Spot[] = [];
      midIds.forEach((id) => { const s = spot(v.byId[id], true); if (s) out.push(s); });
      if (pick && midIds.indexOf(pick) < 0 && v.byId[pick]) { const s = spot(v.byId[pick], false); if (s) out.push(s); }
      return out;
    }
    if (hits) {
      const out: Spot[] = [];
      hits.slice(0, SEARCH_MAX).forEach((h) => { const s = spot(h.ven, true); if (s) out.push(s); });
      if (pick && !out.some((s) => s.ven.id === pick) && v.byId[pick]) { const s = spot(v.byId[pick], true); if (s) out.push(s); }
      return out;
    }
    const out: Spot[] = [];
    const near: Spot[] = [];
    v.list.forEach((x) => {
      const at = pins[x.id];
      if (!at) return;
      const d = from ? km(from, at) : null;
      const inside = d !== null && d <= radius;
      if (pick === x.id) out.push({ ven: x, at, d, inside });
      else if (inside && filterOk(x)) near.push({ ven: x, at, d, inside });
    });
    // A crowded circle shows the busiest and nearest.
    near.sort((a, b) => busyOf(b.ven) - busyOf(a.ven) || (tagOf(b.ven) ? 1 : 0) - (tagOf(a.ven) ? 1 : 0) || (a.d as number) - (b.d as number));
    return out.concat(near.slice(0, radius >= 10 ? NEAR_FAR_MAX : NEAR_MAX));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v.list, pins, geo, radius, filter, query, pick, buzz, mode, midIds]);

  // Stops are always on the map, drawn as numbered circles.
  const minute = Math.floor(Date.now() / 60000);
  const markers: MapMarker[] = useMemo(() => {
    const list: MapMarker[] = shown.map(({ ven, at, inside }, i) => {
      const c = stopOf(ven.id), st = openState(ven);
      const kind: MapMarker['kind'] = pick === ven.id ? 'goal' : mode === 'mid' ? 'mid' : inside ? 'near' : 'far';
      return {
        id: ven.id, at, name: ven.name, kind, glyph: kindGlyph(ven),
        tag: mode === 'mid' ? (i === 0 ? 'Fairest' : '') : tagOf(ven), busy: mode === 'mid' ? 0 : busyOf(ven), open: st ? st.open : null,
        names: mode === 'mid' || i < NAMED, stop: c ? { n: c.position, done: c.done } : null
      };
    });
    const have: Record<string, boolean> = {};
    list.forEach((m) => { have[m.id] = true; });
    stops.forEach((c) => {
      const at = pins && pins[c.venue_id], ven = v.byId[c.venue_id];
      if (at && ven && !have[c.venue_id]) list.push({ id: ven.id, at, name: ven.name, kind: pick === ven.id ? 'goal' : 'near', glyph: kindGlyph(ven), tag: '', busy: 0, open: null, names: true, stop: { n: c.position, done: c.done } });
    });
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown, stops, pick, buzz, pins, v.byId, minute, mode]);
  const route: LatLng[] = useMemo(() => stops.map((c) => pins && pins[c.venue_id]).filter((x): x is [number, number] => !!x), [stops, pins]);
  const onPickPin = useCallback((id: string) => setPick(id), []);
  const pickVen = pick ? v.byId[pick] : null;

  /* ---------- moving the map ---------- */
  const refit = (coords: LatLng[]) => setFit((o) => ({ key: o.key + 1, coords }));
  const choose = useCallback((at: LatLng, isMine: boolean) => setGeo({ centre: at, mine: isMine, busy: false, chosen: true }), []);
  const modeNow = useRef(mode); modeNow.current = mode;
  const onMapPress = useCallback((at: LatLng) => {
    if (modeNow.current === 'mid') { setPick(null); return; }
    choose(at, false); setPick(null); setNote('');
  }, [choose]);

  const radiusNow = useRef(radius); radiusNow.current = radius;
  const locate = async (quiet?: boolean) => {
    if (geo.busy) return;
    setMode('me');
    setGeo((g) => ({ ...g, busy: true }));
    setNote('');
    const at = await findMe(true, !quiet);   // kept in memory only, never sent anywhere
    if (at) {
      choose(at, true);
      refit(circleCoords(at, radiusNow.current));
      if (!quiet) setNote('Your location stays on this phone and is never saved or shown to friends.');
    } else {
      setGeo((g) => ({ ...g, busy: false }));
      if (!quiet) setNote('Could not get your location. Tap the map to pick a spot instead.');
    }
  };
  // The map starts on where you are, showing the venues within the radius.
  useEffect(() => {
    if (geo.chosen) { refit(circleCoords(geo.centre, radiusNow.current)); return; }
    locate(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const setKm = (n: number) => { savedRadius = n; setRadius(n); setPick(null); if (geo.chosen) refit(circleCoords(geo.centre, n)); };

  // After a filter with no spot chosen, zoom to what it found.
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
  // Middle: zoom to the venues in the middle when they arrive or change.
  const midFit = useRef('');
  useEffect(() => {
    if (mode !== 'mid' || !pins) { midFit.current = ''; return; }
    const k = midIds.join(',');
    if (!k || k === midFit.current) return;
    midFit.current = k;
    refit(midIds.map((id) => pins[id]).filter(Boolean) as LatLng[]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, midIds, pins]);

  const showOnMap = (id: string) => {
    setPick(id);
    setQuery('');
    const at = pins && pins[id];
    if (at) setFocus((o) => ({ key: (o ? o.key : 0) + 1, at }));
  };
  // Back to the first card whenever what the cards show changes.
  useEffect(() => { if (deck.current) deck.current.scrollTo({ x: 0, animated: false }); }, [radius, filter, mode, geo]);

  const crawlRun = (fn: string, venue: string, okMsg?: string) => {
    if (!mine) return;
    const id = mine.id;
    f.act(fn, { p_sesh: id, p_venue: venue }, okMsg).then((l) => { if (Array.isArray(l)) setCrawl({ sesh: id, stops: l, off: false }); });
  };
  const rate = (ven: Venue, stars: number) => {
    f.act('rate_venue', { p_venue: ven.id, p_stars: stars, p_tags: ven.my_tags || [] }, 'Thanks, rating saved.').then(() => refreshVenues());
  };
  const vote = (id: string) => { if (live) f.act('cast_vote', { p_sesh: live.id, p_venue: id }, 'Your vote is in.'); };
  const myVote = live ? ((live.votes || []).filter((x) => x.user_id === me?.id)[0] || { venue_id: null }).venue_id : null;

  if (!me) return null;
  const count = !pins || !geo.chosen ? 0 : v.list.reduce((n, x) => (pins[x.id] && km(geo.centre, pins[x.id]) <= radius && filterOk(x) ? n + 1 : n), 0);
  const cards = shown.filter((x) => x.inside || mode === 'mid');
  const from = geo.mine ? 'you' : 'the pin';

  return (
    <View style={styles.fill}>
      <View style={styles.mapBox}>
        <NativeMap
          centre={geo.centre} radiusKm={radius} chosen={geo.chosen && mode === 'me'} mine={geo.mine} meName={me.name}
          markers={markers} route={route} fit={fit} focus={focus} onPick={onPickPin}
          onMapPress={onMapPress} onZoom={noZoom} radar
          pad={pad}
        />

        {/* The map runs from the very top to the very bottom; the top bar floats over a soft fade so it stays readable. */}
        <View style={styles.head} pointerEvents="box-none" onLayout={(e) => setHeadH(e.nativeEvent.layout.height)}>
          <LinearGradient colors={[fade(C.bg, 0.92), fade(C.bg, 0.55), fade(C.bg, 0)]} style={StyleSheet.absoluteFill} pointerEvents="none" />
          <View style={{ paddingTop: inset.top }}><TopBar f={f} onOpenWeb={onOpenWeb} /></View>
        </View>

        {/* up top: Around me / Middle, search, km buttons and filters */}
        <View style={[styles.float, { top: headH - 6 }]} pointerEvents="box-none">
          <View style={styles.pill}>
            <View style={styles.row}>
              <View style={styles.seg} accessibilityRole="radiogroup" accessibilityLabel="Show">
                {([['me', 'Around me'], ['mid', 'Middle']] as const).map(([k, name]) => (
                  <Pressable key={k} onPress={() => { setMode(k); setPick(null); setNote(''); }} testID={'map-mode-' + k} accessibilityRole="button" accessibilityLabel={name}
                    accessibilityState={{ selected: mode === k }} style={[styles.segBtn, mode === k && (k === 'mid' ? styles.segMid : styles.segOn)]}>
                    <Text style={[styles.segText, mode === k && (k === 'mid' ? styles.segMidText : styles.segOnText)]}>{name}</Text>
                  </Pressable>
                ))}
              </View>
              {mode === 'me' ? (
                <View style={styles.search}>
                  <Icon name="search" size={15} colour={C.muted} />
                  <TextInput
                    style={styles.input} value={query} onChangeText={setQuery} placeholder="Search" placeholderTextColor={C.muted}
                    autoCorrect={false} autoCapitalize="none" returnKeyType="search" accessibilityLabel="Search venues" testID="venue-search"
                  />
                  {query ? (
                    <Pressable onPress={() => setQuery('')} accessibilityRole="button" accessibilityLabel="Clear search" style={styles.clear}>
                      <Icon name="close" size={14} colour={C.muted} />
                    </Pressable>
                  ) : null}
                </View>
              ) : null}
            </View>
            {mode === 'me' && !words.length ? (
              <>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} accessibilityRole="radiogroup" accessibilityLabel="How far" testID="radius">
                  {KMS.map((n) => (
                    <Pressable key={n} onPress={() => setKm(n)} testID={'radius-' + n} accessibilityRole="button" accessibilityLabel={n + ' km'}
                      accessibilityState={{ selected: radius === n }} style={[styles.chip, styles.kmChip, radius === n && styles.kmOn]}>
                      <Text style={[styles.chipText, radius === n && styles.kmOnText]}>{n} km</Text>
                    </Pressable>
                  ))}
                </ScrollView>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} accessibilityRole="radiogroup" accessibilityLabel="Show only">
                  {FILTERS.map(([key, name]) => (
                    <Pressable key={key || 'near'} onPress={() => setFilter(filter === key ? '' : key)} testID={'chip-' + (key || 'near')} accessibilityRole="button" accessibilityLabel={name}
                      accessibilityState={{ selected: filter === key }} style={[styles.chip, filter === key && styles.chipOn]}>
                      <Text style={[styles.chipText, filter === key && styles.chipTextOn]}>{name}</Text>
                    </Pressable>
                  ))}
                </ScrollView>
              </>
            ) : null}
            {mode === 'mid' && live && !meetOff ? (
              <View style={styles.row} testID="map-meet">
                <Text style={[styles.small, styles.grow]} testID="map-meet-count">
                  <Text style={styles.strong}>{meet ? meet.shared : 0} of {live.members.length}</Text> sharing their rough area
                </Text>
                <Switch
                  value={!!(meet && meet.mine)} disabled={meetBusy || !meet} onValueChange={shareMeet} testID="map-meet-switch"
                  accessibilityLabel="Share my rough area for this sesh" trackColor={{ false: C.trackLine, true: C.on }} thumbColor="#ffffff"
                />
              </View>
            ) : null}
          </View>

          {hits && query ? (
            <ScrollView style={[styles.results, { maxHeight: Math.round(screenH * 0.32) }]} contentContainerStyle={styles.resultsBody} nestedScrollEnabled keyboardShouldPersistTaps="handled" testID="search-results">
              <Text style={styles.small}>
                {hits.length ? <Text style={styles.strong}>{hits.length} venue{hits.length === 1 ? '' : 's'}</Text> : 'No venues '}{hits.length ? ' match' + (hits.length === 1 ? 'es' : '') : 'match '}
                <Text style={styles.strong}> {query.trim()}</Text>
                {hits.length > SEARCH_LIST ? '. Type more to narrow it down.' : ''}
              </Text>
              {hits.slice(0, SEARCH_LIST).map((h) => <VenueRow key={h.ven.id} h={h} v={v} onShow={showOnMap} onOpen={onVenue} />)}
            </ScrollView>
          ) : null}
        </View>

        {pickVen ? null : <Pressable onPress={() => locate()} disabled={geo.busy} testID="map-near-me" accessibilityRole="button" accessibilityLabel={geo.busy ? 'Finding you' : 'Near me'}
          accessibilityState={{ selected: geo.mine && mode === 'me', disabled: geo.busy }} style={[styles.fab, { bottom: TABS_H + inset.bottom + 150 }, geo.mine && mode === 'me' && styles.fabOn]}>
          <Icon name="arrow" size={18} colour={geo.mine && mode === 'me' ? C.accentInk : C.fg} />
        </Pressable>}

        {/* along the bottom: the picked venue, or the venues as swipe cards */}
        <View style={[styles.bottom, { bottom: TABS_H + inset.bottom }]} pointerEvents="box-none">
          {pickVen ? (
            <PickCard
              ven={pickVen} v={v} geo={geo} mine={mine} live={live} stop={stopOf(pickVen.id)} crawlOff={crawl.off} crawlFull={stops.length >= CRAWL_MAX}
              onClose={() => setPick(null)} onOpen={() => onVenue(pickVen.id)} onRate={(n) => rate(pickVen, n)}
              onVote={() => vote(pickVen.id)} onAdd={() => crawlRun('crawl_add', pickVen.id, 'Added to the Sesh Map.')} onStop={() => onOpenWeb('sesh')}
            />
          ) : (
            <>
              <View style={styles.countRow} pointerEvents="box-none">
                {mode === 'mid' ? (
                  <Text style={styles.countTag}>{live ? (meetOff ? 'Middle is not set up yet' : midIds.length ? 'In the middle for everyone' : 'Waiting for mates') : 'Middle'}</Text>
                ) : geo.chosen && !hits ? (
                  <Text style={styles.countTag} testID="venue-count">
                    {count} venue{count === 1 ? '' : 's'}{filter ? ' ' + filterName.toLowerCase() : ''} within <Text testID="radius-label">{radius} km</Text> of {from}
                  </Text>
                ) : hits && !query ? (
                  <Text style={styles.countTag}>{hits.length} {filterName.toLowerCase()}</Text>
                ) : !geo.chosen ? (
                  <Text style={styles.countTag}>{geo.busy ? 'Finding you...' : 'Tap the map to pick a spot'}</Text>
                ) : null}
              </View>
              {note ? <Text style={[styles.countTag, styles.noteTag]} testID="map-note">{note}</Text> : null}
              {mode === 'mid' && !live ? (
                <View style={styles.card}><Text style={styles.small}>Start or join a sesh, then come back here to find the venues halfway between you and your mates. Nobody sees where anyone is.</Text></View>
              ) : mode === 'mid' && live && !meetOff && !midIds.length ? (
                <View style={styles.card} testID="map-meet-waiting">
                  <Text style={styles.small}>{meet && meet.mine ? 'Once a mate switches it on too, the venues between you light up gold.' : 'Switch it on above to share your rough area (to about 500 m) for this sesh only. Nobody sees it, only the venues it finds, and it is deleted when you switch off or the sesh ends.'}</Text>
                </View>
              ) : (
                <ScrollView ref={deck} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.deck} snapToInterval={CARD_W + 8} decelerationRate="fast" testID="venue-cards">
                  {cards.map((x, i) => (
                    <VenueCard key={x.ven.id} s={x} mid={mode === 'mid'} first={i === 0} pinFrom={!geo.mine}
                      voted={myVote === x.ven.id} canVote={!!live && !live.locked_venue} onShow={showOnMap} onVote={vote} />
                  ))}
                </ScrollView>
              )}
              <Pressable onPress={onWebMap} accessibilityRole="button" accessibilityLabel="Map not loading? Use the simple map" testID="map-simple" style={styles.simple}>
                <Text style={styles.simpleText}>Map not loading? Use the simple map</Text>
              </Pressable>
            </>
          )}
        </View>
      </View>
    </View>
  );
}

/* ---------- pieces ---------- */
const CARD_W = 228;
const TABS_H = 112;   // the floating thumb dock (its status orb rises above the bar) (App.tsx) sits over the bottom of the map
// One venue in the cards along the bottom.
function VenueCard({ s, mid, first, pinFrom, voted, canVote, onShow, onVote }: {
  s: Spot; mid: boolean; first: boolean; pinFrom: boolean; voted: boolean; canVote: boolean; onShow: (id: string) => void; onVote: (id: string) => void;
}) {
  const ven = s.ven, st = openState(ven);
  const tag = mid ? (first ? 'Fairest' : '') : '';
  return (
    <Pressable onPress={() => onShow(ven.id)} testID={'card-' + ven.id} accessibilityRole="button" accessibilityLabel={ven.name} style={styles.vcard}>
      <View style={[styles.vic, mid && { borderColor: GOLD }]}>
        <Icon name={kindGlyph(ven) === 'fork' ? 'fork' : kindGlyph(ven) === 'events' ? 'events' : 'venues'} size={16} colour={C.fg} />
        {st ? <View style={[styles.vdot, { backgroundColor: st.open ? C.on : C.off }]} /> : null}
      </View>
      <View style={styles.grow}>
        <Text style={styles.vname} numberOfLines={1}>{ven.name}{tag ? '  ' : ''}{tag ? <Text style={styles.gold}>{tag}</Text> : null}</Text>
        <Text style={styles.vmeta} numberOfLines={1}>{[ven.kind, hoursLine(ven), ven.ratings ? Number(ven.average).toFixed(1) + '★' : ''].filter(Boolean).join(' · ')}</Text>
      </View>
      {mid ? (
        canVote ? <Pressable onPress={() => onVote(ven.id)} testID={'card-vote-' + ven.id} accessibilityRole="button" accessibilityLabel={'Vote for ' + ven.name}
          accessibilityState={{ selected: voted }} style={[styles.vote, voted && styles.voteOn]}>
          <Text style={[styles.voteText, voted && styles.voteOnText]}>{voted ? 'Voted' : 'Vote'}</Text>
        </Pressable> : null
      ) : s.d !== null ? (
        <View>
          <Text style={styles.vkm}>{fmtKm(s.d)}</Text>
          <Text style={styles.vsub}>{pinFrom ? 'from pin' : walkText(s.d)}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

// A venue under the search box.
function VenueRow({ h, v, onShow, onOpen }: { h: Hit; v: Venues; onShow: (id: string) => void; onOpen: (id: string) => void }) {
  const ven = h.ven, onPin = !!(v.pins && v.pins[ven.id]);
  return (
    <View style={styles.card}>
      <View style={styles.row}>
        <View style={styles.grow}>
          <Text style={styles.title}>{ven.name}</Text>
          <Text style={styles.small}>{[ven.kind, hoursLine(ven)].filter(Boolean).join(', ')}</Text>
          <Text style={styles.small}>
            {h.d !== null ? <Text style={styles.strong}>{fmtKm(h.d)} </Text> : null}{h.d !== null ? 'away, ' : ''}
            {ven.ratings ? <Text><Text style={styles.strong}>{Number(ven.average).toFixed(1)}</Text> from {ven.ratings} rating{ven.ratings === 1 ? '' : 's'}</Text> : 'no ratings yet'}
          </Text>
        </View>
        <Button small ghost label={onPin ? 'Show' : 'Open'} testID={'show-' + ven.id} onPress={() => (onPin ? onShow(ven.id) : onOpen(ven.id))} />
      </View>
    </View>
  );
}

// The venue picked on the map, along the bottom.
function PickCard({ ven, v, geo, mine, live, stop, crawlOff, crawlFull, onClose, onOpen, onRate, onVote, onAdd, onStop }: {
  ven: Venue; v: Venues; geo: Geo; mine: SeshT | null; live: SeshT | null; stop: CrawlStop | null; crawlOff: boolean; crawlFull: boolean;
  onClose: () => void; onOpen: () => void; onRate: (n: number) => void; onVote: () => void; onAdd: () => void; onStop: () => void;
}) {
  const at = v.pins && v.pins[ven.id];
  const g = useGoogleRating(ven.id);
  const away = geo.chosen && at ? fmtKm(km(geo.centre, at)) + (geo.mine ? ' away' : ' from the pin') : '';
  return (
    <View style={[styles.card, styles.pick]} testID="map-pick">
      <View style={styles.row}>
        <View style={styles.grow}>
          {ven.is_example ? <Text style={styles.eyebrow}>Example venue</Text> : null}
          <Text style={styles.h2}>{ven.name}</Text>
          <Text style={styles.small}>{[ven.kind, hoursLine(ven), away].filter(Boolean).join(', ')}</Text>
        </View>
        <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" style={styles.round}><Icon name="close" size={18} colour={C.fg} /></Pressable>
      </View>
      <Text style={styles.small}>
        {ven.ratings ? Number(ven.average).toFixed(1) + ' ★ on Crewzy (' + ven.ratings + ')' : 'No Crewzy ratings yet'}
        {g ? '   ' : ''}
        {g ? <Text testID="google-rating" onPress={g.url ? () => Linking.openURL(g.url as string).catch(() => {}) : undefined}>
          <Text style={styles.strong}>{g.rating.toFixed(1)}</Text> ★ on Google ({g.count})</Text> : null}
      </Text>
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
        {live && !live.locked_venue ? <Button small ghost label="Vote for it" testID="pick-vote" onPress={onVote} /> : null}
        {mine && !crawlOff ? (
          stop ? <Button small ghost label={'Stop ' + stop.position + ' on the Sesh Map'} testID="pick-stop" onPress={onStop} />
            : crawlFull ? null : <Button small ghost label="Add to the Sesh Map" testID="pick-add" onPress={onAdd} />
        ) : null}
      </View>
    </View>
  );
}

const styles = themed(() => StyleSheet.create({
  fill: { flex: 1 },
  mapBox: { flex: 1, backgroundColor: C.dark ? '#14161c' : '#E9E6E0' },
  head: { position: 'absolute', top: 0, left: 0, right: 0, paddingBottom: 14 },
  float: { position: 'absolute', left: 10, right: 10, gap: 6 },
  pill: { backgroundColor: C.tabBg, borderRadius: 18, borderWidth: 1, borderColor: C.line, padding: 8, gap: 7 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  seg: { flexDirection: 'row', padding: 3, borderRadius: 18, backgroundColor: C.surface, borderWidth: 1, borderColor: C.line },
  segBtn: { minHeight: 30, paddingHorizontal: 11, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  segOn: { backgroundColor: C.accent },
  segMid: { backgroundColor: GOLD },
  segText: { fontFamily: F.bodyBold, fontSize: 12, color: C.fg },
  segOnText: { color: C.accentInk },
  segMidText: { color: '#1a1205' },
  search: { flex: 1, minWidth: 110, flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 36, paddingHorizontal: 10, borderRadius: 18, backgroundColor: C.surface, borderWidth: 1, borderColor: C.line },
  input: { flex: 1, fontFamily: F.body, fontSize: 14, color: C.fg, paddingVertical: 4 },
  clear: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  chips: { flexDirection: 'row', gap: 6 },
  chip: { minHeight: 32, paddingHorizontal: 12, borderRadius: 16, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface, alignItems: 'center', justifyContent: 'center' },
  chipOn: { backgroundColor: C.accent, borderColor: C.accent },
  chipText: { fontFamily: F.bodyBold, fontSize: 12, color: C.fg },
  chipTextOn: { color: C.accentInk },
  kmChip: { minWidth: 50 },
  kmOn: { backgroundColor: RADAR, borderColor: RADAR, shadowColor: RADAR, shadowOpacity: 0.8, shadowRadius: 8, shadowOffset: { width: 0, height: 0 }, elevation: 4 },
  kmOnText: { color: '#06210f' },
  results: { flexGrow: 0, backgroundColor: C.bg, borderRadius: 16, borderWidth: 1, borderColor: C.line },
  resultsBody: { gap: 8, padding: 10 },
  fab: { position: 'absolute', right: 12, width: 46, height: 46, borderRadius: 23, backgroundColor: C.tabBg, borderWidth: 1, borderColor: C.line, alignItems: 'center', justifyContent: 'center' },
  fabOn: { backgroundColor: C.accent },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0, gap: 6, paddingBottom: 2 },
  countRow: { flexDirection: 'row', paddingHorizontal: 12 },
  countTag: { fontFamily: F.bodyBold, fontSize: 12, color: C.fg, backgroundColor: C.tabBg, borderRadius: 10, paddingHorizontal: 9, paddingVertical: 3, overflow: 'hidden' },
  noteTag: { marginHorizontal: 12, alignSelf: 'flex-start', fontFamily: F.body },
  deck: { paddingHorizontal: 12, gap: 8 },
  vcard: { width: CARD_W, flexDirection: 'row', alignItems: 'center', gap: 9, backgroundColor: C.dark ? '#121318' : C.surface, borderRadius: 16, borderWidth: 1, borderColor: C.line, paddingVertical: 9, paddingHorizontal: 10 },
  vic: { width: 34, height: 34, borderRadius: 17, backgroundColor: C.surface2, borderWidth: 2, borderColor: 'transparent', alignItems: 'center', justifyContent: 'center' },
  vdot: { position: 'absolute', right: -2, bottom: -2, width: 10, height: 10, borderRadius: 5, borderWidth: 2, borderColor: C.bg },
  vname: { fontFamily: F.bodyBold, fontSize: 13, color: C.fg },
  vmeta: { fontFamily: F.body, fontSize: 11, color: C.muted },
  vkm: { fontFamily: F.display, fontSize: 13, color: C.fg, textAlign: 'right' },
  vsub: { fontFamily: F.body, fontSize: 10, color: C.muted, textAlign: 'right' },
  gold: { fontFamily: F.bodyBold, fontSize: 10, color: '#1a1205', backgroundColor: GOLD },
  vote: { paddingHorizontal: 11, minHeight: 30, borderRadius: 15, backgroundColor: C.surface2, alignItems: 'center', justifyContent: 'center' },
  voteOn: { backgroundColor: GOLD },
  voteText: { fontFamily: F.bodyBold, fontSize: 11, color: C.fg },
  voteOnText: { color: '#1a1205' },
  card: { backgroundColor: C.dark ? '#121318' : C.surface, borderRadius: 18, paddingVertical: 12, paddingHorizontal: 14, gap: 8, borderWidth: 1, borderColor: C.line, marginHorizontal: 12 },
  pick: { marginBottom: 6 },
  grow: { flex: 1, minWidth: 0 },
  title: { fontFamily: F.bodyBold, fontSize: 15, color: C.fg },
  h2: { fontFamily: F.display, fontSize: 19, color: C.fg },
  eyebrow: { fontFamily: F.bodyBold, fontSize: 11, letterSpacing: 0.8, textTransform: 'uppercase', color: C.muted },
  small: { fontFamily: F.body, fontSize: 13, lineHeight: 18, color: C.muted },
  strong: { fontFamily: F.bodyBold, color: C.fg },
  round: { width: 38, height: 38, borderRadius: 19, backgroundColor: C.surface2, alignItems: 'center', justifyContent: 'center' },
  stars: { flexDirection: 'row', gap: 2 },
  star: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center' },
  starText: { fontSize: 24, color: C.muted },
  starOn: { color: C.thinking },
  simple: { alignSelf: 'center', minHeight: 26, justifyContent: 'center', paddingHorizontal: 8 },
  simpleText: { fontFamily: F.body, fontSize: 11, color: C.muted, textDecorationLine: 'underline' }
}));
