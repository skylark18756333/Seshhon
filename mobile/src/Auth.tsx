// Signing up and logging in, as native screens. They show the same things in the same words as welcome(),
// loginScreen(), recoverScreen(), resetScreen(), emailCard(), codeCard() and tooYoung() in docs/app.js, and the same database
// functions and email-code function are called by the form handlers there (the 'join', 'login', 'recover',
// 'reset-send', 'reset-new' and 'email-confirm' submit handlers, finishSignUp and saveNewLogin).
// Steps: sign up (name, date of birth, username, password, email, human check) -> the 18+ age check if the
// database asks for it -> confirm the email with a 6-digit code ("Later" skips) -> save the recovery code -> the
// tour (App.tsx shows it). Log in (username or email + password + human check), "Forgot your password?" (a code
// to the confirmed email, or the recovery code), and the login code and age check for an account that needs them (App.tsx shows those).
// Only the human check and the provider's age check page are web pages, in a small WebView (HumanCheck, AgeWeb).
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Linking, Text, TextInput, View } from 'react-native';
import AgeCheck from './AgeCheck';
import { loadAge } from './api';
import { Field, Page, Password, styles } from './Forms';
import HumanCheck, { type HumanCheckHandle } from './HumanCheck';
import { Button, Toast } from './Parts';
import {
  currentSession, emailCode, emailLoginName, isUnderage, lastUsername, pendingInvite, refreshSession, rememberPhone, rememberUsername,
  rpc, setSession, setTourPending, setUnderage, signInAnonymously, signInWithPassword, type ApiError
} from './session';
import { C } from './theme';

const SITE = 'https://frendzy.au/';
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$/;

export type AuthStart = 'join' | 'login' | 'recover';
export type AuthDone = { tour?: boolean; you?: boolean; note?: string };
type Screen = 'join' | 'login' | 'recover' | 'reset' | 'tooyoung' | 'age' | 'email' | 'code';
type NewCode = { code: string; username: string; after: 'home' | 'login'; emailed?: string };
type Login = { username: string; password: string; email: string };
type Waiting = { name: string; dob: string; login: Login };

// Perth has no daylight saving, so today in Perth is always UTC + 8 hours (todayPerth in docs/app.js).
function todayPerth(): string { return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10); }
function eighteenYearsAgo(): string {
  const t = todayPerth().split('-');
  return (Number(t[0]) - 18) + '-' + t[1] + '-' + t[2];   // someone born on or before this date is 18 or over
}
// The date of birth is typed as DD/MM/YYYY (the slashes go in by themselves); the database takes YYYY-MM-DD.
function dobText(raw: string): string {
  const d = raw.replace(/\D/g, '').slice(0, 8);
  return d.length > 4 ? d.slice(0, 2) + '/' + d.slice(2, 4) + '/' + d.slice(4) : d.length > 2 ? d.slice(0, 2) + '/' + d.slice(2) : d;
}
function dobIso(text: string): string {
  const m = text.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return '';
  const d = new Date(Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1])));
  if (d.getUTCFullYear() !== Number(m[3]) || d.getUTCMonth() !== Number(m[2]) - 1 || d.getUTCDate() !== Number(m[1])) return '';
  return m[3] + '-' + m[2] + '-' + m[1];
}

