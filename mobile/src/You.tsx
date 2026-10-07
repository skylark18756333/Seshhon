// The native You page, opened from your face at the top right. It shows the same things in the same words as
// you(), accountCards(), sec(), safetyCard(), saveForm(), emailCard() and codeCard() in
// docs/app.js, and its taps call the same database functions as the ACT list and the form handlers there.
// Settings are drop-down sections, as on the web: tap a title to open or close it. Each remembers whether it
// is open while you move between tabs, and one with something waiting for you (a question, a form step) is
// always open.
// Left out on purpose: "Put Frendzy on your home screen" (this is the app on the home screen already) and the
// staff deal-code card (deals are switched off in docs/config.js).
import Constants from 'expo-constants';
import * as ImagePicker from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import React, { useCallback, useEffect, useState } from 'react';
import { KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import {
  addFriendByUsername, loadAccount, loadEmailsOn, loadSafety,
  type Account, type Safety
} from './api';
import Icon from './Icon';
import { Avatar, Button, Face, Toast, TopBar } from './Parts';
import {
  clearTour, currentSession, emailCode, forgetPhone, rememberPhone, rememberUsername, rpc, setSession, type ApiError
} from './session';
import Tour from './Tour';
import type { Frendzy } from './useFrendzy';
import { C, COLOURS, F, LABELS, first } from './theme';

const WEB_URL: string = (Constants.expoConfig?.extra?.webUrl as string) || 'https://frendzy.au/';
const INVITE_BASE = 'https://frendzy.au/';
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$/;

// Which sections are open, kept while the app runs (ui.sets in docs/app.js).
const openSets: Record<string, boolean> = {};

type NewCode = { code: string; username: string; emailed?: string };
type EmailStep = { email: string; hint: string; renew: boolean };

// Crops the middle square of a photo and shrinks it to 160 x 160 on this phone before it is sent, as
// shrinkPhoto in docs/app.js does: a JPEG at 82% quality, or 60% if that is still too big for the database.
async function shrinkPhoto(asset: ImagePicker.ImagePickerAsset): Promise<string> {
  const w = asset.width, h = asset.height, side = Math.min(w, h);
  if (!side) throw new Error('empty');
  const ref = await ImageManipulator.manipulate(asset.uri)
    .crop({ originX: Math.floor((w - side) / 2), originY: Math.floor((h - side) / 2), width: side, height: side })
    .resize({ width: 160, height: 160 })
    .renderAsync();
  let out = await ref.saveAsync({ format: SaveFormat.JPEG, compress: 0.82, base64: true });
  let url = 'data:image/jpeg;base64,' + (out.base64 || '');
  if (url.length > 60000) {
    out = await ref.saveAsync({ format: SaveFormat.JPEG, compress: 0.6, base64: true });
    url = 'data:image/jpeg;base64,' + (out.base64 || '');
  }
  if (!out.base64) throw new Error('empty');
  return url;
}

export default function You({ f, onOpenWeb, onSignedOut }: { f: Frendzy; onOpenWeb: (tab: string) => void; onSignedOut: (note: string) => void }) {
  const me = f.state && f.state.me;
  const friends = (f.state && f.state.friends) || [];
  const requestsOut = (f.state && f.state.requests_out) || [];
  const blocked = (f.state && f.state.blocked) || [];

  // What the page reads besides api_state (loadAccount, loadSafety, loadRole, loadTwoStep in docs/app.js).
  const [account, setAccount] = useState<Account | null | 'off' | undefined>(undefined);
  const [safety, setSafety] = useState<Safety | 'off' | undefined>(undefined);
  const [emailsOn, setEmailsOn] = useState(false);
  useEffect(() => {
    let gone = false;
    Promise.all([loadAccount(), loadSafety(), loadEmailsOn()]).then(([a, sf, on]) => {
      if (gone) return;
      setAccount(a); setSafety(sf); setEmailsOn(on);
    });
    return () => { gone = true; };
  }, []);

  const [, setTick] = useState(0);
  const toggle = (key: string) => { openSets[key] = !openSets[key]; setTick((n) => n + 1); };
  const [confirm, setConfirm] = useState<string | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [linkShown, setLinkShown] = useState(false);
  const [friendName, setFriendName] = useState('');
  const [addError, setAddError] = useState('');
  const [adding, setAdding] = useState(false);
  const [tour, setTour] = useState(false);

  // The account forms.
  const [editAccount, setEditAccount] = useState(false);
  const [changeEmail, setChangeEmail] = useState(false);
  const [emailStep, setEmailStep] = useState<EmailStep | null>(null);
  const [newCode, setNewCode] = useState<NewCode | null>(null);
  const [saveUser, setSaveUser] = useState('');
  const [savePass, setSavePass] = useState('');
  const [saveEmail, setSaveEmail] = useState('');
  const [saveError, setSaveError] = useState('');
  const [saveBusy, setSaveBusy] = useState(false);
  const [ecCode, setEcCode] = useState('');
  const [ecError, setEcError] = useState('');
  const [ecBusy, setEcBusy] = useState(false);


  // A copy of a new recovery code goes to the account's confirmed email (emailRecovery in docs/app.js).
  const emailRecovery = useCallback((c: NewCode | null) => {
    if (!c || c.emailed) return;
    emailCode('recovery', { username: c.username, code: c.code }).then((r) => {
      setNewCode((now) => (now && now.code === c.code ? { ...now, emailed: r.hint } : now));
    }, () => {});
  }, []);

  if (!me) return null;
  const a = account && account !== 'off' ? account : null;
  const myPhoto = f.photos[me.id];
  const inviteLink = INVITE_BASE + '?invite=' + me.invite_code;

  /* ---------- taps ---------- */
  const savePhoto = (dataUrl: string | null) => {
    setPhotoBusy(true);
    rpc('set_photo', { p_photo: dataUrl })
      .then(() => f.refresh())
      .then(() => f.say(dataUrl ? 'Photo saved.' : 'Photo removed.'), (e: ApiError) => f.say(e.message))
      .then(() => setPhotoBusy(false));
  };
  const pickPhoto = async () => {
    let picked: ImagePicker.ImagePickerResult;
    try {
      picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 });
    } catch (e) { f.say('That photo could not be opened. Try a different one.'); return; }
    if (picked.canceled || !picked.assets || !picked.assets[0]) return;
    const asset = picked.assets[0];
    if (asset.type && asset.type !== 'image') { f.say('Pick a photo.'); return; }
    let dataUrl: string;
    try { dataUrl = await shrinkPhoto(asset); } catch (e) { f.say('That photo could not be opened. Try a different one.'); return; }
    savePhoto(dataUrl);
  };

  const share = () => {
    setLinkShown(true);
    Share.share({ title: 'Frendzy', message: "Add me on Frendzy so we can see when we're both up for a sesh. " + inviteLink }).catch(() => {});
  };

  const addFriend = () => {
    const name = friendName.trim();
    if (!name) { setAddError("Type your friend's username."); return; }
    if (adding) return;
    setAdding(true);
    addFriendByUsername(name).then((r) => {
      if (!r || !r.ok) { setAddError((r && r.message) || "That didn't work. Try again."); return; }
      setAddError(''); setFriendName(''); openSets.friends = true;   // open Your friends so the new request shows
      f.say(r.state === 'accepted' ? 'You and ' + first(r.name) + ' are now friends.'
        : r.state === 'requested' ? 'Friend request sent to ' + first(r.name) + '.' : 'You and ' + first(r.name) + ' are already friends.');
      return f.refresh();
    }, (e: ApiError) => {
      setAddError(e.missing ? 'Adding by username needs a database update. Send your invite link for now.' : e.message);
    }).then(() => setAdding(false));
  };

  const setGender = (v: string) => {
    const sf = safety && safety !== 'off' ? safety : { gender: null, women_only: false };
    f.act('set_safety', { p_gender: v || null, p_women_only: (v === 'woman' || v === 'nonbinary') && !!sf.women_only })
      .then((r) => { if (r) setSafety(r); });
  };
  const setWomenOnly = (on: boolean) => {
    const sf = safety && safety !== 'off' ? safety : { gender: null, women_only: false };
    f.act('set_safety', { p_gender: sf.gender, p_women_only: on }, on ? 'Women and non-binary only is on.' : 'Women and non-binary only is off.')
      .then((r) => { if (r) setSafety(r); });
  };

  // Username and password, and adding or changing the login email (the save-account and add-email forms).
  const askEmail = !a && emailsOn;
  const submitSave = async (addingEmail: boolean) => {
    const su = addingEmail ? '' : saveUser.trim().toLowerCase(), sp = addingEmail ? '' : savePass;
    const hasEmail = addingEmail || askEmail, em = saveEmail.trim();
    if (!addingEmail && !/^[a-z0-9_]{3,20}$/.test(su)) { setSaveError('Pick a username of 3 to 20 letters, numbers or _.'); return; }
    if (!addingEmail && sp.length < 10) { setSaveError('Use a password of at least 10 characters.'); return; }
    if (hasEmail && !EMAIL_RE.test(em)) { setSaveError('Enter your email address. Login codes go there.'); return; }
    setSaveBusy(true); setSaveError('');
    try {
      let code: NewCode | null = null;
      if (!addingEmail) {
        const r = await rpc('save_account', { p_username: su, p_password: sp });
        setEditAccount(false);
        rememberUsername(r.username);
        f.setUsername(r.username);
        code = { code: r.recovery_code, username: r.username };
        setNewCode(code);
        loadAccount().then(setAccount);
      }
      let step: EmailStep | null = null;
      if (hasEmail && em) {
        // The account is saved either way; if the email can't be sent, it can be added again from here.
        try {
          const s = await emailCode('setup', { email: em });
          step = { email: em, hint: s.hint || em, renew: addingEmail };
          setEmailStep(step);
        } catch (x) { if (addingEmail) throw x; f.say((x as Error).message); }
      }
      setSavePass(''); setSaveEmail('');
      if (!step) emailRecovery(code);   // a password change on an account that already has its email
    } catch (x) {
      setSaveError((x as Error).message);
    }
    setSaveBusy(false);
  };

  const confirmEmail = async () => {
    const code = ecCode.replace(/\D/g, '');
    if (code.length !== 6) { setEcError('Enter the 6-digit code from the email.'); return; }
    setEcBusy(true); setEcError('');
    try {
      const r = await rpc('two_step_check', { p_code: code });
      if (!r || !r.ok) { setEcError((r && r.message) || "That didn't work. Try again."); setEcBusy(false); return; }
      const changed = !!(a && a.email);
      setAccount((old) => (old && old !== 'off' ? { ...old, email: r.email } : old));
      const renew = !!(emailStep && emailStep.renew) && !newCode;
      setEmailStep(null); setChangeEmail(false); setEcCode('');
      f.say(changed ? 'Email changed. Login codes now go to ' + r.email + '.' : 'Email confirmed. New logins will ask for a code from it.');
      rememberPhone();   // the phone that confirmed the email doesn't need a code at its next login
      // From the You page, a fresh recovery code goes to the (new) email too. The old one only exists as a hash.
      let next = newCode;
      if (renew) {
        try {
          const c = await rpc('renew_recovery_code');
          next = { code: c.recovery_code, username: c.username };
          setNewCode(next);
        } catch (e) {}
      }
      emailRecovery(next);
    } catch (x) {
      setEcError((x as Error).message);
    }
    setEcBusy(false);
  };
  const resendEmail = () => {
    if (!emailStep) return;
    emailCode('setup', { email: emailStep.email }).then(() => f.say('Code sent again.'), (x: Error) => f.say(x.message));
  };

  // Log out: this phone forgets the sign-in, in secure storage and in the web page, which then shows the login.
  const logOut = () => {
    clearTour();
    onSignedOut('Logged out. Log in again with your username and password.');
    setSession(null);
  };
  const deleteAccount = () => {
    const goneId = currentSession() && currentSession()!.user_id;
    setConfirm(null);
    rpc('delete_account').then(() => {
      if (goneId) forgetPhone(goneId);
      rememberUsername(null);
      clearTour();
      onSignedOut('Your account has been deleted.');
      setSession(null);
    }, (e: ApiError) => { if (!e.signedOut) f.say(e.message); });
  };

  /* ---------- the page ---------- */
  const sf = safety && safety !== 'off' ? safety : null;

  return (
    <View style={styles.fill}>
      <TopBar f={f} onOpenWeb={onOpenWeb} />
      <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView style={styles.fill} contentContainerStyle={styles.view} keyboardShouldPersistTaps="handled">
          <View style={styles.row}>
            <Avatar id={me.id} name={me.name} photos={f.photos} ring={COLOURS[me.colour]} size={56} font={18} />
            <View style={styles.grow}>
              <Text style={styles.h1} accessibilityRole="header">{me.name}</Text>
              <Text style={[styles.muted, styles.small]}>Status: {LABELS[me.colour]}</Text>
            </View>
          </View>

          <Pressable style={styles.crewsRow} onPress={() => onOpenWeb('crews')} accessibilityRole="button" accessibilityLabel="Crews and besties" testID="open-crews">
            <View style={styles.grow}>
              <Text style={[styles.h2, { fontSize: 17 }]}>Crews and besties</Text>
              <Text style={[styles.muted, styles.small]}>Share when you're free with the people you pick, and get catch-up ideas.</Text>
            </View>
            <View style={styles.chevronRight} />
          </Pressable>

          <Text style={styles.pill}>Settings</Text>

          <Section k="photo" title="Your photo" hint={myPhoto ? 'Added' : 'None yet'} force={photoBusy} onToggle={toggle}>
            <View style={styles.row}>
              <View style={[styles.mePic, { borderColor: COLOURS[me.colour] }]}>
                <Face id={me.id} name={me.name} photos={f.photos} size={64} font={22} />
              </View>
              <Text style={[styles.muted, styles.small, styles.grow]}>Only your friends see it on your circle, never strangers or anyone you block. Use a photo of you.</Text>
            </View>
            <View style={styles.row}>
              <Button small label={photoBusy ? 'Saving...' : myPhoto ? 'Change photo' : 'Add a photo'} disabled={photoBusy} onPress={pickPhoto} />
              {myPhoto && !photoBusy ? <Button small ghost label="Remove" onPress={() => savePhoto(null)} /> : null}
            </View>
          </Section>

          <Section k="add" title="Add a friend" force={!friends.length} onToggle={toggle}>
            {account !== 'off' ? (
              <View style={styles.stack8}>
                <View style={styles.field}>
                  <Text style={styles.label}>Add by username</Text>
                  <View style={styles.row}>
                    <TextInput
                      style={[styles.input, styles.grow]}
                      value={friendName}
                      onChangeText={setFriendName}
                      onSubmitEditing={addFriend}
                      placeholder="their username"
                      placeholderTextColor={C.muted}
                      autoCapitalize="none"
                      autoCorrect={false}
                      maxLength={21}
                      accessibilityLabel="Add by username"
                    />
                    <Button label="Add" small disabled={adding} onPress={addFriend} />
                  </View>
                </View>
                {addError ? <Text style={styles.error}>{addError}</Text> : null}
                <Text style={[styles.muted, styles.small]}>
                  {a ? <Text>Your username is <Text style={styles.strong}>{a.username}</Text>. Tell your friends so they can add you.</Text>
                    : 'Pick a username on the You page so friends can add you too.'}
                </Text>
              </View>
            ) : null}
            <Text style={[styles.muted, styles.small]}>Not on Frendzy yet? Send them your invite link. When they sign up you get a friend request to accept.</Text>
            <Button label="Send your invite link" ghost onPress={share} />
            {linkShown ? (
              <>
                <Text style={[styles.muted, styles.small]}>Copy this link and send it to a friend:</Text>
                <Text selectable style={styles.linkbox}>{inviteLink}</Text>
              </>
            ) : null}
          </Section>

          {friends.length || requestsOut.length ? (
            <Section k="friends" title="Your friends" hint={String(friends.length)} force={/^(unfriend|block):/.test(confirm || '')} onToggle={toggle}>
              {friends.map((fr) => {
                const asking = confirm === 'unfriend:' + fr.friendship, blocking = confirm === 'block:' + fr.id;
                return (
                  <View key={fr.friendship} style={[styles.row, styles.wrapRow]} testID={'friend-' + fr.id}>
                    <View style={styles.grow}>
                      <Text style={styles.body}>{fr.name}</Text>
                      {blocking ? <Text style={[styles.muted, styles.small]}>They won't see you or be able to add you again.</Text> : null}
                    </View>
                    {asking ? (
                      <>
                        <Button small label="Remove" colour={C.off} ink onPress={() => { setConfirm(null); f.act('answer_friend', { p_friendship: fr.friendship, p_accept: false }); }} />
                        <Button small ghost label="Keep" onPress={() => setConfirm(null)} />
                      </>
                    ) : blocking ? (
                      <>
                        <Button small label="Block" colour={C.off} ink onPress={() => { setConfirm(null); f.act('block_user', { p_user: fr.id }, 'Blocked.'); }} />
                        <Button small ghost label="Cancel" onPress={() => setConfirm(null)} />
                      </>
                    ) : (
                      <>
                        <Button small ghost label="Remove" onPress={() => setConfirm('unfriend:' + fr.friendship)} />
                        <Button small ghost label="Block" onPress={() => setConfirm('block:' + fr.id)} />
                      </>
                    )}
                  </View>
                );
              })}
              {requestsOut.map((rq) => (
                <View key={rq.friendship} style={styles.row}>
                  <View style={styles.grow}>
                    <Text style={styles.body}>{rq.name}</Text>
                    <Text style={[styles.muted, styles.small]}>Waiting for them to accept</Text>
                  </View>
                  <Button small ghost label="Cancel" onPress={() => f.act('answer_friend', { p_friendship: rq.friendship, p_accept: false })} />
                </View>
              ))}
            </Section>
          ) : null}

          {sf ? (
            <Section k="safety" title="Safety" hint={sf.women_only ? 'Women only on' : ''} onToggle={toggle}>
              <Text style={[styles.muted, styles.small]}>Your gender is private. It is never shown to anyone, and you don't have to say.</Text>
              <View style={[styles.row, styles.wrapRow]}>
                {[['woman', 'Woman'], ['man', 'Man'], ['nonbinary', 'Non-binary'], ['', 'Rather not say']].map(([v, label]) => {
                  const on = (sf.gender || '') === v;
                  return <Button key={label} small ghost={!on} pressed={on} label={label} onPress={() => setGender(v)} />;
                })}
              </View>
              {sf.gender === 'woman' || sf.gender === 'nonbinary' ? (
                <>
                  <Text style={[styles.h2, { marginTop: 8 }]}>Women and non-binary only</Text>
                  <Text style={[styles.muted, styles.small]}>
                    {sf.women_only
                      ? "On. Only women and non-binary people can see your status, add you, or join and chat in seshes you start. Anyone else just sees you as red. In someone else's sesh, the people in it can still see you."
                      : "When it's on, only women and non-binary people can see your status, add you, or join and chat in seshes you start."}
                  </Text>
                  <View style={styles.start}>
                    <Button small ghost={sf.women_only} pressed={sf.women_only} label={sf.women_only ? 'Turn off' : 'Turn on'} onPress={() => setWomenOnly(!sf.women_only)} />
                  </View>
                </>
              ) : null}
            </Section>
          ) : null}

          {blocked.length ? (
            <Section k="blocked" title="Blocked people" hint={String(blocked.length)} onToggle={toggle}>
              {blocked.map((b) => (
                <View key={b.id} style={styles.row}>
                  <Text style={[styles.body, styles.grow]}>{b.name}</Text>
                  <Button small ghost label="Unblock" onPress={() => f.act('unblock_user', { p_user: b.id }, 'Unblocked. You can add each other again.')} />
                </View>
              ))}
            </Section>
          ) : null}

          {/* ---------- accountCards ---------- */}
          {account !== 'off' && account !== undefined ? (
            emailStep ? (
              <View style={[styles.card, styles.cardOn]}>
                <Text style={styles.h2}>Confirm your email</Text>
                <Text style={[styles.muted, styles.small]}>We sent a 6-digit code to <Text style={styles.strong}>{emailStep.hint}</Text>. Once it's confirmed, every new login asks for a code from this email as well as your password.</Text>
                <Field label="Code from the email">
                  <TextInput style={styles.input} value={ecCode} onChangeText={setEcCode} onSubmitEditing={confirmEmail} keyboardType="number-pad"
                    autoComplete="one-time-code" textContentType="oneTimeCode" maxLength={7} accessibilityLabel="Code from the email" />
                </Field>
                {ecError ? <Text style={styles.error}>{ecError}</Text> : null}
                <Button label="Confirm email" disabled={ecBusy} onPress={confirmEmail} />
                <View style={styles.row}>
                  <Button small ghost label="Send again" onPress={resendEmail} />
                  <Button small ghost label="Later" onPress={() => setEmailStep(null)} />
                </View>
              </View>
            ) : newCode ? (
              <View style={[styles.card, styles.cardOn]}>
                <Text style={styles.h2}>Save your recovery code</Text>
                <Text style={[styles.muted, styles.small]}>If you forget your password, this code is the only way back into your account. Screenshot it or write it down. It won't be shown again.</Text>
                <Text selectable style={[styles.linkbox, styles.code]} testID="recovery-code">{newCode.code}</Text>
                <Text style={[styles.muted, styles.small]}>Your username is <Text style={styles.strong}>{newCode.username}</Text>.</Text>
                {newCode.emailed ? <Text style={[styles.body, styles.small]}>We also emailed it to <Text style={styles.strong}>{newCode.emailed}</Text>. Keep that email.</Text> : null}
                <Button label="I've saved it" onPress={() => setNewCode(null)} />
              </View>
            ) : a && !editAccount ? (
              <Section k="login" title="Username and password" hint={a.username} onToggle={toggle}>
                <Text style={[styles.muted, styles.small]}>You're logged in as <Text style={styles.strong}>{a.username}</Text>. Use it to log in on another phone.</Text>
                {a.email && !changeEmail ? (
                  <Text style={[styles.muted, styles.small]}>New logins also need a code sent to <Text style={styles.strong}>{a.email}</Text>.</Text>
                ) : emailsOn ? (
                  <View style={styles.stack12}>
                    <Text style={[styles.muted, styles.small]}>
                      {a.email ? <Text>We'll send a code to the new email. Until you type it, codes keep going to <Text style={styles.strong}>{a.email}</Text>.</Text>
                        : 'Add an email so every new login needs a code from it as well as your password.'}
                    </Text>
                    <EmailField label={a.email ? 'New email' : 'Email for login codes'} value={saveEmail} onChange={setSaveEmail} onSubmit={() => submitSave(true)} />
                    {saveError ? <Text style={styles.error}>{saveError}</Text> : null}
                    <View style={styles.row}>
                      <Button small label="Send me a code" disabled={saveBusy} onPress={() => submitSave(true)} />
                      {a.email ? <Button small ghost label="Cancel" onPress={() => { setChangeEmail(false); setSaveError(''); }} /> : null}
                    </View>
                  </View>
                ) : null}
                <View style={[styles.row, styles.wrapRow]}>
                  {a.email && !changeEmail && emailsOn ? <Button small ghost label="Change email" onPress={() => { setChangeEmail(true); setSaveError(''); }} /> : null}
                  <Button small ghost label="Change password" onPress={() => { setEditAccount(true); setSaveUser(a.username); setSaveError(''); }} />
                  <Button small ghost label="Log out" onPress={logOut} />
                </View>
              </Section>
            ) : (
              <View style={styles.card}>
                <Text style={styles.h2}>{a ? 'Change password' : 'Keep your account'}</Text>
                {a ? null : (
                  <Text style={[styles.muted, styles.small]}>Right now your account only lives in this app. Add a username and password so you can log in on a new phone.{emailsOn ? ' Each new login will also need a code we email you.' : ''}</Text>
                )}
                <View style={styles.stack12}>
                  <Field label="Username" note="3 to 20 letters, numbers or _. Friends who know it can add you.">
                    <TextInput style={styles.input} value={saveUser} onChangeText={setSaveUser} autoCapitalize="none" autoCorrect={false} autoComplete="username"
                      maxLength={20} accessibilityLabel="Username" />
                  </Field>
                  <Field label={a ? 'New password' : 'Password'} note="At least 10 characters.">
                    <Password value={savePass} onChange={setSavePass} label={a ? 'New password' : 'Password'} />
                  </Field>
                  {askEmail ? <EmailField label="Email" value={saveEmail} onChange={setSaveEmail} /> : null}
                  {saveError ? <Text style={styles.error}>{saveError}</Text> : null}
                  <Button label={a ? 'Save and get a new recovery code' : 'Save my account'} disabled={saveBusy} onPress={() => submitSave(false)} />
                </View>
                {a ? <Button ghost label="Cancel" onPress={() => { setEditAccount(false); setSaveError(''); setSavePass(''); }} /> : null}
              </View>
            )
          ) : null}

          <Section k="account" title="Your account" force={confirm === 'delete'} onToggle={toggle}>
            <Text style={[styles.muted, styles.small]}>{a ? 'You can log in on any phone with your username and password.' : 'Your account lives in this app on this phone.'} If Frendzy staff ask for your account ID, it's this:</Text>
            <Text selectable style={styles.linkbox}>{me.id}</Text>
            {confirm === 'delete' ? (
              <>
                <Text style={styles.error}>This removes your name, friends, votes and ratings for good.</Text>
                <View style={styles.row}>
                  <Button small label="Delete for good" colour={C.off} ink onPress={deleteAccount} />
                  <Button small ghost label="Keep my account" onPress={() => setConfirm(null)} />
                </View>
              </>
            ) : <Button ghost label="Delete my account" onPress={() => setConfirm('delete')} />}
          </Section>

          <Section k="tour" title="How Frendzy works" onToggle={toggle}>
            <Text style={[styles.muted, styles.small]}>A quick look at status, friends, seshes and the map.</Text>
            <View style={styles.start}><Button small ghost label="Show the tour" onPress={() => setTour(true)} /></View>
          </Section>

          <Section k="about" title="About" onToggle={toggle}>
            <Pressable accessibilityRole="link" onPress={() => Linking.openURL(WEB_URL + 'privacy.html').catch(() => {})}>
              <Text style={[styles.body, styles.small, styles.link]}>Privacy Policy</Text>
            </Pressable>
            <Pressable accessibilityRole="link" onPress={() => Linking.openURL(WEB_URL + 'terms.html').catch(() => {})}>
              <Text style={[styles.body, styles.small, styles.link]}>Terms of use</Text>
            </Pressable>
            {Constants.expoConfig?.version ? <Text style={[styles.muted, styles.small]}>App version {Constants.expoConfig.version}</Text> : null}
          </Section>
        </ScrollView>
      </KeyboardAvoidingView>
      {tour ? <Tour name={first(me.name)} onClose={() => setTour(false)} /> : null}
      <Toast text={f.toast} />
    </View>
  );
}

