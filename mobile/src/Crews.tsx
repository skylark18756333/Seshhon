// Crews and besties, and the free time you share with them (migration 0031_crews). Opened from the You page
// (or the link on Home). Sharing is opt-in and only ever with a crew or a bestie, never with all your friends,
// and it holds no places or calendar details: you tick Morning, Arvo or Night by hand. Every tap calls a
// database function (crews_state, set_free, set_share_settings, plan_catch_up and so on), and the database
// decides who may see what. Plain Views only, no shadows and no gradients, so it looks the same on every phone.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import {
  loadCatchUps, loadCrews, loadFreeTime,
  type Bestie, type CatchUp, type Crew, type CrewsState, type FreeTime, type ShareSettings
} from './api';
import Icon from './Icon';
import { Button, Toast } from './Parts';
import { rpc, type ApiError } from './session';
import type { Frendzy } from './useFrendzy';
import { C, F, HANGOUTS, PART_NAMES, fmtDay, fmtSlot, first, slotStart } from './theme';

const PARTS = ['morning', 'arvo', 'night'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const HANGOUT_NAME: Record<string, string> = Object.fromEntries(HANGOUTS);

/* ---------- suggestion cards (also shown on Home) ---------- */
// "Friday night works for The Girls. 4 of 5 are free." with Plan it, which makes a planned sesh (migration 0025)
// invited to the crew. Nothing shows when nothing is on or the database is older than the feature.
export function CatchUpCards({ f, onPlanned }: { f: Frendzy; onPlanned?: () => void }) {
  const [list, setList] = useState<CatchUp[]>([]);
  const [busy, setBusy] = useState('');
  const alive = useRef(true);
  const load = useCallback(() => { loadCatchUps().then((l) => { if (alive.current) setList(l); }); }, []);
  useEffect(() => {
    alive.current = true;
    load();
    const timer = setInterval(load, 30000);
    return () => { alive.current = false; clearInterval(timer); };
  }, [load]);
  if (!list.length) return null;
  const key = (c: CatchUp) => c.target + c.day + c.part;
  const plan = (c: CatchUp) => {
    if (busy) return;
    setBusy(key(c));
    rpc('plan_catch_up', { p_kind: c.kind, p_target: c.target, p_day: c.day, p_part: c.part, p_at: slotStart(c.day, c.part).toISOString() }).then(() => {
      f.say('Planned for ' + fmtSlot(c.day, c.part).toLowerCase() + '. ' + (c.kind === 'crew' ? 'Your crew can say they are in.' : first(c.label) + ' can say they are in.'));
      f.refresh(); load();
      if (onPlanned) onPlanned();
    }, (e: ApiError) => { if (!e.signedOut) f.say(e.message); }).then(() => setBusy(''));
  };
  const notNow = (c: CatchUp) => {
    setList((l) => l.filter((x) => key(x) !== key(c)));
    rpc('dismiss_catch_up', { p_target: c.target, p_day: c.day, p_part: c.part }).then(() => {}, () => load());
  };
  return (
    <View style={styles.stack}>
      <Text style={styles.h2}>Catch-ups</Text>
      {list.map((c) => {
        const hang = c.hangouts && c.hangouts.length ? HANGOUT_NAME[c.hangouts[0]] || 'Catch up' : 'Catch up';
        return (
          <View key={key(c)} style={[styles.card, styles.cardOn]} testID={'catchup-' + c.day + '-' + c.part}>
            {c.kind === 'crew' ? (
              <>
                <Text style={styles.cardTitle}>{fmtSlot(c.day, c.part)} works for {c.label}.</Text>
                <Text style={[styles.muted, styles.small]}>{c.free} of {c.of} are free{c.names.length ? ': you, ' + c.names.map(first).join(', ') : ''}.</Text>
              </>
            ) : (
              <>
                <Text style={styles.cardTitle}>You and {first(c.label)} are both free {fmtSlot(c.day, c.part).toLowerCase()}.</Text>
                <Text style={[styles.muted, styles.small]}>{hang}?</Text>
              </>
            )}
            <View style={styles.row}>
              <Button small label="Plan it" disabled={!!busy} onPress={() => plan(c)} />
              <Button small ghost label="Not now" onPress={() => notNow(c)} />
            </View>
          </View>
        );
      })}
    </View>
  );
}

/* ---------- the screen ---------- */
type View_ = { t: 'main' } | { t: 'crew'; id: string } | { t: 'bestie'; id: string } | { t: 'free' };

export default function Crews({ f, onBack, onPlanned }: { f: Frendzy; onBack: () => void; onPlanned: () => void }) {
  const [data, setData] = useState<CrewsState | 'off' | null>(null);
  const [free, setFree] = useState<FreeTime | null>(null);
  const [view, setView] = useState<View_>({ t: 'main' });
  const alive = useRef(true);
  const reload = useCallback(() => Promise.all([loadCrews(), loadFreeTime()]).then(([c, ft]) => {
    if (!alive.current) return;
    setData(c); setFree(ft);
  }), []);
  useEffect(() => {
    alive.current = true;
    reload();
    const timer = setInterval(reload, 15000);
    return () => { alive.current = false; clearInterval(timer); };
  }, [reload]);

  // A tap that calls a database function, says the result and reads everything again.
  const run = useCallback((fn: string, args: Record<string, unknown>, okMsg?: string): Promise<any> =>
    rpc(fn, args).then((r) => { if (okMsg) f.say(okMsg); return reload().then(() => r); },
      (e: ApiError) => { if (!e.signedOut) f.say(e.message); return null; }), [f, reload]);

  // Back goes up one level: crew or free time to the list, the list to You.
  const back = () => { if (view.t === 'main') onBack(); else setView({ t: 'main' }); };
  const title = view.t === 'free' ? 'When you are free' : view.t === 'crew' ? 'Crew' : view.t === 'bestie' ? 'Bestie' : 'Crews and besties';
  const crew = data && data !== 'off' && view.t === 'crew' ? data.crews.find((c) => c.id === view.id) : undefined;
  const bestie = data && data !== 'off' && view.t === 'bestie' ? data.besties.find((b) => b.id === view.id) : undefined;

  return (
    <View style={styles.fill}>
      <View style={styles.top}>
        <Pressable onPress={back} accessibilityRole="button" accessibilityLabel="Back" style={styles.backBtn} testID="crews-back">
          <Icon name="back" size={22} colour={C.fg} />
        </Pressable>
        <Text style={[styles.h1, styles.grow]} numberOfLines={1} accessibilityRole="header">{view.t === 'crew' && crew ? crew.name : view.t === 'bestie' && bestie ? bestie.name : title}</Text>
      </View>
      <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView style={styles.fill} contentContainerStyle={styles.view} keyboardShouldPersistTaps="handled">
          {data === null ? <Text style={styles.muted}>Loading...</Text>
            : data === 'off' ? (
              <View style={styles.card}>
                <Text style={styles.cardTitle}>Not switched on yet</Text>
                <Text style={[styles.muted, styles.small]}>Crews and besties need a database update. Ask whoever runs Frendzy to run 0031_crews in Supabase.</Text>
              </View>
            ) : view.t === 'free' ? <FreeGrid free={free} run={run} />
            : view.t === 'crew' ? (crew ? <CrewView f={f} crew={crew} run={run} onGone={() => setView({ t: 'main' })} /> : <Text style={styles.muted}>That crew is gone.</Text>)
            : view.t === 'bestie' ? (bestie ? <BestieView bestie={bestie} run={run} onGone={() => setView({ t: 'main' })} /> : <Text style={styles.muted}>That bestie is gone.</Text>)
            : <Main f={f} data={data} free={free} run={run} open={setView} onPlanned={onPlanned} />}
        </ScrollView>
      </KeyboardAvoidingView>
      <Toast text={f.toast} />
    </View>
  );
}

type Run = (fn: string, args: Record<string, unknown>, okMsg?: string) => Promise<any>;

function Main({ f, data, free, run, open, onPlanned }: { f: Frendzy; data: CrewsState; free: FreeTime | null; run: Run; open: (v: View_) => void; onPlanned: () => void }) {
  const friends = (f.state && f.state.friends) || [];
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const crews = data.crews.filter((c) => c.state === 'member');
  const crewInvites = data.crews.filter((c) => c.state === 'invited');
  const besties = data.besties.filter((b) => b.state === 'accepted');
  const bestieAsks = data.besties.filter((b) => b.state === 'in');
  const bestieSent = data.besties.filter((b) => b.state === 'out');
  const taken = new Set(data.besties.map((b) => b.id));
  const slots = free ? free.days.reduce((n, d) => n + d.free.length, 0) : 0;
  const sharing = [...crews, ...besties].filter((x) => x.settings.share !== 'off').length;

  return (
    <>
      <View style={styles.card}>
        <Text style={styles.body}>Share when you're free with your besties and your crews, so Frendzy can suggest a catch-up. It's off until you switch it on, one crew or bestie at a time. Other friends never see it, and no places or calendar details are shared.</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Your free time</Text>
        <Text style={[styles.muted, styles.small]}>{slots ? 'Free for ' + slots + ' slot' + (slots === 1 ? '' : 's') + ' in the next 2 weeks.' : 'Nothing ticked yet.'} {sharing ? 'Shared with ' + sharing + ' crew' + (sharing === 1 ? '' : 's') + ' or bestie' + (sharing === 1 ? '' : 's') + '.' : 'Not shared with anyone yet.'}</Text>
        <View style={styles.start}><Button small label="Set when I'm free" onPress={() => open({ t: 'free' })} testID="open-free" /></View>
      </View>

      <CatchUpCards f={f} onPlanned={onPlanned} />

      {crewInvites.length || bestieAsks.length ? (
        <View style={styles.stack}>
          <Text style={styles.h2}>Invites</Text>
          {crewInvites.map((c) => (
            <View key={c.id} style={styles.card}>
              <Text style={styles.body}><Text style={styles.strong}>{first(c.invited_by)}</Text> invited you to the crew <Text style={styles.strong}>{c.name}</Text></Text>
              <View style={styles.row}>
                <Button small label="Join" onPress={() => run('answer_crew_invite', { p_crew: c.id, p_accept: true }, 'You joined ' + c.name + '. Nothing is shared until you switch it on.')} />
                <Button small ghost label="No thanks" onPress={() => run('answer_crew_invite', { p_crew: c.id, p_accept: false })} />
              </View>
            </View>
          ))}
          {bestieAsks.map((b) => (
            <View key={b.id} style={styles.card}>
              <Text style={styles.body}><Text style={styles.strong}>{first(b.name)}</Text> wants you as a bestie</Text>
              <View style={styles.row}>
                <Button small label="Say yes" onPress={() => run('answer_bestie', { p_user: b.id, p_accept: true }, 'You and ' + first(b.name) + ' are besties. Nothing is shared until you switch it on.')} />
                <Button small ghost label="No thanks" onPress={() => run('answer_bestie', { p_user: b.id, p_accept: false })} />
              </View>
            </View>
          ))}
        </View>
      ) : null}

      <View style={styles.stack}>
        <View style={[styles.row, styles.between]}>
          <Text style={styles.h2}>Besties</Text>
          <Text style={[styles.muted, styles.small]}>{besties.length} of 5</Text>
        </View>
        {besties.map((b) => <Row key={b.id} label={b.name} hint={shareHint(b.settings)} onPress={() => open({ t: 'bestie', id: b.id })} testID={'bestie-' + b.name} />)}
        {bestieSent.map((b) => (
          <View key={b.id} style={styles.row}>
            <View style={styles.grow}>
              <Text style={styles.body}>{b.name}</Text>
              <Text style={[styles.muted, styles.small]}>Waiting for them to say yes</Text>
            </View>
            <Button small ghost label="Cancel" onPress={() => run('remove_bestie', { p_user: b.id })} />
          </View>
        ))}
        {!besties.length && !bestieSent.length ? <Text style={[styles.muted, styles.small]}>A bestie is one friend you share free time with, one to one. You both have to say yes.</Text> : null}
        {adding ? (
          <View style={styles.card}>
            <Text style={styles.label}>Pick a friend</Text>
            {friends.filter((fr) => !taken.has(fr.id)).map((fr) => (
              <Button key={fr.id} small ghost label={fr.name} onPress={() => { setAdding(false); run('request_bestie', { p_user: fr.id }, 'Asked ' + first(fr.name) + ' to be your bestie.'); }} />
            ))}
            {!friends.filter((fr) => !taken.has(fr.id)).length ? <Text style={[styles.muted, styles.small]}>All your friends are already besties or waiting.</Text> : null}
            <View style={styles.start}><Button small ghost label="Cancel" onPress={() => setAdding(false)} /></View>
          </View>
        ) : (
          <View style={styles.start}><Button small ghost label="Add a bestie" disabled={data.besties.length >= 5 || !friends.length} onPress={() => setAdding(true)} /></View>
        )}
      </View>

      <View style={styles.stack}>
        <View style={[styles.row, styles.between]}>
          <Text style={styles.h2}>Crews</Text>
          <Text style={[styles.muted, styles.small]}>{crews.length} of 10</Text>
        </View>
        {crews.map((c) => <Row key={c.id} label={c.name} hint={c.members.filter((m) => m.state === 'member').length + ' people' + (c.settings.share === 'off' ? '' : ', ' + shareHint(c.settings))} onPress={() => open({ t: 'crew', id: c.id })} testID={'crew-' + c.name} />)}
        {!crews.length ? <Text style={[styles.muted, styles.small]}>A crew is a group of your friends, like The Girls or Footy boys. Up to 15 people, and everyone has to accept the invite.</Text> : null}
        <View style={styles.card}>
          <Text style={styles.label}>Make a crew</Text>
          <View style={styles.row}>
            <TextInput style={[styles.input, styles.grow]} value={name} onChangeText={setName} placeholder="Crew name" placeholderTextColor={C.muted}
              maxLength={30} accessibilityLabel="Crew name" onSubmitEditing={() => make()} />
            <Button small label="Make crew" disabled={!name.trim() || crews.length >= 10} onPress={() => make()} />
          </View>
        </View>
      </View>
    </>
  );

  function make() {
    const nm = name.trim();
    if (!nm) return;
    run('make_crew', { p_name: nm }, nm + ' is made. Now invite your friends.').then((r) => {
      if (r && r.id) { setName(''); open({ t: 'crew', id: r.id }); }
    });
  }
}

function shareHint(s: ShareSettings): string {
  return s.share === 'exact' ? 'sharing exact times' : s.share === 'week' ? 'sharing free this week' : 'not sharing';
}

function Row({ label, hint, onPress, testID }: { label: string; hint: string; onPress: () => void; testID?: string }) {
  return (
    <Pressable style={styles.listRow} onPress={onPress} accessibilityRole="button" accessibilityLabel={label} testID={testID}>
      <View style={styles.grow}>
        <Text style={styles.body}>{label}</Text>
        <Text style={[styles.muted, styles.small]}>{hint}</Text>
      </View>
      <View style={styles.chevron} />
    </Pressable>
  );
}

/* ---------- one crew ---------- */
function CrewView({ f, crew, run, onGone }: { f: Frendzy; crew: Crew; run: Run; onGone: () => void }) {
  const friends = (f.state && f.state.friends) || [];
  const [confirm, setConfirm] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [rename, setRename] = useState('');
  const inCrew = new Set(crew.members.map((m) => m.id));
  const candidates = friends.filter((fr) => !inCrew.has(fr.id));
  const people = crew.members.filter((m) => m.state === 'member');
  const asked = crew.members.filter((m) => m.state === 'invited');

  return (
    <>
      <View style={styles.stack}>
        <View style={[styles.row, styles.between]}>
          <Text style={styles.h2}>People</Text>
          <Text style={[styles.muted, styles.small]}>{crew.members.length} of 15</Text>
        </View>
        {people.map((m) => (
          <View key={m.id} style={[styles.row, styles.wrapRow]}>
            <View style={styles.grow}>
              <Text style={styles.body}>{m.name}{m.id === f.state?.me?.id ? ' (you)' : ''}</Text>
              {m.week === true ? <Text style={[styles.muted, styles.small]}>Free sometime this week</Text> : m.week === false ? <Text style={[styles.muted, styles.small]}>Not free this week</Text> : null}
            </View>
            {crew.mine && m.id !== f.state?.me?.id ? <Button small ghost label="Remove" onPress={() => run('remove_from_crew', { p_crew: crew.id, p_user: m.id }, first(m.name) + ' is out of the crew.')} /> : null}
          </View>
        ))}
        {asked.map((m) => (
          <View key={m.id} style={styles.row}>
            <View style={styles.grow}>
              <Text style={styles.body}>{m.name}</Text>
              <Text style={[styles.muted, styles.small]}>Invited, waiting for them to join</Text>
            </View>
            {crew.mine ? <Button small ghost label="Cancel" onPress={() => run('remove_from_crew', { p_crew: crew.id, p_user: m.id })} /> : null}
          </View>
        ))}
        {crew.mine ? (
          picking ? (
            <View style={styles.card}>
              <Text style={styles.label}>Invite friends</Text>
              <View style={[styles.row, styles.wrapRow]}>
                {candidates.map((fr) => {
                  const on = picked.includes(fr.id);
                  return <Button key={fr.id} small ghost={!on} pressed={on} label={fr.name} onPress={() => setPicked((p) => (on ? p.filter((x) => x !== fr.id) : [...p, fr.id]))} />;
                })}
              </View>
              {!candidates.length ? <Text style={[styles.muted, styles.small]}>Everyone you know is already in.</Text> : null}
              <View style={styles.row}>
                <Button small label={picked.length ? 'Invite ' + picked.length : 'Invite'} disabled={!picked.length}
                  onPress={() => { const who = picked; setPicked([]); setPicking(false); run('invite_to_crew', { p_crew: crew.id, p_users: who }, 'Invited. They are in once they accept.'); }} />
                <Button small ghost label="Cancel" onPress={() => { setPicking(false); setPicked([]); }} />
              </View>
            </View>
          ) : <View style={styles.start}><Button small ghost label="Invite friends" disabled={crew.members.length >= 15} onPress={() => setPicking(true)} /></View>
        ) : null}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>What you share with {crew.name}</Text>
        <Settings settings={crew.settings} onChange={(s) => run('set_share_settings', args('crew', crew.id, s))} />
      </View>

      {crew.mine ? (
        <View style={styles.card}>
          <Text style={styles.label}>Rename the crew</Text>
          <View style={styles.row}>
            <TextInput style={[styles.input, styles.grow]} value={rename} onChangeText={setRename} placeholder={crew.name} placeholderTextColor={C.muted} maxLength={30} accessibilityLabel="New crew name" />
            <Button small ghost label="Rename" disabled={!rename.trim()} onPress={() => { const nm = rename.trim(); setRename(''); run('rename_crew', { p_crew: crew.id, p_name: nm }, 'Renamed.'); }} />
          </View>
        </View>
      ) : null}

      <View style={styles.card}>
        {confirm === 'leave' ? (
          <>
            <Text style={styles.body}>Leave {crew.name}? You stop sharing with it straight away, and nobody is told.</Text>
            <View style={styles.row}>
              <Button small label="Leave" colour={C.off} ink onPress={() => run('leave_crew', { p_crew: crew.id }, 'You left ' + crew.name + '.').then(onGone)} />
              <Button small ghost label="Stay" onPress={() => setConfirm(null)} />
            </View>
          </>
        ) : confirm === 'delete' ? (
          <>
            <Text style={styles.error}>Delete {crew.name} for everyone?</Text>
            <View style={styles.row}>
              <Button small label="Delete crew" colour={C.off} ink onPress={() => run('delete_crew', { p_crew: crew.id }, 'Crew deleted.').then(onGone)} />
              <Button small ghost label="Keep it" onPress={() => setConfirm(null)} />
            </View>
          </>
        ) : (
          <View style={[styles.row, styles.wrapRow]}>
            <Button small ghost label="Leave crew" onPress={() => setConfirm('leave')} />
            {crew.mine ? <Button small ghost label="Delete crew" onPress={() => setConfirm('delete')} /> : null}
          </View>
        )}
      </View>
    </>
  );
}

/* ---------- one bestie ---------- */
function BestieView({ bestie, run, onGone }: { bestie: Bestie; run: Run; onGone: () => void }) {
  const [confirm, setConfirm] = useState(false);
  return (
    <>
      {bestie.week === true ? <Text style={styles.muted}>{first(bestie.name)} is free sometime this week.</Text>
        : bestie.week === false ? <Text style={styles.muted}>{first(bestie.name)} is not free this week.</Text> : null}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>What you share with {first(bestie.name)}</Text>
        <Settings settings={bestie.settings} bestie onChange={(s) => run('set_share_settings', args('bestie', bestie.id, s))} />
      </View>
      <View style={styles.card}>
        {confirm ? (
          <>
            <Text style={styles.body}>Stop being besties with {first(bestie.name)}? You stop sharing straight away, and nobody is told.</Text>
            <View style={styles.row}>
              <Button small label="Remove bestie" colour={C.off} ink onPress={() => run('remove_bestie', { p_user: bestie.id }, 'Removed.').then(onGone)} />
              <Button small ghost label="Keep" onPress={() => setConfirm(false)} />
            </View>
          </>
        ) : <View style={styles.start}><Button small ghost label="Remove bestie" onPress={() => setConfirm(true)} /></View>}
      </View>
    </>
  );
}

function args(kind: string, target: string, s: ShareSettings): Record<string, unknown> {
  return { p_kind: kind, p_target: target, p_share: s.share, p_hangouts: s.hangouts, p_suggest: s.suggest, p_min: s.min, p_quiet: s.quiet };
}

// The sharing settings, the same for a crew and a bestie. Each tap saves straight away.
function Settings({ settings, onChange: save, bestie }: { settings: ShareSettings; onChange: (s: ShareSettings) => Promise<unknown> | void; bestie?: boolean }) {
  // The taps show straight away and each one sends the whole set of settings, so two quick taps never undo each
  // other. What the database sends back replaces them once nothing is waiting to be saved.
  const [s, setS] = useState(settings);
  const waiting = useRef(0);
  const sent = JSON.stringify(settings);
  useEffect(() => { if (!waiting.current) setS(settings); }, [sent]);   // eslint-disable-line react-hooks/exhaustive-deps
  const onChange = (next: ShareSettings) => {
    setS(next);
    waiting.current += 1;
    Promise.resolve(save(next)).then(() => { waiting.current -= 1; if (!waiting.current) setS(settingsRef.current); }, () => { waiting.current -= 1; });
  };
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const toggle = (list: number[] | string[], v: number | string) => ((list as any[]).includes(v) ? (list as any[]).filter((x) => x !== v) : [...(list as any[]), v]);
  return (
    <View style={styles.stack12}>
      <View style={styles.field}>
        <Text style={styles.label}>Share my free time</Text>
        <View style={[styles.row, styles.wrapRow]}>
          {([['off', 'Off'], ['week', 'Free this week'], ['exact', 'Exact times']] as const).map(([v, label]) => (
            <Button key={v} small ghost={s.share !== v} pressed={s.share === v} label={label} onPress={() => onChange({ ...s, share: v })} />
          ))}
        </View>
        <Text style={[styles.muted, styles.small]}>
          {s.share === 'off' ? 'Nothing is shared.' : s.share === 'week' ? 'They only see whether you are free sometime this week, not when.' : 'They see you are free for the days and times you tick. Suggestions need exact times from both sides.'}
        </Text>
      </View>
      <View style={styles.field}>
        <Text style={styles.label}>What we do together</Text>
        <View style={[styles.row, styles.wrapRow]}>
          {HANGOUTS.map(([v, label]) => {
            const on = s.hangouts.includes(v);
            return <Button key={v} small ghost={!on} pressed={on} label={label} onPress={() => onChange({ ...s, hangouts: toggle(s.hangouts, v) as string[] })} />;
          })}
        </View>
      </View>
      <View style={styles.field}>
        <Text style={styles.label}>Suggest catch-ups</Text>
        <View style={[styles.row, styles.wrapRow]}>
          {([['off', 'Off'], ['weekly', 'Once a week'], ['enough', 'Whenever enough are free']] as const).map(([v, label]) => (
            <Button key={v} small ghost={s.suggest !== v} pressed={s.suggest === v} label={label} onPress={() => onChange({ ...s, suggest: v })} />
          ))}
        </View>
        {s.suggest !== 'off' && s.share !== 'exact' ? <Text style={styles.error}>Suggestions need you to share exact times.</Text> : null}
      </View>
      {bestie ? null : (
        <View style={styles.field}>
          <Text style={styles.label}>How many of us are needed</Text>
          <View style={styles.row}>
            <Button small ghost label="-" disabled={s.min <= 2} onPress={() => onChange({ ...s, min: s.min - 1 })} />
            <Text style={[styles.body, styles.strong]} testID="min-free">At least {s.min} of us</Text>
            <Button small ghost label="+" disabled={s.min >= 15} onPress={() => onChange({ ...s, min: s.min + 1 })} />
          </View>
        </View>
      )}
      <View style={styles.field}>
        <Text style={styles.label}>Quiet days</Text>
        <View style={[styles.row, styles.wrapRow]}>
          {WEEKDAYS.map((d, i) => {
            const on = s.quiet.includes(i);
            return <Button key={d} small ghost={!on} pressed={on} label={d} onPress={() => onChange({ ...s, quiet: toggle(s.quiet, i) as number[] })} />;
          })}
        </View>
        <Text style={[styles.muted, styles.small]}>Frendzy never suggests a catch-up on these days.</Text>
      </View>
    </View>
  );
}

/* ---------- when I'm free ---------- */
function FreeGrid({ free, run }: { free: FreeTime | null; run: Run }) {
  // Ticks show straight away, then the database is told and its answer replaces them.
  const [local, setLocal] = useState<Record<string, boolean>>({});
  if (!free) return <Text style={styles.muted}>Loading...</Text>;
  const on = (day: string, part: string, list: string[]) => (day + part in local ? local[day + part] : list.includes(part));
  const tick = (day: string, part: string, now: boolean) => {
    setLocal((l) => ({ ...l, [day + part]: !now }));
    run('set_free', { p_day: day, p_part: part, p_free: !now }).then(() => setLocal((l) => { const n = { ...l }; delete n[day + part]; return n; }));
  };
  const usual = (dow: number, part: string) => free.pattern.includes(dow + ':' + part);
  const flipUsual = (dow: number, part: string) => {
    const key = dow + ':' + part;
    run('set_free_pattern', { p_pattern: usual(dow, part) ? free.pattern.filter((p) => p !== key) : [...free.pattern, key] });
  };
  return (
    <>
      <Text style={styles.muted}>Tap when you're free. Nothing is shared until you switch it on for a crew or bestie, and slots are deleted once the day has passed.</Text>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Usually free</Text>
        <Text style={[styles.muted, styles.small]}>Fills in the next 2 weeks for you. You can still untick any one day below.</Text>
        {PARTS.map((part) => (
          <View key={part} style={styles.usualRow}>
            <Text style={[styles.body, styles.partName]}>{PART_NAMES[part]}</Text>
            <View style={[styles.row, styles.wrapRow, styles.grow]}>
              {WEEKDAYS.map((d, i) => {
                const lit = usual(i, part);
                return (
                  <Pressable key={d} style={[styles.chip, lit && styles.chipOn]} onPress={() => flipUsual(i, part)} accessibilityRole="button"
                    accessibilityLabel={'Usually free ' + d + ' ' + part} accessibilityState={{ selected: lit }}>
                    <Text style={[styles.chipText, lit && styles.chipTextOn]}>{d.slice(0, 2)}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        ))}
      </View>
      <View style={styles.start}><Button small ghost label="Busy this week" onPress={() => run('busy_this_week', {}, 'Cleared. You are busy for the next 7 days.')} /></View>
      <View style={styles.card}>
        {free.days.map((d) => (
          <View key={d.day} style={styles.dayRow}>
            <Text style={[styles.body, styles.dayName]}>{fmtDay(d.day)}</Text>
            <View style={[styles.row, styles.grow]}>
              {PARTS.map((part) => {
                const lit = on(d.day, part, d.free);
                return (
                  <Pressable key={part} style={[styles.slot, lit && styles.chipOn]} onPress={() => tick(d.day, part, lit)} accessibilityRole="button"
                    accessibilityLabel={PART_NAMES[part] + ' ' + fmtDay(d.day)} accessibilityState={{ selected: lit }} testID={'free-' + d.day + '-' + part}>
                    <Text style={[styles.chipText, lit && styles.chipTextOn]}>{PART_NAMES[part]}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        ))}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  top: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingTop: 12, paddingBottom: 6, maxWidth: 440, width: '100%', alignSelf: 'center' },
  backBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  view: { paddingHorizontal: 18, paddingTop: 12, paddingBottom: 24, gap: 20, maxWidth: 440, width: '100%', alignSelf: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  wrapRow: { flexWrap: 'wrap', rowGap: 8, columnGap: 8 },
  between: { justifyContent: 'space-between' },
  start: { flexDirection: 'row' },
  grow: { flex: 1, minWidth: 0 },
  stack: { gap: 10 },
  stack12: { gap: 16 },
  h1: { fontFamily: F.display, fontSize: 24, lineHeight: 28, letterSpacing: -0.5, color: C.fg },
  h2: { fontFamily: F.displayBold, fontSize: 19, letterSpacing: -0.2, color: C.fg },
  cardTitle: { fontFamily: F.displayBold, fontSize: 17, color: C.fg },
  body: { fontFamily: F.body, fontSize: 16, color: C.fg },
  strong: { fontFamily: F.bodyBold },
  muted: { fontFamily: F.body, fontSize: 16, lineHeight: 22, color: C.muted },
  small: { fontSize: 14, lineHeight: 20 },
  error: { fontFamily: F.bodyMid, fontSize: 14, color: C.off },
  label: { fontFamily: F.bodyMid, fontSize: 16, color: C.fg },
  field: { gap: 8 },
  card: { backgroundColor: C.surface, borderRadius: 18, padding: 14, gap: 10, borderWidth: 1, borderColor: 'transparent' },
  cardOn: { borderColor: C.on },
  input: { height: 52, borderRadius: 14, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface, paddingHorizontal: 16, color: C.fg, fontFamily: F.body, fontSize: 16 },
  listRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 56, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 18, backgroundColor: C.surface },
  chevron: { width: 9, height: 9, borderRightWidth: 2, borderBottomWidth: 2, borderColor: C.muted, transform: [{ rotate: '-45deg' }] },
  usualRow: { gap: 6 },
  partName: { fontFamily: F.bodyMid },
  dayRow: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 52 },
  dayName: { width: 84, fontSize: 14 },
  slot: { flex: 1, minHeight: 44, borderRadius: 14, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface, alignItems: 'center', justifyContent: 'center' },
  chip: { minWidth: 40, minHeight: 40, borderRadius: 12, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface, alignItems: 'center', justifyContent: 'center' },
  chipOn: { backgroundColor: C.on, borderColor: C.on },
  chipText: { fontFamily: F.bodyBold, fontSize: 13, color: C.fg },
  chipTextOn: { color: C.ink }
});
