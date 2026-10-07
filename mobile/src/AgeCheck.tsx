// "Quick age check": the third-party 18+ check, in the same words as ageCheck() and finishAgeCheck() in docs/app.js.
// The provider's own page opens in a window (AgeWeb) and sends the person back here, then the database is asked how
// it went. Used straight after sign-up (before the account is made) and for an account that still needs the check.
import Constants from 'expo-constants';
import React, { useEffect, useRef, useState } from 'react';
import { Linking, Text, View } from 'react-native';
import AgeWeb from './AgeWeb';
import { loadAge, type Age } from './api';
import { Button } from './Parts';
import { Page, styles } from './Forms';
import { ageCheckCall, type ApiError } from './session';

const WEB_URL: string = (Constants.expoConfig?.extra?.webUrl as string) || 'https://frendzy.au/';
const PROVIDER_NAMES: Record<string, string> = { yoti: 'Yoti', didit: 'Didit' };

export default function AgeCheck({ onPassed }: { onPassed: () => void | Promise<void> }) {
  const [age, setAge] = useState<Age | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [started, setStarted] = useState(false);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  const finish = async () => {
    setBusy(true); setNote('');
    try {
      const r = await ageCheckCall('finish');
      const result = r && r.result;
      const fresh = await loadAge();
      if (!alive.current) return;
      setAge(fresh);
      if (result === 'passed') { await onPassed(); return; }
      if (result === 'pending') setNote('Your check is still being looked at. This can take a few minutes.');
      else if (result === 'failed') setNote("We couldn't confirm you're 18 or over. You can try again, for example with ID.");
    } catch (x) {
      if (alive.current && !(x as ApiError).signedOut) setNote((x as Error).message);
    }
    if (alive.current) setBusy(false);
  };

  // Opened again while a check is still being looked at (or after the provider sent the person back): ask how it went.
  useEffect(() => {
    loadAge().then((a) => {
      if (!alive.current) return;
      setAge(a);
      if (a.pending) finish();
    });
  }, []);

  const start = async () => {
    setBusy(true); setNote('');
    try {
      const r = await ageCheckCall('start', { return_to: WEB_URL });
      if (!/^https?:\/\//.test(String(r && r.url))) throw new Error('The age check is not working right now. Try again soon.');
      setStarted(true);
      setUrl(r.url);   // the provider's page sends the person back here with ?age_check=done
    } catch (x) {
      setNote((x as Error).message);
    }
    setBusy(false);
  };

  const who = PROVIDER_NAMES[(age && age.provider) || ''] || 'Our age check partner';
  const pending = started || !!(age && age.pending);
  return (
    <Page>
      <Text style={styles.h1}>Quick age check</Text>
      <Text style={styles.muted}>Frendzy is for people aged 18 and over. {who} checks your age with a quick selfie. If it can't tell from your face, it asks you to show ID instead.</Text>
      <Text style={[styles.muted, styles.small]}>
        {who} only tells us whether you passed. Frendzy never sees or keeps your photo or ID. See the{' '}
        <Text style={styles.link} onPress={() => Linking.openURL(WEB_URL + 'privacy.html').catch(() => {})}>Privacy Policy</Text>.
      </Text>
      {note ? <Text style={styles.error}>{note}</Text> : null}
      <View style={styles.stack12}>
        {pending ? (
          <>
            <Button label="I've finished, check again" disabled={busy} onPress={finish} />
            <Button ghost label="Start again" disabled={busy} onPress={start} />
          </>
        ) : <Button label="Start age check" disabled={busy} onPress={start} />}
      </View>
      {url ? <AgeWeb url={url} onReturn={() => { setUrl(null); finish(); }} onClose={() => setUrl(null)} /> : null}
    </Page>
  );
}
