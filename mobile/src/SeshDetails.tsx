// Inside a live sesh (Sarah's pick, "Live chat tile", 2026-11-03): the sesh's own name, emoji, colour and cover
// photo (migration 0044), the time left before it ends by itself (8 hours after it started), a clear End sesh, a
// big Chat tile showing the newest messages, small Vote / Crawl / Settings tiles, and each part opening full
// screen under a slim bar in the sesh's colour. Until 0044 is run, the sesh shows in the theme's colours and
// Settings can't change the name, colour or photo.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Image, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { LinearGradient } from 'expo-linear-gradient';
import type { Message, Sesh as SeshT } from './api';
import NativeMap from './NativeMap';
import type { LatLng, MapMarker } from './mapShared';
import { Button, Face } from './Parts';
import { shrinkCover } from './photos';
import { rpc } from './session';
import { C, F, fade, themed } from './theme';
import { leaderOf, type Venues } from './venues';

export const SESH_HOURS = 8;
// Fun, not drinks: Crewzy never puts alcohol up front (WA liquor rules).
export const EMOJIS = ['🎉', '🪩', '🎶', '🎤', '🍕', '🌮', '🎳', '🏖️', '🌙', '🔥', '😎', '✨'];
// The sesh colours (the same keys are checked in set_sesh_details, 0044). No colour: the theme's own.
export const SESH_COLOURS: Record<string, [string, string]> = {
  sunset: ['#FF7A45', '#E0407A'],
  ocean: ['#21C6A4', '#2A7FD4'],
  violet: ['#5B8CFF', '#9B5BFF'],
  gold: ['#F5A623', '#D4572A'],
  forest: ['#7AA52F', '#2E8F6A'],
  pop: ['#FF4FA0', '#6B2BD9']
};

export type Details = { name: string | null; emoji: string | null; colour: string | null; private: boolean; cover_at: string | null };
export type SeshLook = { details: Details | null; cover: string | null; ready: boolean; reload: () => void };

export function seshColours(d: Details | null): [string, string] {
  return d && d.colour && SESH_COLOURS[d.colour] ? SESH_COLOURS[d.colour] : [C.heroFrom, C.heroTo];
}

// Reads the sesh's name, emoji, colour and cover. ready is false when 0044 isn't on the database yet.
export function useSeshDetails(seshId: string | null): SeshLook {
  const [details, setDetails] = useState<Details | null>(null);
  const [ready, setReady] = useState(false);
  const [cover, setCover] = useState<{ at: string; url: string | null } | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!seshId) { setDetails(null); setCover(null); return; }
    let live = true;
    rpc<Details | null>('sesh_details', { p_sesh: seshId }).then(
      (d) => { if (live) { setDetails(d || null); setReady(true); } },
      () => { if (live) { setDetails(null); setReady(false); } }
    );
    return () => { live = false; };
  }, [seshId, tick]);
  // The photo itself is only fetched when it has changed.
  const coverAt = details ? details.cover_at : null;
  useEffect(() => {
    if (!seshId || !coverAt) { setCover(null); return; }
    if (cover && cover.at === coverAt) return;
    let live = true;
    rpc<string | null>('sesh_cover', { p_sesh: seshId }).then((url) => { if (live) setCover({ at: coverAt, url: url || null }); }, () => {});
    return () => { live = false; };
  }, [seshId, coverAt]); // eslint-disable-line react-hooks/exhaustive-deps
  // Read again every 20 seconds, so a new name or photo shows on everyone's phone.
  useEffect(() => { if (!seshId) return; const t = setInterval(() => setTick((n) => n + 1), 20000); return () => clearInterval(t); }, [seshId]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { details, cover: cover && coverAt ? cover.url : null, ready, reload };
}

function useNow(every: number) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), every); return () => clearInterval(t); }, [every]);
  return now;
}
function leftText(mins: number) { return mins >= 60 ? Math.floor(mins / 60) + 'h ' + (mins % 60) + 'm left' : mins + 'm left'; }

// "5h 12m left" until the sesh ends by itself, and (bar) a bar that empties as the 8 hours run down.
export function TimeLeft({ startsAt, bar, colour }: { startsAt?: string | null; bar?: boolean; colour?: string }) {
  const start = startsAt ? new Date(startsAt).getTime() : 0;
  const now = useNow(30000);
  if (!start) return null;
  const total = SESH_HOURS * 3600000;
  const left = Math.max(0, start + total - now);
  const text = <Text style={[styles.timeText, colour ? { color: colour } : null]} testID="sesh-time-left">⏱ {leftText(Math.round(left / 60000))}</Text>;
  if (!bar) return text;
  return (
    <View style={styles.timeWrap}>
      {text}
      <View style={styles.timeTrack}><View style={[styles.timeFill, { width: `${Math.round((left / total) * 100)}%` as `${number}%` }]} /></View>
    </View>
  );
}

