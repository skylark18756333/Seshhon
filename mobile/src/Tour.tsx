// The walkthrough shown after sign-up, and again from "Show the tour" on the You page. Seven quick steps through
// the app as it is now: the switch, the party lobby, the sesh card, the Map and Events, friends and messages, and
// safety. Each picture is drawn from the screens' own colours, so it matches whichever look is picked. After it,
// a tip pops up the first time each button is tapped (tips.ts, Tip.tsx).
import React, { useEffect, useRef, useState } from 'react';
import { LinearGradient } from 'expo-linear-gradient';
import { Modal, PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import type { Colour } from './api';
import Icon from './Icon';
import Logo from './Logo';
import { Face } from './Parts';
import { pauseTips, startGuide } from './tips';
import { C, COLOURS, F, LABELS, fade, themed } from './theme';

type Step = { art: React.ReactNode; title: string; body: React.ReactNode };

const TILES: [string, string, [string, string]][] = [
  ['⚡', 'Go now', ['#FF7A45', '#E0407A']],
  ['📍', 'Crewzy crawl', ['#21C6A4', '#2A7FD4']],
  ['🗓', 'Plan for later', ['#5B8CFF', '#9B5BFF']],
  ['🔒', 'Invite only', ['#C04BD8', '#5E3BD1']]
];

function steps(name: string): Step[] {
  return [
    {
      art: <View style={styles.bigLogo}><Logo status="on" /></View>,
      title: name ? 'Welcome, ' + name + '.' : 'Welcome to Crewzy.',
      body: "Crewzy gets you off your phone and out with your mates. Here's the app in six quick steps. Then I'll show you round the real thing, button by button."
    },
    {
      art: <SwitchArt />,
      title: 'Your switch',
      body: (
        <Text>
          Tap the glowing orb in the middle of the bottom bar, or push it sideways. <Text style={[styles.strong, { color: C.on }]}>Green</Text> means you're keen to go out.{' '}
          <Text style={[styles.strong, { color: C.thinking }]}>Amber</Text> means you're thinking about it, and only friends you allow see it.{' '}
          <Text style={[styles.strong, { color: C.off }]}>Red</Text> means you're off and hidden. Green and amber go back to red by themselves later.
        </Text>
      )
    },
    {
      art: (
        <View style={styles.tiles}>
          {TILES.map(([emoji, title, colours]) => (
            <LinearGradient key={title} colors={colours} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.tile}>
              <Text style={styles.tileEmoji}>{emoji}</Text>
              <Text style={styles.tileTitle} numberOfLines={1}>{title}</Text>
            </LinearGradient>
          ))}
        </View>
      ),
      title: 'Start a party',
      body: "When you're not in a sesh, Home is your party lobby. Go now, plan a Crewzy crawl, plan one for later, or keep it invite only. Hosting earns XP for every friend who joins."
    },
    {
      art: <SeshArt />,
      title: 'In a sesh',
      body: "The sesh card shows who's in, the newest chat line and the crawl. Chat, vote on where to go and tick off each stop. When the sesh ends, its chat and votes are deleted."
    },
    {
      art: <MapArt />,
      title: 'Find a place',
      body: "The Map shows venues around you on a radar. Pick how far with the km buttons, swipe the cards, and use Middle to find spots between your crew. The Events tab has what's on tonight."
    },
    {
      art: (
        <View style={styles.faces}>
          {([['Mia', 'on'], ['Jay', 'thinking'], ['Sam', 'off']] as [string, Colour][]).map(([n, c]) => (
            <View key={n} style={styles.face}>
              <View style={[styles.faceRing, { borderColor: c === 'off' ? C.line : COLOURS[c], shadowColor: COLOURS[c], shadowOpacity: c === 'off' ? 0 : 0.8 }]}>
                <Face id="" name={n} photos={{}} size={52} font={18} />
              </View>
              <Text style={styles.faceName}>{n}</Text>
              {c === 'off' ? null : <Text style={[styles.faceState, { color: COLOURS[c] }]}>{LABELS[c]}</Text>}
            </View>
          ))}
          <View style={styles.headBtns}>
            <View style={styles.headBtn}><Icon name="sesh" size={16} colour={C.fg} /></View>
          </View>
        </View>
      ),
      title: 'Friends and messages',
      body: 'The button at the top right opens your friends, shown as round photos lit in their colour. Chats on the bottom bar holds your messages, locked end to end and deleted once read or after 7 days.'
    },
    {
      art: (
        <Svg width={64} height={64} viewBox="0 0 24 24" fill="none" stroke={C.on} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
          <Path d="M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6z" />
          <Path d="M8.5 12l2.5 2.5 4.5-5" />
        </Svg>
      ),
      title: "You're in control",
      body: 'Block anyone in one tap. Women and non-binary people can turn on women and non-binary only mode under Safety on your page. This tour and the tips are there too, under How Crewzy works.'
    }
  ];
}

