// The native Home screen: the logo with the three status lights, your status, who's up for it, and tonight's seshes.
// It shows the same things in the same words as home() in docs/app.js.
import React, { useEffect, useRef, useState } from 'react';
import { Animated, PanResponder, Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import type { Colour, Friend, Sesh } from './api';
import { CatchUpCards } from './Crews';
import { Button, Face, Toast, TopBar } from './Parts';
import type { Frendzy } from './useFrendzy';
import { C, COLOURS, F, LABELS, STATUS_COPY, fade, first, fmtLeft, initials, themed } from './theme';
import { useVenues, type Venues } from './venues';

const INVITE_BASE = 'https://frendzy.au/';
// The big switch runs red, amber, green from left to right.
const SWITCH: Colour[] = ['off', 'thinking', 'on'];

export default function Home({ f, onOpenWeb }: { f: Frendzy; onOpenWeb: (tab: string) => void }) {
  const me = f.state && f.state.me;
  const [linkShown, setLinkShown] = useState(false);
  const [friendName, setFriendName] = useState('');
  const [adding, setAdding] = useState(false);
  const v = useVenues();
  if (!me) return null;
  const colour = me.colour;
  const copy = STATUS_COPY[colour];
  const friends = f.state ? f.state.friends : [];
  const requests = f.state ? f.state.requests_in : [];
  const nights = (f.state ? f.state.seshes : []).filter((s) => !(s.planned && s.starts_at && new Date(s.starts_at).getTime() > Date.now()))
    .sort((x, y) => Number(y.am_member) - Number(x.am_member));
  // Only friends on green show here. Red friends are never shown. Amber friends stay out of sight until friends can choose to allow it.
  const greens = friends.filter((x) => x.colour === 'on');

  const share = () => {
    const link = INVITE_BASE + '?invite=' + me.invite_code;
    setLinkShown(true);
    Share.share({ title: 'Frendzy', message: "Add me on Frendzy so we can see when we're both up for a sesh. " + link }).catch(() => {});
  };

  return (
    <View style={styles.fill}>
      <TopBar f={f} onOpenWeb={onOpenWeb} />

      <ScrollView style={styles.fill} contentContainerStyle={styles.view} keyboardShouldPersistTaps="handled">
        {/* Your status: one card with the word, how long it lasts, and the switch to change it. */}
        <StatusCard colour={colour} word={copy[0]} note={colour !== 'off' && me.expires_at ? <Until at={me.expires_at} /> : copy[1]} onPick={(c) => { if (c !== colour) f.setColour(c); }} />

        {requests.length ? (
          <View style={styles.stack}>
            <Text style={styles.h2}>Friend requests</Text>
            {requests.map((r) => (
              <View key={r.friendship} style={styles.card}>
                <View style={styles.row}>
                  <View style={styles.avatar}><Text style={styles.avatarText}>{initials(r.name)}</Text></View>
                  <Text style={[styles.body, styles.grow]}><Text style={styles.strong}>{r.name}</Text> wants to add you</Text>
                </View>
                <View style={styles.row}>
                  <Button label="Accept" small onPress={() => f.answer(r.friendship, true)} />
                  <Button label="Decline" small ghost onPress={() => f.answer(r.friendship, false)} />
                </View>
              </View>
            ))}
          </View>
        ) : null}

        {!friends.length ? (
          <View style={styles.card}>
            <Text style={styles.h2}>Add your friends</Text>
            <Text style={[styles.muted, styles.small]}>Frendzy only works with friends on it. Add them by username or send them your invite link, then accept their request when it arrives.</Text>
            <View style={styles.field}>
              <Text style={styles.label}>Add by username</Text>
              <View style={styles.row}>
                <TextInput
                  style={[styles.input, styles.grow]}
                  value={friendName}
                  onChangeText={setFriendName}
                  placeholder="their username"
                  placeholderTextColor={C.muted}
                  autoCapitalize="none"
                  autoCorrect={false}
                  maxLength={21}
                />
                <Button
                  label="Add"
                  small
                  onPress={() => {
                    if (adding) return;
                    setAdding(true);
                    f.addFriend(friendName.trim()).then((ok) => { setAdding(false); if (ok) setFriendName(''); });
                  }}
                />
              </View>
            </View>
            <Text style={[styles.muted, styles.small]}>
              {f.username ? <Text>Your username is <Text style={styles.strong}>{f.username}</Text>. Tell your friends so they can add you.</Text>
                : 'Pick a username on the You page so friends can add you too.'}
            </Text>
            <Button label="Send your invite link" ghost onPress={share} />
            {linkShown ? (
              <>
                <Text style={[styles.muted, styles.small]}>Copy this link and send it to a friend:</Text>
                <Text selectable style={styles.linkbox}>{INVITE_BASE + '?invite=' + me.invite_code}</Text>
              </>
            ) : null}
          </View>
        ) : colour === 'off' ? (
          <View style={styles.card}>
            <Text style={styles.h2}>Friends are hidden while you're red</Text>
            <Text style={[styles.muted, styles.small]}>Tap green up top to see who's up for it tonight.</Text>
          </View>
        ) : (
          <View style={styles.stack}>
            <View style={[styles.row, styles.between]}>
              <Text style={styles.h2}>Up for it now</Text>
              <Text style={[styles.muted, styles.small]}>{greens.length} green</Text>
            </View>
            {/* A row of friends, each in a ring of their status colour, keenest first. */}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.faces}>
              {greens.map((fr) => (
                <FriendFace key={fr.id} friend={fr} photos={f.photos} />
              ))}
            </ScrollView>
            {!greens.length ? <Text style={[styles.muted, styles.small]}>No friends are green right now.</Text> : null}
          </View>
        )}

        {/* Tonight: your own sesh, then friends' live seshes you can join. */}
        {colour !== 'off' ? nights.map((s) => <NightCard key={s.id} s={s} f={f} v={v} onOpenWeb={onOpenWeb} />) : null}

        {friends.length ? <CatchUpCards f={f} onPlanned={() => onOpenWeb('sesh')} /> : null}

        {friends.length && colour === 'thinking' ? <Button label="See what's on tonight" colour={C.thinking} ink onPress={() => onOpenWeb('events')} /> : null}
        {friends.length && colour !== 'on'   // planning works on any colour (migration 0033)
          ? <Button label="Plan a sesh for later" icon="clock" ghost onPress={() => onOpenWeb('sesh')} /> : null}
        {friends.length ? <Button label="Crews and besties" ghost onPress={() => onOpenWeb('crews')} testID="home-crews" /> : null}
      </ScrollView>

      <Toast text={f.toast} />
    </View>
  );
}

