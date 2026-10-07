// The native Home screen: the logo with the status switch, your status, and who's up for it tonight.
// It shows the same things in the same words as home() in docs/app.js.
import React, { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import type { Colour, Friend } from './api';
import Icon from './Icon';
import { CatchUpCards } from './Crews';
import { Button, Face, Toast, TopBar } from './Parts';
import type { Frendzy } from './useFrendzy';
import { C, COLOURS, F, LABELS, STATUS_COPY, STATUS_ICON, STOPS, fade, first, fmtLeft, initials } from './theme';

const INVITE_BASE = 'https://frendzy.au/';

export default function Home({ f, onOpenWeb }: { f: Frendzy; onOpenWeb: (tab: string) => void }) {
  const me = f.state && f.state.me;
  const [linkShown, setLinkShown] = useState(false);
  const [friendName, setFriendName] = useState('');
  const [adding, setAdding] = useState(false);
  if (!me) return null;
  const colour = me.colour;
  const copy = STATUS_COPY[colour];
  const friends = f.state ? f.state.friends : [];
  const requests = f.state ? f.state.requests_in : [];
  const live = (f.state ? f.state.seshes : []).filter((s) => s.am_member && !(s.planned && s.starts_at && new Date(s.starts_at).getTime() > Date.now()))[0];
  const on = friends.filter((x) => x.colour === 'on').length;
  const thinking = friends.filter((x) => x.colour === 'thinking').length;

  const share = () => {
    const link = INVITE_BASE + '?invite=' + me.invite_code;
    setLinkShown(true);
    Share.share({ title: 'Frendzy', message: "Add me on Frendzy so we can see when we're both up for a sesh. " + link }).catch(() => {});
  };

  return (
    <View style={styles.fill}>
      <TopBar f={f} onOpenWeb={onOpenWeb} />

      <ScrollView style={styles.fill} contentContainerStyle={styles.view} keyboardShouldPersistTaps="handled">
        <View style={styles.stack}>
          <Text style={styles.eyebrow}>Your status</Text>
          <Text style={[styles.statusWord, { color: COLOURS[colour] }]}>{copy[0]}</Text>
          <Text style={styles.muted}>{copy[1]}{colour !== 'off' && me.expires_at ? <Until at={me.expires_at} /> : null}</Text>
          <Switch colour={colour} onPick={(c) => f.setColour(c)} />
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
            <Text style={[styles.muted, styles.small]}>Slide to green or amber to see who's up for it tonight.</Text>
          </View>
        ) : (
          <View style={[styles.stack, { gap: 4 }]}>
            <View style={[styles.row, styles.between]}>
              <Text style={styles.h2}>Up for it now</Text>
              <Text style={[styles.muted, styles.small]}>{on} green, {thinking} amber</Text>
            </View>
            <View style={styles.faces}>
              {friends.slice().sort((x, y) => STOPS.indexOf(x.colour) - STOPS.indexOf(y.colour)).map((fr) => (
                <FriendFace key={fr.id} friend={fr} photos={f.photos} />
              ))}
            </View>
          </View>
        )}

        {friends.length ? <CatchUpCards f={f} onPlanned={() => onOpenWeb('sesh')} /> : null}

        {friends.length && colour !== 'off' ? (
          colour === 'on'
            ? <Button
                label={live ? "Open tonight's sesh" : 'Start a sesh'}
                onPress={() => {
                  // Like go-sesh in docs/app.js: open tonight's sesh, or start one and then open it.
                  if (live) { onOpenWeb('sesh'); return; }
                  f.act('start_sesh', {}, 'Sesh started. Friends who are around can join.').then(() => onOpenWeb('sesh'));
                }}
              />
            : <Button label="See what's on tonight" colour={C.thinking} ink onPress={() => onOpenWeb('events')} />
        ) : null}

        {friends.length ? <Button label="Crews and besties" ghost onPress={() => onOpenWeb('crews')} testID="home-crews" /> : null}
      </ScrollView>

      <Toast text={f.toast} />
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
  return <Text> Back to red in {fmtLeft(left)}.</Text>;
}