// The status switch: a dark track with the green orb lit on the right.
function SwitchArt() {
  return (
    <View style={styles.switchCard}>
      <Text style={styles.switchEyebrow}>Your status</Text>
      <Text style={[styles.switchWord, { color: C.on }]}>Keen</Text>
      <View style={[styles.track, { borderColor: fade(C.on, 0.35) }]}>
        {(['off', 'thinking', 'on'] as Colour[]).map((k) => (
          <View key={k} style={styles.stop}>
            {k === 'on' ? <View style={[styles.orb, { backgroundColor: C.on, shadowColor: C.on }]} />
              : <View style={[styles.stopDot, { borderColor: COLOURS[k] }]} />}
          </View>
        ))}
      </View>
    </View>
  );
}

// A small sesh card in the look's own hero colours.
function SeshArt() {
  return (
    <LinearGradient colors={[C.heroFrom, C.heroTo]} start={{ x: 0, y: 0 }} end={{ x: 0.6, y: 1 }} style={styles.sesh}>
      <View style={styles.livePill}><View style={styles.liveDot} /><Text style={styles.liveText}>LIVE SESH</Text></View>
      <Text style={styles.seshTitle}>The Bird</Text>
      <View style={styles.seshFaces}>
        {['Mia', 'Jay', 'Ana'].map((n, i) => (
          <View key={n} style={[styles.seshFace, i ? { marginLeft: -8 } : null]}><Face id="" name={n} photos={{}} size={24} font={9} /></View>
        ))}
        <Text style={styles.seshSmall}>  3 in</Text>
      </View>
      <View style={styles.seg}>
        {['Chat', 'Vote', 'Crawl', 'More'].map((k, i) => (
          <View key={k} style={[styles.segBtn, i === 0 && styles.segOn]}><Text style={[styles.segText, i === 0 && styles.segTextOn]}>{k}</Text></View>
        ))}
      </View>
    </LinearGradient>
  );
}

// The radar: a glowing circle with venues inside it, and the km buttons.
function MapArt() {
  return (
    <View style={styles.map}>
      <View style={[styles.road, { top: '40%', transform: [{ rotate: '-22deg' }] }]} />
      <View style={[styles.road, styles.roadThin, { top: '60%', transform: [{ rotate: '-68deg' }] }]} />
      <View style={styles.radar} />
      <View style={[styles.blip, { left: '38%', top: '38%' }]} />
      <View style={[styles.blip, { left: '58%', top: '50%' }]} />
      <View style={[styles.blip, styles.blipGold, { left: '47%', top: '62%' }]} />
      <View style={styles.me} />
      <View style={styles.kms}>
        {[1, 2, 5, 10].map((n) => (
          <View key={n} style={[styles.km, n === 2 && styles.kmOn]}><Text style={[styles.kmText, n === 2 && styles.kmTextOn]}>{n} km</Text></View>
        ))}
      </View>
    </View>
  );
}

