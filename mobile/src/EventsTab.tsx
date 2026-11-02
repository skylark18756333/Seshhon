// The Events tab on the phone: festivals, concerts, gigs, comedy and food from the events table (api_events), in the
// app's own look so it follows You > Look. Each card has a bold badge for its kind, the place, the time (or "time to
// confirm") and how far away it is from your approximate location, which stays on the phone. Sharing comes later.
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { LinearGradient } from 'expo-linear-gradient';
import { C, F, fmtWhen, themed } from './theme';
import { rpc } from './session';
import { km, useMyPlace } from './venues';

type Event = {
  id: string; title: string; kind: string; place: string; lat: number | null; lng: number | null;
  starts_at: string; ends_at: string; source_url: string | null; time_to_confirm: boolean;
};

// Solid, bold icons on a glowing gradient disc, as in the mock-up Sarah picked: a note for music (blue), a mic for
// comedy (green), a fork for food and drink (the accent). Paths are filled shapes so they read at a glance.
const NOTE = 'M19 3v11.3a3.5 3.5 0 1 1-2-3.16V6.2L9 8.1V18a3.5 3.5 0 1 1-2-3.16V6l12-3z';
const MIC = 'M12 2a3.5 3.5 0 0 0-3.5 3.5v5a3.5 3.5 0 0 0 7 0v-5A3.5 3.5 0 0 0 12 2z M5 10.5a1 1 0 0 1 2 0 5 5 0 0 0 10 0 1 1 0 0 1 2 0 7 7 0 0 1-6 6.93V21h3a1 1 0 0 1 0 2H8a1 1 0 0 1 0-2h3v-3.57A7 7 0 0 1 5 10.5z';

// Badges copied from the icon mock-up Sarah picked: the solid note in blue for music, the solid mic in green for
// comedy, and the fork emoji on the purple-to-pink gradient for food and drink.
const badgeFor = (kind: string): { colours: [string, string]; glow: string; path?: string; emoji?: string } => {
  if (kind === 'Comedy') return { colours: ['#22C55E', '#86EFAC'], glow: '#22C55E', path: MIC };
  if (kind === 'Concert' || kind === 'Gig' || kind === 'Festival') return { colours: ['#2F7BFF', '#5AA8FF'], glow: '#2F7BFF', path: NOTE };
  return { colours: ['#7C4DFF', '#FF4FA3'], glow: '#FF4FA3', emoji: '\u{1F374}' };   // food and drink, and anything else
};

function whenLine(e: Event): string {
  if (e.time_to_confirm) {
    const d = new Date(e.starts_at);
    return d.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Australia/Perth' }) + ', time to confirm';
  }
  return fmtWhen(e.starts_at);
}

function Badge({ kind }: { kind: string }) {
  const b = badgeFor(kind);
  return (
    <View style={[styles.glow, { shadowColor: b.glow }]}>
      <LinearGradient colors={b.colours} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.badge}>
        {b.emoji
          ? <Text style={styles.emoji}>{b.emoji}</Text>
          : <Svg width={34} height={34} viewBox="0 0 24 24"><Path d={b.path as string} fill="#FFFFFF" /></Svg>}
      </LinearGradient>
    </View>
  );
}

export default function EventsTab() {
  const [list, setList] = useState<Event[] | null>(null);
  const [failed, setFailed] = useState(false);
  const here = useMyPlace(true);   // asks for location once, the same as the Map; the position stays on the phone

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
      <Text style={styles.sub}>Festivals, concerts, gigs, comedy and food near you.</Text>
      {list.length === 0 ? (
        <View style={styles.card}>
          <Text style={styles.title}>{failed ? "Couldn't load events" : 'Nothing listed yet'}</Text>
          <Text style={styles.small}>{failed ? 'Check your connection and try again.' : 'Gigs, festivals, comedy and food show up here when they are added.'}</Text>
        </View>
      ) : list.map((e) => {
        const away = here && e.lat != null && e.lng != null ? km(here, [e.lat, e.lng]) : null;
        return (
          <View key={e.id} style={styles.card}>
            <View style={styles.top}>
              <Badge kind={e.kind} />
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
  glow: { borderRadius: 33, shadowOpacity: 0.55, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 6 },
  badge: { width: 66, height: 66, borderRadius: 33, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: 'rgba(255,255,255,0.55)' },
  main: { flex: 1, minWidth: 0, gap: 2 },
  kind: { fontFamily: F.bodyBold, fontSize: 11, letterSpacing: 1, color: C.muted, textTransform: 'uppercase' },
  title: { fontFamily: F.displayBold, fontSize: 17, color: C.fg },
  small: { fontFamily: F.body, fontSize: 13, color: C.muted },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' },
  dist: { backgroundColor: C.surface2, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  distText: { fontFamily: F.bodyMid, fontSize: 13, color: C.fg },
  more: { fontFamily: F.bodyBold, fontSize: 13, color: C.accent },
  emoji: { fontSize: 32, lineHeight: 38 }
}));