// A drop-down settings section (sec() in docs/app.js): tap the title to open or close it.
function Section({ k, title, hint, force, onToggle, children }: {
  k: string; title: string; hint?: string; force?: boolean; onToggle: (k: string) => void; children: React.ReactNode;
}) {
  const open = !!(force || openSets[k]);
  return (
    <View style={styles.card0}>
      <Pressable
        style={styles.summary}
        onPress={() => onToggle(k)}
        accessibilityRole="button"
        accessibilityLabel={title}
        aria-expanded={open}
        testID={'set-' + k}
      >
        <Text style={[styles.h2, styles.summaryTitle]} numberOfLines={2}>{title}</Text>
        {hint ? <Text style={[styles.muted, styles.small, styles.hint]} numberOfLines={1}>{hint}</Text> : null}
        <View style={[styles.chevron, open && styles.chevronOpen]} />
      </Pressable>
      {open ? <View style={styles.setBody}>{children}</View> : null}
    </View>
  );
}

function Field({ label, note, children }: { label: string; note?: string; children: React.ReactNode }) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      {children}
      {note ? <Text style={[styles.muted, styles.small]}>{note}</Text> : null}
    </View>
  );
}
function EmailField({ label, value, onChange, onSubmit }: { label: string; value: string; onChange: (t: string) => void; onSubmit?: () => void }) {
  return (
    <Field label={label} note="For login codes only. Nobody else ever sees it.">
      <TextInput style={styles.input} value={value} onChangeText={onChange} onSubmitEditing={onSubmit} keyboardType="email-address" autoComplete="email"
        autoCapitalize="none" autoCorrect={false} maxLength={254} accessibilityLabel={label} />
    </Field>
  );
}
// A password box with an eye button that shows what was typed, so typos are easy to spot.
function Password({ value, onChange, label }: { value: string; onChange: (t: string) => void; label: string }) {
  const [shown, setShown] = useState(false);
  return (
    <View>
      <TextInput style={[styles.input, { paddingRight: 56 }]} value={value} onChangeText={onChange} secureTextEntry={!shown} autoComplete="new-password"
        autoCapitalize="none" autoCorrect={false} maxLength={72} accessibilityLabel={label} />
      <Pressable style={styles.peek} onPress={() => setShown((x) => !x)} accessibilityRole="button"
        accessibilityLabel={shown ? 'Hide password' : 'Show password'} accessibilityState={{ selected: shown }}>
        <Icon name="eye" size={20} colour={shown ? C.fg : C.muted} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  view: { paddingHorizontal: 18, paddingTop: 20, paddingBottom: 24, gap: 20, maxWidth: 440, width: '100%', alignSelf: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  wrapRow: { flexWrap: 'wrap', rowGap: 8, columnGap: 8 },
  between: { justifyContent: 'space-between' },
  start: { flexDirection: 'row' },
  grow: { flex: 1, minWidth: 0 },
  stack6: { gap: 6 },
  stack8: { gap: 8 },
  stack12: { gap: 12 },
  h1: { fontFamily: F.display, fontSize: 28, lineHeight: 31, letterSpacing: -0.5, color: C.fg },
  h2: { fontFamily: F.displayBold, fontSize: 19, letterSpacing: -0.2, color: C.fg },
  body: { fontFamily: F.body, fontSize: 16, color: C.fg },
  strong: { fontFamily: F.bodyBold },
  muted: { fontFamily: F.body, fontSize: 16, lineHeight: 22, color: C.muted },
  small: { fontSize: 14, lineHeight: 20 },
  link: { textDecorationLine: 'underline' },
  error: { fontFamily: F.bodyMid, fontSize: 14, color: C.off },
  pill: { alignSelf: 'flex-start', marginTop: 4, fontFamily: F.bodyBold, fontSize: 12, letterSpacing: 0.8, textTransform: 'uppercase', paddingVertical: 5, paddingHorizontal: 10, borderRadius: 999, borderWidth: 1, borderColor: C.line, color: C.muted, overflow: 'hidden' },
  card: { backgroundColor: C.surface, borderRadius: 18, padding: 14, gap: 10, borderWidth: 1, borderColor: 'transparent' },
  cardOn: { borderColor: C.on },
  card0: { backgroundColor: C.surface, borderRadius: 18 },
  summary: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 56, paddingHorizontal: 16 },
  summaryTitle: { flex: 1, minWidth: 0, fontSize: 17 },
  hint: { maxWidth: '45%' },
  chevron: { width: 9, height: 9, borderRightWidth: 2, borderBottomWidth: 2, borderColor: C.muted, transform: [{ rotate: '45deg' }], marginTop: -4 },
  chevronOpen: { transform: [{ rotate: '-135deg' }], marginTop: 4 },
  crewsRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 64, paddingHorizontal: 16, paddingVertical: 12, borderRadius: 18, backgroundColor: C.surface },
  chevronRight: { width: 9, height: 9, borderRightWidth: 2, borderBottomWidth: 2, borderColor: C.muted, transform: [{ rotate: '-45deg' }] },
  setBody: { gap: 10, paddingHorizontal: 16, paddingBottom: 16 },
  mePic: { borderWidth: 2, borderRadius: 40, padding: 3, margin: 4 },
  linkbox: { fontFamily: F.body, fontSize: 14, paddingVertical: 12, paddingHorizontal: 14, borderRadius: 12, backgroundColor: C.bg, borderWidth: 1, borderColor: C.line, color: C.fg, overflow: 'hidden' },
  code: { fontSize: 20, fontFamily: F.bodyBold, letterSpacing: 1, textAlign: 'center' },
  field: { gap: 8 },
  label: { fontFamily: F.bodyMid, fontSize: 16, color: C.fg },
  input: { height: 52, borderRadius: 14, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface, paddingHorizontal: 16, color: C.fg, fontFamily: F.body, fontSize: 16 },
  peek: { position: 'absolute', right: 4, top: 4, width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }
});