// A live sesh as a card: whose night it is, where they're heading, who's in, and Join or Open.
function NightCard({ s, f, v, onOpenWeb }: { s: Sesh; f: Frendzy; v: Venues; onOpenWeb: (tab: string) => void }) {
  const host = s.members.filter((m) => m.name === s.creator_name)[0] || s.members[0];
  const place = s.locked_venue && v.byId[s.locked_venue] ? v.byId[s.locked_venue].name : null;
  const others = s.members.filter((m) => !host || m.id !== host.id);
  const title = s.am_member ? (s.mine ? 'Your sesh' : first(s.creator_name) + "'s sesh, you're in") : first(s.creator_name) + "'s night";
  return (
    <View style={[styles.card, styles.night]} testID={'night-' + s.id}>
      <View style={styles.row}>
        {host ? <Face id={host.id} name={host.name} photos={f.photos} size={40} font={14} /> : null}
        <View style={styles.grow}>
          <Text style={styles.strongBody}>{title}</Text>
          <Text style={[styles.muted, styles.small]}>Live now, {s.members.length} in</Text>
        </View>
      </View>
      <Text style={styles.nightPlace}>{place || 'Still choosing where'}</Text>
      {others.length ? <Text style={[styles.muted, styles.small]}>{others.map((m) => first(m.name)).join(', ')} {others.length === 1 ? 'is' : 'are'} in too.</Text> : null}
      <View style={styles.row}>
        {s.am_member
          ? <Button small label="Open the sesh" onPress={() => onOpenWeb('sesh')} />
          : <Button small label="Join them" onPress={() => f.act('join_sesh', { p_sesh: s.id }, "You're in.").then((r) => { if (r !== null) onOpenWeb('sesh'); })} />}
      </View>
    </View>
  );
}

// "Back to red in 12:04." — counted down every second, as the web app does.
function Until({ at }: { at: string }) {
  const end = new Date(at).getTime();
  const [left, setLeft] = useState(end - Date.now());
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    timer.current = setInterval(() => setLeft(end - Date.now()), 1000);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [end]);
  return <Text>Back to red in {fmtLeft(left)}.</Text>;
}

// A friend as a round face in a ring of their status colour, lit from behind. Red friends are greyed out.
function FriendFace({ friend, photos }: { friend: Friend; photos: Record<string, string> }) {
  const away = friend.colour === 'off';
  const glow = away ? C.line : COLOURS[friend.colour];
  return (
    <View style={styles.friend}>
      <View style={styles.facePad}>
        {!away ? (
          <>
            <View style={[styles.faceGlow, { backgroundColor: fade(glow, 0.07) }]} />
            <View style={[styles.faceGlowMid, { backgroundColor: fade(glow, 0.12) }]} />
            <View style={[styles.faceGlowInner, { backgroundColor: fade(glow, 0.2) }]} />
          </>
        ) : null}
        <View style={[styles.ring, { borderColor: away ? C.line : COLOURS[friend.colour] }]}>
          <Face id={friend.id} name={friend.name} photos={photos} size={58} font={20} away={away} />
        </View>
      </View>
      <Text numberOfLines={1} style={styles.faceName}>{first(friend.name)}</Text>
      <Text style={[styles.faceState, { color: away ? C.muted : COLOURS[friend.colour] }]}>{LABELS[friend.colour]}</Text>
    </View>
  );
}