export default function Auth({ start, note, onDone }: { start: AuthStart; note: string | null; onDone: (r: AuthDone) => void }) {
  const [screen, setScreen] = useState<Screen>(isUnderage() && start === 'join' ? 'tooyoung' : start);
  const [loginName, setLoginName] = useState('');
  const [loginNote, setLoginNote] = useState<string | null>(null);
  const [waiting, setWaiting] = useState<Waiting | null>(null);
  const [newCode, setNewCode] = useState<NewCode | null>(null);
  const [emailStep, setEmailStep] = useState<{ email: string; hint: string } | null>(null);
  const ticket = useRef<string | null>(null);   // straight after a recovery code, the next login doesn't need the email code
  const [toast, setToast] = useState<string | null>(note);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const say = useCallback((text: string) => {
    setToast(text);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3600);
  }, []);
  useEffect(() => { if (note) say(note); return () => { if (toastTimer.current) clearTimeout(toastTimer.current); }; }, []);

  // A copy of a new recovery code goes to the account's confirmed email (emailRecovery in docs/app.js). It stays on
  // screen too, in case the email doesn't arrive. Accounts without a confirmed email just skip this.
  const emailRecovery = useCallback((c: NewCode | null): Promise<void> => {
    if (!c || c.emailed || !currentSession()) return Promise.resolve();
    return emailCode('recovery', { username: c.username, code: c.code }).then((r) => {
      setNewCode((now) => (now && now.code === c.code ? { ...now, emailed: r.hint } : now));
    }, () => {});
  }, []);

  // The details were checked and the 18+ check is out of the way (finishSignUp and saveNewLogin in docs/app.js).
  const finishSignUp = useCallback(async (w: Waiting) => {
    await rpc('api_sign_up', { p_name: w.name, p_birth_date: w.dob });
    setTourPending();   // the tour after sign-up; App.tsx shows it once the recovery code is saved
    setWaiting(null);
    try {
      const r = await rpc('save_account', { p_username: w.login.username, p_password: w.login.password });
      const code: NewCode = { code: r.recovery_code, username: r.username, after: 'home' };
      rememberUsername(r.username);
      setNewCode(code);
      // Then a code to confirm the email. The account is saved either way; the email can be added later on the You page.
      let step: { email: string; hint: string } | null = null;
      if (w.login.email) {
        try { const sent = await emailCode('setup', { email: w.login.email }); step = { email: w.login.email, hint: sent.hint || '' }; }
        catch (x) { say((x as Error).message); }
      }
      setEmailStep(step);
      setScreen(step ? 'email' : 'code');
    } catch (e) {
      onDone({ tour: true, you: true, note: (e as Error).message + ' Pick another username below.' });
    }
  }, [onDone, say]);

  /* ---------- the screens ---------- */
  if (screen === 'tooyoung') {
    return (
      <View style={styles.fill}>
        <Page>
          <Text style={styles.h1}>Frendzy is for people aged 18 and over.</Text>
          <Text style={styles.muted}>We can't set up an account for you. If you entered your date of birth wrongly, contact us through the Privacy Policy page.</Text>
        </Page>
      </View>
    );
  }
  if (screen === 'age') {
    return <View style={styles.fill}><AgeCheck onPassed={() => finishSignUp(waiting as Waiting)} /><Toast text={toast} /></View>;
  }
  if (screen === 'email' && emailStep) {
    return (
      <View style={styles.fill}>
        <EmailConfirm
          step={emailStep}
          onSay={say}
          onConfirmed={() => { setEmailStep(null); setScreen('code'); emailRecovery(newCode); }}
          onLater={() => { setEmailStep(null); setScreen('code'); }}
        />
        <Toast text={toast} />
      </View>
    );
  }
  if (screen === 'code' && newCode) {
    return (
      <View style={styles.fill}>
        <Page>
          <View style={styles.stack12}>
            <Text style={styles.h2}>Save your recovery code</Text>
            <Text style={[styles.muted, styles.small]}>If you forget your password, this code is the only way back into your account. Screenshot it or write it down. It won't be shown again.</Text>
            <Text selectable style={[styles.linkbox, styles.code]} testID="recovery-code">{newCode.code}</Text>
            <Text style={[styles.muted, styles.small]}>Your username is <Text style={styles.strong}>{newCode.username}</Text>.</Text>
            {newCode.emailed ? <Text style={[styles.body, styles.small]}>We also emailed it to <Text style={styles.strong}>{newCode.emailed}</Text>. Keep that email.</Text> : null}
            <Button label="I've saved it" onPress={() => {
              if (newCode.after === 'login') { setLoginName(newCode.username); setNewCode(null); setScreen('login'); }
              else { setNewCode(null); onDone({ tour: true }); }
            }} />
          </View>
        </Page>
        <Toast text={toast} />
      </View>
    );
  }
  if (screen === 'recover') {
    return (
      <View style={styles.fill}>
        <Recover
          initial={loginName}
          onBack={() => setScreen('login')}
          onRecovered={async (code, ticketValue) => {
            // A copy goes to the confirmed email while the temporary sign-in still works; that sign-in was only for
            // the recovery, so log in with the new password next.
            setNewCode(code);
            await emailRecovery(code);
            ticket.current = ticketValue;
            setSession(null);
            setScreen('code');
          }}
        />
        <Toast text={toast} />
      </View>
    );
  }
  if (screen === 'reset') {
    return (
      <View style={styles.fill}>
        <Reset
          initial={loginName}
          onBack={() => setScreen('login')}
          onRecover={() => setScreen('recover')}
          onReset={(username, ticketValue) => {
            // The temporary sign-in was only for the reset; log in with the new password next.
            ticket.current = ticketValue;
            setSession(null);
            setLoginName(username);
            setLoginNote('Your password is changed. Log in with your username ' + username + ' and your new password.');
            setScreen('login');
          }}
        />
        <Toast text={toast} />
      </View>
    );
  }
  if (screen === 'login') {
    return (
      <View style={styles.fill}>
        <Login
          initial={loginName}
          note={loginNote}
          onReset={(name) => { setLoginName(name); setLoginNote(null); setScreen('reset'); }}
          onJoin={() => setScreen(isUnderage() ? 'tooyoung' : 'join')}
          onLoggedIn={async () => {
            // Straight after a recovery code, this login doesn't need the email code.
            const t = ticket.current; ticket.current = null;
            if (t) { try { const ok = await rpc('two_step_use_ticket', { p_ticket: t }); if (ok) await refreshSession(); } catch (e) {} }
            onDone({});
          }}
        />
        <Toast text={toast} />
      </View>
    );
  }
  return (
    <View style={styles.fill}>
      <Join
        onLogin={() => setScreen('login')}
        onTooYoung={() => { setUnderage(); setScreen('tooyoung'); }}
        onReady={async (w) => {
          // The 18+ check, if the database asks for it, comes before the account is made.
          const age = await loadAge();
          if (age.required && !age.passed) { setWaiting(w); setScreen('age'); return; }
          await finishSignUp(w);
        }}
      />
      <Toast text={toast} />
    </View>
  );
}

