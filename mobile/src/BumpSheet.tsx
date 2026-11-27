// Bump to add: two people open this, knock their phones together, and each sees the other's name with an Add
// button. If both tap Add they're friends straight away; no request, no notification. The server pairs the two
// bumps by timing alone (within 2 seconds). No location is sent.
import React, { useEffect, useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { rpc } from './session';
import { canFeelKnock, thud, watchKnock } from './extras';
import { Button } from './Parts';
import { C, F, fade, themed } from './theme';

type Match = { pair: string; id: string; name: string; username?: string | null; mine?: boolean | null; theirs?: boolean | null; friends?: boolean };
type Step = 'ready' | 'looking' | 'found' | 'waiting' | 'done' | 'busy' | 'none' | 'no';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export default function BumpSheet({ open, onClose, onFriends }: { open: boolean; onClose: () => void; onFriends: () => void }) {
  const [step, setStep] = useState<Step>('ready');
  const [match, setMatch] = useState<Match | null>(null);
  const [error, setError] = useState('');
  const live = useRef(0); // bumped each time the sheet opens or resets, so old loops stop

  const reset = () => { live.current++; setStep('ready'); setMatch(null); setError(''); };
  useEffect(() => { if (open) reset(); else live.current++; }, [open]);

  const bump = async () => {
    if (step !== 'ready' && step !== 'none' && step !== 'busy') return;
    const run = ++live.current;
    thud();
    setStep('looking'); setError('');
    try {
      let m: any = await rpc('bump');
      // The other phone may land a moment later, so look again for about 3 seconds.
      for (let i = 0; !m && i < 6 && live.current === run; i++) { await wait(500); m = await rpc('bump_check'); }
      if (live.current !== run) return;
      if (m && m.busy) { setStep('busy'); return; }
      if (!m || !m.pair) { setStep('none'); return; }
      thud();
      setMatch(m); setStep(m.friends ? 'done' : 'found');
    } catch (e: any) {
      if (live.current === run) { setError((e && e.message) || "Couldn't reach Crewzy. Try again."); setStep('ready'); }
    }
  };

  // Listen for a knock while the sheet is waiting for one.
  useEffect(() => {
    if (!open || !(step === 'ready' || step === 'none' || step === 'busy')) return;
    return watchKnock(() => { bump(); });
  }, [open, step]);

  const answer = async (add: boolean) => {
    if (!match) return;
    const run = live.current;
    try {
      let m: any = await rpc('bump_answer', { p_pair: match.pair, p_add: add });
      if (!add) { setStep('no'); return; }
      setStep('waiting');
      // Wait up to 20 seconds for them to tap Add too.
      for (let i = 0; m && !m.friends && m.theirs !== false && i < 20 && live.current === run; i++) {
        await wait(1000);
        m = await rpc('bump_status', { p_pair: match.pair });
      }
      if (live.current !== run) return;
      if (m && m.friends) { thud(); setStep('done'); onFriends(); }
      else setStep('no');
    } catch (e: any) {
      if (live.current === run) { setError((e && e.message) || "Couldn't reach Crewzy."); setStep('ready'); }
    }
  };

  const who = match ? match.name : '';
  const handle = match && match.username ? '@' + match.username : '';

  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={styles.shade} onPress={onClose} accessibilityLabel="Close" />
      <View style={styles.sheet}>
        <Text style={styles.h1} accessibilityRole="header">Bump to add</Text>
        {step === 'ready' || step === 'none' || step === 'busy' ? (
          <>
            <Text style={styles.body}>
              {canFeelKnock
                ? 'Both of you open this, then gently knock your phones together.'
                : 'Both of you open this and tap Bump at the same moment.'}
            </Text>
            {step === 'none' ? <Text style={styles.note}>No one bumped at the same time. Try again together.</Text> : null}
            {step === 'busy' ? <Text style={styles.note}>A few people bumped at once, so we couldn't tell who's who. Bump again.</Text> : null}
            {error ? <Text style={styles.note}>{error}</Text> : null}
            <Pressable onPress={bump} style={({ pressed }) => [styles.big, pressed && { transform: [{ scale: 0.96 }] }]}
              accessibilityRole="button" accessibilityLabel="Bump now" testID="bump-now">
              <Text style={styles.bigText}>Bump</Text>
            </Pressable>
            <Text style={styles.small}>Uses timing only. Your location isn't sent.</Text>
          </>
        ) : null}
        {step === 'looking' ? <Text style={styles.body}>Looking for the other phone…</Text> : null}
        {step === 'found' && match ? (
          <>
            <View style={styles.face}><Text style={styles.faceText}>{(who.trim()[0] || '?').toUpperCase()}</Text></View>
            <Text style={styles.name}>{who}</Text>
            {handle ? <Text style={styles.small}>{handle}</Text> : null}
            <Text style={styles.body}>Add {who} as a friend?</Text>
            <View style={styles.row}>
              <Button label="Add" onPress={() => answer(true)} testID="bump-add" />
              <Button label="No" ghost onPress={() => answer(false)} />
            </View>
          </>
        ) : null}
        {step === 'waiting' ? <Text style={styles.body}>Waiting for {who} to tap Add…</Text> : null}
        {step === 'done' ? (
          <>
            <Text style={styles.name}>You and {who} are friends 🎉</Text>
            <Button label="Done" onPress={onClose} />
          </>
        ) : null}
        {step === 'no' ? (
          <>
            <Text style={styles.body}>Not added this time.</Text>
            <View style={styles.row}>
              <Button label="Bump again" onPress={reset} />
              <Button label="Close" ghost onPress={onClose} />
            </View>
          </>
        ) : null}
      </View>
    </Modal>
  );
}

const styles = themed(() => StyleSheet.create({
  shade: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet: { backgroundColor: C.bg, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 40, gap: 14, alignItems: 'center', borderTopWidth: 1, borderColor: C.line },
  h1: { color: C.fg, fontFamily: F.logo, fontSize: 24 },
  body: { color: C.fg, fontFamily: F.body, fontSize: 16, textAlign: 'center' },
  note: { color: C.thinking, fontFamily: F.body, fontSize: 14, textAlign: 'center' },
  small: { color: C.muted, fontFamily: F.body, fontSize: 13, textAlign: 'center' },
  big: { width: 150, height: 150, borderRadius: 75, backgroundColor: fade(C.on, 0.18), borderWidth: 3, borderColor: C.on, alignItems: 'center', justifyContent: 'center', shadowColor: C.on, shadowOpacity: 0.8, shadowRadius: 18, elevation: 8, marginVertical: 8 },
  bigText: { color: C.fg, fontFamily: F.logo, fontSize: 26 },
  face: { width: 84, height: 84, borderRadius: 42, backgroundColor: fade(C.accent, 0.25), borderWidth: 2, borderColor: C.accent, alignItems: 'center', justifyContent: 'center' },
  faceText: { color: C.fg, fontFamily: F.logo, fontSize: 34 },
  name: { color: C.fg, fontFamily: F.bodyBold, fontSize: 20, textAlign: 'center' },
  row: { flexDirection: 'row', gap: 12 }
}));
