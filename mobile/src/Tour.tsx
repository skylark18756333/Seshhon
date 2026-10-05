// The short walkthrough, opened again from "Show the tour" on the You page. The same six steps, words and
// buttons as docs/tour.js; each picture is drawn from the native screens' own pieces like the web one is.
import React, { useRef, useState } from 'react';
import { Modal, PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import type { Colour } from './api';
import Logo from './Logo';
import { Face } from './Parts';
import { C, COLOURS, F, LABELS } from './theme';

const ZEST = '#B8F23E';
const PIN_BLUE = '#1F7BFF';

type Step = { art: React.ReactNode; title: string; body: React.ReactNode };

function steps(name: string): Step[] {
  return [
    {
      art: <View style={styles.bigLogo}><Logo /></View>,
      title: name ? 'Welcome, ' + name + '.' : 'Welcome to Frendzy.',
      body: "Frendzy is for getting off your phone and out with your mates. Here's how it works in five quick steps."
    },
    {
      art: (
        <View style={styles.slide}>
          <View style={[styles.knob, { backgroundColor: 'rgba(61, 220, 132, 0.22)' }]} />
          {['G', 'A', 'R'].map((x) => <View key={x} style={styles.stop}><Text style={styles.stopText}>{x}</Text></View>)}
        </View>
      ),
      title: "Slide to show you're up for it",
      body: (
        <Text>
          <Text style={[styles.strong, { color: C.on }]}>Green</Text> means you're keen to go out. <Text style={[styles.strong, { color: C.thinking }]}>Amber</Text> means you're thinking about it.{' '}
          <Text style={[styles.strong, { color: C.off }]}>Red</Text> means you're off and hidden. You start on red, and green or amber goes back to red by itself later.
        </Text>
      )
    },
    {
      art: (
        <View style={styles.faces}>
          {([['Mia', 'on'], ['Jay', 'thinking'], ['Sam', 'off']] as [string, Colour][]).map(([n, c]) => (
            <View key={n} style={styles.face}>
              <View style={[styles.faceRing, { borderColor: c === 'off' ? 'transparent' : COLOURS[c], shadowColor: COLOURS[c] }]}>
                <Face id="" name={n} photos={{}} size={56} font={20} away={c === 'off'} />
              </View>
              <Text style={styles.faceName}>{n}</Text>
              <Text style={[styles.faceState, { color: c === 'off' ? C.muted : COLOURS[c] }]}>{LABELS[c]}</Text>
            </View>
          ))}
        </View>
      ),
      title: 'Bring your friends',
      body: 'Frendzy only works with friends on it. Send them your invite link, then accept their request. Friends show up as faces lit in their status colour, and only friends see your photo.'
    },
    {
      art: (
        <View style={styles.chat}>
          <Text style={styles.msg}>Who's keen tonight?</Text>
          <Text style={[styles.msg, styles.msgMe]}>Me! Vote for a spot</Text>
          <View style={styles.vote}>
            <Text style={styles.voteName}>The Bird</Text>
            <View style={styles.bar}><View style={styles.barFill} /></View>
            <Text style={styles.voteCount}>3</Text>
          </View>
        </View>
      ),
      title: 'Start a sesh',
      body: "When you're green, start a sesh. Friends join, vote on where to go and chat. When the sesh ends, its votes and chat are deleted."
    },
    {
      art: (
        <View style={styles.map}>
          <View style={[styles.road, { top: '45%', transform: [{ rotate: '-25deg' }] }]} />
          <View style={[styles.road, styles.roadThin, { top: '62%', transform: [{ rotate: '-70deg' }] }]} />
          <Pin left="22%" top="60%" />
          <Pin left="74%" top="50%" />
          <Pin left="47%" top="42%" hot />
          <View style={[styles.tag, { left: '47%', top: '58%' }]}>
            <Text style={styles.tagName}>The Bird</Text>
            <Text style={styles.tagSmall}>Open till 2am</Text>
          </View>
        </View>
      ),
      title: 'Find a place',
      body: "On the Map, choose where to look and how far you'll go. Tap a pin to see the venue, its hours and rating. The Events tab shows what's on tonight."
    },
    {
      art: (
        <Svg width={64} height={64} viewBox="0 0 24 24" fill="none" stroke={C.on} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
          <Path d="M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6z" />
          <Path d="M8.5 12l2.5 2.5 4.5-5" />
        </Svg>
      ),
      title: "You're in control",
      body: 'Block anyone in one tap. Women and non-binary people can turn on a women and non-binary only mode under Safety on your profile. You can see this tour again from there too.'
    }
  ];
}

function Pin({ left, top, hot }: { left: `${number}%`; top: `${number}%`; hot?: boolean }) {
  return (
    <View style={[styles.pin, { left, top }]}>
      <Svg width={30} height={40} viewBox="0 0 30 40">
        <Path d="M15 39s13-13.4 13-23.5C28 7.5 22.2 2 15 2S2 7.5 2 15.5C2 25.6 15 39 15 39z" fill={hot ? ZEST : PIN_BLUE} stroke="#0B0B0D" strokeWidth={2} />
        <Circle cx={15} cy={15} r={5} fill="#fff" />
      </Svg>
    </View>
  );
}

export default function Tour({ name, onClose }: { name: string; onClose: () => void }) {
  const list = steps(name);
  const [at, setAt] = useState(0);
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
            {last ? null : (
              <Pressable onPress={onClose} accessibilityRole="button" style={styles.skip}><Text style={styles.skipText}>Skip</Text></Pressable>
            )}
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
            <Pressable style={styles.btn} onPress={() => move(1)} accessibilityRole="button">
              <Text style={styles.btnText}>{last ? "Let's go" : at ? 'Next' : 'Show me'}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  dim: { flex: 1, justifyContent: 'flex-end', alignItems: 'center', padding: 16, backgroundColor: 'rgba(5, 5, 6, 0.82)' },
  card: { width: '100%', maxWidth: 420, backgroundColor: '#131418', borderWidth: 1, borderColor: C.line, borderRadius: 26, paddingTop: 18, paddingHorizontal: 20, paddingBottom: 20, gap: 14 },
  headRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 40 },
  eyebrow: { fontFamily: F.bodyBold, fontSize: 12, letterSpacing: 1.4, textTransform: 'uppercase', color: C.muted },
  skip: { minHeight: 40, paddingHorizontal: 4, justifyContent: 'center' },
  skipText: { fontFamily: F.body, fontSize: 14, color: C.muted, textDecorationLine: 'underline' },
  art: { height: 170, borderRadius: 18, backgroundColor: C.bg, borderWidth: 1, borderColor: C.line, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
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
  slide: { flexDirection: 'row', width: '86%', maxWidth: 280, height: 76, padding: 5, borderRadius: 38, backgroundColor: C.track, borderWidth: 1, borderColor: C.trackLine },
  knob: { position: 'absolute', top: 5, bottom: 5, left: 5, width: '31%', borderRadius: 33 },
  stop: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  stopText: { fontFamily: F.bodyBold, fontSize: 18, color: C.fg },
  faces: { flexDirection: 'row', width: '86%', justifyContent: 'space-around' },
  face: { alignItems: 'center', gap: 4 },
  faceRing: { borderWidth: 2, borderRadius: 32, padding: 2, shadowOpacity: 0.8, shadowRadius: 12, shadowOffset: { width: 0, height: 0 } },
  faceName: { fontFamily: F.bodyBold, fontSize: 14, color: C.fg },
  faceState: { fontFamily: F.body, fontSize: 12 },
  chat: { width: '86%', gap: 8 },
  msg: { alignSelf: 'flex-start', fontFamily: F.body, fontSize: 14, color: C.fg, backgroundColor: C.surface2, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 18, borderBottomLeftRadius: 6, overflow: 'hidden' },
  msgMe: { alignSelf: 'flex-end', backgroundColor: C.accent, color: C.accentInk, borderBottomLeftRadius: 18, borderBottomRightRadius: 6 },
  vote: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  voteName: { fontFamily: F.body, fontSize: 14, color: C.fg },
  bar: { flex: 1, height: 8, borderRadius: 4, backgroundColor: C.line, overflow: 'hidden' },
  barFill: { width: '70%', height: '100%', borderRadius: 4, backgroundColor: C.accent },
  voteCount: { fontFamily: F.body, fontSize: 14, color: C.muted },
  map: { width: '100%', height: '100%', backgroundColor: '#141B2A' },
  road: { position: 'absolute', left: '-20%', width: '140%', height: 6, backgroundColor: '#3A4256' },
  roadThin: { height: 4, backgroundColor: '#2E3546' },
  pin: { position: 'absolute', marginLeft: -15, marginTop: -40 },
  tag: { position: 'absolute', transform: [{ translateX: -50 }], backgroundColor: 'rgba(16, 17, 21, 0.92)', borderRadius: 10, paddingVertical: 5, paddingHorizontal: 10 },
  tagName: { fontFamily: F.bodyMid, fontSize: 14, color: C.fg },
  tagSmall: { fontFamily: F.body, fontSize: 12, color: '#C9CCD3' }
});