/* ---------- sign up (welcome() and the 'join' form) ---------- */
function Join({ onLogin, onTooYoung, onReady }: { onLogin: () => void; onTooYoung: () => void; onReady: (w: Waiting) => Promise<void> }) {
  const [name, setName] = useState('');
  const [dob, setDob] = useState('');
  const [user, setUser] = useState('');
  const [pass, setPass] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const check = useRef<HumanCheckHandle>(null);
  const invited = pendingInvite();
  const signedIn = !!currentSession();

  const submit = async () => {
    const fail = (msg: string) => { setError(msg); setBusy(false); };
    const first = name.trim(), birth = dobIso(dob), ju = user.trim().toLowerCase(), je = email.trim();
    if (!first) return fail('Enter your first name to continue.');
    if (!birth || birth < '1900-01-01' || birth > todayPerth()) return fail('Enter your date of birth.');
    if (birth > eighteenYearsAgo()) { onTooYoung(); return; }
    if (!/^[a-z0-9_]{3,20}$/.test(ju)) return fail('Pick a username of 3 to 20 letters, numbers or _.');
    if (pass.length < 10) return fail('Use a password of at least 10 characters.');
    if (!EMAIL_RE.test(je)) return fail('Enter your email address. Login codes go there.');
    setBusy(true); setError('');
    try {
      if (!currentSession()) await signInAnonymously(await (check.current ? check.current.take() : Promise.resolve('')));
      // An older database without username_free() just skips this early check; save_account still refuses a taken name.
      let free: boolean = true;
      try { free = await rpc('username_free', { p_username: ju }); } catch (x) { if (!(x as ApiError).missing) throw x; }
      if (free === false) throw new Error('That username is taken. Try another.');
      await onReady({ name: first, dob: birth, login: { username: ju, password: pass, email: je } });
    } catch (x) { fail((x as Error).message); return; }
    setBusy(false);
  };

  return (
    <Page>
      <Text style={styles.h1}>Tell your friends you're up for a sesh.</Text>
      <Text style={styles.muted}>{invited ? 'A friend invited you. Sign up and they will get your friend request.' : "Go green when you're keen, see which friends are too, and pick a place together."}</Text>
      <View style={styles.stack16}>
        <Field label="Your first name">
          <TextInput style={styles.input} value={name} onChangeText={setName} autoComplete="given-name" textContentType="givenName" maxLength={24} accessibilityLabel="Your first name" />
        </Field>
        <Field label="Date of birth" note="Frendzy is for people aged 18 and over. We only use this to check your age and do not keep it.">
          <TextInput style={styles.input} value={dob} onChangeText={(t) => setDob(dobText(t))} keyboardType="number-pad" placeholder="DD/MM/YYYY" placeholderTextColor={C.muted}
            autoComplete="birthdate-full" maxLength={10} accessibilityLabel="Date of birth" />
        </Field>
        <Field label="Pick a username" note="3 to 20 letters, numbers or _. Friends add you with it.">
          <TextInput style={styles.input} value={user} onChangeText={setUser} autoComplete="username-new" autoCapitalize="none" autoCorrect={false} spellCheck={false} maxLength={20} accessibilityLabel="Pick a username" />
        </Field>
        <Field label="Make a password" note="At least 10 characters. You use it to log in on another phone.">
          <Password value={pass} onChange={setPass} label="Make a password" />
        </Field>
        <Field label="Your email" note="We email you a code to confirm it, and again whenever you log in on a new phone. Nobody else ever sees it.">
          <TextInput style={styles.input} value={email} onChangeText={setEmail} onSubmitEditing={submit} keyboardType="email-address" autoComplete="email" autoCapitalize="none" autoCorrect={false}
            spellCheck={false} maxLength={254} accessibilityLabel="Your email" />
        </Field>
        {signedIn ? null : <HumanCheck ref={check} onWait={setChecking} />}
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Button label={checking ? "Checking you're human…" : 'Get started'} disabled={busy} onPress={submit} />
        <Text style={[styles.muted, styles.small]}>
          By continuing you agree to the <Text style={styles.link} onPress={() => Linking.openURL(SITE + 'terms.html').catch(() => {})}>Terms</Text> and{' '}
          <Text style={styles.link} onPress={() => Linking.openURL(SITE + 'privacy.html').catch(() => {})}>Privacy Policy</Text>.
        </Text>
      </View>
      <Button ghost label="I already have an account" onPress={onLogin} />
    </Page>
  );
}