// The cover photo behind a card, darkened so the white writing stays easy to read.
export function CoverBehind({ url }: { url: string | null }) {
  if (!url) return null;
  return (
    <>
      <Image source={{ uri: url }} style={StyleSheet.absoluteFill} resizeMode="cover" />
      <LinearGradient colors={['rgba(0,0,0,0.15)', 'rgba(0,0,0,0.6)']} style={StyleSheet.absoluteFill} />
    </>
  );
}

// Ending (or leaving) asks first. A browser has no Alert, so the browser test ends it straight away.
export function confirmEnd(mine: boolean, onEnd: () => void) {
  if (Platform.OS === 'web') { onEnd(); return; }
  Alert.alert(
    mine ? 'End the sesh?' : 'Leave the sesh?',
    mine ? 'It ends for everyone, and the chat, votes and Sesh Map are deleted.' : "You'll leave it. Everyone else carries on.",
    [{ text: 'Cancel', style: 'cancel' }, { text: mine ? 'End it' : 'Leave', style: 'destructive', onPress: onEnd }]
  );
}

// The red End sesh (or Leave) pill in the corner of the card.
export function EndPill({ mine, onEnd }: { mine: boolean; onEnd: () => void }) {
  return (
    <Pressable style={styles.endPill} onPress={() => confirmEnd(mine, onEnd)} accessibilityRole="button"
      accessibilityLabel={mine ? 'End the sesh' : 'Leave the sesh'} testID="sesh-end">
      <Text style={styles.endPillText}>{mine ? 'End sesh' : 'Leave'}</Text>
    </Pressable>
  );
}

// The big Chat tile in the sesh room: the newest messages, so you can see the chat without opening it.
export function ChatTile({ recent, myId, photos, colours, onOpen }: {
  recent: Message[]; myId: string; photos: Record<string, string>; colours: [string, string]; onOpen: () => void;
}) {
  return (
    <Pressable onPress={onOpen} accessibilityRole="button" accessibilityLabel="Open the chat" testID="sesh-chat-tile"
      style={({ pressed }) => pressed && styles.pressed}>
      <LinearGradient colors={colours} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.chatTile}>
        <View style={styles.rowBetween}>
          <Text style={styles.tileTitle}>💬 Chat</Text>
          <Text style={styles.tileNote}>Open ›</Text>
        </View>
        {recent.length ? recent.map((m) => (
          <View key={m.id} style={styles.chatLine}>
            <Face id={m.sender} name={m.name} photos={photos} size={22} font={9} />
            <Text style={styles.chatText} numberOfLines={2}>
              <Text style={styles.chatWho}>{m.sender === myId ? 'You' : (m.name || '').split(' ')[0]}</Text> {m.body}
            </Text>
          </View>
        )) : <Text style={styles.chatLineEmpty}>No messages yet. Say where you're heading.</Text>}
      </LinearGradient>
    </Pressable>
  );
}

export type RoomTile = { key: string; emoji: string; title: string; note: string; colours: [string, string]; onPress: () => void };
// The small tiles under the Chat tile: Vote (or Where), Crawl, Settings.
export function RoomTiles({ tiles }: { tiles: RoomTile[] }) {
  return (
    <View style={styles.tiles}>
      {tiles.map((t) => (
        <Pressable key={t.key} style={({ pressed }) => [styles.tileWrap, pressed && styles.pressed]} onPress={t.onPress}
          accessibilityRole="button" accessibilityLabel={t.title + '. ' + t.note} testID={'room-' + t.key}>
          <LinearGradient colors={t.colours} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.tile}>
            <Text style={styles.tileEmoji}>{t.emoji}</Text>
            <Text style={styles.tileTitle} numberOfLines={1}>{t.title}</Text>
            <Text style={styles.tileNote} numberOfLines={1}>{t.note}</Text>
          </LinearGradient>
        </Pressable>
      ))}
    </View>
  );
}

