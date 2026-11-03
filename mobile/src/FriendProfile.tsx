// A friend's profile, opened by tapping their face anywhere in the app: their photo, colour, about line, level and
// badges, what you two share (seshes you're both in, crews), and a Sesh request button. It never shows where
// anyone is or has been. friend_profile() (migration 0040) applies the same colour rules as everywhere else: red,
// hidden-from-you and amber you aren't allowed to see all come back as 'off'.
import { LinearGradient } from 'expo-linear-gradient';
import React, { useEffect, useRef, useState } from 'react';
import * as ImagePicker from 'expo-image-picker';
import { Animated, Easing, Image, Modal, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Colour } from './api';
import Icon from './Icon';
import GemBadge from './GemBadge';
import { Button, Face, Toast } from './Parts';
import { shrinkCover, shrinkPhoto } from './photos';
import { rpc, type ApiError } from './session';
import type { Frendzy } from './useFrendzy';
import { C, COLOURS, F, fade, first, fmtWhen, hue, themed } from './theme';

type Profile = {
  id: string; name: string; about?: string | null; colour: Colour; photo?: string | null;
  level?: number; xp?: number; next?: number; from?: number;
  seshes?: number; friends?: number; mutual?: number; badges?: string[];
  counts?: { joined?: number; hosted?: number; planned?: number; friends?: number };
  crews?: string[]; together?: { id: string; at: string; host: string }[];
};

// Every badge there is, in the order they show. Earned ones shine; locked ones show how close you are (counts from
// migration 0041). Names are about meeting up, never drinking: WA's rules on promoting liquor (Sarah, 2026-11-02).
type Badge = { key: string; name: string; icon: string; colour: string; dark: string; how: string; tip: string; count: 'joined' | 'hosted' | 'planned' | 'friends'; need: number };
const BADGES: Badge[] = [
  { key: 'first_round', name: 'First meetup', icon: 'tick', colour: '#FFD84D', dark: '#F08A00', how: 'Joined a friend\'s sesh', tip: 'Join a friend\'s sesh, or say "I\'m in" to a friend\'s plan.', count: 'joined', need: 1 },
  { key: 'regular', name: 'Regular', icon: 'clock', colour: '#FF6FB5', dark: '#B0127E', how: 'Joined 10 seshes', tip: 'Join 10 of your friends\' seshes. Every one you join counts.', count: 'joined', need: 10 },
  { key: 'ringleader', name: 'Ringleader', icon: 'sesh', colour: '#4DEB95', dark: '#0B8A50', how: 'Friends joined 5 of your seshes', tip: 'Start a sesh and get friends to join it. Each friend who joins counts.', count: 'hosted', need: 5 },
  { key: 'planner', name: 'Planner', icon: 'events', colour: '#A47BFF', dark: '#4A1FC8', how: 'Friends said they\'re in to 3 of your plans', tip: 'Plan a sesh ahead with Sesh request, then get friends to say they\'re in.', count: 'planned', need: 3 },
  { key: 'social', name: 'Social', icon: 'you', colour: '#55D4FF', dark: '#1258C8', how: '10 friends on Crewzy', tip: 'Add friends by their username. Once 10 of them accept, it\'s yours.', count: 'friends', need: 10 }
];
// A title on the cover that grows with your level.
function rankOf(level: number): string {
  return level >= 10 ? 'Legend' : level >= 6 ? 'Night Owl' : level >= 3 ? 'Regular' : 'Fresh Face';
}
const TILES: [string, string, string][] = [['Friends', '#FF4FA3', '#C2186B'], ['Mutual', '#1FB6FF', '#1460C8'], ['Seshes', '#3DDC84', '#13955A'], ['Badges', '#FFC83D', '#C98A00']];

// Your page's own colours (migration 0041). Friends see your page in your theme, on top of their own app look.
type Theme = { name: string; a: string; b: string };
const THEMES: Record<string, Theme> = {
  neon: { name: 'Neon', a: '#8B5CFF', b: '#FFC83D' },
  sunset: { name: 'Sunset', a: '#FF7A45', b: '#E0407A' },
  ocean: { name: 'Ocean', a: '#1FB6FF', b: '#2EE6C5' },
  pop: { name: 'Pop', a: '#FF4FA3', b: '#8B5CFF' },
  lime: { name: 'Lime', a: '#3DDC84', b: '#E6FF3D' },
  mono: { name: 'Mono', a: '#9B9EA8', b: '#F5F6F8' }
};
const FRAMES: [string, string][] = [['glow', 'Status glow'], ['neon', 'Theme'], ['gold', 'Gold'], ['rainbow', 'Rainbow'], ['none', 'None']];
const RAINBOW = ['#F0524B', '#F5C542', '#3DDC84', '#1FB6FF', '#8B5CFF'] as const;
type Style = { theme: string; frame: string; cover?: string | null; badges: string[] };

// Opening a profile from any screen: the host below, mounted once in App, listens for this.
let show: ((id: string | null) => void) | null = null;
export function openFriend(id: string) { if (show) show(id); }

