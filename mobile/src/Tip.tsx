// First-use tips on the screen (the words and the "seen" list are in tips.ts).
//
//   <Tip id="lobby-now" onPress={start} style={styles.tileWrap}>
//     {(press) => <Pressable onPress={press}>...</Pressable>}
//   </Tip>
// The first time the button is tapped, the screen dims, the button lights up and a tip says what it does. Its
// button (or the lit-up button itself) carries on with what was tapped; tapping anywhere else just closes it.
// From then on the button works straight away. `style` is put on the wrapper, so pass the button's own layout
// (width, flex) there if it sits in a row or grid.
//
//   <TipSpot id="home-switch">...</TipSpot>
// Shows its tip by itself the first time that part of the screen is seen, without waiting for a tap. For
// things you drag or that explain a whole card.
//
// <TipHost /> sits once over everything in App.tsx and draws whichever tip is on show.
import React, { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { useShown } from './Shown';
import { TIPS, close, currentTip, dropTip, onTips, showTip, tipSeen, turnOffTips, type Rect } from './tips';
import { C, F, fade, themed } from './theme';

type Measurable = { measureInWindow: (cb: (x: number, y: number, w: number, h: number) => void) => void };

function measure(node: Measurable | null, done: (r: Rect | null) => void) {
  if (!node || typeof node.measureInWindow !== 'function') { done(null); return; }
  try {
    node.measureInWindow((x, y, w, h) => done(w > 0 && h > 0 ? { x, y, w, h } : null));
  } catch (e) { done(null); }
}

// For a button that can't take the <Tip> wrapper: put ref on a View round it (collapsable={false}), and pass the
// press handler through press(...).
export function useTip(id: string) {
  const ref = useRef<View>(null);
  const press = (action: () => void) => () => {
    if (tipSeen(id)) { action(); return; }
    measure(ref.current as unknown as Measurable, (rect) => {
      if (!rect) { action(); return; }
      showTip({ id, rect, go: action });
    });
  };
  return { ref, press };
}

export function Tip({ id, onPress, style, children }: { id: string; onPress: () => void; style?: StyleProp<ViewStyle>; children: (press: () => void) => React.ReactNode }) {
  const t = useTip(id);
  return <View ref={t.ref} collapsable={false} style={style}>{children(t.press(onPress))}</View>;
}

// when: false holds the tip back (say, until the card it explains is there).
export function TipSpot({ id, when = true, delay = 900, style, children }: { id: string; when?: boolean; delay?: number; style?: StyleProp<ViewStyle>; children: React.ReactNode }) {
  const ref = useRef<View>(null);
  const shown = useShown();
  useEffect(() => {
    if (!shown || !when || tipSeen(id)) return;
    const timer = setTimeout(() => {
      measure(ref.current as unknown as Measurable, (rect) => { if (rect) showTip({ id, rect }); });
    }, delay);
    return () => { clearTimeout(timer); dropTip(id); };
  }, [id, shown, when, delay]);
  return <View ref={ref} collapsable={false} style={style}>{children}</View>;
}

const PAD = 6;       // the lit-up ring sits this far outside the button
const GAP = 14;      // between the ring and the tip
const SIDE = 16;

export function TipHost() {
  const [, redraw] = useState(0);
  useEffect(() => onTips(() => redraw((n) => n + 1)), []);
  const host = useRef<View>(null);
  const [box, setBox] = useState({ x: 0, y: 0, w: 0, h: 0 });
  const fadeIn = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(0)).current;
  const tip = currentTip();
  const copy = tip ? TIPS[tip.id] : null;

  useEffect(() => {
    if (!tip) return;
    fadeIn.setValue(0);
    Animated.timing(fadeIn, { toValue: 1, duration: 220, useNativeDriver: true }).start();
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 900, useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 0, duration: 900, useNativeDriver: true })
    ]));
    loop.start();
    return () => loop.stop();
  }, [tip ? tip.id : null]);

  const onLayout = () => measure(host.current as unknown as Measurable, (r) => { if (r) setBox(r); });

  if (!tip || !copy || !box.w) {
    return <View ref={host} collapsable={false} style={StyleSheet.absoluteFill} pointerEvents="none" onLayout={onLayout} />;
  }
  // The ring, in the host's own coordinates, kept on screen.
  const W = box.w, H = box.h;
  const x = Math.max(4, tip.rect.x - box.x - PAD), y = Math.max(4, tip.rect.y - box.y - PAD);
  const w = Math.min(W - 4 - x, tip.rect.w + PAD * 2), h = Math.min(H - 4 - y, tip.rect.h + PAD * 2);
  const radius = Math.min(26, h / 2);
  const below = y + h / 2 < H * 0.55;
  const bw = Math.min(W - SIDE * 2, 380), left = (W - bw) / 2;
  const arrowX = Math.max(22, Math.min(bw - 22, x + w / 2 - left));
  const go = !!tip.go;
  const dim = C.dark ? 'rgba(3, 3, 6, 0.76)' : 'rgba(17, 17, 20, 0.52)';

  return (
    <View ref={host} collapsable={false} style={StyleSheet.absoluteFill} onLayout={onLayout}>
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: fadeIn }]}>
        {/* the dim, in four pieces round the button so the button itself stays bright */}
        <Pressable style={[styles.dim, { left: 0, top: 0, right: 0, height: y, backgroundColor: dim }]} onPress={() => close(false)} accessibilityLabel="Close the tip" />
        <Pressable style={[styles.dim, { left: 0, top: y + h, right: 0, bottom: 0, backgroundColor: dim }]} onPress={() => close(false)} accessible={false} />
        <Pressable style={[styles.dim, { left: 0, top: y, width: x, height: h, backgroundColor: dim }]} onPress={() => close(false)} accessible={false} />
        <Pressable style={[styles.dim, { left: x + w, top: y, right: 0, height: h, backgroundColor: dim }]} onPress={() => close(false)} accessible={false} />
        {/* the lit-up button: tapping it carries on */}
        <Pressable style={{ position: 'absolute', left: x, top: y, width: w, height: h, borderRadius: radius }} onPress={() => close(go)}
          accessibilityRole="button" accessibilityLabel={copy.go || 'Got it'} />
        <Animated.View pointerEvents="none" style={[styles.ring, {
          left: x, top: y, width: w, height: h, borderRadius: radius,
          opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 0.55] }),
          transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.04] }) }]
        }]} />

        <View style={[styles.bubble, { left, width: bw }, below ? { top: y + h + GAP } : { bottom: H - y + GAP }]}
          accessibilityViewIsModal accessibilityLiveRegion="polite">
          <View style={[styles.arrow, { left: arrowX - 8 }, below ? { top: -9 } : { bottom: -9 }]} />
          <View style={styles.cover} />
          <View style={styles.inner}>
            <View style={styles.head}>
              <View style={styles.spark} />
              <Text style={styles.eyebrow}>Tip</Text>
              <View style={styles.grow} />
              <Pressable onPress={turnOffTips} hitSlop={10} accessibilityRole="button"><Text style={styles.offText}>Turn off tips</Text></Pressable>
            </View>
            <Text style={styles.title} accessibilityRole="header">{copy.title}</Text>
            <Text style={styles.body}>{copy.body}</Text>
            <View style={styles.row}>
              {go ? (
                <Pressable style={[styles.btn, styles.ghost]} onPress={() => close(false)} accessibilityRole="button">
                  <Text style={[styles.btnText, { color: C.fg }]}>Not now</Text>
                </Pressable>
              ) : null}
              <Pressable style={styles.btn} onPress={() => close(go)} accessibilityRole="button" testID="tip-go">
                <Text style={styles.btnText}>{go ? copy.go || 'Got it' : 'Got it'}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Animated.View>
    </View>
  );
}