// A part opened full screen: a slim bar in the sesh colour (back, name, time left), then tabs between the parts.
export function SeshStrip<P extends string>({ title, startsAt, look, parts, on, onPart, onBack }: {
  title: string; startsAt?: string | null; look: SeshLook; parts: [P, string][]; on: P; onPart: (p: P) => void; onBack: () => void;
}) {
  return (
    <View style={styles.stripWrap}>
      <Pressable onPress={onBack} accessibilityRole="button" accessibilityLabel="Back to the sesh" testID="sesh-strip-back">
        <LinearGradient colors={seshColours(look.details)} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.strip}>
          <CoverBehind url={look.cover} />
          <Text style={styles.stripBack}>‹</Text>
          <View style={styles.grow}>
            <Text style={styles.stripTitle} numberOfLines={1}>{title}</Text>
            <TimeLeft startsAt={startsAt} colour="rgba(255, 255, 255, 0.9)" />
          </View>
        </LinearGradient>
      </Pressable>
      <View style={styles.tabs}>
        {parts.map(([k, label]) => (
          <Pressable key={k} style={[styles.tab, on === k && styles.tabOn]} onPress={() => onPart(k)}
            accessibilityRole="tab" accessibilityLabel={label} accessibilityState={{ selected: on === k }} testID={'sesh-' + k}>
            <Text style={[styles.tabText, on === k && styles.tabTextOn]} numberOfLines={1}>{label}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

// Settings, full screen: cover photo, colour, name and emoji and invite-only (for the person who started it),
// and a clear End sesh (or Leave) at the bottom.
export function SeshSettings({ s, look, say, onEnd, children }: {
  s: SeshT; look: SeshLook; say: (m: string) => void; onEnd: () => void; children?: React.ReactNode;
}) {
  const d = look.details;
  const can = !!s.mine && look.ready;
  const [name, setName] = useState((d && d.name) || '');
  const [emoji, setEmoji] = useState((d && d.emoji) || '');
  const [colour, setColour] = useState((d && d.colour) || '');
  const [closed, setClosed] = useState(d ? d.private : !!s.private);
  const [busy, setBusy] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  // When the details arrive (or change on someone else's phone), the form follows them.
  const sig = d ? [d.name, d.emoji, d.colour, d.private].join('|') : '';
  useEffect(() => {
    if (!d) return;
    setName(d.name || ''); setEmoji(d.emoji || ''); setColour(d.colour || ''); setClosed(d.private);
  }, [sig]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = () => {
    setBusy(true);
    rpc('set_sesh_details', { p_sesh: s.id, p_name: name, p_emoji: emoji, p_private: closed, p_colour: colour }).then(
      () => { setBusy(false); say('Sesh updated.'); look.reload(); },
      (e: { message?: string }) => { setBusy(false); say((e && e.message) || "Couldn't save that. Try again."); }
    );
  };
  const setPhoto = async (remove: boolean) => {
    let url: string | null = null;
    if (!remove) {
      // allowsEditing opens the phone's own crop screen: move and zoom the photo to fit the wide cover box.
      let picked: ImagePicker.ImagePickerResult;
      try { picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1, allowsEditing: true, aspect: [2, 1] }); } catch (e) { say('That photo could not be opened. Try a different one.'); return; }
      if (picked.canceled || !picked.assets || !picked.assets[0]) return;
      try { url = await shrinkCover(picked.assets[0]); } catch (e) { say('That photo could not be used. Try a different one.'); return; }
    }
    setPhotoBusy(true);
    rpc('set_sesh_cover', { p_sesh: s.id, p_cover: url }).then(
      () => { setPhotoBusy(false); say(remove ? 'Cover photo removed.' : 'Cover photo saved.'); look.reload(); },
      (e: { message?: string }) => { setPhotoBusy(false); say((e && e.message) || "Couldn't save that photo. Try again."); }
    );
  };
  const swatch: [string, string][] = Object.keys(SESH_COLOURS).map((k) => [k, k]);

  return (
    <View style={styles.settings} testID="sesh-settings">
      {can ? (
        <>
          <Text style={styles.h}>Cover photo</Text>
          <LinearGradient colors={seshColours(colour ? { ...(d as Details), colour } : d)} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.coverBox}>
            <CoverBehind url={look.cover} />
            <View style={styles.coverButtons}>
              <Pressable style={styles.coverBtn} onPress={() => setPhoto(false)} disabled={photoBusy} accessibilityRole="button" testID="sesh-cover">
                <Text style={styles.coverBtnText}>{photoBusy ? 'Saving...' : look.cover ? '📷 Change photo' : '📷 Add a photo'}</Text>
              </Pressable>
              {look.cover && !photoBusy ? (
                <Pressable style={styles.coverBtn} onPress={() => setPhoto(true)} accessibilityRole="button">
                  <Text style={styles.coverBtnText}>Remove</Text>
                </Pressable>
              ) : null}
            </View>
          </LinearGradient>

          <Text style={styles.h}>Sesh colour</Text>
          <View style={styles.wrap}>
            <Pressable onPress={() => setColour('')} accessibilityRole="button" accessibilityLabel="Theme colour" accessibilityState={{ selected: !colour }}
              style={[styles.swatchRing, !colour && styles.swatchOn]}>
              <LinearGradient colors={[C.heroFrom, C.heroTo]} style={styles.swatch} />
            </Pressable>
            {swatch.map(([k]) => (
              <Pressable key={k} onPress={() => setColour(k)} accessibilityRole="button" accessibilityLabel={'Colour ' + k}
                accessibilityState={{ selected: colour === k }} style={[styles.swatchRing, colour === k && styles.swatchOn]} testID={'sesh-colour-' + k}>
                <LinearGradient colors={SESH_COLOURS[k]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.swatch} />
              </Pressable>
            ))}
          </View>

          <Text style={styles.h}>Name your sesh</Text>
          <TextInput value={name} onChangeText={setName} maxLength={40} placeholder="Tonight's sesh" placeholderTextColor={C.muted}
            style={styles.input} accessibilityLabel="Sesh name" testID="sesh-name-input" />
          <Text style={styles.h}>Pick an emoji</Text>
          <View style={styles.wrap}>
            {EMOJIS.map((e) => (
              <Pressable key={e} onPress={() => setEmoji(emoji === e ? '' : e)} style={[styles.emoji, emoji === e && styles.emojiOn]}
                accessibilityRole="button" accessibilityState={{ selected: emoji === e }} accessibilityLabel={'Emoji ' + e}>
                <Text style={styles.emojiText}>{e}</Text>
              </Pressable>
            ))}
          </View>

          <Text style={styles.h}>Who can see it</Text>
          <View style={styles.wrap}>
            <Pressable style={[styles.pick, !closed && styles.pickOn]} onPress={() => setClosed(false)} accessibilityRole="button" accessibilityState={{ selected: !closed }} testID="sesh-public">
              <Text style={[styles.pickText, !closed && styles.pickTextOn]}>👋 All my friends</Text>
            </Pressable>
            <Pressable style={[styles.pick, closed && styles.pickOn]} onPress={() => setClosed(true)} accessibilityRole="button" accessibilityState={{ selected: closed }} testID="sesh-closed">
              <Text style={[styles.pickText, closed && styles.pickTextOn]}>🔒 Invite only</Text>
            </Pressable>
          </View>
          <Text style={styles.note}>{closed ? 'Only the people in it and friends you invite can see it.' : 'All your friends can see it and join.'}</Text>
          <Button label={busy ? 'Saving...' : 'Save'} onPress={save} disabled={busy} testID="sesh-save" />
        </>
      ) : (
        <Text style={styles.note}>
          {s.mine ? 'Naming the sesh, its colour and a cover photo are on the way.'
            : (s.private ? '🔒 Invite only. ' : '👋 Open to friends. ') + 'Only the person who started it can change the name, colour and photo.'}
        </Text>
      )}

      {children}

      <Pressable style={styles.endBig} onPress={() => confirmEnd(!!s.mine, onEnd)} accessibilityRole="button"
        accessibilityLabel={s.mine ? 'End the sesh' : 'Leave the sesh'} testID="sesh-end-big">
        <Text style={styles.endBigText}>{s.mine ? 'End sesh' : 'Leave the sesh'}</Text>
      </Pressable>
    </View>
  );
}

// A small map of the top three spots by votes: the leader in gold, the others as bubbles with their vote counts.
export function VotesMap({ s, v, meName, onPick }: { s: SeshT; v: Venues; meName: string; onPick: (id: string) => void }) {
  const tally = leaderOf(s);
  const pins = v.pins;
  const top = Object.keys(tally.by).filter((id) => pins && pins[id])
    .sort((a, b) => tally.by[b].n - tally.by[a].n || tally.by[a].firstAt - tally.by[b].firstAt).slice(0, 3);
  const sig = top.map((id) => id + ':' + tally.by[id].n).join('|');
  const markers: MapMarker[] = useMemo(() => top.map((id, i) => {
    const ven = v.byId[id], n = tally.by[id].n;
    return { id, at: pins![id], name: ven ? ven.name : 'A venue', kind: i === 0 ? 'goal' : 'near', glyph: 'venues', tag: n + ' vote' + (n === 1 ? '' : 's'),
      busy: 0, open: null, names: true, stop: null };
  }), [sig, v.byId]); // eslint-disable-line react-hooks/exhaustive-deps
  const coords: LatLng[] = markers.map((m) => m.at);
  const fit = useMemo(() => ({ key: Date.now(), coords }), [sig]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!top.length) return null;
  return (
    <View style={styles.mapWrap}>
      <Text style={styles.h}>Top votes on the map</Text>
      <View style={styles.map} testID="votes-map">
        <NativeMap centre={coords[0]} radiusKm={1} chosen={false} mine={false} meName={meName} markers={markers} route={[]}
          fit={fit} focus={null} onPick={onPick} onMapPress={noop} onZoom={noop} />
      </View>
    </View>
  );
}
const noop = () => {};

const styles = themed(() => StyleSheet.create({
  grow: { flex: 1, minWidth: 0 },
  pressed: { transform: [{ scale: 0.98 }] },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  timeText: { fontFamily: F.bodyBold, fontSize: 12, color: '#fff' },
  timeWrap: { gap: 6 },
  timeTrack: { height: 7, borderRadius: 4, backgroundColor: 'rgba(0, 0, 0, 0.25)', overflow: 'hidden' },
  timeFill: { height: 7, borderRadius: 4, backgroundColor: '#fff' },
  endPill: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 14, backgroundColor: 'rgba(255, 255, 255, 0.95)' },
  endPillText: { fontFamily: F.bodyBold, fontSize: 12, color: '#D93A33' },
  chatTile: { borderRadius: 22, padding: 14, gap: 8, minHeight: 130 },
  chatLine: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(0, 0, 0, 0.2)', borderRadius: 14, paddingVertical: 8, paddingHorizontal: 10 },
  chatLineEmpty: { fontFamily: F.body, fontSize: 14, color: 'rgba(255, 255, 255, 0.9)' },
  chatText: { flex: 1, minWidth: 0, fontFamily: F.body, fontSize: 14, color: '#fff' },
  chatWho: { fontFamily: F.bodyBold },
  tiles: { flexDirection: 'row', gap: 8 },
  tileWrap: { flex: 1 },
  tile: { borderRadius: 20, padding: 12, height: 96, justifyContent: 'space-between' },
  tileEmoji: { fontSize: 20 },
  tileTitle: { fontFamily: F.bodyBold, fontSize: 15, color: '#fff' },
  tileNote: { fontFamily: F.bodyMid, fontSize: 11, color: 'rgba(255, 255, 255, 0.9)' },
  stripWrap: { gap: 8 },
  strip: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 18, overflow: 'hidden' },
  stripBack: { fontFamily: F.bodyBold, fontSize: 24, color: '#fff', marginTop: -2 },
  stripTitle: { fontFamily: F.bodyBold, fontSize: 16, color: '#fff' },
  tabs: { flexDirection: 'row', gap: 6 },
  tab: { flex: 1, minHeight: 38, borderRadius: 14, borderWidth: 1, borderColor: C.line, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  tabOn: { backgroundColor: C.fg, borderColor: C.fg },
  tabText: { fontFamily: F.bodyBold, fontSize: 13, color: C.fg },
  tabTextOn: { color: C.bg },
  settings: { gap: 10 },
  h: { fontFamily: F.bodyBold, fontSize: 14, color: C.fg },
  coverBox: { height: 110, borderRadius: 18, overflow: 'hidden', justifyContent: 'flex-end', padding: 8 },
  coverButtons: { flexDirection: 'row', justifyContent: 'flex-end', gap: 6 },
  coverBtn: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 12, backgroundColor: 'rgba(0, 0, 0, 0.55)' },
  coverBtnText: { fontFamily: F.bodyBold, fontSize: 12, color: '#fff' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  swatchRing: { padding: 3, borderRadius: 22, borderWidth: 2, borderColor: 'transparent' },
  swatchOn: { borderColor: C.fg },
  swatch: { width: 34, height: 34, borderRadius: 17 },
  input: { fontFamily: F.body, fontSize: 16, color: C.fg, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 14, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface },
  emoji: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: C.line, backgroundColor: C.surface },
  emojiOn: { borderColor: C.on, borderWidth: 2, backgroundColor: fade(C.on, 0.15) },
  emojiText: { fontSize: 22 },
  pick: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 18, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface },
  pickOn: { borderColor: C.on, backgroundColor: fade(C.on, 0.15) },
  pickText: { fontFamily: F.bodyBold, fontSize: 13, color: C.muted },
  pickTextOn: { color: C.fg },
  note: { fontFamily: F.body, fontSize: 13, color: C.muted },
  endBig: { marginTop: 8, paddingVertical: 14, borderRadius: 20, borderWidth: 1.5, borderColor: C.off, backgroundColor: fade(C.off, 0.12), alignItems: 'center' },
  endBigText: { fontFamily: F.bodyBold, fontSize: 15, color: C.off },
  mapWrap: { gap: 8 },
  map: { height: 200, borderRadius: 20, overflow: 'hidden', borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }
}));