export function FriendProfileHost({ f, onMessages }: { f: Frendzy; onMessages: (id: string) => void }) {
  const [id, setId] = useState<string | null>(null);
  useEffect(() => { show = setId; return () => { show = null; }; }, []);
  return (
    <Modal visible={!!id} animationType="slide" onRequestClose={() => setId(null)} statusBarTranslucent>
      {id ? <FriendProfile f={f} id={id} onClose={() => setId(null)} onMessages={() => { setId(null); onMessages(id); }} /> : null}
    </Modal>
  );
}

function FriendProfile({ f, id, onClose, onMessages }: { f: Frendzy; id: string; onClose: () => void; onMessages: () => void }) {
  const insets = useSafeAreaInsets();
  const friend = f.state ? f.state.friends.filter((x) => x.id === id)[0] : undefined;
  const me = f.state && f.state.me;
  const self = !!me && me.id === id;   // your own page, as friends see it (opened from You)
  const [p, setP] = useState<Profile | null>(null);
  const [game, setGame] = useState(true);   // false: migration 0040 isn't run yet, so level and badges are left out
  const [sheet, setSheet] = useState(false);
  const [menu, setMenu] = useState<null | 'menu' | 'remove' | 'block'>(null);
  const [hidden, setHidden] = useState<boolean | null>(null);
  const [style, setStyle] = useState<Style | null>(null);   // null: migration 0041 isn't run yet, so no customising
  const [custom, setCustom] = useState(false);
  const [badge, setBadge] = useState<Badge | null>(null);   // the badge sheet: how to earn it and how close you are
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let gone = false;
    rpc('friend_profile', { p_friend: id }).then((d: any) => { if (!gone && d) setP(d); }, (e: ApiError) => {
      if (gone) return;
      if (e.missing) setGame(false);
      else f.say(e.message);
    });
    rpc('profile_style', { p_friend: id }).then((d: any) => {
      if (!gone && d) setStyle({ theme: d.theme || 'neon', frame: d.frame || 'glow', cover: d.cover || null, badges: Array.isArray(d.badges) ? d.badges : [] });
    }, () => {});
    rpc('my_status_hides').then((l: any) => { if (!gone) setHidden(Array.isArray(l) && l.includes(id)); }, () => {});
    return () => { gone = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Without migration 0040 the page still works from what the app already has.
  const view: Profile | null = p || (friend ? { id, name: friend.name, colour: friend.colour } : self && me ? { id, name: me.name, colour: me.colour } : null);
  if (!view) {
    return (
      <View style={[styles.page, styles.center, { paddingTop: insets.top }]}>
        <Text style={styles.muted}>{friend === undefined && f.state ? 'This person isn\'t on your friends list.' : 'Loading…'}</Text>
        <Button label="Back" ghost onPress={onClose} />
      </View>
    );
  }
  const colour: Colour = friend ? friend.colour : self && me ? me.colour : view.colour;
  const out = colour !== 'off';
  const ring = out ? COLOURS[colour] : C.line;
  const photos = view.photo ? { ...f.photos, [id]: view.photo } : f.photos;
  const h = hue(view.name);
  const name = first(view.name);
  const earned = view.badges || [];
  const level = view.level || 1, xp = view.xp || 0, from = view.from || 0, next = view.next || 50;
  const part = Math.max(0, Math.min(1, (xp - from) / Math.max(1, next - from)));
  const together = view.together || [], crews = view.crews || [];
  const theme = THEMES[(style && style.theme) || 'neon'] || THEMES.neon;
  const frame = (style && style.frame) || 'glow';
  const shown = style && style.badges.length ? BADGES.filter((b) => style.badges.includes(b.key) && earned.includes(b.key)) : BADGES;
  const counts = view.counts || {};
  const have = (b: Badge) => Math.min(b.need, b.count === 'friends' ? (counts.friends ?? view.friends ?? 0) : (counts[b.count] ?? 0));
  const segs = Math.round(part * 10);
  const line = colour === 'on' ? 'Green, up for it' : colour === 'thinking' ? 'Amber, maybe later' : 'Not out right now';

  const mySesh = f.state ? f.state.seshes.filter((s) => s.mine && !s.planned)[0] : undefined;
  const now = () => {
    const done = (r: unknown) => { if (r) setSheet(false); };
    if (mySesh) f.act('invite_to_sesh', { p_sesh: mySesh.id, p_friends: [id] }, name + "'s invited to your sesh.").then(done);
    else f.act('start_private_sesh', { p_friends: [id] }, 'Sesh started. ' + name + "'s invited.").then(done);
  };
  const plan = (at: Date) => {
    f.act('plan_sesh', { p_at: at.toISOString(), p_friends: [id] }, 'Planned. ' + name + ' can say they\'re in.').then((r) => { if (r) setSheet(false); });
  };

  return (
    <View style={styles.page}>
      <ScrollView contentContainerStyle={{ paddingBottom: 110 + insets.bottom }}>
        {/* Their cover photo if they added one, otherwise a glow in their page's theme colours. */}
        {style && style.cover ? <Image source={{ uri: style.cover }} style={styles.coverPic} resizeMode="cover" /> : null}
        <LinearGradient
          colors={style && style.cover ? ['rgba(0, 0, 0, 0.35)', 'rgba(0, 0, 0, 0)', fade(C.bg, 0.9)] : style ? [fade(theme.a, 0.6), fade(theme.b, 0.18), C.bg] : out ? [fade(ring, 0.55), fade(ring, 0.08), C.bg] : [`hsla(${h}, 60%, 45%, 0.45)`, `hsla(${(h + 40) % 360}, 60%, 30%, 0.15)`, C.bg]}
          start={{ x: 0, y: 0 }} end={{ x: 0.4, y: 1 }}
          style={[styles.cover, { paddingTop: insets.top + 10 }]}
        >
          {style && !style.cover ? <><Blob colour="rgba(255, 255, 255, 0.28)" size={190} x={-40} y={-30} /><Blob colour="rgba(0, 0, 0, 0.18)" size={220} x={170} y={40} slow /></> : null}
          <Sparkle x="22%" y={70} />
          <Sparkle x="62%" y={50} delay={800} />
          <Sparkle x="84%" y={100} delay={1400} />
          {game ? <View style={styles.rank}><Text style={styles.rankText}>★ {rankOf(level)}</Text></View> : null}
          <Pressable style={styles.round} onPress={onClose} accessibilityRole="button" accessibilityLabel="Back"><Icon name="back" size={20} colour="#fff" /></Pressable>
          {self ? null : <Pressable style={styles.round} onPress={() => setMenu('menu')} accessibilityRole="button" accessibilityLabel="More"><Text style={styles.dots}>⋯</Text></Pressable>}
        </LinearGradient>

        <View style={styles.body}>
          <View style={styles.who}>
            <PhotoFrame kind={frame} ring={ring} theme={theme}>
              <Face id={id} name={view.name} photos={photos} size={92} font={30} />
            </PhotoFrame>
            <View style={styles.grow}>
              <Text style={[styles.state, { color: out ? ring : C.muted }]}>{line}</Text>
              <Text style={styles.name} numberOfLines={1}>{view.name}</Text>
            </View>
          </View>
          {view.about ? <View style={styles.card}><Text style={styles.eyebrow}>About</Text><Text style={styles.text}>{view.about}</Text></View> : null}

          {game ? (
            <LinearGradient colors={[fade(theme.a, 0.22), fade(theme.b, 0.16)]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.level, { borderColor: fade(theme.a, 0.5) }]}>
              <LinearGradient colors={[theme.b, theme.a]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.lvl}>
                <Text style={styles.lvlSmall}>LVL</Text><Text style={styles.lvlNum}>{level}</Text>
              </LinearGradient>
              <View style={styles.grow}>
                <View style={styles.between}>
                  <Text style={styles.xp}>{xp.toLocaleString()} XP</Text>
                  <Text style={styles.small}>{(next - xp).toLocaleString()} to level {level + 1}</Text>
                </View>
                <View style={styles.segs}>
                  {Array.from({ length: 10 }, (_, i) => i < segs
                    ? <LinearGradient key={i} colors={[theme.a, theme.b]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={[styles.seg, { shadowColor: theme.b }]} />
                    : i === segs ? <Blink key={i}><View style={[styles.seg, { backgroundColor: fade(theme.a, 0.4) }]} /></Blink>
                    : <View key={i} style={[styles.seg, styles.segOff]} />)}
                </View>
              </View>
            </LinearGradient>
          ) : null}

          {game ? (
            <View style={styles.stats}>
              {[view.friends, self ? null : view.mutual, view.seshes, earned.length].map((n, i) => (self && i === 1 ? null : (
                <LinearGradient key={TILES[i][0]} colors={[TILES[i][1], TILES[i][2]]} start={{ x: 0, y: 0 }} end={{ x: 0.6, y: 1 }} style={[styles.stat, { shadowColor: TILES[i][2] }]}>
                  <Text style={styles.statNum}>{n == null ? '–' : String(n)}</Text>
                  <Text style={styles.statLabel}>{TILES[i][0]}</Text>
                </LinearGradient>
              )))}
            </View>
          ) : null}

          {game ? (
            <View style={styles.stack}>
              <View style={styles.between}>
                <Text style={styles.eyebrow}>{shown === BADGES ? (earned.length ? 'Badges' : 'Badges to unlock') : 'Showing off'}</Text>
                <Text style={styles.small}>{earned.length} of {BADGES.length} earned · tap one</Text>
              </View>
              <View style={[styles.badges, shown !== BADGES && styles.badgesPicked]}>
                {shown.map((b, i) => {
                  const lit = earned.includes(b.key);
                  return (
                    <Pressable key={b.key} style={styles.badge} onPress={() => setBadge(b)} accessibilityRole="button" accessibilityLabel={b.name + (lit ? ', earned. ' : ', not yet. ') + b.how + '. Tap to see how to earn it.'}>
                      {lit ? (
                        <Bob delay={i * 300}><GemBadge kind={b.key} c1={b.colour} c2={b.dark} lit need={b.need} size={58} delay={i * 500} /></Bob>
                      ) : (
                        <GemBadge kind={b.key} c1={b.colour} c2={b.dark} lit={false} have={view.counts ? have(b) : 0} need={b.need} size={58} />
                      )}
                      <Text style={[styles.badgeName, !lit && { color: C.muted }]} numberOfLines={2}>{b.name}</Text>
                      {!lit && view.counts ? <Text style={styles.badgeProg}>{have(b)}/{b.need}</Text> : null}
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ) : null}

          {self && game && view.counts ? (
            <View style={styles.stack}>
              <View style={styles.between}><Text style={styles.eyebrow}>Quests</Text><Text style={styles.small}>Earn XP and badges</Text></View>
              {[
                { icon: 'tick', title: "Join a friend's sesh", done: (counts.joined || 0) > 0, part: Math.min(1, counts.joined || 0), prize: '+50 XP', c: ['#3DDC84', '#0F8A52'] },
                { icon: 'sesh', title: 'Get a friend to join your sesh', done: (counts.hosted || 0) > 0, part: Math.min(1, counts.hosted || 0), prize: '+20 XP', c: ['#8B5CFF', '#4B25C9'] },
                { icon: 'events', title: 'Plan a sesh a friend says yes to · ' + Math.min(3, counts.planned || 0) + '/3', done: (counts.planned || 0) >= 3, part: Math.min(1, (counts.planned || 0) / 3), prize: 'Badge', c: ['#FF4FA3', '#A0177A'] },
                { icon: 'you', title: 'Add 10 friends · ' + Math.min(10, counts.friends || 0) + '/10', done: (counts.friends || 0) >= 10, part: Math.min(1, (counts.friends || 0) / 10), prize: 'Badge', c: ['#1FB6FF', '#1460C8'] }
              ].map((q) => (
                <View key={q.title} style={[styles.quest, q.done && { opacity: 0.6 }]}>
                  <LinearGradient colors={[q.c[0], q.c[1]]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.questIcon}><Icon name={q.done ? 'tick' : q.icon} size={18} colour="#fff" /></LinearGradient>
                  <View style={styles.grow}>
                    <Text style={styles.rowTitle}>{q.title}</Text>
                    <View style={styles.questBar}><LinearGradient colors={[q.c[0], q.c[1]]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={[styles.barFill, { width: `${Math.round(q.part * 100)}%` }]} /></View>
                  </View>
                  <LinearGradient colors={[theme.a, theme.b]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.prize}><Text style={styles.prizeText}>{q.done ? 'Done' : q.prize}</Text></LinearGradient>
                </View>
              ))}
            </View>
          ) : null}

          {together.length || crews.length ? (
            <View style={styles.stack}>
              <Text style={styles.eyebrow}>You and {name}</Text>
              {together.map((s) => (
                <View key={s.id} style={styles.row}>
                  <View style={styles.grow}>
                    <Text style={styles.rowTitle}>{new Date(s.at).getTime() > Date.now() ? 'Planned, ' + fmtWhen(s.at) : 'On now'}</Text>
                    <Text style={styles.small}>{s.host}'s sesh · you're both in</Text>
                  </View>
                  <Text style={styles.chip}>In</Text>
                </View>
              ))}
              {crews.map((c) => (
                <View key={c} style={styles.row}>
                  <View style={styles.grow}><Text style={styles.rowTitle}>{c}</Text><Text style={styles.small}>A crew you're both in</Text></View>
                </View>
              ))}
            </View>
          ) : null}
        </View>
      </ScrollView>

      {self ? (
        <View style={[styles.actions, { paddingBottom: 14 + insets.bottom }]}>
          {style ? <View style={styles.grow}><Button label="Customise your page" onPress={() => setCustom(true)} testID="profile-customise" /></View> : null}
          {me ? <View style={style ? null : styles.grow}><Button label="Share" ghost onPress={() => {
            Share.share({ title: 'Crewzy', message: "Add me on Crewzy so we can see when we're both up for a sesh. https://frendzy.au/?invite=" + me.invite_code }).catch(() => {});
          }} /></View> : null}
        </View>
      ) : (
        <View style={[styles.actions, { paddingBottom: 14 + insets.bottom }]}>
          <View style={styles.grow}><Pulse colour={theme.a}><Button label="Sesh request" onPress={() => setSheet(true)} testID="profile-sesh" /></Pulse></View>
          <Button label="Message" ghost onPress={onMessages} />
        </View>
      )}

      {sheet ? (
        <Sheet onClose={() => setSheet(false)} insets={insets.bottom}>
          <Text style={styles.sheetTitle}>Sesh with {name}?</Text>
          {out ? (
            <Pressable style={styles.choice} onPress={now} disabled={!me || me.colour !== 'on'} accessibilityRole="button">
              <Text style={[styles.rowTitle, (!me || me.colour !== 'on') && { color: C.muted }]}>{mySesh ? 'Invite to your sesh' : 'Right now'}</Text>
              <Text style={styles.small}>{me && me.colour === 'on' ? (mySesh ? name + ' can see your sesh and join it.' : 'Starts a sesh just for you and ' + name + '.') : 'Slide the switch to green to start one now.'}</Text>
            </Pressable>
          ) : null}
          <Text style={styles.eyebrow}>Plan one</Text>
          <View style={styles.when}>
            {planTimes().map(([label, at]) => (
              <Pressable key={label} style={styles.whenBtn} onPress={() => plan(at)} accessibilityRole="button" accessibilityLabel={'Plan for ' + label}>
                <Text style={styles.whenText}>{label}</Text>
              </Pressable>
            ))}
          </View>
          <Text style={styles.small}>{name} gets an invite and taps "I'm in". Only the two of you can see it.</Text>
        </Sheet>
      ) : null}

      {badge ? (() => {
        const lit = earned.includes(badge.key);
        const got = have(badge);
        return (
          <Sheet onClose={() => setBadge(null)} insets={insets.bottom}>
            <View style={styles.badgeTop}>
              <GemBadge kind={badge.key} c1={badge.colour} c2={badge.dark} lit={lit} have={view.counts ? got : 0} need={badge.need} size={84} />
              <View style={styles.grow}>
                <Text style={styles.sheetTitle}>{badge.name}</Text>
                <Text style={[styles.state, { color: lit ? badge.colour : C.muted }]}>{lit ? (self ? 'You earned this' : name + ' earned this') : 'Not earned yet'}</Text>
              </View>
            </View>
            <Text style={styles.eyebrow}>How to earn it</Text>
            <Text style={styles.text}>{badge.tip}</Text>
            {view.counts ? (
              <View style={styles.stack}>
                <View style={styles.between}>
                  <Text style={styles.rowTitle}>{badge.how}</Text>
                  <Text style={styles.small}>{got}/{badge.need}</Text>
                </View>
                <View style={styles.questBar}><View style={[styles.barFill, { width: `${(100 * got) / badge.need}%`, backgroundColor: badge.colour }]} /></View>
                {!lit ? <Text style={styles.small}>{(self ? 'You\'re ' : name + ' is ') + (badge.need - got) + ' away.'}</Text> : null}
              </View>
            ) : null}
            <Text style={styles.small}>Badges only count meeting up with friends on Crewzy.</Text>
          </Sheet>
        );
      })() : null}

      {custom && style ? (
        <Sheet onClose={() => setCustom(false)} insets={insets.bottom}>
          <Customise
            style={style}
            earned={earned}
            hasPhoto={!!photos[id]}
            busy={busy}
            onStyle={(change) => {
              const before = style;
              setStyle({ ...style, ...change });
              rpc('set_profile_style', { p_theme: change.theme || null, p_frame: change.frame || null, p_badges: change.badges || null })
                .catch((e: ApiError) => { setStyle(before); f.say(e.message); });
            }}
            onCover={async (remove) => {
              const url = remove ? null : await pick(true, f.say);
              if (url === undefined) return;
              setBusy(true);
              rpc('set_cover', { p_cover: url }).then(() => { setStyle((s0) => (s0 ? { ...s0, cover: url } : s0)); f.say(url ? 'Cover saved.' : 'Cover removed.'); },
                (e: ApiError) => f.say(e.message)).then(() => setBusy(false));
            }}
            onPhoto={async () => {
              const url = await pick(false, f.say);
              if (!url) return;
              setBusy(true);
              rpc('set_photo', { p_photo: url }).then(() => { setP((p0) => (p0 ? { ...p0, photo: url } : p0)); f.refresh(); f.say('Photo saved.'); },
                (e: ApiError) => f.say(e.message)).then(() => setBusy(false));
            }}
            onDone={() => setCustom(false)}
          />
        </Sheet>
      ) : null}

      {menu ? (
        <Sheet onClose={() => setMenu(null)} insets={insets.bottom}>
          {menu === 'menu' ? (
            <>
              {hidden !== null ? (
                <Button ghost label={hidden ? 'Show my status to ' + name : 'Hide my status from ' + name} onPress={() => {
                  f.act('set_status_hidden', { p_friend: id, p_hidden: !hidden }, hidden ? name + ' can see your status again.' : name + ' now always sees you as red.')
                    .then((r) => { if (Array.isArray(r)) setHidden(r.includes(id)); setMenu(null); });
                }} />
              ) : null}
              {friend ? <Button ghost label="Remove friend" onPress={() => setMenu('remove')} /> : null}
              <Button ghost label="Block" onPress={() => setMenu('block')} />
            </>
          ) : (
            <>
              <Text style={styles.sheetTitle}>{menu === 'remove' ? 'Remove ' + name + '?' : 'Block ' + name + '?'}</Text>
              {menu === 'block' ? <Text style={styles.small}>They won't see you or be able to add you again.</Text> : null}
              <Button label={menu === 'remove' ? 'Remove' : 'Block'} colour={C.off} ink onPress={() => {
                const go = menu === 'remove' && friend
                  ? f.act('answer_friend', { p_friendship: friend.friendship, p_accept: false })
                  : f.act('block_user', { p_user: id }, 'Blocked.');
                go.then(() => { setMenu(null); onClose(); });
              }} />
              <Button ghost label="Cancel" onPress={() => setMenu(null)} />
            </>
          )}
        </Sheet>
      ) : null}
      <Toast text={f.toast} />
    </View>
  );
}

// Little moving parts that make the page feel alive. All of them run on the native thread.
function useLoop(ms: number, delay = 0) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.delay(delay),
      Animated.timing(v, { toValue: 1, duration: ms / 2, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      Animated.timing(v, { toValue: 0, duration: ms / 2, easing: Easing.inOut(Easing.quad), useNativeDriver: true })
    ]));
    loop.start();
    return () => loop.stop();
  }, [v, ms, delay]);
  return v;
}
function Sparkle({ x, y, delay = 0 }: { x: `${number}%`; y: number; delay?: number }) {
  const v = useLoop(2400, delay);
  return <Animated.View pointerEvents="none" style={[styles.spark, { left: x, top: y, opacity: v.interpolate({ inputRange: [0, 1], outputRange: [1, 0.2] }), transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [1, 0.5] }) }] }]} />;
}
function Blob({ colour, size, x, y, slow }: { colour: string; size: number; x: number; y: number; slow?: boolean }) {
  const v = useLoop(slow ? 11000 : 8000);
  return <Animated.View pointerEvents="none" style={{ position: 'absolute', left: x, top: y, width: size, height: size, borderRadius: size / 2, backgroundColor: colour,
    transform: [{ translateX: v.interpolate({ inputRange: [0, 1], outputRange: [0, slow ? -24 : 30] }) }, { translateY: v.interpolate({ inputRange: [0, 1], outputRange: [0, 14] }) }] }} />;
}
function Bob({ children, delay = 0 }: { children: React.ReactNode; delay?: number }) {
  const v = useLoop(2600, delay);
  return <Animated.View style={{ transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [0, -4] }) }] }}>{children}</Animated.View>;
}
function Blink({ children }: { children: React.ReactNode }) {
  const v = useLoop(1200);
  return <Animated.View style={{ flex: 1, opacity: v.interpolate({ inputRange: [0, 1], outputRange: [1, 0.35] }) }}>{children}</Animated.View>;
}
function Pulse({ children, colour }: { children: React.ReactNode; colour: string }) {
  const v = useLoop(2000);
  return (
    <View>
      <Animated.View pointerEvents="none" style={[styles.pulse, { backgroundColor: fade(colour, 0.35), opacity: v, transform: [{ scaleX: v.interpolate({ inputRange: [0, 1], outputRange: [1, 1.04] }) }, { scaleY: v.interpolate({ inputRange: [0, 1], outputRange: [1, 1.18] }) }] }]} />
      {children}
    </View>
  );
}

