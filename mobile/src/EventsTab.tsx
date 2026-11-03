// The Events tab on the phone: festivals, concerts, gigs, comedy and food from the events table (api_events), in the
// app's own look so it follows You > Look. Each card has a bold badge for its kind, the place, the time (or "time to
// confirm") and how far away it is from your approximate location, which stays on the phone. Tapping an event opens
// Crewzy's own pop-up with its details and what you can do with it: suggest it to friends (a locked friend message),
// add it to your sesh (posted in the sesh chat) or open the event's own page.
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';
import { LinearGradient } from 'expo-linear-gradient';
import { C, F, fmtWhen, themed } from './theme';
import { sendMessage, type Sesh as SeshT } from './api';
import Icon from './Icon';
import { sendToFriend } from './Messages';
import { Avatar, Button } from './Parts';
import { rpc } from './session';
import type { Frendzy } from './useFrendzy';
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

export default function EventsTab({ f }: { f: Frendzy }) {
  const [list, setList] = useState<Event[] | null>(null);
  const [open, setOpen] = useState<Event | null>(null);
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
          <Pressable key={e.id} style={styles.card} onPress={() => setOpen(e)} accessibilityRole="button" accessibilityLabel={e.title + ', more info'} testID={'event-' + e.id}>
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
              <Text style={styles.more}>More info</Text>
            </View>
          </Pressable>
        );
      })}
      <Modal visible={!!open} transparent animationType="slide" onRequestClose={() => setOpen(null)} statusBarTranslucent>
        {open ? <EventSheet f={f} e={open} away={here && open.lat != null && open.lng != null ? km(here, [open.lat, open.lng]) : null} onClose={() => setOpen(null)} /> : null}
      </Modal>
    </ScrollView>
  );
}

function awayLine(away: number | null): string {
  return away == null ? '' : away < 1 ? Math.round(away * 1000) + ' m away' : away.toFixed(1) + ' km away';
}
function isLater(s: SeshT): boolean {
  return !!(s.planned && s.starts_at && new Date(s.starts_at).getTime() > Date.now());
}