/* ---------- log in (loginScreen() and the 'login' form) ---------- */
function Login({ initial, note, onJoin, onReset, onLoggedIn }: { initial: string; note: string | null; onJoin: () => void; onReset: (name: string) => void; onLoggedIn: () => Promise<void> }) {
  const [user, setUser] = useState(initial);
  const [pass, setPass] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const check = useRef<HumanCheckHandle>(null);
  // The username used last time is filled in (LAST_USER_KEY in docs/app.js).
  useEffect(() => {
    if (initial) return;
    const last = lastUsername();
    if (last) setUser(last);
  }, []);

  const submit = async () => {
    const lu = user.trim();
    const fail = (msg: string) => { setError(msg); setBusy(false); };
    if (!lu || !pass) return fail('Enter your username or email, and your password.');
    setBusy(true); setError('');
    try {
      const token = await (check.current ? check.current.take() : Promise.resolve(''));
      const name = lu.indexOf('@') > 0 ? await emailLoginName(lu, pass) : lu;
      await signInWithPassword(name, pass, token);
      rememberUsername(lu.toLowerCase());
      await onLoggedIn();
    } catch (x) { fail((x as Error).message); }
  };

  return (
    <Page>
      <Text style={styles.h1}>Log in</Text>
      {note ? <Text style={styles.muted}>{note}</Text> : null}
      <View style={styles.stack16}>
        <Field label="Username or email">
          <TextInput style={styles.input} value={user} onChangeText={setUser} autoComplete="username" autoCapitalize="none" autoCorrect={false} spellCheck={false} maxLength={254} accessibilityLabel="Username or email" />
        </Field>
        <Field label="Password">
          <Password value={pass} onChange={setPass} onSubmit={submit} label="Password" current />
        </Field>
        <HumanCheck ref={check} onWait={setChecking} />
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Button label={checking ? "Checking you're human…" : 'Log in'} disabled={busy} onPress={submit} />
      </View>
      <View style={styles.stack12}>
        <Button ghost label="Forgot your password?" onPress={() => onReset(user.trim())} />
        <Button ghost label="Back" onPress={onJoin} />
      </View>
    </Page>
  );
}