// The round frame round a photo: your status colour (the default), your theme, gold, a rainbow, or nothing.
function PhotoFrame({ kind, ring, theme, children }: { kind: string; ring: string; theme: Theme; children: React.ReactNode }) {
  if (kind === 'rainbow') {
    return (
      <LinearGradient colors={RAINBOW} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.rainbow}>
        <View style={styles.rainbowInner}>{children}</View>
      </LinearGradient>
    );
  }
  if (kind === 'none') return <View style={styles.noFrame}>{children}</View>;
  const colour = kind === 'neon' ? theme.a : kind === 'gold' ? '#FFC83D' : ring;
  return (
    <View style={[styles.photoRing, { borderColor: colour, shadowColor: colour }, kind === 'gold' && styles.goldRing]}>
      {children}
    </View>
  );
}

// Picks a photo from the phone and shrinks it. undefined: nothing picked or it couldn't be used.
async function pick(wide: boolean, say: (m: string) => void): Promise<string | undefined> {
  let picked: ImagePicker.ImagePickerResult;
  try { picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 }); } catch (e) { say('That photo could not be opened. Try a different one.'); return undefined; }
  if (picked.canceled || !picked.assets || !picked.assets[0]) return undefined;
  try { return await (wide ? shrinkCover : shrinkPhoto)(picked.assets[0]); } catch (e) { say('That photo could not be used. Try a different one.'); return undefined; }
}

