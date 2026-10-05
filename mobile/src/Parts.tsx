// Pieces more than one native screen uses: the header with the logo and you, the status glow, faces,
// buttons and the toast. Same look as the web app's topBar(), avatar() and .btn in docs/.
import { LinearGradient } from 'expo-linear-gradient';
import React from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Defs, LinearGradient as SvgGradient, Rect, Stop } from 'react-native-svg';
import type { Colour } from './api';
import Icon from './Icon';
import Logo from './Logo';
import type { Frendzy } from './useFrendzy';
import { C, COLOURS, F, fade, hue, initials } from './theme';

// The top of the screen glows in your status colour, so you can tell at a glance where you are. It reaches up behind
// the status bar. Drawn as an SVG with many small steps rather than a three-colour gradient, because that gradient
// showed up on a real Android phone as a hard-edged band.
const GLOW_HEIGHT = 320;
const GLOW_STOPS = [0, 0.1, 0.2, 0.32, 0.46, 0.62, 0.8, 1].map((at) => ({ at, alpha: 0.5 * Math.pow(1 - at, 2.2) }));
export function Glow({ colour }: { colour: Colour }) {
  const inset = useSafeAreaInsets().top;
  const rgb = COLOURS[colour];
  return (
    <View pointerEvents="none" style={[styles.glow, { top: -inset, height: GLOW_HEIGHT + inset }]}>
      <Svg width="100%" height="100%">
        <Defs>
          <SvgGradient id="glow" x1="0" y1="0" x2="0" y2="1">
            {GLOW_STOPS.map((g) => <Stop key={g.at} offset={g.at} stopColor={rgb} stopOpacity={g.alpha} />)}
          </SvgGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#glow)" />
      </Svg>
    </View>
  );
}

// The header above every tab: the logo with the status switch on the left, you on the right.
export function TopBar({ f, onOpenWeb }: { f: Frendzy; onOpenWeb: (tab: string) => void }) {
  const me = f.state && f.state.me;
  if (!me) return null;
  return (
    <View style={styles.top}>
      <Logo status={me.colour} onPick={(c) => { if (c !== me.colour) f.setColour(c); }} />
      <View style={styles.topRight}>
        {f.offline ? <Text style={styles.pill}>Offline</Text> : null}
        <Pressable onPress={() => onOpenWeb('you')} accessibilityRole="button" accessibilityLabel="You" style={[styles.profile, { borderColor: COLOURS[me.colour] }]}>
          <Face id={me.id} name={me.name} photos={f.photos} size={40} font={13} />
        </Pressable>
      </View>
    </View>
  );
}

// Someone's photo if they added one and you're allowed to see it, otherwise their initials on a colour of their own.
export function Face({ id, name, photos, size, font, away }: { id: string; name: string; photos: Record<string, string>; size: number; font: number; away?: boolean }) {
  const pic = photos[id];
  const h = hue(name);
  return (
    <View style={[styles.face, { width: size, height: size, borderRadius: size / 2, opacity: away ? 0.45 : 1, borderColor: away ? C.line : 'rgba(255, 255, 255, 0.85)' }]}>
      {pic
        ? <Image source={{ uri: pic }} style={{ width: size, height: size, borderRadius: size / 2 }} />
        : (
          <LinearGradient
            colors={[`hsl(${h}, 70%, 58%)`, `hsl(${(h + 40) % 360}, 65%, 38%)`]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={[styles.faceFill, { borderRadius: size / 2 }]}
          >
            <Text style={[styles.faceInitials, { fontSize: font }]}>{initials(name)}</Text>
          </LinearGradient>
        )}
    </View>
  );
}

// The web app's .avatar: a face in a ring of a colour (status colour, or green for people in the sesh).
export function Avatar({ id, name, photos, ring, size, font }: { id?: string; name: string; photos: Record<string, string>; ring?: string; size?: number; font?: number }) {
  const s = size || 40;
  const pic = id ? photos[id] : undefined;
  return (
    <View style={[styles.avatar, { width: s, height: s, borderRadius: s / 2, borderColor: ring || C.line }]}>
      {pic ? <Image source={{ uri: pic }} style={{ width: s - 4, height: s - 4, borderRadius: (s - 4) / 2 }} />
        : <Text style={[styles.avatarText, { fontSize: font || (s < 40 ? 12 : 13) }]}>{initials(name)}</Text>}
    </View>
  );
}

export function Button({ label, onPress, small, ghost, colour, ink, disabled, icon, pressed, testID }: {
  label: string; onPress: () => void; small?: boolean; ghost?: boolean; colour?: string; ink?: boolean;
  disabled?: boolean; icon?: string; pressed?: boolean; testID?: string;
}) {
  const textStyle = [styles.btnText, small && styles.btnTextSmall, ghost && styles.btnTextGhost, ink ? { color: C.ink } : null, disabled && styles.btnTextOff];
  const iconColour = disabled ? C.muted : ghost ? C.fg : ink ? C.ink : C.accentInk;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled, ...(pressed === undefined ? {} : { selected: pressed }) }}
      disabled={disabled}
      onPress={onPress}
      testID={testID}
      style={[styles.btn, small && styles.btnSmall, ghost && styles.btnGhost, colour ? { backgroundColor: colour } : null, disabled && styles.btnOff]}
    >
      <View style={styles.btnRow}>
        {icon ? <Icon name={icon} size={small ? 14 : 16} colour={iconColour} /> : null}
        <Text style={textStyle}>{label}</Text>
      </View>
    </Pressable>
  );
}

export function Toast({ text }: { text: string | null }) {
  if (!text) return null;
  return <View style={styles.toast} pointerEvents="none"><Text style={styles.toastText}>{text}</Text></View>;
}

const styles = StyleSheet.create({
  glow: { position: 'absolute', left: 0, right: 0 },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, paddingHorizontal: 18, paddingTop: 12, paddingBottom: 10, maxWidth: 440, width: '100%', alignSelf: 'center' },
  topRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  pill: { fontFamily: F.bodyBold, fontSize: 12, letterSpacing: 0.8, textTransform: 'uppercase', paddingVertical: 5, paddingHorizontal: 10, borderRadius: 999, borderWidth: 1, borderColor: C.off, color: C.off },
  profile: { width: 44, height: 44, borderRadius: 22, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },

  face: { borderWidth: 2, overflow: 'hidden' },
  faceFill: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  faceInitials: { fontFamily: F.display, color: '#fff' },
  avatar: { borderWidth: 2, backgroundColor: C.surface2, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  avatarText: { fontFamily: F.bodyBold, color: C.fg },

  btn: { minHeight: 54, paddingHorizontal: 20, borderRadius: 27, backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center' },
  btnRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  btnSmall: { minHeight: 44, paddingHorizontal: 18, borderRadius: 22 },
  btnGhost: { backgroundColor: C.surface, borderWidth: 1, borderColor: C.line },
  btnOff: { backgroundColor: C.surface2, borderWidth: 0 },
  btnText: { fontFamily: F.bodyBold, fontSize: 16, color: C.accentInk },
  btnTextSmall: { fontSize: 14 },
  btnTextGhost: { color: C.fg },
  btnTextOff: { color: C.muted },

  toast: { position: 'absolute', left: 16, right: 16, bottom: 16, alignItems: 'center' },
  toastText: { fontFamily: F.bodyBold, fontSize: 14, color: C.ink, backgroundColor: C.fg, paddingVertical: 12, paddingHorizontal: 18, borderRadius: 24, textAlign: 'center', overflow: 'hidden' }
});