// The pop-up for one event: what, where, when, how far, and the three things to do with it. "Suggest to friends"
// turns the pop-up into a friend picker.
function EventSheet({ f, e, away, onClose }: { f: Frendzy; e: Event; away: number | null; onClose: () => void }) {
  const inset = useSafeAreaInsets().bottom;
  const [picking, setPicking] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');   // shown in the pop-up itself: the app's toast sits behind it
  const me = f.state && f.state.me;
  const friends = (f.state ? f.state.friends : []).slice().sort((a, b) => a.name.localeCompare(b.name));
  const seshes = (f.state ? f.state.seshes : []).filter((s) => s.am_member).sort((a, b) => Number(isLater(a)) - Number(isLater(b)));
  const mine = seshes[0] || null;
  const line = e.title + (e.place ? ' at ' + e.place : '') + ', ' + whenLine(e) + (e.source_url ? '. ' + e.source_url : '');

  const addToSesh = () => {
    if (!mine) { setNote('Start a sesh on Home first, then add this to it.'); return; }
    setBusy(true); setNote('');
    sendMessage(mine.id, ('\u{1F39F} Event idea: ' + line).slice(0, 500))
      .then(() => { f.say('Added to your sesh chat.'); onClose(); }, (err: { message?: string }) => setNote((err && err.message) || "Couldn't add it. Try again."))
      .then(() => setBusy(false));
  };
  const suggest = async () => {
    if (!me || !picked.length) return;
    setBusy(true); setNote('');
    let sent = 0, last = '';
    const sentTo: string[] = [];
    for (const id of picked) {
      try { await sendToFriend(me.id, id, '\u{1F39F} Keen for this? ' + line); sent += 1; sentTo.push(id); } catch (err) { last = (err as Error).message || ''; }
    }
    setBusy(false);
    if (sent === picked.length) { f.say(sent === 1 ? 'Sent.' : 'Sent to ' + sent + ' friends.'); onClose(); }
    else {
      setPicked((p) => p.filter((x) => sentTo.indexOf(x) < 0));
      setNote((sent ? 'Sent to ' + sent + '. ' : '') + (last || "Some didn't send. Try again."));
    }
  };
  const toggle = (id: string) => setPicked((p) => (p.indexOf(id) >= 0 ? p.filter((x) => x !== id) : p.concat(id)));

  return (
    <View style={styles.scrim}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />
      <View style={[styles.sheet, { paddingBottom: 18 + inset }]} testID="event-sheet">
        <View style={styles.handle} />
        {picking ? (
          <>
            <View style={styles.sheetHead}>
              <Pressable onPress={() => setPicking(false)} accessibilityRole="button" accessibilityLabel="Back" style={styles.round}><Icon name="back" size={18} colour={C.fg} /></Pressable>
              <Text style={[styles.sheetTitle, styles.main]}>Suggest to friends</Text>
            </View>
            <Text style={styles.small}>They get it as a locked message in Chats.</Text>
            {friends.length ? (
              <ScrollView style={styles.pickList} contentContainerStyle={styles.pickWrap}>
                {friends.map((fr) => {
                  const on = picked.indexOf(fr.id) >= 0;
                  return (
                    <Pressable key={fr.id} onPress={() => toggle(fr.id)} style={[styles.pick, on && styles.pickOn]} accessibilityRole="checkbox" accessibilityState={{ checked: on }} testID={'suggest-' + fr.id}>
                      <Avatar id={fr.id} name={fr.name} photos={f.photos} size={34} />
                      <Text style={styles.pickName} numberOfLines={1}>{fr.name}</Text>
                      {on ? <View style={styles.pickTick}><Icon name="tick" size={12} colour={C.accentInk} /></View> : null}
                    </Pressable>
                  );
                })}
              </ScrollView>
            ) : <Text style={styles.small}>Add some friends first.</Text>}
            {note ? <Text style={styles.note} testID="event-note">{note}</Text> : null}
            <Button label={busy ? 'Sending…' : picked.length ? 'Send to ' + picked.length : 'Pick friends'} disabled={busy || !picked.length} onPress={suggest} testID="suggest-send" />
          </>
        ) : (
          <>
            <View style={styles.sheetHead}>
              <Badge kind={e.kind} />
              <View style={styles.main}>
                <Text style={styles.kind}>{e.kind}</Text>
                <Text style={styles.sheetTitle}>{e.title}</Text>
              </View>
              <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" style={styles.round}><Icon name="close" size={18} colour={C.fg} /></Pressable>
            </View>
            <View style={styles.facts}>
              <Fact icon="clock" text={whenLine(e)} />
              {e.place ? <Fact icon="map" text={e.place} /> : null}
              {away != null ? <Fact icon="arrow" text={awayLine(away)} /> : null}
            </View>
            {note ? <Text style={styles.note} testID="event-note">{note}</Text> : null}
            <Button icon="send" label="Suggest to friends" onPress={() => { setNote(''); setPicking(true); }} testID="event-suggest" />
            <Button ghost icon="plus" label={mine ? 'Add to ' + (isLater(mine) ? 'your planned sesh' : "tonight's sesh") : 'Add to a sesh'} disabled={busy} onPress={addToSesh} testID="event-add" />
            {e.source_url ? (
              <Button ghost icon="arrow" label="View event page" onPress={() => Linking.openURL(e.source_url as string).catch(() => f.say("Couldn't open the page."))} testID="event-page" />
            ) : null}
          </>
        )}
      </View>
    </View>
  );
}

function Fact({ icon, text }: { icon: string; text: string }) {
  return (
    <View style={styles.fact}>
      <Icon name={icon} size={16} colour={C.muted} />
      <Text style={styles.factText}>{text}</Text>
    </View>
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
  emoji: { fontSize: 32, lineHeight: 38 },
  scrim: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.55)' },
  sheet: { backgroundColor: C.dark ? '#14141A' : '#FFFFFF', borderTopLeftRadius: 26, borderTopRightRadius: 26, borderWidth: 1, borderColor: C.line, padding: 18, gap: 12, maxHeight: '85%' },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: C.line },
  sheetHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  sheetTitle: { fontFamily: F.displayBold, fontSize: 20, color: C.fg },
  round: { width: 36, height: 36, borderRadius: 18, backgroundColor: C.surface2, alignItems: 'center', justifyContent: 'center' },
  facts: { gap: 8, paddingVertical: 4 },
  fact: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  factText: { flex: 1, fontFamily: F.body, fontSize: 14, color: C.fg },
  pickList: { maxHeight: 300 },
  pickWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pick: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 4, paddingRight: 12, minHeight: 44, borderRadius: 22, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface, maxWidth: '100%' },
  pickOn: { borderColor: C.accent, borderWidth: 2, backgroundColor: C.surface2 },
  pickName: { fontFamily: F.bodyBold, fontSize: 13, color: C.fg, flexShrink: 1 },
  pickTick: { width: 20, height: 20, borderRadius: 10, backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center' },
  note: { fontFamily: F.bodyMid, fontSize: 13, color: C.off }
}));
