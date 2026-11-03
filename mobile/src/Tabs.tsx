// The thumb dock at the bottom: Home, Map, your status orb, Events and Chats. The icons are "Crewzy dots":
// line icons that each hold a light (Chats holds three). The lights and the dock's edge glow take your colour. The orb in the middle glows your
// colour; tap it and red, amber and green fan out above it, so you can change your status from any tab, or push it
// sideways (right towards green, left towards red). Swiping along the rest of the bar moves between the tabs.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import type { Colour } from './api';
import { C, COLOURS, F, LABELS, fade, themed } from './theme';

const TABS: [string, string][] = [['home', 'Home'], ['map', 'Map'], ['orb', ''], ['events', 'Events'], ['messages', 'Chats']];
const ORDER: Colour[] = ['off', 'thinking', 'on'];   // red, amber, green, left to right as on the logo
const PAGES = TABS.map(([k]) => k).filter((k) => k !== 'orb');   // the tabs a swipe along the bar moves between
const STEP = 64;      // how far a finger moves along the bar to go one tab over
const NUDGE = 24;     // how far the orb is pushed sideways to change colour
const sideways = (dx: number, dy: number, min: number) => Math.abs(dx) > min && Math.abs(dx) > Math.abs(dy) * 1.5;

// One Crewzy dots icon: the line drawing in ink, and its light (or lights) in colour.
function DotIcon({ name, ink, lit, light }: { name: string; ink: string; lit: boolean; light: string }) {
  const op = lit ? 1 : 0.7;
  const line = { fill: 'none', stroke: ink, strokeWidth: 2.2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  return (
    <Svg width={27} height={27} viewBox="0 0 24 24">
      {name === 'home' ? (
        <>
          <Path d="M3.5 11 12 4l8.5 7" {...line} />
          <Path d="M6 10v10h12V10" {...line} />
          <Circle cx={12} cy={14.5} r={2} fill={light} opacity={op} />
        </>
      ) : name === 'map' ? (
        <>
          <Path d="M12 21.5s-7-6.4-7-11.7a7 7 0 0 1 14 0c0 5.3-7 11.7-7 11.7z" {...line} />
          <Circle cx={12} cy={9.8} r={2.4} fill={light} opacity={op} />
        </>
      ) : name === 'events' ? (
        <>
          <Path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h15A1.5 1.5 0 0 1 21 6.5v3a2.5 2.5 0 0 0 0 5v3a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5v-3a2.5 2.5 0 0 0 0-5z" {...line} />
          <Circle cx={9} cy={12} r={2} fill={light} opacity={op} />
        </>
      ) : (
        <>
          <Path d="M12 3c5 0 9 3.6 9 8s-4 8-9 8c-1 0-2-.1-2.9-.4L4 20.5l1.3-4A7.6 7.6 0 0 1 3 11c0-4.4 4-8 9-8z" {...line} />
          <Circle cx={8} cy={11} r={1.4} fill={light} opacity={op} />
          <Circle cx={12} cy={11} r={1.4} fill={light} opacity={op} />
          <Circle cx={16} cy={11} r={1.4} fill={light} opacity={op} />
        </>
      )}
    </Svg>
  );
}

export default function Tabs({ tab, requests, colour, onPick, onColour }: {
  tab: string; requests: number; colour: Colour | null; onPick: (tab: string) => void; onColour: (c: Colour) => void;
}) {
  const [open, setOpen] = useState(false);
  const [shown, setShown] = useState(false);   // the fan stays mounted only while open or closing, so it never sits over the screen
  const fan = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (open) setShown(true);
    Animated.spring(fan, { toValue: open ? 1 : 0, useNativeDriver: true, friction: 7, tension: 90 }).start(({ finished }) => {
      if (finished && !open) setShown(false);
    });
  }, [open, fan]);
  useEffect(() => { setOpen(false); }, [tab]);
  const glow = colour ? COLOURS[colour] : C.line;

  // Swipe along the bar: the highlight follows your finger, one tab over for every STEP you move.
  const live = useRef({ tab, colour, onPick, onColour });
  live.current = { tab, colour, onPick, onColour };
  const barSwipe = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_e, g) => sideways(g.dx, g.dy, 12),
    onPanResponderRelease: (_e, g) => {
      const steps = Math.round(g.dx / STEP) || Math.sign(g.dx);
      const at = Math.max(0, PAGES.indexOf(live.current.tab));
      const to = PAGES[Math.min(PAGES.length - 1, Math.max(0, at + steps))];
      setOpen(false);
      if (to !== live.current.tab) live.current.onPick(to);
    }
  }), []);
  // Push the orb sideways: right goes towards green, left towards red. The orb leans with your finger.
  const lean = useRef(new Animated.Value(0)).current;
  const orbSwipe = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_e, g) => !!live.current.colour && sideways(g.dx, g.dy, 8),
    onPanResponderTerminationRequest: () => false,
    onPanResponderMove: (_e, g) => lean.setValue(Math.max(-30, Math.min(30, g.dx / 2))),
    onPanResponderRelease: (_e, g) => {
      Animated.spring(lean, { toValue: 0, useNativeDriver: true, friction: 5 }).start();
      const c = live.current.colour;
      if (!c || Math.abs(g.dx) < NUDGE) return;
      const to = ORDER[Math.min(2, Math.max(0, ORDER.indexOf(c) + (g.dx > 0 ? 1 : -1)))];
      setOpen(false);
      if (to !== c) live.current.onColour(to);
    },
    onPanResponderTerminate: () => { Animated.spring(lean, { toValue: 0, useNativeDriver: true }).start(); }
  }), [lean]);

  return (
    <View style={styles.wrap} pointerEvents="box-none">
      {/* The three lights fan out above the orb. */}
      {colour && shown ? (
        <View style={styles.fanRow} pointerEvents={open ? 'box-none' : 'none'}>
          {ORDER.map((c, i) => {
            const x = (i - 1) * 68, y = i === 1 ? -14 : 0;
            return (
              <Animated.View key={c} style={{ opacity: fan, transform: [{ translateX: fan.interpolate({ inputRange: [0, 1], outputRange: [0, x] }) }, { translateY: fan.interpolate({ inputRange: [0, 1], outputRange: [40, y] }) }, { scale: fan }] }}>
                <Pressable onPress={() => { setOpen(false); if (c !== colour) onColour(c); }} accessibilityRole="button" accessibilityLabel={'Go ' + LABELS[c].toLowerCase()} testID={'dock-' + c}
                  style={[styles.fanDot, { backgroundColor: COLOURS[c], shadowColor: COLOURS[c] }, c === colour && styles.fanOn]}>
                  <Text style={styles.fanText}>{LABELS[c]}</Text>
                </Pressable>
              </Animated.View>
            );
          })}
        </View>
      ) : null}
      <View style={[styles.nav, colour ? { borderColor: fade(glow, 0.55), shadowColor: glow } : null]} accessibilityRole="tablist" accessibilityLabel="Sections"
        {...barSwipe.panHandlers} testID="dock-bar">
        {TABS.map(([key, name]) => {
          if (key === 'orb') {
            return (
              <Animated.View key={key} {...orbSwipe.panHandlers} style={[styles.orbWrap, { transform: [{ translateX: lean }] }]}>
                <Pressable onPress={() => setOpen((o) => !o)} disabled={!colour} accessibilityRole="button" testID="dock-orb"
                  accessibilityLabel={colour ? 'Your status: ' + LABELS[colour] + '. Tap or swipe to change' : 'Your status'}
                  style={[styles.orb, { backgroundColor: glow, shadowColor: glow, borderColor: C.bg }]}>
                  <View style={styles.orbLights}>
                    {ORDER.map((c) => <View key={c} style={[styles.orbDot, c === colour ? styles.orbDotOn : null]} />)}
                  </View>
                </Pressable>
              </Animated.View>
            );
          }
          const here = key === tab;
          return (
            <Pressable key={key} style={styles.button} onPress={() => { setOpen(false); onPick(key); }}
              accessibilityRole="tab" accessibilityLabel={name} accessibilityState={{ selected: here }}>
              <DotIcon name={key} ink={here ? C.fg : C.muted} lit={here} light={colour ? glow : C.muted} />
              <Text style={[styles.label, here && { color: C.fg }]}>{name}</Text>
              {key === 'home' && requests > 0 ? (
                <View style={styles.badge}><Text style={styles.badgeText}>{requests}</Text></View>
              ) : null}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = themed(() => StyleSheet.create({
  wrap: { alignItems: 'center' },
  nav: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', width: '94%', maxWidth: 400, height: 68,
    marginTop: 14, marginBottom: 12, paddingHorizontal: 6, borderRadius: 34, borderWidth: 1.5, borderColor: C.line, backgroundColor: C.tabBg,
    shadowOpacity: C.dark ? 0.55 : 0.25, shadowRadius: 16, shadowOffset: { width: 0, height: 0 }, elevation: 4
  },
  button: { width: 62, height: 60, alignItems: 'center', justifyContent: 'center', gap: 2 },
  label: { fontFamily: F.bodyBold, fontSize: 11, color: C.muted },
  orbWrap: { marginTop: -30 },
  orb: {
    width: 70, height: 70, borderRadius: 35, borderWidth: 4, alignItems: 'center', justifyContent: 'center',
    shadowOpacity: C.dark ? 0.85 : 0.45, shadowRadius: 14, shadowOffset: { width: 0, height: 0 }, elevation: 8
  },
  orbLights: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  orbDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: 'rgba(11, 11, 13, 0.3)' },
  orbDotOn: { width: 12, height: 12, borderRadius: 6, backgroundColor: '#FFFFFF' },
  fanRow: { position: 'absolute', bottom: 118, left: 0, right: 0, height: 64, alignItems: 'center', justifyContent: 'center', zIndex: 5 },
  fanDot: {
    position: 'absolute', left: -32, top: 0, width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center',
    shadowOpacity: 0.8, shadowRadius: 12, shadowOffset: { width: 0, height: 0 }, elevation: 6, borderWidth: 3, borderColor: fade('#FFFFFF', 0.25)
  },
  fanOn: { borderColor: '#FFFFFF' },
  fanText: { fontFamily: F.bodyBold, fontSize: 12, color: '#0B0B0D' },
  badge: { position: 'absolute', top: 2, left: '50%', marginLeft: 6, minWidth: 18, height: 18, paddingHorizontal: 5, borderRadius: 9, backgroundColor: C.off, alignItems: 'center', justifyContent: 'center' },
  badgeText: { fontFamily: F.bodyBold, fontSize: 11, color: '#fff' }
}));