// The status switch: one track, a coloured knob, and three lamps. Tapping a lamp sets your status.
function Switch({ colour, onPick }: { colour: Colour; onPick: (c: Colour) => void }) {
  return (
    <View style={styles.slide} accessibilityLabel="Set your status">
      <View style={[styles.knob, { left: `${STOPS.indexOf(colour) * (100 / 3)}%`, backgroundColor: fade(COLOURS[colour], 0.22) }]} />
      {STOPS.map((k) => {
        const lit = k === colour;
        return (
          <Pressable
            key={k}
            style={styles.stop}
            onPress={() => { if (!lit) onPick(k); }}
            accessibilityRole="button"
            accessibilityLabel={LABELS[k]}
            accessibilityState={{ selected: lit }}
          >
            <View style={[styles.lamp, { backgroundColor: lit ? COLOURS[k] : fade(COLOURS[k], 0.2), shadowColor: COLOURS[k] }, lit && styles.lampLit]}>
              <Icon name={STATUS_ICON[k]} size={28} weight={3} colour={lit ? C.ink : 'rgba(255, 255, 255, 0.55)'} />
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

// A friend as a round face, lit from behind in their status colour. Red friends are greyed out.
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
        <Face id={friend.id} name={friend.name} photos={photos} size={64} font={22} away={away} />
      </View>
      <Text numberOfLines={1} style={styles.faceName}>{first(friend.name)}</Text>
      <Text style={[styles.faceState, { color: away ? C.muted : COLOURS[friend.colour] }]}>{LABELS[friend.colour]}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  view: { paddingHorizontal: 18, paddingTop: 20, paddingBottom: 24, gap: 20, maxWidth: 440, width: '100%', alignSelf: 'center' },

  stack: { gap: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  between: { justifyContent: 'space-between' },
  grow: { flex: 1 },
  eyebrow: { fontFamily: F.bodyBold, fontSize: 12, letterSpacing: 1.4, textTransform: 'uppercase', color: C.muted },
  statusWord: { fontFamily: F.display, fontSize: 56, lineHeight: 60, letterSpacing: -2.5 },
  h2: { fontFamily: F.displayBold, fontSize: 19, letterSpacing: -0.2, color: C.fg },
  body: { fontFamily: F.body, fontSize: 16, color: C.fg },
  strong: { fontFamily: F.bodyBold },
  muted: { fontFamily: F.body, fontSize: 16, lineHeight: 22, color: C.muted },
  small: { fontSize: 14, lineHeight: 20 },
  card: { backgroundColor: C.surface, borderRadius: 18, padding: 14, gap: 10 },
  avatar: { width: 40, height: 40, borderRadius: 20, borderWidth: 2, borderColor: C.line, backgroundColor: C.surface2, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontFamily: F.bodyBold, fontSize: 13, color: C.fg },
  linkbox: { fontFamily: F.body, fontSize: 14, padding: 12, borderRadius: 12, backgroundColor: C.bg, borderWidth: 1, borderColor: C.line, color: C.fg },
  field: { gap: 8 },
  label: { fontFamily: F.bodyMid, fontSize: 16, color: C.fg },
  input: { height: 52, borderRadius: 14, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface, paddingHorizontal: 16, color: C.fg, fontFamily: F.body, fontSize: 16 },

  // Status switch
  slide: { position: 'relative', flexDirection: 'row', height: 76, padding: 5, borderRadius: 38, backgroundColor: C.track, borderWidth: 1, borderColor: C.trackLine },
  knob: { position: 'absolute', top: 5, bottom: 5, marginLeft: 5, width: '31%', borderRadius: 33 },
  stop: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  lamp: { width: 54, height: 54, borderRadius: 27, alignItems: 'center', justifyContent: 'center' },
  lampLit: { shadowOpacity: 0.9, shadowRadius: 12, shadowOffset: { width: 0, height: 0 } },

  // Friends
  faces: { flexDirection: 'row', flexWrap: 'wrap', paddingTop: 10, rowGap: 14 },
  friend: { width: '25%', alignItems: 'center', gap: 4 },
  facePad: { alignItems: 'center', justifyContent: 'center', marginTop: 8, marginBottom: 6, width: 64, height: 64 },
  faceGlow: { position: 'absolute', width: 100, height: 100, borderRadius: 50 },
  faceGlowMid: { position: 'absolute', width: 88, height: 88, borderRadius: 44 },
  faceGlowInner: { position: 'absolute', width: 76, height: 76, borderRadius: 38 },
  faceName: { fontFamily: F.bodyBold, fontSize: 14, color: C.fg, maxWidth: '100%' },
  faceState: { fontFamily: F.body, fontSize: 12 }
});
