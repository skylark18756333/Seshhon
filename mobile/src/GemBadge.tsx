// Collectible gem badges for the profile (Sarah picked the "Gem" style, 2026-11-02).
// Each badge is a faceted hexagon in its own colour with a solid picture. Earned gems are full colour with a
// glow and a twinkle. Locked ones show their colour faintly, with a dashed outline, a lock, and a ring that fills
// up as you get closer. Pictures are about meeting up with friends only: nothing about drinks or venues.
import React, { useEffect, useRef } from 'react';
import { Animated, Easing, View } from 'react-native';
import Svg, { Circle, Defs, G, LinearGradient, Path, Rect, Stop } from 'react-native-svg';
import { C } from './theme';

const GEM = 'M0-30 L26-15 V15 L0 30 L-26 15 V-15 Z';
const INNER = 'M0-23 L20-11.5 V11.5 L0 23 L-20 11.5 V-11.5 Z';

// Solid pictures, drawn round 0,0 in a 24-unit box. `cut` is the colour used for lines cut into the picture.
function Glyph({ kind, fill, cut }: { kind: string; fill: string; cut: string }) {
  const line = { stroke: cut, strokeWidth: 2.6, fill: 'none', strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  switch (kind) {
    case 'first_round':   // two friends meeting
      return (
        <G fill={fill}>
          <Circle cx={-4} cy={-4} r={3.6} /><Circle cx={4} cy={-4} r={3.6} />
          <Path d="M-11 9c0-5 3-8 7-8 2 0 3 .6 4 1.5C1 1.6 2 1 4 1c4 0 7 3 7 8z" />
        </G>
      );
    case 'regular':       // a clock
      return <G><Circle r={10} fill={fill} /><Path d="M0 -6v6.5l4.5 3" {...line} /></G>;
    case 'ringleader':    // a crown
      return <G fill={fill}><Path d="M-10 6l-1.5-12 6 5L0-9l5.5 8 6-5L10 6z" /><Rect x={-10} y={7.5} width={20} height={3.5} rx={1.5} /></G>;
    case 'planner':       // a calendar with a tick
      return (
        <G>
          <G fill={fill}><Rect x={-10} y={-8} width={20} height={18} rx={4} /><Rect x={-6} y={-11} width={3} height={6} rx={1.5} /><Rect x={3} y={-11} width={3} height={6} rx={1.5} /></G>
          <Path d="M-5 3l3.5 3.5L6-1" {...line} />
        </G>
      );
    default:              // social: a group of friends
      return (
        <G fill={fill}>
          <Circle cx={0} cy={-5} r={4} /><Circle cx={-8} cy={-2} r={3} /><Circle cx={8} cy={-2} r={3} />
          <Path d="M-7 10c0-5 3-7.5 7-7.5S7 5 7 10z" />
          <Path d="M-13 9c0-3.5 2-5.5 5-5.5 1 0 1.8.2 2.4.6-1.6 1.4-2.4 3.2-2.4 4.9z" />
          <Path d="M13 9c0-3.5-2-5.5-5-5.5-1 0-1.8.2-2.4.6 1.6 1.4 2.4 3.2 2.4 4.9z" />
        </G>
      );
  }
}

function Twinkle({ size, delay }: { size: number; delay: number }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.delay(delay),
      Animated.timing(v, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      Animated.timing(v, { toValue: 0, duration: 900, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      Animated.delay(1400)
    ]));
    loop.start();
    return () => loop.stop();
  }, [v, delay]);
  const s = size * 0.2;
  return (
    <Animated.View pointerEvents="none" style={{ position: 'absolute', right: size * 0.06, top: size * 0.02, width: s, height: s,
      opacity: v.interpolate({ inputRange: [0, 1], outputRange: [0.25, 1] }), transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1.15] }) }, { rotate: '15deg' }] }}>
      <Svg width={s} height={s} viewBox="-6 -6 12 12"><Path d="M0-6 l1.6 4.4 4.4 1.6-4.4 1.6L0 6l-1.6-4.4L-6 0l4.4-1.6z" fill="#fff" /></Svg>
    </Animated.View>
  );
}

export default function GemBadge({ kind, c1, c2, lit, have, need, size = 56, delay = 0 }: {
  kind: string; c1: string; c2: string; lit: boolean; have?: number; need: number; size?: number; delay?: number;
}) {
  const id = 'gem-' + kind + (lit ? '-on' : '-off');
  const frac = Math.max(0, Math.min(1, (have || 0) / need));
  const R = 34, round = 2 * Math.PI * R;
  return (
    <View style={{ width: size, height: size * 76 / 74, shadowColor: c1, shadowOpacity: lit ? 0.8 : 0, shadowRadius: 10, shadowOffset: { width: 0, height: 0 } }}>
      <Svg width={size} height={size * 76 / 74} viewBox="-37 -36 74 76">
        <Defs>
          <LinearGradient id={id} x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={c1} /><Stop offset="1" stopColor={c2} />
          </LinearGradient>
        </Defs>
        {!lit ? (
          <G>
            <Circle r={R} fill="none" stroke={C.line} strokeWidth={3} />
            {frac > 0 ? <Circle r={R} fill="none" stroke={c1} strokeWidth={3} strokeLinecap="round" strokeDasharray={`${round * frac} ${round}`} transform="rotate(-90)" /> : null}
          </G>
        ) : null}
        <Path d={GEM} fill={lit ? `url(#${id})` : c1} opacity={lit ? 1 : 0.3} />
        {lit ? (
          <G>
            <Path d={INNER} fill={c2} opacity={0.35} />
            <Path d="M0-23 L20-11.5 L0 0Z" fill="#fff" opacity={0.22} />
            <Path d="M-20 11.5 L0 0 L0 23Z" fill="#000" opacity={0.12} />
          </G>
        ) : (
          <Path d={INNER} fill={C.surface} opacity={0.75} stroke={c1} strokeWidth={1.5} strokeDasharray="3 3" />
        )}
        <G transform="scale(1.4)"><Glyph kind={kind} fill={lit ? '#fff' : c2} cut={lit ? c2 : C.surface} /></G>
        {!lit ? (
          <G transform="translate(19,22)">
            <Circle r={7.5} fill={C.surface} stroke={C.line} strokeWidth={1.5} />
            <Rect x={-3.6} y={-1} width={7.2} height={5.5} rx={1.2} fill={C.muted} />
            <Path d="M-2.2-1v-2a2.2 2.2 0 0 1 4.4 0v2" stroke={C.muted} strokeWidth={1.5} fill="none" />
          </G>
        ) : null}
      </Svg>
      {lit ? <Twinkle size={size} delay={delay} /> : null}
    </View>
  );
}