/* ---------- forgot your password (recoverScreen() and the 'recover' form) ---------- */
function Recover({ initial, onBack, onRecovered }: { initial: string; onBack: () => void; onRecovered: (code: NewCode, ticket: string | null) => Promise<void> }) {
  const [user, setUser] = useState(initial);
  const [code, setCode] = useState('');
  const [pass, setPass] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const check = useRef<HumanCheckHandle>(null);
  const signedIn = !!currentSession();

  const submit = async () => {
    const fail = (msg: string) => { setError(msg); setBusy(false); };
    const ru = user.trim();
    if (!ru || !code.trim()) return fail('Enter your username or email, and your recovery code.');
    if (pass.length < 10) return fail('Use a password of at least 10 characters.');
    setBusy(true); setError('');
    try {
      if (!currentSession()) await signInAnonymously(await (check.current ? check.current.take() : Promise.resolve('')));
      const r = await rpc('recover_account', { p_username: ru, p_code: code, p_password: pass });
      if (!r || !r.ok) return fail((r && r.message) || "That didn't work. Try again.");
      const fresh: NewCode = { code: r.recovery_code, username: r.username, after: 'login' };
      await onRecovered(fresh, r.ticket || null);
    } catch (x) { fail((x as Error).message); }
  };

  return (
    <Page>
      <Text style={styles.h1}>Use your recovery code</Text>
      <Text style={styles.muted}>Enter the recovery code you saved when you made your password, and choose a new password.</Text>
      <View style={styles.stack16}>
        <Field label="Username or email">
          <TextInput style={styles.input} value={user} onChangeText={setUser} autoComplete="username" autoCapitalize="none" autoCorrect={false} spellCheck={false} maxLength={254} accessibilityLabel="Username or email" />
        </Field>
        <Field label="Recovery code">
          <TextInput style={styles.input} value={code} onChangeText={setCode} autoCapitalize="characters" autoCorrect={false} spellCheck={false} maxLength={24}
            placeholder="XXXX-XXXX-XXXX-XXXX" placeholderTextColor={C.muted} accessibilityLabel="Recovery code" />
        </Field>
        <Field label="New password" note="At least 10 characters.">
          <Password value={pass} onChange={setPass} onSubmit={submit} label="New password" />
        </Field>
        {signedIn ? null : <HumanCheck ref={check} onWait={setChecking} />}
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Button label={checking ? "Checking you're human…" : 'Set new password'} disabled={busy} onPress={submit} />
      </View>
      <Button ghost label="Back" onPress={onBack} />
    </Page>
  );
}

