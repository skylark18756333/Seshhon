// The Friends screen, opened from the people button in the header: friend requests, adding by username, and all
// your friends as a wall of round photos. Green friends glow, amber friends you're allowed to see get an amber
// ring and tag, and everyone else (red included) has a plain ring, so nobody can tell who is on red.
// Tapping a face opens their profile.
import React, { useState } from 'react';
import { Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import type { Friend } from './api';
import { openFriend } from './FriendProfile';
import Icon from './Icon';
import { Button, Face, Toast } from './Parts';
import type { Frendzy } from './useFrendzy';
import { C, COLOURS, F, fade, first, themed } from './theme';

const INVITE_BASE = 'https://frendzy.au/';
const ORDER: Record<string, number> = { on: 0, thinking: 1, off: 2 };

export default function Friends({ f, onBack, onOpenWeb }: { f: Frendzy; onBack: () => void; onOpenWeb: (tab: string) => void }) {
  const me = f.state && f.state.me;
  const friends = (f.state && f.state.friends) || [];
  const requests = (f.state && f.state.requests_in) || [];
  const [name, setName] = useState('');
  const [adding, setAdding] = useState(false);
  const [find, setFind] = useState('');
  const { width } = useWindowDimensions();
  if (!me) return null;
  // Three faces a row, sized to the screen (the page is at most 440 wide, with 18 each side).
  const col = Math.floor((Math.min(width, 440) - 36 - 2 * 14) / 3);
  const face = Math.min(col - 14, 104);
  const q = find.trim().toLowerCase();
  const list = friends
    .filter((x) => !q || x.name.toLowerCase().includes(q))
    .sort((a, b) => ORDER[a.colour] - ORDER[b.colour] || a.name.localeCompare(b.name));
  const greens = friends.filter((x) => x.colour === 'on').length;

  const add = () => {
    if (adding || !name.trim()) return;
    setAdding(true);
    f.addFriend(name.trim()).then((ok) => { setAdding(false); if (ok) setName(''); });
  };
  const share = () => {
    Share.share({ title: 'Crewzy', message: "Add me on Crewzy so we can see when we're both up for a sesh. " + INVITE_BASE + '?invite=' + me.invite_code }).catch(() => {});
  };

  return (
    <View style={styles.fill}>
      <View style={styles.top}>
        <Pressable onPress={onBack} accessibilityRole="button" accessibilityLabel="Back" style={styles.backBtn}>
          <Icon name="back" size={22} colour={C.fg} />
        </Pressable>
        <Text style={[styles.h1, styles.grow]} accessibilityRole="header">Friends</Text>
        <Text style={[styles.muted, styles.small]}>{friends.length}{greens ? ', ' + greens + ' green' : ''}</Text>
      </View>
      <ScrollView style={styles.fill} contentContainerStyle={styles.view} keyboardShouldPersistTaps="handled">
        {/* You, first: your own profile is one tap away. */}
        <Pressable style={({ pressed }) => [styles.meCard, { borderColor: fade(COLOURS[me.colour] || C.line, 0.55) }, pressed && { opacity: 0.85 }]}
          onPress={() => openFriend(me.id)} accessibilityRole="button" accessibilityLabel="Your profile" testID="friends-me">
          <View style={[styles.meRing, { borderColor: COLOURS[me.colour] || C.line, shadowColor: COLOURS[me.colour] || C.line }]}>
            <Face id={me.id} name={me.name} photos={f.photos} size={52} font={18} />
          </View>
          <View style={styles.grow}>
            <Text style={styles.group}>You</Text>
            <Text style={styles.meName} numberOfLines={1}>{me.name}</Text>
            <Text style={[styles.muted, styles.small]} numberOfLines={1}>See and customise your profile</Text>
          </View>
          <View style={styles.flip}><Icon name="back" size={18} colour={C.muted} /></View>
        </Pressable>

        {requests.length ? (
          <View style={styles.stack}>
            <Text style={styles.group}>Wants to add you</Text>
            {requests.map((r) => (
              <View key={r.friendship} style={styles.request}>
                <Face id={r.friendship} name={r.name} photos={{}} size={44} font={15} />
                <Text style={[styles.body, styles.grow]} numberOfLines={2}><Text style={styles.strong}>{r.name}</Text></Text>
                <Button label="Accept" small onPress={() => f.answer(r.friendship, true)} />
                <Button label="No" small ghost onPress={() => f.answer(r.friendship, false)} />
              </View>
            ))}
          </View>
        ) : null}

        <View style={styles.addRow}>
          <TextInput
            style={[styles.input, styles.grow]}
            value={name}
            onChangeText={setName}
            placeholder="Add by username"
            placeholderTextColor={C.muted}
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={21}
            returnKeyType="send"
            onSubmitEditing={add}
            accessibilityLabel="Add a friend by username"
          />
          <Button label="Add" small onPress={add} disabled={adding || !name.trim()} />
        </View>

        <View style={styles.chipRow}>
          <Pressable style={styles.chip} onPress={() => onOpenWeb('crews')} accessibilityRole="button" accessibilityLabel="Crews and besties" testID="open-crews">
            <Text style={styles.chipText}>Crews and besties</Text>
          </Pressable>
          <Pressable style={styles.chip} onPress={share} accessibilityRole="button" accessibilityLabel="Send your invite link">
            <Text style={styles.chipText}>Send invite link</Text>
          </Pressable>
        </View>

        {friends.length > 9 ? (
          <TextInput
            style={styles.input}
            value={find}
            onChangeText={setFind}
            placeholder="Search your friends"
            placeholderTextColor={C.muted}
            autoCorrect={false}
            accessibilityLabel="Search your friends"
          />
        ) : null}

        {!friends.length ? (
          <Text style={styles.muted}>No friends yet. Add them by username or send your invite link{f.username ? ', and tell them yours: ' + f.username : ''}.</Text>
        ) : (
          <View style={styles.wall}>
            {list.map((fr) => <Tile key={fr.id} fr={fr} photos={f.photos} col={col} face={face} />)}
          </View>
        )}
        {q && !list.length ? <Text style={styles.muted}>No friend called that.</Text> : null}
      </ScrollView>
      <Toast text={f.toast} />
    </View>
  );
}

// One friend: a round photo in a ring. Only green and amber get a colour; red looks the same as anyone else.
function Tile({ fr, photos, col, face }: { fr: Friend; photos: Record<string, string>; col: number; face: number }) {
  const lit = fr.colour === 'on' || fr.colour === 'thinking';
  const ring = lit ? COLOURS[fr.colour] : C.line;
  return (
    <Pressable style={[styles.tile, { width: col }]} onPress={() => openFriend(fr.id)} accessibilityRole="button"
      accessibilityLabel={'Open ' + fr.name + "'s profile" + (fr.colour === 'on' ? ', green' : fr.colour === 'thinking' ? ', amber' : '')}>
      <View style={[styles.ring, { borderColor: ring, borderWidth: lit ? 3 : 1.5, borderRadius: (face + 12) / 2, shadowColor: ring },
        fr.colour === 'on' && styles.glow, fr.colour === 'on' && { backgroundColor: fade(C.on, 0.12) }]}>
        <Face id={fr.id} name={fr.name} photos={photos} size={face} font={Math.round(face / 3)} />
      </View>
      {lit ? (
        <View style={[styles.tag, { backgroundColor: ring }]}>
          <Text style={styles.tagText}>{fr.colour === 'on' ? 'GREEN' : 'AMBER'}</Text>
        </View>
      ) : null}
      <Text style={styles.name} numberOfLines={1}>{first(fr.name)}</Text>
    </Pressable>
  );
}

const styles = themed(() => StyleSheet.create({
  fill: { flex: 1 },
  top: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingRight: 18, paddingTop: 12, paddingBottom: 6, maxWidth: 440, width: '100%', alignSelf: 'center' },
  backBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  view: { paddingHorizontal: 18, paddingTop: 8, paddingBottom: 28, gap: 14, maxWidth: 440, width: '100%', alignSelf: 'center' },
  grow: { flex: 1, minWidth: 0 },
  stack: { gap: 10 },
  h1: { fontFamily: F.display, fontSize: 26, lineHeight: 30, letterSpacing: -0.5, color: C.fg },
  body: { fontFamily: F.body, fontSize: 16, color: C.fg },
  strong: { fontFamily: F.bodyBold },
  muted: { fontFamily: F.body, fontSize: 16, lineHeight: 22, color: C.muted },
  small: { fontSize: 14, lineHeight: 20 },
  group: { fontFamily: F.bodyBold, fontSize: 12, letterSpacing: 1.4, textTransform: 'uppercase', color: C.muted },
  request: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: C.surface, borderRadius: 20, borderWidth: 1.5, borderColor: fade(C.on, 0.5), padding: 12 },
  meCard: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 14, borderRadius: 22, borderWidth: 1.5, backgroundColor: C.surface },
  meRing: { padding: 3, borderWidth: 2.5, borderRadius: 34, shadowOpacity: C.dark ? 0.8 : 0.3, shadowRadius: 10, shadowOffset: { width: 0, height: 0 } },
  meName: { fontFamily: F.display, fontSize: 20, color: C.fg },
  flip: { transform: [{ scaleX: -1 }] },
  addRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  input: { height: 50, borderRadius: 16, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface, paddingHorizontal: 16, color: C.fg, fontFamily: F.body, fontSize: 16 },
  chipRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  chip: { paddingVertical: 9, paddingHorizontal: 14, borderRadius: 999, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface },
  chipText: { fontFamily: F.bodyBold, fontSize: 14, color: C.fg },
  wall: { flexDirection: 'row', flexWrap: 'wrap', gap: 14, paddingTop: 6 },
  tile: { alignItems: 'center', gap: 6 },
  ring: { padding: 4.5 },
  glow: { shadowOpacity: C.dark ? 0.9 : 0.4, shadowRadius: 12, shadowOffset: { width: 0, height: 0 }, elevation: 4 },
  tag: { marginTop: -16, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8, borderWidth: 2, borderColor: C.bg },
  tagText: { fontFamily: F.bodyBold, fontSize: 9, letterSpacing: 0.8, color: '#0B0B0D' },
  name: { fontFamily: F.bodyBold, fontSize: 14, color: C.fg, maxWidth: '100%' }
}));
