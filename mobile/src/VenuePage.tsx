// A venue's own page in the phone app (it used to be the packed web page, with its OpenStreetMap map). Opened from
// a venue on Home, in a sesh, or "Open venue" on the Map. It shows the venue on a small Google map, whether it is
// open, how far away it is, its Crewzy and Google ratings, the week's hours, your own stars and tags, and what you
// can do with it: vote for it in your sesh, add it to the Sesh Map, get directions or share it.
// Your position is only used on the phone for the distance (venues.ts), as everywhere else.
import { LinearGradient } from 'expo-linear-gradient';
import React, { useEffect, useMemo, useState } from 'react';
import { Linking, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { seshCrawl, type CrawlStop, type Sesh as SeshT, type Venue } from './api';
import { NATIVE_MAP } from './config';
import { useGoogleRating } from './google';
import Icon from './Icon';
import { MapGuard } from './MapGuard';
import VenueMap from './VenueMap';
import { Button } from './Parts';
import { C, F, fade, themed } from './theme';
import type { Frendzy } from './useFrendzy';
import { awayText, openState, refreshVenues, useVenues } from './venues';

type Hours = { parse: (text: string) => unknown; table: (h: unknown) => { day: string; text: string }[] | null };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const SeshHours: Hours = require('../web/hours.generated.js');

const TAGS = ['Good vibe', 'Good value', 'Fast service'];
const CRAWL_MAX = 12;
const GOLD = '#FFC53D';

function isLater(s: SeshT): boolean {
  return !!(s.planned && s.starts_at && new Date(s.starts_at).getTime() > Date.now());
}
// Monday is 0, in Perth time, to light up today's row of the hours.
function perthDay(): number {
  try {
    const d = new Intl.DateTimeFormat('en-GB', { timeZone: 'Australia/Perth', weekday: 'short' }).format(new Date());
    return Math.max(0, ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(d));
  } catch (e) { return (new Date().getDay() + 6) % 7; }
}

export default function VenuePage({ f, id, onClose, onSesh }: { f: Frendzy; id: string; onClose: () => void; onSesh: () => void }) {
  const v = useVenues();
  const ven: Venue | undefined = v.byId[id];
  const at = v.pins ? v.pins[id] : undefined;
  const g = useGoogleRating(id);
  const [mapOff, setMapOff] = useState(false);
  // Your stars and tags as you tap them, so the page answers at once (and a tag tapped straight after the stars works)
  // before the venue list comes back from the database.
  const [mineRating, setMineRating] = useState<{ stars: number; tags: string[] } | null>(null);

  // Your sesh: tonight's first, else a planned one (the Sesh Map works on both), as on the Map tab.
  const seshes = (f.state && f.state.seshes) || [];
  const mine = seshes.filter((s) => s.am_member).sort((a, b) => Number(isLater(a)) - Number(isLater(b)))[0] || null;
  const later = !!mine && isLater(mine);
  const meId = f.state && f.state.me ? f.state.me.id : null;
  const myVote = mine ? ((mine.votes || []).filter((x) => x.user_id === meId)[0] || { venue_id: null }).venue_id : null;

  const [stops, setStops] = useState<CrawlStop[] | null>(null);   // null: no Sesh Map (no sesh, or an older database)
  const mineId = mine ? mine.id : null;
  useEffect(() => {
    if (!mineId) { setStops(null); return; }
    let gone = false;
    seshCrawl(mineId).then((l) => { if (!gone) setStops(l); }, () => { if (!gone) setStops(null); });
    return () => { gone = true; };
  }, [mineId]);
  const stop = stops ? stops.filter((s) => s.venue_id === id)[0] || null : null;

  const rows = useMemo(() => (ven && ven.hours ? SeshHours.table(SeshHours.parse(ven.hours)) : null), [ven && ven.hours]);
  const today = perthDay();

  if (!ven) {
    return (
      <View style={styles.fill}>
        <View style={styles.bar}><Back onPress={onClose} /></View>
        <View style={styles.page}><Text style={styles.muted}>{v.list.length ? 'That venue is no longer listed.' : 'Loading the venue…'}</Text></View>
      </View>
    );
  }

  const st = openState(ven);
  const away = awayText(v, id);
  const myStars = mineRating ? mineRating.stars : ven.my_stars || 0;
  const myTags = mineRating ? mineRating.tags : ven.my_tags || [];
  const rate = (stars: number) => {
    setMineRating({ stars, tags: myTags });
    f.act('rate_venue', { p_venue: ven.id, p_stars: stars, p_tags: myTags }, 'Thanks, rating saved.').then(() => refreshVenues());
  };
  const tag = (t: string) => {
    if (!myStars) { f.say('Pick your stars first.'); return; }
    const tags = myTags.indexOf(t) >= 0 ? myTags.filter((x) => x !== t) : myTags.concat(t);
    setMineRating({ stars: myStars, tags });
    f.act('rate_venue', { p_venue: ven.id, p_stars: myStars, p_tags: tags }).then(() => refreshVenues());
  };
  const vote = () => { if (mine) f.act('cast_vote', { p_sesh: mine.id, p_venue: ven.id }, 'Your vote is in.'); };
  const addStop = () => {
    if (!mine) return;
    f.act('crawl_add', { p_sesh: mine.id, p_venue: ven.id }, 'Added to the Sesh Map.').then((l) => { if (Array.isArray(l)) setStops(l); });
  };
  const directions = () => {
    const url = at ? 'https://www.google.com/maps/dir/?api=1&destination=' + at[0] + ',' + at[1]
      : 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(ven.name + ' Perth');
    Linking.openURL(url).catch(() => f.say("Couldn't open maps."));
  };
  const share = () => {
    const text = ven.name + (ven.kind ? ' (' + ven.kind + ')' : '') + ', who is keen? On Crewzy.';
    Share.share({ message: text + ' https://frendzy.au/' }).catch(() => {});
  };

  const showMap = NATIVE_MAP && !mapOff && !!at;
  const openColour = st ? (st.open ? (st.soon ? GOLD : C.on) : C.off) : C.muted;

  return (
    <View style={styles.fill} testID="venue-page">
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.hero}>
          {showMap ? (
            <MapGuard onFail={() => setMapOff(true)}>
              <VenueMap at={at!} dark={C.dark} pin={C.off} onPress={directions} />
            </MapGuard>
          ) : (
            <LinearGradient colors={[C.heroFrom, C.heroTo]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
          )}
          <LinearGradient colors={['transparent', C.bg]} style={styles.heroFade} pointerEvents="none" />
          <View style={styles.heroBar}><Back onPress={onClose} /></View>
        </View>

        <View style={styles.page}>
          <View style={styles.head}>
            {ven.is_example ? <Text style={styles.eyebrow}>Example venue</Text> : null}
            <Text style={styles.name}>{ven.name}</Text>
            <View style={styles.chips}>
              {ven.kind ? <View style={styles.chip}><Text style={styles.chipText}>{ven.kind}</Text></View> : null}
              <View style={[styles.chip, { borderColor: fade(openColour, 0.6), backgroundColor: fade(openColour, 0.14) }]}>
                <View style={[styles.dot, { backgroundColor: openColour }]} />
                <Text style={styles.chipText}>{st ? st.text : 'Hours unknown'}</Text>
              </View>
              {away ? <View style={styles.chip}><Icon name="arrow" size={13} colour={C.fg} /><Text style={styles.chipText}>{away}</Text></View> : null}
            </View>
          </View>

          <View style={styles.scores}>
            <View style={styles.score}>
              <Text style={styles.big}>{ven.ratings ? Number(ven.average).toFixed(1) : '–'}<Text style={styles.starGold}> ★</Text></Text>
              <Text style={styles.small}>{ven.ratings ? 'Crewzy, ' + ven.ratings + ' rating' + (ven.ratings === 1 ? '' : 's') : 'No Crewzy ratings yet'}</Text>
            </View>
            {g ? (
              <Pressable style={styles.score} onPress={g.url ? () => Linking.openURL(g.url as string).catch(() => {}) : undefined} accessibilityRole="link" testID="google-rating">
                <Text style={styles.big}>{g.rating.toFixed(1)}<Text style={styles.starGold}> ★</Text></Text>
                <Text style={styles.small}>Google, {g.count} reviews</Text>
              </Pressable>
            ) : null}
          </View>

          <View style={styles.actions}>
            {mine && !mine.locked_venue ? (
              <Button label={myVote === ven.id ? 'You voted for this' : 'Vote for this in ' + (later ? 'your planned sesh' : "tonight's sesh")}
                onPress={vote} disabled={myVote === ven.id} testID="venue-vote" />
            ) : null}
            {mine && stops ? (
              stop ? <Button ghost label={'Stop ' + stop.position + ' on the Sesh Map'} onPress={onSesh} testID="venue-stop" />
                : stops.length < CRAWL_MAX ? <Button ghost icon="plus" label="Add to the Sesh Map" onPress={addStop} testID="venue-add" /> : null
            ) : null}
            <View style={styles.pair}>
              <View style={styles.half}><Button ghost small icon="map" label="Directions" onPress={directions} testID="venue-directions" /></View>
              <View style={styles.half}><Button ghost small icon="up" label="Share" onPress={share} testID="venue-share" /></View>
            </View>
          </View>

          <View style={styles.card}>
            <Text style={styles.h2}>Opening hours</Text>
            {rows ? rows.map((r, i) => (
              <View key={r.day} style={[styles.hourRow, i === today && styles.today]}>
                <Text style={[styles.hourDay, i === today && styles.todayText]}>{r.day}{i === today ? ' (today)' : ''}</Text>
                <Text style={[styles.hourText, i === today && styles.todayText]}>{r.text}</Text>
              </View>
            )) : <Text style={styles.muted}>{ven.hours ? 'Listed as: ' + ven.hours : 'Hours unknown. Check with the venue before you go.'}</Text>}
          </View>

          <View style={styles.card}>
            <Text style={styles.h2}>Rate this venue</Text>
            <View style={styles.stars} accessibilityLabel={'Rate ' + ven.name}>
              {[1, 2, 3, 4, 5].map((n) => (
                <Pressable key={n} onPress={() => rate(n)} testID={'venue-star-' + n} accessibilityRole="button"
                  accessibilityLabel={'Rate ' + n + ' star' + (n > 1 ? 's' : '')} accessibilityState={{ selected: myStars >= n }} style={styles.star}>
                  <Text style={[styles.starText, myStars >= n && styles.starOn]}>★</Text>
                </Pressable>
              ))}
            </View>
            <View style={styles.chips}>
              {TAGS.map((t) => {
                const on = myTags.indexOf(t) >= 0;
                return (
                  <Pressable key={t} onPress={() => tag(t)} accessibilityRole="button" accessibilityState={{ selected: on }}
                    style={[styles.tag, on && styles.tagOn]} testID={'venue-tag-' + t}>
                    <Text style={[styles.tagText, on && styles.tagTextOn]}>{t}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

function Back({ onPress }: { onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel="Back" style={styles.back} testID="venue-back" hitSlop={8}>
      <Icon name="back" size={20} colour="#FFFFFF" />
    </Pressable>
  );
}

const styles = themed(() => StyleSheet.create({
  fill: { flex: 1, backgroundColor: C.bg },
  scroll: { paddingBottom: 120 },
  bar: { padding: 16 },
  hero: { height: 230, overflow: 'hidden', backgroundColor: C.surface },
  heroFade: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 90 },
  heroBar: { position: 'absolute', top: 12, left: 12 },
  back: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center' },
  page: { paddingHorizontal: 16, gap: 16, marginTop: -28 },
  head: { gap: 8 },
  eyebrow: { fontFamily: F.bodyBold, fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: C.muted },
  name: { fontFamily: F.displayBold, fontSize: 32, lineHeight: 38, color: C.fg },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, minHeight: 30, borderRadius: 15, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface },
  chipText: { fontFamily: F.bodyMid, fontSize: 13, color: C.fg },
  dot: { width: 8, height: 8, borderRadius: 4 },
  scores: { flexDirection: 'row', gap: 10 },
  score: { flex: 1, backgroundColor: C.surface, borderWidth: 1, borderColor: C.line, borderRadius: 18, padding: 14, gap: 2 },
  big: { fontFamily: F.displayBold, fontSize: 26, color: C.fg },
  starGold: { color: GOLD, fontSize: 20 },
  small: { fontFamily: F.body, fontSize: 12, color: C.muted },
  muted: { fontFamily: F.body, fontSize: 14, color: C.muted },
  actions: { gap: 10 },
  pair: { flexDirection: 'row', gap: 10 },
  half: { flex: 1 },
  card: { backgroundColor: C.surface, borderWidth: 1, borderColor: C.line, borderRadius: 22, padding: 16, gap: 10 },
  h2: { fontFamily: F.displayBold, fontSize: 18, color: C.fg },
  hourRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6, paddingHorizontal: 10, borderRadius: 10 },
  today: { backgroundColor: C.surface2 },
  hourDay: { fontFamily: F.body, fontSize: 14, color: C.muted },
  hourText: { fontFamily: F.body, fontSize: 14, color: C.fg },
  todayText: { fontFamily: F.bodyBold, color: C.fg },
  stars: { flexDirection: 'row', gap: 6 },
  star: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  starText: { fontSize: 34, color: C.line },
  starOn: { color: GOLD },
  tag: { minHeight: 36, paddingHorizontal: 14, borderRadius: 18, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface, alignItems: 'center', justifyContent: 'center' },
  tagOn: { backgroundColor: C.accent, borderColor: C.accent },
  tagText: { fontFamily: F.bodyBold, fontSize: 13, color: C.fg },
  tagTextOn: { color: C.accentInk }
}));
