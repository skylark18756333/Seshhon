// A friend's profile, opened by tapping their face anywhere in the app: their photo, colour, about line, level and
// badges, what you two share (seshes you're both in, crews), and a Sesh request button. It never shows where
// anyone is or has been. friend_profile() (migration 0040) applies the same colour rules as everywhere else: red,
// hidden-from-you and amber you aren't allowed to see all come back as 'off'.
import { LinearGradient } from 'expo-linear-gradient';
import React, { useEffect, useState } from 'react';
import * as ImagePicker from 'expo-image-picker';
import { Image, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Colour } from './api';
import Icon from './Icon';
import { Button, Face, Toast } from './Parts';
import { shrinkCover, shrinkPhoto } from './photos';
import { rpc, type ApiError } from './session';
import type { Frendzy } from './useFrendzy';
import { C, COLOURS, F, fade, first, fmtWhen, hue, themed } from './theme';

type Profile = {
  id: string; name: string; about?: string | null; colour: Colour; photo?: string | null;
  level?: number; xp?: number; next?: number; from?: number;
  seshes?: number; friends?: number; mutual?: number; badges?: string[];
  crews?: string[]; together?: { id: string; at: string; host: string }[];
};

// Every badge there is, in the order they show. Earned ones are lit; the rest stay faint so friends see what's next.
const BADGES: { key: string; name: string; icon: string; colour: string; how: string }[] = [
  { key: 'first_round', name: 'First round', icon: 'tick', colour: '#FFC83D', how: 'Joined a friend\'s sesh' },
  { key: 'regular', name: 'Regular', icon: 'clock', colour: '#FF4FA3', how: 'Joined 10 seshes' },
  { key: 'ringleader', name: 'Ringleader', icon: 'sesh', colour: '#3DDC84', how: 'Friends joined 5 of your seshes' },
  { key: 'planner', name: 'Planner', icon: 'events', colour: '#8B5CFF', how: 'Friends said they\'re in to 3 of your plans' },
  { key: 'social', name: 'Social', icon: 'you', colour: '#3DC8FF', how: '10 friends on Crewzy' }
];

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

export function FriendProfileHost({ f, onMessages }: { f: Frendzy; onMessages: () => void }) {
  const [id, setId] = useState<string | null>(null);
  useEffect(() => { show = setId; return () => { show = null; }; }, []);
  return (
    <Modal visible={!!id} animationType="slide" onRequestClose={() => setId(null)} statusBarTranslucent>
      {id ? <FriendProfile f={f} id={id} onClose={() => setId(null)} onMessages={() => { setId(null); onMessages(); }} /> : null}
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
            <View style={styles.level}>
              <View style={[styles.lvl, style ? { borderColor: theme.b, backgroundColor: fade(theme.b, 0.14) } : null]}><Text style={styles.lvlSmall}>LVL</Text><Text style={styles.lvlNum}>{level}</Text></View>
              <View style={styles.grow}>
                <View style={styles.between}>
                  <Text style={styles.xp}>{xp.toLocaleString()} XP</Text>
                  <Text style={styles.small}>{(next - xp).toLocaleString()} to level {level + 1}</Text>
                </View>
                <View style={styles.bar}><LinearGradient colors={[theme.a, theme.b]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={[styles.barFill, { width: `${Math.round(part * 100)}%` }]} /></View>
              </View>
            </View>
          ) : null}

          {game ? (
            <View style={styles.stats}>
              {[['Friends', view.friends], ['Mutual', view.mutual], ['Seshes', view.seshes], ['Badges', earned.length]].map(([label, n]) => (
                <View key={label as string} style={styles.stat}>
                  <Text style={styles.statNum}>{n == null ? '–' : String(n)}</Text>
                  <Text style={styles.statLabel}>{label as string}</Text>
                </View>
              ))}
            </View>
          ) : null}

          {game ? (
            <View style={styles.stack}>
              <Text style={styles.eyebrow}>{shown === BADGES ? 'Badges' : 'Showing off'}</Text>
              <View style={[styles.badges, shown !== BADGES && styles.badgesPicked]}>
                {shown.map((b) => {
                  const lit = earned.includes(b.key);
                  return (
                    <View key={b.key} style={styles.badge} accessibilityLabel={b.name + (lit ? ', earned. ' : ', not yet. ') + b.how}>
                      <View style={[styles.badgeIcon, { backgroundColor: fade(b.colour, lit ? 0.22 : 0.06), borderColor: lit ? b.colour : C.line }]}>
                        <Icon name={b.icon} size={20} colour={lit ? b.colour : C.muted} />
                      </View>
                      <Text style={[styles.badgeName, !lit && { color: C.muted }]} numberOfLines={2}>{b.name}</Text>
                    </View>
                  );
                })}
              </View>
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

      {self && style ? (
        <View style={[styles.actions, { paddingBottom: 14 + insets.bottom }]}>
          <View style={styles.grow}><Button label="Customise your page" onPress={() => setCustom(true)} testID="profile-customise" /></View>
        </View>
      ) : self ? null : (
        <View style={[styles.actions, { paddingBottom: 14 + insets.bottom }]}>
          <View style={styles.grow}><Button label="Sesh request" onPress={() => setSheet(true)} testID="profile-sesh" /></View>
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
    if (d.getTime() < Date.now() + 10 * 60000 || d.getTime() > Date.now() + 14 * 86400000) return;
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

  level: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  lvl: { width: 54, height: 54, borderRadius: 16, borderWidth: 2, borderColor: '#FFC83D', backgroundColor: fade('#FFC83D', 0.14), alignItems: 'center', justifyContent: 'center', transform: [{ rotate: '-6deg' }] },
  lvlSmall: { fontFamily: F.bodyBold, fontSize: 9, letterSpacing: 1, color: C.dark ? '#FFC83D' : '#9A6B00' },
  lvlNum: { fontFamily: F.displayBold, fontSize: 20, lineHeight: 22, color: C.dark ? '#FFC83D' : '#9A6B00' },
  xp: { fontFamily: F.displayBold, fontSize: 16, color: C.fg },
  bar: { height: 10, borderRadius: 6, backgroundColor: C.surface2, overflow: 'hidden', marginTop: 6 },
  barFill: { height: '100%', borderRadius: 6 },

  stats: { flexDirection: 'row', gap: 8 },
  stat: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 16, backgroundColor: C.surface, borderWidth: 1, borderColor: C.line },
  statNum: { fontFamily: F.displayBold, fontSize: 19, color: C.fg },
  statLabel: { fontFamily: F.bodyBold, fontSize: 10, letterSpacing: 0.8, textTransform: 'uppercase', color: C.muted },

  badges: { flexDirection: 'row', justifyContent: 'space-between' },
  badgesPicked: { justifyContent: 'flex-start', gap: 14 },
  badge: { width: '19%', alignItems: 'center', gap: 6 },
  badgeIcon: { width: 48, height: 48, borderRadius: 16, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
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