// The three stops are plain circles in their own colour. The lit one sits under the glowing orb, so it shows a small
// light centre; the other two stay softly coloured so you can see what each stop means without any names or icons.
function StopDot({ kind, lit }: { kind: Colour; lit: boolean }) {
  const c = COLOURS[kind];
  return lit
    ? <View style={[styles.dot, { borderColor: C.ink, backgroundColor: 'transparent' }]}><View style={[styles.dotCore, { backgroundColor: C.ink }]} /></View>
    : <View style={[styles.dot, { borderColor: fade(c, 0.9), backgroundColor: fade(c, 0.55) }]} />;
}

// Your status as a little control deck: the word in your colour, then a wide switch. A glowing orb with a slow pulse
// slides to the one you pick, over a faint dial of ticks. Each stop has its icon (tick, question mark, cross) and its
// name, and every stop is a big target.
function StatusCard({ colour, word, note, onPick }: { colour: Colour; word: string; note: React.ReactNode; onPick: (c: Colour) => void }) {
  const [w, setW] = useState(0);
  const at = Math.max(0, SWITCH.indexOf(colour));
  const slide = useRef(new Animated.Value(at)).current;
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.spring(slide, { toValue: at, useNativeDriver: true, friction: 7, tension: 110 }).start();
  }, [at, slide]);
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 1600, useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 0, duration: 1600, useNativeDriver: true })
    ]));
    loop.start();
    return () => loop.stop();
  }, [pulse]);
  const stop = w / 3;
  const mode = COLOURS[colour];
  // Drag the orb along the track and let go: it settles on the nearest colour. A tap on a stop still works.
  const live = useRef({ stop, at, onPick });
  live.current = { stop, at, onPick };
  const from = useRef(0);
  const drag = useRef(PanResponder.create({
    onMoveShouldSetPanResponderCapture: (_e, g) => Math.abs(g.dx) > 6 && Math.abs(g.dx) > Math.abs(g.dy),
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: () => {
      slide.stopAnimation((v) => { from.current = v; });
    },
    onPanResponderMove: (_e, g) => {
      const { stop: st } = live.current;
      if (st > 0) slide.setValue(Math.max(0, Math.min(2, from.current + g.dx / st)));
    },
    onPanResponderRelease: (_e, g) => {
      const { stop: st, at: was, onPick: pick } = live.current;
      const to = st > 0 ? Math.max(0, Math.min(2, Math.round(from.current + g.dx / st))) : was;
      if (to !== was) pick(SWITCH[to]);
      else Animated.spring(slide, { toValue: was, useNativeDriver: true, friction: 7, tension: 110 }).start();
    }
  })).current;
  const x = slide.interpolate({ inputRange: [0, 1, 2], outputRange: [4, 4 + stop, 4 + stop * 2] });
  return (
    <View style={[styles.statusCard, { borderColor: fade(mode, 0.55), shadowColor: mode }]}>
      <View style={styles.statusTop}>
        <Text style={styles.eyebrow}>Your status</Text>
        <Text style={[styles.statusWord, { color: mode }]}>{word}</Text>
        <Text style={[styles.muted, styles.small]}>{note}</Text>
      </View>
      <View style={[styles.track, { borderColor: fade(mode, 0.35) }]} onLayout={(e) => setW(e.nativeEvent.layout.width)} accessibilityLabel="Set your status" {...drag.panHandlers}>
        <View pointerEvents="none" style={styles.ticks}>
          {Array.from({ length: 24 }, (_, i) => <View key={i} style={[styles.tick, i % 4 === 0 && styles.tickBig]} />)}
        </View>
        {w ? (
          <Animated.View pointerEvents="none" style={[styles.orb, { width: stop - 8, transform: [{ translateX: x }] }]}>
            <Animated.View style={[styles.halo, { backgroundColor: fade(mode, 0.16), transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.12] }) }] }]} />
            <View style={[styles.core, { backgroundColor: mode, shadowColor: mode }]} />
          </Animated.View>
        ) : null}
        {SWITCH.map((k) => {
          const lit = k === colour;
          return (
            <Pressable
              key={k}
              style={styles.stop}
              onPress={() => onPick(k)}
              accessibilityRole="button"
              accessibilityLabel={LABELS[k]}
              accessibilityState={{ selected: lit }}
            >
              <StopDot kind={k} lit={lit} />
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = themed(() => StyleSheet.create({
  fill: { flex: 1 },
  view: { paddingHorizontal: 18, paddingTop: 20, paddingBottom: 24, gap: 20, maxWidth: 440, width: '100%', alignSelf: 'center' },

  stack: { gap: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  between: { justifyContent: 'space-between' },
  grow: { flex: 1 },
  eyebrow: { fontFamily: F.bodyBold, fontSize: 12, letterSpacing: 1.4, textTransform: 'uppercase', color: C.muted },
  statusWord: { fontFamily: F.display, fontSize: 34, lineHeight: 40, letterSpacing: -0.8 },
  h2: { fontFamily: F.displayBold, fontSize: 19, letterSpacing: -0.2, color: C.fg },
  body: { fontFamily: F.body, fontSize: 16, color: C.fg },
  strong: { fontFamily: F.bodyBold },
  muted: { fontFamily: F.body, fontSize: 16, lineHeight: 22, color: C.muted },
  small: { fontSize: 14, lineHeight: 20 },
  card: { backgroundColor: C.surface, borderRadius: 22, padding: 16, gap: 10, borderWidth: 1, borderColor: C.line },
  avatar: { width: 40, height: 40, borderRadius: 20, borderWidth: 2, borderColor: C.line, backgroundColor: C.surface2, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontFamily: F.bodyBold, fontSize: 13, color: C.fg },
  linkbox: { fontFamily: F.body, fontSize: 14, padding: 12, borderRadius: 12, backgroundColor: C.bg, borderWidth: 1, borderColor: C.line, color: C.fg },
  field: { gap: 8 },
  label: { fontFamily: F.bodyMid, fontSize: 16, color: C.fg },
  input: { height: 52, borderRadius: 14, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface, paddingHorizontal: 16, color: C.fg, fontFamily: F.body, fontSize: 16 },

  // Your status, one line
  statusCard: { backgroundColor: C.surface, borderRadius: 30, padding: 16, gap: 14, borderWidth: 1.5, shadowOpacity: C.dark ? 0.4 : 0.15, shadowRadius: 20, shadowOffset: { width: 0, height: 0 } },
  statusTop: { gap: 2 },
  track: { flexDirection: 'row', height: 78, borderRadius: 39, backgroundColor: C.track, borderWidth: 1 },
  ticks: { position: 'absolute', left: 22, right: 22, top: 0, bottom: 0, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', opacity: 0.5 },
  tick: { width: 1, height: 8, backgroundColor: C.trackLine },
  tickBig: { height: 16 },
  orb: { position: 'absolute', top: 4, bottom: 4, alignItems: 'center', justifyContent: 'center' },
  halo: { position: 'absolute', top: -2, bottom: -2, left: -2, right: -2, borderRadius: 40 },
  core: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, borderRadius: 35, shadowOpacity: 0.9, shadowRadius: 16, shadowOffset: { width: 0, height: 0 }, elevation: 6 },
  dot: { width: 30, height: 30, borderRadius: 15, borderWidth: 2.5, alignItems: 'center', justifyContent: 'center' },
  dotCore: { width: 10, height: 10, borderRadius: 5 },
  stop: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 2 },
  night: { borderWidth: 1, borderColor: fade(C.on, 0.45), shadowColor: C.on, shadowOpacity: C.dark ? 0.25 : 0, shadowRadius: 18, shadowOffset: { width: 0, height: 0 } },
  nightPlace: { fontFamily: F.display, fontSize: 22, letterSpacing: -0.4, color: C.fg },
  strongBody: { fontFamily: F.bodyBold, fontSize: 16, color: C.fg },

  // Friends
  faces: { flexDirection: 'row', gap: 6, paddingTop: 4, paddingRight: 8 },
  friend: { width: 82, alignItems: 'center', gap: 2 },
  ring: { borderWidth: 3, borderRadius: 40, padding: 3 },
  facePad: { alignItems: 'center', justifyContent: 'center', marginTop: 10, marginBottom: 8, width: 76, height: 76 },
  faceGlow: { position: 'absolute', width: 100, height: 100, borderRadius: 50 },
  faceGlowMid: { position: 'absolute', width: 88, height: 88, borderRadius: 44 },
  faceGlowInner: { position: 'absolute', width: 76, height: 76, borderRadius: 38 },
  faceName: { fontFamily: F.bodyBold, fontSize: 14, color: C.fg, maxWidth: '100%' },
  faceState: { fontFamily: F.body, fontSize: 12 }
}));
