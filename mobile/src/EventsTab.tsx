// The Events tab on the phone: festivals, concerts and gigs from the events table (api_events), in the app's own
// look so it follows You > Look. Each card has a badge for its kind, the place, the time (or "time to confirm") and
// how far away it is from your approximate location, which stays on the phone. Sharing comes later.
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { C, F, fmtWhen, themed } from './theme';
import { rpc } from './session';
import { km, useMyPlace } from './venues';

type Event = {
  id: string; title: string; kind: string; place: string; lat: number | null; lng: number | null;
  starts_at: string; ends_at: string; source_url: string | null; time_to_confirm: boolean;
};

// Concerts, gigs and festivals get the music note; comedy the mic; anything else the fork. Colours match the
// icon choices Sarah picked: blue for music, green for comedy, the accent for food and drink. A function, so the
// accent follows the Look the phone is using.
const badgeFor = (kind: string): { glyph: string; colour: string } => {
  if (kind === 'Comedy') return { glyph: '\u{1F3A4}', colour: '#22C55E' };
  if (kind === 'Concert' || kind === 'Gig' || kind === 'Festival') return { glyph: '\u266B', colour: '#2F7BFF' };
  return { glyph: '\u{1F374}', colour: C.accent };   // food and drink, and anything else
};

function whenLine(e: Event): string {
  if (e.time_to_confirm) {
    const d = new Date(e.starts_at);
    return d.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Australia/Perth' }) + ', time to confirm';
  }
  return fmtWhen(e.starts_at);
}

export default function EventsTab() {
  const [list, setList] = useState<Event[] | null>(null);
  const [failed, setFailed] = useState(false);
  const here = useMyPlace(false);

  useEffect(() => {
    let live = true;
    rpc<Event[]>('api_events')
      .then((rows) => { if (live) setList(rows || []); })
      .catch(() => { if (live) { setFailed(true); setList([]); } });
    return () => { live = false; };
  }, []);

  if (list === null) {
    return <View style={styles.centre}><ActivityIndicator color={C.muted} /></View>;
  }

  return (
    <ScrollView contentContainerStyle={styles.page} showsVerticalScrollIndicator={false}>
      <Text style={styles.heading}>Events</Text>
      <Text style={styles.sub}>Festivals, concerts and gigs near you.</Text>
      {list.length === 0 ? (
        <View style={styles.card}>
          <Text style={styles.title}>{failed ? "Couldn't load events" : 'Nothing listed yet'}</Text>
          <Text style={styles.small}>{failed ? 'Check your connection and try again.' : 'Gigs, festivals and comedy show up here when they are added.'}</Text>
        </View>
      ) : list.map((e) => {
        const badge = badgeFor(e.kind);
        const away = here && e.lat != null && e.lng != null ? km(here, [e.lat, e.lng]) : null;
        return (
          <View key={e.id} style={styles.card}>
            <View style={styles.top}>
              <View style={[styles.badge, { backgroundColor: badge.colour }]}>
                <Text style={styles.glyph}>{badge.glyph}</Text>
              </View>
              <View style={styles.main}>
                <Text style={styles.kind}>{e.kind}</Text>
                <Text style={styles.title}>{e.title}</Text>
                <Text style={styles.small}>{e.place}</Text>
                <Text style={styles.small}>{whenLine(e)}</Text>
              </View>
            </View>
            <View style={styles.row}>
              <View style={styles.dist}>
                <Text style={styles.distText}>{away == null ? 'Distance unknown' : away < 1 ? Math.round(away * 1000) + ' m away' : away.toFixed(1) + ' km away'}</Text>
              </View>
              {e.source_url ? (
                <Pressable onPress={() => Linking.openURL(e.source_url as string)} accessibilityRole="link">
                  <Text style={styles.more}>More info</Text>
                </Pressable>
              ) : null}
            </View>
          </View>
        );
      })}
    </ScrollView>
  );
}

const styles = themed(() => StyleSheet.create({
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  page: { padding: 16, gap: 12 },
  heading: { fontFamily: F.display, fontSize: 26, color: C.fg },
  sub: { fontFamily: F.body, fontSize: 13, color: C.muted, marginBottom: 6 },
  card: { backgroundColor: C.surface, borderWidth: 1, borderColor: C.line, borderRadius: 22, padding: 16, gap: 12 },
  top: { flexDirection: 'row', gap: 14, alignItems: 'center' },
  badge: { width: 58, height: 58, borderRadius: 29, alignItems: 'center', justifyContent: 'center' },
  glyph: { fontSize: 26, color: '#fff' },
  main: { flex: 1, minWidth: 0, gap: 2 },
  kind: { fontFamily: F.bodyBold, fontSize: 11, letterSpacing: 1, color: C.muted, textTransform: 'uppercase' },
  title: { fontFamily: F.displayBold, fontSize: 17, color: C.fg },
  small: { fontFamily: F.body, fontSize: 13, color: C.muted },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' },
  dist: { backgroundColor: C.surface2, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  distText: { fontFamily: F.bodyMid, fontSize: 13, color: C.fg },
  more: { fontFamily: F.bodyBold, fontSize: 13, color: C.accent }
}));