// Customise your page: every change shows on the page behind straight away and is saved as you tap.
function Customise({ style, earned, hasPhoto, busy, onStyle, onCover, onPhoto, onDone }: {
  style: Style; earned: string[]; hasPhoto: boolean; busy: boolean;
  onStyle: (change: Partial<Style>) => void; onCover: (remove: boolean) => void; onPhoto: () => void; onDone: () => void;
}) {
  const mine = BADGES.filter((b) => earned.includes(b.key));
  return (
    <ScrollView style={styles.customScroll} contentContainerStyle={styles.customBody}>
      <Text style={styles.sheetTitle}>Customise your page</Text>

      <Text style={styles.eyebrow}>Cover photo</Text>
      <View style={styles.wrap}>
        <Button small label={busy ? 'Saving...' : style.cover ? 'Change cover' : 'Add a cover'} disabled={busy} onPress={() => onCover(false)} />
        {style.cover && !busy ? <Button small ghost label="Remove" onPress={() => onCover(true)} /> : null}
      </View>

      <Text style={styles.eyebrow}>Profile photo</Text>
      <View style={styles.wrap}><Button small ghost label={hasPhoto ? 'Change photo' : 'Add a photo'} disabled={busy} onPress={onPhoto} /></View>

      <Text style={styles.eyebrow}>Colour theme</Text>
      <View style={styles.wrap}>
        {Object.keys(THEMES).map((k) => {
          const t = THEMES[k], on = style.theme === k;
          return (
            <Pressable key={k} onPress={() => onStyle({ theme: k })} style={styles.swatchBox} accessibilityRole="button" accessibilityState={{ selected: on }} accessibilityLabel={t.name + ' theme'}>
              <LinearGradient colors={[t.a, t.b]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.swatch, on && { borderColor: C.fg }]} />
              <Text style={[styles.pickText, !on && { color: C.muted }]}>{t.name}</Text>
            </Pressable>
          );
        })}
      </View>

      <Text style={styles.eyebrow}>Photo frame</Text>
      <View style={styles.wrap}>
        {FRAMES.map(([k, label]) => {
          const on = style.frame === k;
          return (
            <Pressable key={k} onPress={() => onStyle({ frame: k })} style={[styles.pick, on && styles.pickOn]} accessibilityRole="button" accessibilityState={{ selected: on }}>
              <Text style={[styles.pickText, !on && { color: C.muted }]}>{label}</Text>
            </Pressable>
          );
        })}
      </View>

      <Text style={styles.eyebrow}>Badges to show</Text>
      {mine.length ? (
        <>
          <View style={styles.wrap}>
            {mine.map((b) => {
              const on = style.badges.includes(b.key);
              return (
                <Pressable key={b.key} style={[styles.pick, on && { borderColor: b.colour, backgroundColor: fade(b.colour, 0.16) }]} accessibilityRole="button" accessibilityState={{ selected: on }}
                  onPress={() => {
                    const next = on ? style.badges.filter((x) => x !== b.key) : style.badges.concat(b.key);
                    if (next.length > 3) return;
                    onStyle({ badges: next });
                  }}>
                  <Text style={[styles.pickText, !on && { color: C.muted }]}>{b.name}</Text>
                </Pressable>
              );
            })}
          </View>
          <Text style={styles.small}>Pick up to 3. With none picked, all badges show.</Text>
        </>
      ) : <Text style={styles.small}>Go out with friends to earn your first badge, then pick which ones show here.</Text>}

      <Button label="Done" onPress={onDone} />
    </ScrollView>
  );
}