const styles = themed(() => StyleSheet.create({
  dim: { position: 'absolute' },
  ring: { position: 'absolute', borderWidth: 2.5, borderColor: C.accent, shadowColor: C.accent, shadowOpacity: C.dark ? 0.9 : 0.35, shadowRadius: 14, shadowOffset: { width: 0, height: 0 } },
  bubble: {
    position: 'absolute', borderRadius: 24, backgroundColor: C.bg, borderWidth: 1, borderColor: fade(C.accent, C.dark ? 0.45 : 0.18),
    shadowColor: C.dark ? C.accent : '#000', shadowOpacity: C.dark ? 0.35 : 0.18, shadowRadius: 22, shadowOffset: { width: 0, height: 6 }, elevation: 12
  },
  inner: { borderRadius: 23, backgroundColor: C.dark ? C.surface : '#FFFFFF', paddingTop: 14, paddingHorizontal: 18, paddingBottom: 16, gap: 8 },
  // The pointer is a turned square half under the bubble; `cover` hides the half inside it.
  arrow: { position: 'absolute', width: 16, height: 16, transform: [{ rotate: '45deg' }], backgroundColor: C.dark ? C.bg : '#FFFFFF', borderColor: fade(C.accent, C.dark ? 0.45 : 0.18), borderWidth: 1 },
  cover: { ...StyleSheet.absoluteFillObject, borderRadius: 23, backgroundColor: C.dark ? C.bg : '#FFFFFF' },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  spark: { width: 8, height: 8, borderRadius: 4, backgroundColor: C.on, shadowColor: C.on, shadowOpacity: 0.9, shadowRadius: 6, shadowOffset: { width: 0, height: 0 } },
  eyebrow: { fontFamily: F.bodyBold, fontSize: 12, letterSpacing: 1.4, textTransform: 'uppercase', color: C.muted },
  grow: { flex: 1 },
  offText: { fontFamily: F.body, fontSize: 13, color: C.muted, textDecorationLine: 'underline' },
  title: { fontFamily: F.display, fontSize: 22, lineHeight: 26, letterSpacing: -0.4, color: C.fg },
  body: { fontFamily: F.body, fontSize: 15, lineHeight: 21, color: C.muted },
  row: { flexDirection: 'row', gap: 10, marginTop: 6 },
  btn: { flex: 1, minHeight: 48, borderRadius: 24, backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  ghost: { backgroundColor: 'transparent', borderWidth: 1, borderColor: C.line },
  btnText: { fontFamily: F.bodyBold, fontSize: 15, color: C.accentInk }
}));