export default function Tour({ name, onClose }: { name: string; onClose: () => void }) {
  const list = steps(name);
  const [at, setAt] = useState(0);
  // Tips wait while the walkthrough is open, then start once it closes.
  useEffect(() => { pauseTips(true); return () => pauseTips(false); }, []);
  const last = at === list.length - 1;
  const move = (by: number) => {
    const to = at + by;
    if (to < 0) return;
    if (to >= list.length) { onClose(); return; }
    setAt(to);
  };
  // Swipe left or right to move between steps.
  const moveRef = useRef(move);
  moveRef.current = move;
  const swipe = useRef(PanResponder.create({
    onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 20 && Math.abs(g.dx) > Math.abs(g.dy),
    onPanResponderRelease: (_, g) => { if (Math.abs(g.dx) > 50) moveRef.current(g.dx < 0 ? 1 : -1); }
  })).current;
  const s = list[at];
  return (
    <Modal transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.dim} {...swipe.panHandlers}>
        <View style={styles.card} accessibilityViewIsModal accessibilityLabel={s.title}>
          <View style={styles.headRow}>
            <Text style={styles.eyebrow}>{at + 1} of {list.length}</Text>
            <Pressable onPress={onClose} accessibilityRole="button" style={styles.skip}><Text style={styles.skipText}>{last ? "I'll explore myself" : 'Skip'}</Text></Pressable>
          </View>
          <View style={styles.art}>{s.art}</View>
          <Text style={styles.h1} accessibilityRole="header">{s.title}</Text>
          <Text style={styles.body}>{s.body}</Text>
          <View style={styles.dots}>
            {list.map((_, i) => <View key={i} style={[styles.dot, i === at && styles.dotOn]} />)}
          </View>
          <View style={styles.row}>
            {at ? (
              <Pressable style={[styles.btn, styles.btnGhost]} onPress={() => move(-1)} accessibilityRole="button">
                <Text style={[styles.btnText, { color: C.fg }]}>Back</Text>
              </Pressable>
            ) : null}
            {/* The last step hands over to "Show me around" on the real screens (tips.ts). */}
            <Pressable style={styles.btn} onPress={() => { if (last) { onClose(); startGuide(); } else move(1); }} accessibilityRole="button">
              <Text style={styles.btnText}>{last ? 'Show me around' : at ? 'Next' : 'Show me'}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = themed(() => StyleSheet.create({
  dim: { flex: 1, justifyContent: 'flex-end', alignItems: 'center', padding: 16, backgroundColor: C.dark ? 'rgba(5, 5, 6, 0.82)' : 'rgba(17, 17, 20, 0.55)' },
  card: { width: '100%', maxWidth: 420, backgroundColor: C.dark ? C.bg : '#FFFFFF', borderWidth: 1, borderColor: C.line, borderRadius: 26, paddingTop: 18, paddingHorizontal: 20, paddingBottom: 20, gap: 14 },
  headRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 40 },
  eyebrow: { fontFamily: F.bodyBold, fontSize: 12, letterSpacing: 1.4, textTransform: 'uppercase', color: C.muted },
  skip: { minHeight: 40, paddingHorizontal: 4, justifyContent: 'center' },
  skipText: { fontFamily: F.body, fontSize: 14, color: C.muted, textDecorationLine: 'underline' },
  art: { height: 170, borderRadius: 18, backgroundColor: C.dark ? C.surface : C.bg, borderWidth: 1, borderColor: C.line, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  h1: { fontFamily: F.display, fontSize: 26, lineHeight: 29, letterSpacing: -0.5, color: C.fg },
  body: { fontFamily: F.body, fontSize: 16, lineHeight: 22, color: C.muted },
  strong: { fontFamily: F.bodyBold },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 6 },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: C.line },
  dotOn: { width: 20, backgroundColor: C.accent },
  row: { flexDirection: 'row', gap: 12 },
  btn: { flex: 1, minHeight: 54, borderRadius: 27, backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center' },
  btnGhost: { backgroundColor: C.surface, borderWidth: 1, borderColor: C.line },
  btnText: { fontFamily: F.bodyBold, fontSize: 16, color: C.accentInk },

  bigLogo: { transform: [{ scale: 1.5 }] },
  switchCard: { width: '86%', gap: 2 },
  switchEyebrow: { fontFamily: F.bodyBold, fontSize: 11, letterSpacing: 1.4, textTransform: 'uppercase', color: C.muted },
  switchWord: { fontFamily: F.display, fontSize: 26, lineHeight: 30, marginBottom: 8 },
  track: { flexDirection: 'row', height: 58, borderRadius: 29, backgroundColor: C.track, borderWidth: 1 },
  stop: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  stopDot: { width: 22, height: 22, borderRadius: 11, borderWidth: 2.5 },
  orb: { position: 'absolute', top: 4, bottom: 4, left: 4, right: 4, borderRadius: 25, shadowOpacity: 0.9, shadowRadius: 14, shadowOffset: { width: 0, height: 0 }, elevation: 6 },
  tiles: { width: '90%', flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tile: { width: '48%', flexGrow: 1, height: 64, borderRadius: 16, padding: 10, justifyContent: 'space-between' },
  tileEmoji: { fontSize: 16 },
  tileTitle: { fontFamily: F.bodyBold, fontSize: 13, color: '#fff' },
  sesh: { width: '86%', borderRadius: 20, padding: 12, gap: 6 },
  livePill: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', backgroundColor: 'rgba(0, 0, 0, 0.25)', borderRadius: 10, paddingVertical: 3, paddingHorizontal: 8 },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: C.on },
  liveText: { fontFamily: F.bodyBold, fontSize: 10, letterSpacing: 1.2, color: '#fff' },
  seshTitle: { fontFamily: F.display, fontSize: 22, color: '#fff' },
  seshFaces: { flexDirection: 'row', alignItems: 'center' },
  seshFace: { borderWidth: 2, borderColor: 'rgba(255, 255, 255, 0.9)', borderRadius: 14 },
  seshSmall: { fontFamily: F.body, fontSize: 12, color: 'rgba(255, 255, 255, 0.85)' },
  seg: { flexDirection: 'row', gap: 5 },
  segBtn: { flex: 1, height: 26, borderRadius: 10, backgroundColor: 'rgba(255, 255, 255, 0.18)', alignItems: 'center', justifyContent: 'center' },
  segOn: { backgroundColor: '#fff' },
  segText: { fontFamily: F.bodyBold, fontSize: 11, color: '#fff' },
  segTextOn: { color: '#111114' },
  faces: { flexDirection: 'row', width: '90%', justifyContent: 'space-around', alignItems: 'center' },
  face: { alignItems: 'center', gap: 4 },
  faceRing: { borderWidth: 2.5, borderRadius: 32, padding: 2, shadowRadius: 12, shadowOffset: { width: 0, height: 0 } },
  faceName: { fontFamily: F.bodyBold, fontSize: 13, color: C.fg },
  faceState: { fontFamily: F.body, fontSize: 11 },
  headBtns: { gap: 8 },
  headBtn: { width: 38, height: 38, borderRadius: 19, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface2, alignItems: 'center', justifyContent: 'center' },
  map: { width: '100%', height: '100%', backgroundColor: C.dark ? '#141B2A' : '#E4E7EC' },
  road: { position: 'absolute', left: '-20%', width: '140%', height: 6, backgroundColor: C.dark ? '#3A4256' : '#FFFFFF' },
  roadThin: { height: 4, backgroundColor: C.dark ? '#2E3546' : '#F4F5F7' },
  radar: { position: 'absolute', left: '50%', top: '50%', width: 120, height: 120, marginLeft: -60, marginTop: -60, borderRadius: 60, borderWidth: 2, borderColor: C.on, backgroundColor: fade(C.on, 0.12), shadowColor: C.on, shadowOpacity: 0.8, shadowRadius: 12, shadowOffset: { width: 0, height: 0 } },
  blip: { position: 'absolute', width: 12, height: 12, marginLeft: -6, marginTop: -6, borderRadius: 6, backgroundColor: C.on, borderWidth: 2, borderColor: '#fff' },
  blipGold: { backgroundColor: '#FFC53D' },
  me: { position: 'absolute', left: '50%', top: '50%', width: 14, height: 14, marginLeft: -7, marginTop: -7, borderRadius: 7, backgroundColor: '#1F7BFF', borderWidth: 3, borderColor: '#fff' },
  kms: { position: 'absolute', top: 10, left: 10, flexDirection: 'row', gap: 5 },
  km: { paddingVertical: 4, paddingHorizontal: 9, borderRadius: 12, backgroundColor: C.tabBg, borderWidth: 1, borderColor: C.line },
  kmOn: { backgroundColor: C.on, borderColor: C.on },
  kmText: { fontFamily: F.bodyBold, fontSize: 11, color: C.fg },
  kmTextOn: { color: '#04210F' }
}));
