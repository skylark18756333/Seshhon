// "Check your email": after the password, a login on an account with email codes waits here for the code. The words
// and steps are those of twoStepScreen() and the two-step form in docs/app.js.
import React, { useEffect, useRef, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { Button } from './Parts';
import Icon from './Icon';
import { Field, Page, styles } from './Forms';
import { currentSession, emailCode, forgetPhone, refreshSession, rememberPhone, rpc } from './session';
import { C } from './theme';

export default function TwoStep({ onDone, onRecover, onCancel }: { onDone: () => void; onRecover: () => void; onCancel: () => void }) {
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [code, setCode] = useState('');
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  const send = () => {
    setNote('Sending a code...'); setError('');
    emailCode('login').then((r) => {
      if (alive.current) setNote('We sent a 6-digit code to ' + r.hint + '. It works for 10 minutes.');
    }, (x: Error) => {
      if (alive.current) { setNote(''); setError(x.message); }
    });
  };
  useEffect(send, []);

  const submit = async () => {
    const digits = code.replace(/\D/g, '');
    if (digits.length !== 6) { setError('Enter the 6-digit code from the email.'); return; }
    setBusy(true); setError('');
    try {
      const r = await rpc('two_step_check', { p_code: digits });
      if (!r || !r.ok) { setError((r && r.message) || "That didn't work. Try again."); setBusy(false); return; }
      // A fresh sign-in token, now with full access.
      await refreshSession();
      if (remember) await rememberPhone();
      else { const s = currentSession(); if (s && s.user_id) forgetPhone(s.user_id); }
      onDone();
    } catch (x) {
      if (alive.current) { setError((x as Error).message); setBusy(false); }
    }
  };

  return (
    <Page>
      <Text style={styles.h1}>Check your email</Text>
      {note ? <Text style={styles.muted}>{note}</Text> : null}
      <View style={styles.stack16}>
        <Field label="Code from the email">
          <TextInput style={styles.input} value={code} onChangeText={setCode} onSubmitEditing={submit} keyboardType="number-pad"
            autoComplete="one-time-code" textContentType="oneTimeCode" maxLength={7} autoCorrect={false} accessibilityLabel="Code from the email" />
        </Field>
        <Pressable style={styles.check} onPress={() => setRemember((x) => !x)} accessibilityRole="checkbox" accessibilityState={{ checked: remember }}
          accessibilityLabel="Remember this phone for 30 days">
          <View style={[styles.box, remember && styles.boxOn]}>{remember ? <Icon name="tick" size={16} colour={C.accentInk} /> : null}</View>
          <Text style={styles.body}>Remember this phone for 30 days</Text>
        </Pressable>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Button label="Log in" disabled={busy} onPress={submit} />
      </View>
      <View style={styles.stack12}>
        <Button ghost label="Send a new code" onPress={send} />
        <Button ghost label="Can't get the email? Use your recovery code" onPress={onRecover} />
        <Button ghost label="Cancel" onPress={onCancel} />
      </View>
    </Page>
  );
}
