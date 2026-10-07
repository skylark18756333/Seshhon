// The form pieces the native sign-up, login, login code and age check screens share: the page layout with the
// logo, a labelled box, the password box with its eye button, and the text styles. Same look as the You page.
import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import Icon from './Icon';
import Logo from './Logo';
import { C, F } from './theme';

// One of the full-screen steps: the logo, then the content, centred when it is short and scrolling when it is long.
export function Page({ children }: { children: React.ReactNode }) {
  return (
    <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <Logo />
        {children}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

export function Field({ label, note, children }: { label: string; note?: string; children: React.ReactNode }) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      {children}
      {note ? <Text style={[styles.muted, styles.small]}>{note}</Text> : null}
    </View>
  );
}

// A password box with an eye button that shows what was typed, so typos are easy to spot.
export function Password({ value, onChange, label, current, onSubmit }: { value: string; onChange: (t: string) => void; label: string; current?: boolean; onSubmit?: () => void }) {
  const [shown, setShown] = useState(false);
  return (
    <View>
      <TextInput style={[styles.input, { paddingRight: 56 }]} value={value} onChangeText={onChange} onSubmitEditing={onSubmit} secureTextEntry={!shown}
        autoComplete={current ? 'current-password' : 'new-password'} autoCapitalize="none" autoCorrect={false} maxLength={72} accessibilityLabel={label} />
      <Pressable style={styles.peek} onPress={() => setShown((x) => !x)} accessibilityRole="button"
        accessibilityLabel={shown ? 'Hide password' : 'Show password'} accessibilityState={{ selected: shown }}>
        <Icon name="eye" size={20} colour={shown ? C.fg : C.muted} />
      </Pressable>
    </View>
  );
}

export const styles = StyleSheet.create({
  fill: { flex: 1 },
  page: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 18, paddingVertical: 24, gap: 24, maxWidth: 440, width: '100%', alignSelf: 'center' },
  stack12: { gap: 12 },
  stack16: { gap: 16 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  h1: { fontFamily: F.display, fontSize: 28, lineHeight: 31, letterSpacing: -0.5, color: C.fg },
  h2: { fontFamily: F.displayBold, fontSize: 19, letterSpacing: -0.2, color: C.fg },
  body: { fontFamily: F.body, fontSize: 16, color: C.fg },
  strong: { fontFamily: F.bodyBold },
  muted: { fontFamily: F.body, fontSize: 16, lineHeight: 22, color: C.muted },
  small: { fontSize: 14, lineHeight: 20 },
  link: { textDecorationLine: 'underline' },
  error: { fontFamily: F.bodyMid, fontSize: 14, color: C.off },
  linkbox: { fontFamily: F.body, fontSize: 14, paddingVertical: 12, paddingHorizontal: 14, borderRadius: 12, backgroundColor: C.bg, borderWidth: 1, borderColor: C.line, color: C.fg, overflow: 'hidden' },
  code: { fontSize: 20, fontFamily: F.bodyBold, letterSpacing: 1, textAlign: 'center' },
  field: { gap: 8 },
  label: { fontFamily: F.bodyMid, fontSize: 16, color: C.fg },
  input: { height: 52, borderRadius: 14, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface, paddingHorizontal: 16, color: C.fg, fontFamily: F.body, fontSize: 16 },
  peek: { position: 'absolute', right: 4, top: 4, width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  check: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44 },
  box: { width: 24, height: 24, borderRadius: 7, borderWidth: 2, borderColor: C.muted, alignItems: 'center', justifyContent: 'center' },
  boxOn: { backgroundColor: C.on, borderColor: C.on }
});