/* ---------- forgot your password: a code to the confirmed email (resetScreen() and the 'reset-send' and 'reset-new' forms) ---------- */
function Reset({ initial, onBack, onRecover, onReset }: { initial: string; onBack: () => void; onRecover: () => void; onReset: (username: string, ticket: string | null) => void }) {
  const [email, setEmail] = useState(initial.indexOf('@') > 0 ? initial : '');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [pass, setPass] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const check = useRef<HumanCheckHandle>(null);
  const signedIn = !!currentSession();
  const fail = (msg: string) => { setError(msg); setBusy(false); };

  const send = async () => {
    const se = email.trim().toLowerCase();
    if (!EMAIL_RE.test(se)) return fail('Enter the email you confirmed for Frendzy.');
    setBusy(true); setError('');
    try {
      if (!currentSession()) await signInAnonymously(await (check.current ? check.current.take() : Promise.resolve('')));
      await emailCode('reset', { email: se });
      setSentTo(se); setBusy(false);
    } catch (x) { fail((x as Error).message); }
  };
  const submit = async () => {
    const nc = code.replace(/\D/g, '');
    if (nc.length !== 6) return fail('Enter the 6-digit code from the email.');
    if (pass.length < 10) return fail('Use a password of at least 10 characters.');
    if (!currentSession()) { setSentTo(null); return; }
    setBusy(true); setError('');
    try {
      const r = await rpc('reset_password', { p_email: sentTo, p_code: nc, p_password: pass });
      if (!r || !r.ok) return fail((r && r.message) || "That didn't work. Try again.");
      onReset(r.username, r.ticket || null);
    } catch (x) { fail((x as Error).message); }
  };

  return (
    <Page>
      <Text style={styles.h1}>Forgot your password?</Text>
      {sentTo ? (
        <>
          <Text style={styles.muted}>If {sentTo} has a Frendzy account, we sent it a 6-digit code. Check your junk folder too.</Text>
          <View style={styles.stack16}>
            <Field label="Code from the email">
              <TextInput style={styles.input} value={code} onChangeText={setCode} keyboardType="number-pad" autoComplete="one-time-code" maxLength={7} accessibilityLabel="Code from the email" />
            </Field>
            <Field label="New password" note="At least 10 characters.">
              <Password value={pass} onChange={setPass} onSubmit={submit} label="New password" />
            </Field>
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <Button label="Set new password" disabled={busy} onPress={submit} />
          </View>
          <Button ghost label="Use a different email, or send a new code" onPress={() => { setSentTo(null); setCode(''); setError(''); }} />
        </>
      ) : (
        <>
          <Text style={styles.muted}>Enter the email you confirmed for Frendzy. We'll send it a code to choose a new password.</Text>
          <View style={styles.stack16}>
            <Field label="Email">
              <TextInput style={styles.input} value={email} onChangeText={setEmail} keyboardType="email-address" autoComplete="email" autoCapitalize="none" autoCorrect={false} spellCheck={false} maxLength={254} accessibilityLabel="Email" />
            </Field>
            {signedIn ? null : <HumanCheck ref={check} onWait={setChecking} />}
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <Button label={checking ? "Checking you're human…" : 'Email me a code'} disabled={busy} onPress={send} />
          </View>
        </>
      )}
      <View style={styles.stack12}>
        <Button ghost label="Use your recovery code instead" onPress={onRecover} />
        <Button ghost label="Back" onPress={onBack} />
      </View>
    </Page>
  );
}

/* ---------- confirming the email right after sign-up (emailCard() and the 'email-confirm' form) ---------- */
function EmailConfirm({ step, onSay, onConfirmed, onLater }: { step: { email: string; hint: string }; onSay: (t: string) => void; onConfirmed: () => void; onLater: () => void }) {
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const digits = code.replace(/\D/g, '');
    if (digits.length !== 6) { setError('Enter the 6-digit code from the email.'); return; }
    setBusy(true); setError('');
    try {
      const r = await rpc('two_step_check', { p_code: digits });
      if (!r || !r.ok) { setError((r && r.message) || "That didn't work. Try again."); setBusy(false); return; }
      onSay('Email confirmed. New logins will ask for a code from it.');
      rememberPhone();   // the phone that confirmed the email doesn't need a code at its next login
      onConfirmed();
    } catch (x) { setError((x as Error).message); setBusy(false); }
  };

  return (
    <Page>
      <View style={styles.stack12}>
        <Text style={styles.h2}>Confirm your email</Text>
        <Text style={[styles.muted, styles.small]}>We sent a 6-digit code to <Text style={styles.strong}>{step.hint}</Text>. Once it's confirmed, every new login asks for a code from this email as well as your password.</Text>
        <Field label="Code from the email">
          <TextInput style={styles.input} value={code} onChangeText={setCode} onSubmitEditing={submit} keyboardType="number-pad" autoComplete="one-time-code" textContentType="oneTimeCode"
            maxLength={7} autoCorrect={false} accessibilityLabel="Code from the email" />
        </Field>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Button label="Confirm email" disabled={busy} onPress={submit} />
        <View style={styles.row}>
          <Button small ghost label="Send again" onPress={() => { emailCode('setup', { email: step.email }).then(() => onSay('Code sent again.'), (x: Error) => onSay(x.message)); }} />
          <Button small ghost label="Later" onPress={onLater} />
        </View>
      </View>
    </Page>
  );
}