function Sheet({ children, onClose, insets }: { children: React.ReactNode; onClose: () => void; insets: number }) {
  return (
    <>
      <Pressable style={styles.dim} onPress={onClose} accessibilityLabel="Close" />
      <View style={[styles.sheet, { paddingBottom: 18 + insets }]}>
        <View style={styles.grab} />
        {children}
      </View>
    </>
  );
}

// Four nights to pick from: tonight (if there's still time), tomorrow, and the coming Friday and Saturday, at 7pm.
function planTimes(): [string, Date][] {
  const out: [string, Date][] = [];
  const seen: Record<string, boolean> = {};
  const add = (label: string, days: number) => {
    const d = new Date(); d.setDate(d.getDate() + days); d.setHours(19, 0, 0, 0);
    if (d.getTime() < Date.now() + 10 * 60000 || d.getTime() > Date.now() + 365 * 86400000) return;
    const key = d.toDateString();
    if (seen[key]) return;
    seen[key] = true; out.push([label, d]);
  };
  const today = new Date().getDay();
  add('Tonight', 0);
  add('Tomorrow', 1);
  add('Fri', ((5 - today + 7) % 7) || 7);
  add('Sat', ((6 - today + 7) % 7) || 7);
  return out;
}

const styles = themed(() => StyleSheet.create({
  page: { flex: 1, backgroundColor: C.bg },
  center: { alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24 },
  grow: { flex: 1, minWidth: 0 },
  stack: { gap: 8 },
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 },
  coverPic: { position: 'absolute', top: 0, left: 0, right: 0, height: 170, width: '100%' },
  cover: { height: 170, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', paddingHorizontal: 14 },
  round: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0, 0, 0, 0.4)', borderWidth: 1, borderColor: 'rgba(255, 255, 255, 0.2)' },
  dots: { fontFamily: F.bodyBold, fontSize: 20, lineHeight: 22, color: '#fff' },
  body: { marginTop: -64, paddingHorizontal: 18, gap: 18, maxWidth: 440, width: '100%', alignSelf: 'center' },
  who: { flexDirection: 'row', alignItems: 'flex-end', gap: 14 },
  goldRing: { borderWidth: 5, padding: 2 },
  rainbow: { borderRadius: 56, padding: 4 },
  rainbowInner: { borderRadius: 52, padding: 3, backgroundColor: C.bg },
  noFrame: { padding: 7 },
  photoRing: { borderWidth: 4, borderRadius: 54, padding: 3, backgroundColor: C.bg, shadowOpacity: C.dark ? 0.7 : 0.3, shadowRadius: 18, shadowOffset: { width: 0, height: 0 }, elevation: 6 },
  state: { fontFamily: F.bodyBold, fontSize: 12, letterSpacing: 1, textTransform: 'uppercase' },
  name: { fontFamily: F.display, fontSize: 28, lineHeight: 34, letterSpacing: -0.6, color: C.fg },
  card: { backgroundColor: C.surface, borderRadius: 18, padding: 14, gap: 4, borderWidth: 1, borderColor: C.line },
  eyebrow: { fontFamily: F.bodyBold, fontSize: 12, letterSpacing: 1.4, textTransform: 'uppercase', color: C.muted },
  text: { fontFamily: F.body, fontSize: 16, lineHeight: 22, color: C.fg },
  muted: { fontFamily: F.body, fontSize: 16, color: C.muted },
  small: { fontFamily: F.body, fontSize: 13, lineHeight: 18, color: C.muted },

  level: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 12, borderRadius: 22, borderWidth: 2 },
  segs: { flexDirection: 'row', gap: 3, marginTop: 8 },
  seg: { flex: 1, height: 12, borderRadius: 4, shadowOpacity: 0.6, shadowRadius: 6, shadowOffset: { width: 0, height: 0 } },
  segOff: { backgroundColor: C.surface2, shadowOpacity: 0 },
  rank: { position: 'absolute', right: 14, bottom: 30, paddingVertical: 6, paddingHorizontal: 11, borderRadius: 999, backgroundColor: 'rgba(0, 0, 0, 0.38)' },
  rankText: { fontFamily: F.bodyBold, fontSize: 11, letterSpacing: 1.2, textTransform: 'uppercase', color: '#fff' },
  spark: { position: 'absolute', width: 6, height: 6, borderRadius: 3, backgroundColor: '#fff', shadowColor: '#fff', shadowOpacity: 1, shadowRadius: 6, shadowOffset: { width: 0, height: 0 } },
  pulse: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, borderRadius: 999 },
  quest: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 11, borderRadius: 18, backgroundColor: C.surface, borderWidth: 1.5, borderColor: C.line },
  questIcon: { width: 38, height: 38, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  questBar: { height: 7, borderRadius: 4, backgroundColor: C.surface2, overflow: 'hidden', marginTop: 6 },
  prize: { paddingVertical: 5, paddingHorizontal: 9, borderRadius: 999 },
  prizeText: { fontFamily: F.bodyBold, fontSize: 11, color: '#fff' },
  badgeProg: { fontFamily: F.bodyBold, fontSize: 10, color: C.muted },
  lvl: { width: 58, height: 58, borderRadius: 18, alignItems: 'center', justifyContent: 'center', transform: [{ rotate: '-6deg' }] },
  lvlSmall: { fontFamily: F.bodyBold, fontSize: 9, letterSpacing: 1, color: '#fff' },
  lvlNum: { fontFamily: F.displayBold, fontSize: 24, lineHeight: 26, color: '#fff' },
  xp: { fontFamily: F.displayBold, fontSize: 16, color: C.fg },
  bar: { height: 10, borderRadius: 6, backgroundColor: C.surface2, overflow: 'hidden', marginTop: 6 },
  barFill: { height: '100%', borderRadius: 6 },

  stats: { flexDirection: 'row', gap: 8 },
  stat: { flex: 1, alignItems: 'center', paddingVertical: 11, borderRadius: 18, shadowOpacity: 0.5, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 3 },
  statNum: { fontFamily: F.displayBold, fontSize: 21, color: '#fff' },
  statLabel: { fontFamily: F.bodyBold, fontSize: 10, letterSpacing: 0.8, textTransform: 'uppercase', color: 'rgba(255, 255, 255, 0.9)' },

  badges: { flexDirection: 'row', justifyContent: 'space-between' },
  badgesPicked: { justifyContent: 'flex-start', gap: 14 },
  badge: { width: '19%', alignItems: 'center', gap: 6 },
  badgeTop: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  badgeName: { fontFamily: F.bodyBold, fontSize: 11, textAlign: 'center', color: C.fg },

  row: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 16, backgroundColor: C.surface, borderWidth: 1, borderColor: C.line },
  rowTitle: { fontFamily: F.bodyBold, fontSize: 15, color: C.fg },
  chip: { fontFamily: F.bodyBold, fontSize: 11, letterSpacing: 0.6, textTransform: 'uppercase', color: C.on, backgroundColor: fade(C.on, 0.16), paddingVertical: 4, paddingHorizontal: 10, borderRadius: 999, overflow: 'hidden' },

  actions: { position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 18, paddingTop: 12, backgroundColor: C.bg, borderTopWidth: 1, borderTopColor: C.line },

  dim: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, backgroundColor: 'rgba(4, 4, 10, 0.6)' },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: C.dark ? '#14141A' : '#FFFFFF', borderTopLeftRadius: 26, borderTopRightRadius: 26, borderWidth: 1, borderColor: C.line, padding: 18, gap: 12 },
  grab: { alignSelf: 'center', width: 44, height: 5, borderRadius: 3, backgroundColor: C.line },
  sheetTitle: { fontFamily: F.displayBold, fontSize: 20, color: C.fg },
  choice: { padding: 14, borderRadius: 18, borderWidth: 2, borderColor: C.on, backgroundColor: fade(C.on, 0.1), gap: 4 },
  when: { flexDirection: 'row', gap: 8 },
  whenBtn: { flex: 1, alignItems: 'center', paddingVertical: 12, borderRadius: 14, borderWidth: 1.5, borderColor: C.line, backgroundColor: C.surface },
  customScroll: { maxHeight: 520 },
  customBody: { gap: 12, paddingBottom: 6 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  swatchBox: { alignItems: 'center', gap: 4, width: 52 },
  swatch: { width: 40, height: 40, borderRadius: 20, borderWidth: 3, borderColor: 'transparent' },
  pick: { paddingVertical: 9, paddingHorizontal: 14, borderRadius: 999, borderWidth: 1.5, borderColor: C.line, backgroundColor: C.surface },
  pickOn: { borderColor: C.fg },
  pickText: { fontFamily: F.bodyBold, fontSize: 13, color: C.fg },
  whenText: { fontFamily: F.bodyBold, fontSize: 14, color: C.fg }
}));
