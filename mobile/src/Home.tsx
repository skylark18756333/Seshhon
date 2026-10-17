// The native Home screen: the logo with the three status lights, your status, who's up for it, and tonight's seshes.
// It shows the same things in the same words as home() in docs/app.js.
import React, { useEffect, useRef, useState } from 'react';
import { ScrollView, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import type { Friend, Sesh } from './api';
import { CatchUpCards } from './Crews';
import { Button, Face, Toast, TopBar } from './Parts';
import type { Frendzy } from './useFrendzy';
import { C, COLOURS, F, LABELS, STATUS_COPY, STOPS, fade, first, fmtLeft, initials, themed } from './theme';
import { useVenues, type Venues } from './venues';

const INVITE_BASE = 'https://frendzy.au/';

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
        {/* Your status in one line. The three lights in the bubble up top change it. */}
        <View style={styles.statusLine}>
          <Text style={styles.eyebrow}>Your status</Text>
          <Text style={[styles.statusWord, { color: COLOURS[colour] }]}>{copy[0]}</Text>
          <Text style={[styles.muted, styles.small]}>{colour !== 'off' && me.expires_at ? <Until at={me.expires_at} /> : copy[1]}</Text>
        </View>

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

const styles = themed(() => StyleSheet.create({
  fill: { flex: 1 },
  view: { paddingHorizontal: 18, paddingTop: 20, paddingBottom: 24, gap: 20, maxWidth: 440, width: '100%', alignSelf: 'center' },

  stack: { gap: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  between: { justifyContent: 'space-between' },
  grow: { flex: 1 },
  eyebrow: { fontFamily: F.bodyBold, fontSize: 12, letterSpacing: 1.4, textTransform: 'uppercase', color: C.muted },
  statusWord: { fontFamily: F.display, fontSize: 26, lineHeight: 32, letterSpacing: -0.8 },
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
  statusLine: { gap: 2 },
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
