// Small building blocks shared by every screen.
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { C } from './theme';

type ButtonProps = {
  label: string;
  onPress: () => void;
  color?: string;
  ghost?: boolean;
  small?: boolean;
  disabled?: boolean;
  testID?: string;
};

export function Button({ label, onPress, color = C.on, ghost, small, disabled, testID }: ButtonProps) {
  const box = [
    s.btn,
    small ? s.btnSmall : null,
    { backgroundColor: disabled ? C.surface2 : ghost ? 'transparent' : color },
    ghost && !disabled ? s.btnGhost : null,
  ];
  const text = [s.btnText, small ? s.btnTextSmall : null, { color: disabled ? C.muted : ghost ? C.fg : C.ink }];
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ disabled: !!disabled }} disabled={disabled} onPress={onPress} style={box} testID={testID}>
      <Text style={text}>{label}</Text>
    </Pressable>
  );
}

export function Chip({ label, selected, onPress, testID }: { label: string; selected: boolean; onPress: () => void; testID?: string }) {
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ selected }} onPress={onPress} style={[s.chip, selected ? s.chipOn : null]} testID={testID}>
      <Text style={[s.chipText, selected ? s.chipTextOn : null]}>{label}</Text>
    </Pressable>
  );
}

export function Card({ children, border, thick }: { children: React.ReactNode; border?: string; thick?: boolean }) {
  return <View style={[s.card, border ? { borderColor: border } : null, thick ? { borderWidth: 2 } : null]}>{children}</View>;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  const first = (parts[0] || '?').charAt(0);
  const second = parts.length > 1 ? parts[1].charAt(0) : '';
  return (first + second).toUpperCase();
}

export function Avatar({ name, color, dashed, size = 40 }: { name: string; color: string; dashed?: boolean; size?: number }) {
  return (
    <View style={[s.avatar, { width: size, height: size, borderRadius: size / 2, borderColor: color, borderStyle: dashed ? 'dashed' : 'solid' }]}>
      <Text style={[s.avatarText, { fontSize: size > 44 ? 18 : 13 }]}>{initials(name)}</Text>
    </View>
  );
}

export function Row({ children, between, gap = 12 }: { children: React.ReactNode; between?: boolean; gap?: number }) {
  return <View style={[s.row, { gap }, between ? { justifyContent: 'space-between' } : null]}>{children}</View>;
}

export const H1 = ({ children }: { children: React.ReactNode }) => <Text accessibilityRole="header" style={s.h1}>{children}</Text>;
export const H2 = ({ children }: { children: React.ReactNode }) => <Text accessibilityRole="header" style={s.h2}>{children}</Text>;
export const Eyebrow = ({ children, color }: { children: React.ReactNode; color?: string }) => <Text style={[s.eyebrow, color ? { color } : null]}>{children}</Text>;
export const Muted = ({ children }: { children: React.ReactNode }) => <Text style={s.muted}>{children}</Text>;
export const Body = ({ children }: { children: React.ReactNode }) => <Text style={s.body}>{children}</Text>;

export const s = StyleSheet.create({
  btn: { minHeight: 54, paddingHorizontal: 20, borderRadius: 27, alignItems: 'center', justifyContent: 'center' },
  btnSmall: { minHeight: 44, paddingHorizontal: 18, borderRadius: 22 },
  btnGhost: { borderWidth: 1, borderColor: C.fg },
  btnText: { fontSize: 16, fontWeight: '700' },
  btnTextSmall: { fontSize: 14 },
  chip: { minHeight: 44, paddingHorizontal: 16, borderRadius: 22, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface, alignItems: 'center', justifyContent: 'center' },
  chipOn: { backgroundColor: C.fg, borderColor: C.fg },
  chipText: { fontSize: 14, fontWeight: '500', color: C.fg },
  chipTextOn: { color: C.ink, fontWeight: '700' },
  card: { backgroundColor: C.surface, borderWidth: 1, borderColor: C.line, borderRadius: 16, paddingVertical: 14, paddingHorizontal: 16, gap: 10 },
  avatar: { borderWidth: 2, backgroundColor: C.surface, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: C.fg, fontWeight: '700' },
  row: { flexDirection: 'row', alignItems: 'center' },
  h1: { color: C.fg, fontSize: 34, lineHeight: 38, fontWeight: '800', letterSpacing: -1 },
  h2: { color: C.fg, fontSize: 20, fontWeight: '700' },
  eyebrow: { color: C.muted, fontSize: 13, fontWeight: '700', letterSpacing: 1.2, textTransform: 'uppercase' },
  muted: { color: C.muted, fontSize: 14, lineHeight: 20 },
  body: { color: C.fg, fontSize: 16, lineHeight: 22 },
  dealTitle: { color: C.thinking, fontSize: 17, fontWeight: '700' },
  grow: { flex: 1, minWidth: 0 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  stack: { gap: 10 },
});
