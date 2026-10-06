// The native Sesh tab: tonight's sesh, joining and starting one (open or private), planning one for later, the
// pres address, voting on where to go and locking it in, the Sesh Map (pub crawl), the chat, and ending or
// leaving. It shows the same things in the same words as sesh() and the pieces it uses in docs/app.js
// (pickerHtml, planHtml, plannedHtml, presHtml, votePicks, crawlHtml, chatHtml), and taps call the same
// database functions as the ACT list there.
// The two small street maps of the web Sesh tab (the route to the locked-in venue, and the crawl's map) are
// not drawn here: "See venue" opens the web venue page, which has the map, and the crawl is drawn as a plain
// sketch of its stops in order.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AppState, KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
  type NativeScrollEvent, type NativeSyntheticEvent
} from 'react-native';
import Svg, { Circle, Path, Polyline, Text as SvgText } from 'react-native-svg';
import { getMessages, reportMessage, seshCrawl, sendMessage, type CrawlStop, type Friend, type Member, type Message, type Sesh as SeshT } from './api';
import { CHAT_POLL_MS, RADIUS_KM } from './config';
import Icon from './Icon';
import { Avatar, Button, Toast, TopBar } from './Parts';
import type { ApiError } from './session';
import type { Frendzy } from './useFrendzy';
import { C, COLOURS, F, LABELS, first, fmtLeft, fmtTime, fmtWhen } from './theme';
import { awayText, distanceAway, fmtKm, hoursLine, km, leaderOf, useVenues, votePicks, type Venues } from './venues';

const CRAWL_MAX = 12;
const DAY = 86400000;

type Picked = Record<string, true>;
type Picker = { mode: 'start' | 'invite'; picked: Picked };
type Plan = { at: number; pick: boolean; picked: Picked };
type Crawl = { sesh: string | null; stops: CrawlStop[]; key: string; off: boolean };

// Planned seshes (migration 0025) start later. Until then they only show under "Planned", never as tonight's.
function isPlanned(s: SeshT | null | undefined): boolean {
  return !!(s && s.planned && s.starts_at && new Date(s.starts_at).getTime() > Date.now());
}
function lower(when: string): string { return when.replace(/^(Today|Tomorrow)/, (w) => w.toLowerCase()); }

export default function Sesh({ f, onOpenWeb, onVenue }: { f: Frendzy; onOpenWeb: (tab: string) => void; onVenue: (id: string) => void }) {
  const me = f.state && f.state.me;
  const seshes = (f.state && f.state.seshes) || [];
  const friends = (f.state && f.state.friends) || [];
  const v = useVenues();

  const [seshId, setSeshId] = useState<string | null>(null);
  const [picker, setPicker] = useState<Picker | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [presEdit, setPresEdit] = useState<string | null>(null);
  const [presAddress, setPresAddress] = useState('');
  const [presMin, setPresMin] = useState<number | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [crawl, setCrawl] = useState<Crawl>({ sesh: null, stops: [], key: '', off: false });
  const scroll = useRef<ScrollView>(null);

  // The sesh this tab shows: one opened from the Planned list, or else the one you're in tonight.
  const live = seshes.filter((s) => s.am_member && !isPlanned(s))[0] || null;
  const mine = (seshId && seshes.filter((s) => s.am_member && s.id === seshId)[0]) || live;
  const mineId = mine ? mine.id : null;
  const top = () => scroll.current?.scrollTo({ y: 0, animated: false });

  /* ---------- the Sesh Map's stops, read with every refresh as the web app does ---------- */
  useEffect(() => {
    if (!mineId || crawl.off) {
      if (crawl.key) setCrawl((c) => ({ ...c, sesh: null, stops: [], key: '' }));
      return;
    }
    let gone = false;
    seshCrawl(mineId).then((list) => {
      if (gone) return;
      const key = mineId + JSON.stringify(list);
      setCrawl((c) => (c.key === key ? c : { sesh: mineId, stops: list, key, off: false }));
    }, (e: ApiError) => { if (!gone && e.missing) setCrawl({ sesh: null, stops: [], key: '', off: true }); });
    return () => { gone = true; };
    // f.state is a new object after every read, so this follows the five-second refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mineId, f.state, crawl.off]);
  const stops = mine && crawl.sesh === mine.id ? crawl.stops : [];
  const crawlRun = (fn: string, venue: string, extra: Record<string, unknown>, okMsg?: string) => {
    if (!mine) return;
    const id = mine.id;
    f.act(fn, { p_sesh: id, p_venue: venue, ...extra }, okMsg).then((list) => {
      if (Array.isArray(list)) setCrawl({ sesh: id, stops: list, key: id + JSON.stringify(list), off: false });
    });
  };

  if (!me) return null;
  if (picker) {
    return (
      <Frame f={f} onOpenWeb={onOpenWeb} scroll={scroll}>
        <PickerView
          picker={picker}
          friends={friends}
          mine={mine}
          photos={f.photos}
          onPick={(id) => setPicker((p) => (p ? { ...p, picked: toggle(p.picked, id) } : p))}
          onCancel={() => { setPicker(null); top(); }}
          onGo={() => {
            const ids = Object.keys(picker.picked);
            if (!ids.length) return;
            const done = (r: unknown) => { if (r) { setPicker(null); top(); } };
            if (picker.mode === 'invite' && mine) f.act('invite_to_sesh', { p_sesh: mine.id, p_friends: ids }, 'Invited. They can see the sesh now.').then(done);
            else f.act('start_private_sesh', { p_friends: ids }, 'Private sesh started. Only the friends you picked can see it.').then(done);
          }}
        />
      </Frame>
    );
  }
  if (plan) {
    return (
      <Frame f={f} onOpenWeb={onOpenWeb} scroll={scroll}>
        <PlanView
          plan={plan}
          friends={friends}
          photos={f.photos}
          onChange={setPlan}
          onCancel={() => { setPlan(null); top(); }}
          onGo={() => {
            const ids = Object.keys(plan.picked);
            if (plan.pick && !ids.length) return;
            f.act('plan_sesh', { p_at: new Date(plan.at).toISOString(), p_friends: plan.pick ? ids : null },
              plan.pick ? 'Planned. Only the friends you picked can see it.' : "Planned. Your friends can see it and say they're in.").then((r) => {
              if (r) { setPlan(null); setSeshId(r.id); top(); }
            });
          }}
        />
      </Frame>
    );
  }

  const startPlan = () => {   // starts at the next half hour, at least an hour from now
    const t = new Date(Date.now() + 3600000);
    t.setMinutes(t.getMinutes() < 30 ? 30 : 60, 0, 0);
    setPlan({ at: t.getTime(), pick: false, picked: {} });
    top();
  };
  const planned = (
    <PlannedList
      seshes={seshes}
      skipId={mine ? mine.id : null}
      canPlan={me.colour !== 'off'}
      v={v}
      onOpen={(id) => { setSeshId(id); top(); }}
      onJoin={(id) => f.act('join_sesh', { p_sesh: id }, "You're in. It goes live at the planned time.")}
      onPlan={startPlan}
    />
  );
  const goGreen = () => { f.setColour('on'); onOpenWeb('home'); };

  /* ---------- not in a sesh: join one or start one ---------- */
  if (!mine) {
    const others = seshes.filter((s) => !s.am_member && !isPlanned(s));
    return (
      <Frame f={f} onOpenWeb={onOpenWeb} scroll={scroll}>
        <SeshHeader s={null} later={false} startMs={0} creator="" onBack={() => {}} onStarted={f.refresh} />
        {others.length ? (
          <View style={styles.stack}>
            {others.map((s) => (
              <View key={s.id} style={styles.card}>
                <View style={[styles.row, styles.between]}>
                  <View style={styles.grow}>
                    <Text style={styles.title}>{first(s.creator_name)}'s sesh</Text>
                    {s.private ? <IconLine icon="lock" colour={C.accent} text="Private, you're invited" /> : null}
                    <Text style={[styles.muted, styles.small]}>
                      {s.members.length} in{s.locked_venue && v.byId[s.locked_venue] ? ', going to ' + v.byId[s.locked_venue].name : ', still choosing where'}
                    </Text>
                  </View>
                  <Button small label="Join" onPress={() => f.act('join_sesh', { p_sesh: s.id }, "You're in.")} />
                </View>
              </View>
            ))}
          </View>
        ) : null}
        {me.colour === 'on' ? (
          <>
            <Text style={styles.muted}>{others.length ? 'Or start your own.' : 'Nobody has started one yet. Start a sesh and your friends on green or amber can join and vote on where to go.'}</Text>
            <Button label="Start a sesh" ghost={!!others.length} onPress={() => f.act('start_sesh', {}, 'Sesh started. Friends who are around can join.').then(top)} />
            <Button label="Start a private sesh" icon="lock" ghost onPress={() => { setPicker({ mode: 'start', picked: {} }); top(); }} />
          </>
        ) : me.colour === 'thinking' ? (
          <>
            <Text style={styles.muted}>{others.length ? 'Go green to start your own.' : 'No sesh yet. Go green to start one.'}</Text>
            <Button label="Go green" colour={C.on} ink onPress={goGreen} />
          </>
        ) : (
          <>
            <Text style={styles.muted}>You're red, so seshes are hidden. Go green to start one or see your friends' plans.</Text>
            <Button label="Go green" colour={C.on} ink onPress={goGreen} />
          </>
        )}
        {planned}
      </Frame>
    );
  }

  /* ---------- in a sesh ---------- */
  const later = isPlanned(mine);
  const startMs = later && mine.starts_at ? new Date(mine.starts_at).getTime() : 0;
  const creator = first(mine.creator_name);
  const asked = (mine.invited || []).length;

  return (
    <Frame f={f} onOpenWeb={onOpenWeb} scroll={scroll}>
      <SeshHeader
        s={mine}
        later={later}
        startMs={startMs}
        creator={creator}
        onBack={() => { setSeshId(null); top(); }}
        onStarted={f.refresh}
      />
      <Members s={mine} myId={me.id} photos={f.photos} />

      <PresCard
        s={mine}
        editing={presEdit === mine.id}
        address={presAddress}
        minute={presMin}
        onAddress={setPresAddress}
        onMinute={setPresMin}
        onEdit={() => {
          const p = mine.pres, at = p && p.at ? new Date(p.at) : null;
          setPresAddress((p && p.address) || '');
          setPresMin(at ? at.getHours() * 60 + at.getMinutes() : null);
          setPresEdit(mine.id);
        }}
        onCancel={() => setPresEdit(null)}
        onRemove={() => f.act('set_sesh_pres', { p_sesh: mine.id, p_address: '', p_at: null }, 'Pres address removed.').then((r) => { if (r) setPresEdit(null); })}
        onSave={() => {
          if (!presAddress.trim()) { f.say('Type the address first.'); return; }
          let at: string | null = null;
          if (presMin !== null && mine.starts_at) {   // that time on the day of the sesh, or the evening before for a sesh after midnight
            const start = new Date(mine.starts_at), d = new Date(start);
            d.setHours(Math.floor(presMin / 60), presMin % 60, 0, 0);
            if (d > start) d.setDate(d.getDate() - 1);
            at = d.toISOString();
          }
          f.act('set_sesh_pres', { p_sesh: mine.id, p_address: presAddress.trim(), p_at: at }, 'Pres address saved. Only the people in the sesh can see it.')
            .then((r) => { if (r) setPresEdit(null); });
        }}
      />

      {mine.private ? (
        <View style={styles.card}>
          <View style={[styles.row, styles.between]}>
            <View style={styles.grow}>
              <IconLine icon="lock" colour={C.fg} text="Private sesh" bold />
              <Text style={[styles.muted, styles.small]}>
                {mine.mine ? 'Only you and the ' + asked + ' friend' + (asked === 1 ? '' : 's') + ' you picked can see it.' : 'Only the friends ' + creator + ' picked can see it.'}
              </Text>
            </View>
            {mine.mine ? <Button small ghost label="Invite" onPress={() => { setPicker({ mode: 'invite', picked: {} }); top(); }} /> : null}
          </View>
        </View>
      ) : null}

      {mine.locked_venue ? (
        <LockedCard id={mine.locked_venue} v={v} onVenue={onVenue} />
      ) : (
        <VoteSection
          s={mine}
          myId={me.id}
          v={v}
          onVote={(venue) => {
            const current = (mine.votes.filter((x) => x.user_id === me.id)[0] || { venue_id: null }).venue_id;
            f.act('cast_vote', { p_sesh: mine.id, p_venue: current === venue ? null : venue });
          }}
          onMap={() => onOpenWeb('map')}
          onLock={() => f.act('lock_sesh', { p_sesh: mine.id }, 'Locked in.').then(top)}
        />
      )}

      {crawl.off ? null : (
        <CrawlSection
          s={mine}
          stops={stops}
          v={v}
          onMap={() => onOpenWeb('map')}
          onVenue={onVenue}
          onRun={crawlRun}
        />
      )}

      <Chat f={f} seshId={mine.id} myId={me.id} confirm={confirm} setConfirm={setConfirm} />

      {later ? (
        mine.mine ? (
          <>
            <Button label="Start it now" onPress={() => f.act('start_planned_sesh', { p_sesh: mine.id }, "Sesh started. It's live now.").then((r) => { if (r) { setSeshId(null); top(); } })} />
            <Button label="Cancel the sesh" ghost onPress={() => { setSeshId(null); f.act('end_sesh', { p_sesh: mine.id }, 'Planned sesh cancelled.'); }} />
          </>
        ) : (
          <Button label="Can't make it" ghost onPress={() => { setSeshId(null); f.act('leave_sesh', { p_sesh: mine.id }); }} />
        )
      ) : (
        <>
          {mine.mine
            ? <Button label="End the sesh" ghost onPress={() => { setSeshId(null); f.act('end_sesh', { p_sesh: mine.id }, 'Sesh ended.'); }} />
            : <Button label="Leave the sesh" ghost onPress={() => { setSeshId(null); f.act('leave_sesh', { p_sesh: mine.id }); }} />}
          {planned}
        </>
      )}
    </Frame>
  );
}

function toggle(picked: Picked, id: string): Picked {
  const next = { ...picked };
  if (next[id]) delete next[id]; else next[id] = true;
  return next;
}

/* ---------- the top of the Sesh tab, and who's in ----------
   Kept as their own pieces so the header can later carry more about the sesh, and each member row can later
   carry more about that person, without touching the rest of the screen. */
function SeshHeader({ s, later, startMs, creator, onBack, onStarted }: {
  s: SeshT | null; later: boolean; startMs: number; creator: string; onBack: () => void; onStarted: () => void;
}) {
  if (s && later) {
    return (
      <>
        <Pressable style={styles.linkRow} onPress={onBack} accessibilityRole="button" accessibilityLabel="All seshes">
          <Icon name="back" size={16} colour={C.muted} /><Text style={styles.linkText}>All seshes</Text>
        </Pressable>
        <View style={styles.head}>
          <View style={styles.iconLine}>
            <Icon name="clock" size={14} colour={C.thinking} />
            <Text style={[styles.eyebrow, { color: C.thinking }]}>
              Planned{startMs - Date.now() < DAY ? <Text>, starts in <Countdown until={startMs} onDone={onStarted} /></Text> : null}
            </Text>
          </View>
          <Text style={styles.h1}>{fmtWhen(s.starts_at)}</Text>
          <Text style={[styles.muted, styles.small]}>{s.mine ? 'Your sesh' : creator + "'s sesh"}. It goes live at this time and is deleted 8 hours after, with the votes and chat.</Text>
        </View>
      </>
    );
  }
  return (
    <View style={styles.head}>
      <Text style={[styles.eyebrow, { color: C.on }]}>{s ? 'Live now' : 'Tonight'}</Text>
      <Text style={styles.h1}>Tonight's sesh</Text>
    </View>
  );
}

function Members({ s, myId, photos }: { s: SeshT; myId: string; photos: Record<string, string> }) {
  return (
    <View style={styles.card}>
      <View style={styles.avatars}>
        {s.members.map((m) => <MemberFace key={m.id} m={m} photos={photos} />)}
      </View>
      <View>
        <Text style={styles.strongText}>{s.members.length} in</Text>
        <Text style={[styles.muted, styles.small]}>{s.members.map((m) => (m.id === myId ? 'You' : first(m.name))).join(', ')}</Text>
      </View>
    </View>
  );
}

// One person in the sesh.
function MemberFace({ m, photos }: { m: Member; photos: Record<string, string> }) {
  return <Avatar id={m.id} name={m.name || '?'} photos={photos} ring={C.on} />;
}

/* ---------- the page around every Sesh view: header, glow, scrolling body, toast ---------- */
function Frame({ f, onOpenWeb, scroll, children }: { f: Frendzy; onOpenWeb: (tab: string) => void; scroll: React.RefObject<ScrollView | null>; children: React.ReactNode }) {
  const me = f.state && f.state.me;
  return (
    <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <TopBar f={f} onOpenWeb={onOpenWeb} />
      <ScrollView ref={scroll} style={styles.fill} contentContainerStyle={styles.view} keyboardShouldPersistTaps="handled">
        {children}
      </ScrollView>
      <Toast text={f.toast} />
    </KeyboardAvoidingView>
  );
}

function IconLine({ icon, colour, text, bold, eyebrow }: { icon: string; colour: string; text: string; bold?: boolean; eyebrow?: boolean }) {
  return (
    <View style={styles.iconLine}>
      <Icon name={icon} size={bold ? 14 : 12} colour={colour} />
      <Text style={eyebrow ? styles.eyebrow : bold ? styles.strongText : [styles.small, { color: colour, fontFamily: F.body }]}>{text}</Text>
    </View>
  );
}

// "starts in 02:13" — counted down every second; when it reaches nothing, everything is read again.
function Countdown({ until, onDone }: { until: number; onDone: () => void }) {
  const [left, setLeft] = useState(until - Date.now());
  useEffect(() => {
    const t = setInterval(() => {
      const l = until - Date.now();
      setLeft(l);
      if (l <= 0) { clearInterval(t); onDone(); }
    }, 1000);
    return () => clearInterval(t);
  }, [until, onDone]);
  return <Text>{fmtLeft(left)}</Text>;
}

/* ---------- picking friends for a private sesh (pickerHtml, pickRows) ---------- */
function PickRows({ list, picked, photos, onPick }: { list: Friend[]; picked: Picked; photos: Record<string, string>; onPick: (id: string) => void }) {
  return (
    <View style={[styles.stack, { gap: 8 }]}>
      {list.map((fr) => {
        const on = !!picked[fr.id];
        return (
          <Pressable
            key={fr.id}
            style={[styles.card, styles.pickRow, on && styles.picked]}
            onPress={() => onPick(fr.id)}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            accessibilityLabel={fr.name}
          >
            <Avatar id={fr.id} name={fr.name} photos={photos} ring={COLOURS[fr.colour] || C.off} />
            <View style={styles.grow}>
              <Text style={styles.strongText}>{fr.name}</Text>
              <Text style={[styles.muted, styles.small]}>{LABELS[fr.colour] || 'Red'}</Text>
            </View>
            <View style={[styles.pickBox, on && styles.pickBoxOn]}>{on ? <Icon name="tick" size={18} colour={C.accentInk} /> : null}</View>
          </Pressable>
        );
      })}
    </View>
  );
}

function PickerView({ picker, friends, mine, photos, onPick, onCancel, onGo }: {
  picker: Picker; friends: Friend[]; mine: SeshT | null; photos: Record<string, string>;
  onPick: (id: string) => void; onCancel: () => void; onGo: () => void;
}) {
  const skip: Record<string, boolean> = {};
  if (picker.mode === 'invite' && mine) {
    (mine.invited || []).forEach((id) => { skip[id] = true; });
    mine.members.forEach((m) => { skip[m.id] = true; });
  }
  const list = friends.filter((fr) => !skip[fr.id]);
  const n = Object.keys(picker.picked).length;
  const invite = picker.mode === 'invite';
  return (
    <>
      <View style={styles.head}>
        <View style={styles.iconLine}><Icon name="lock" size={14} colour={C.muted} /><Text style={styles.eyebrow}>Private sesh</Text></View>
        <Text style={styles.h1}>{invite ? 'Invite more friends' : "Who's invited?"}</Text>
        <Text style={styles.muted}>Only the friends you pick can see this sesh and join it. Your other friends won't know it's on.</Text>
      </View>
      {!list.length ? (
        <Text style={styles.muted}>{invite ? 'All your friends are already invited.' : 'Add some friends first, then you can pick who comes.'}</Text>
      ) : (
        <>
          <PickRows list={list} picked={picker.picked} photos={photos} onPick={onPick} />
          <Text style={[styles.muted, styles.small]}>Friends on red see it once they go green or amber.</Text>
        </>
      )}
      <Button
        label={invite ? (n ? 'Invite ' + n : 'Pick friends to invite') : (n ? 'Start private sesh with ' + n : 'Pick at least one friend')}
        disabled={!n}
        onPress={onGo}
      />
      <Button label="Cancel" ghost onPress={onCancel} />
    </>
  );
}

/* ---------- planning a sesh for later (planHtml) ---------- */
// A phone has no date-and-time box like the web page's, so the day and the time each step back and forward.
function PlanView({ plan, friends, photos, onChange, onCancel, onGo }: {
  plan: Plan; friends: Friend[]; photos: Record<string, string>;
  onChange: (p: Plan) => void; onCancel: () => void; onGo: () => void;
}) {
  const n = Object.keys(plan.picked).length;
  const min = Date.now() + 10 * 60000, max = Date.now() + 14 * DAY;
  const move = (ms: number) => {
    const at = Math.min(max, Math.max(min, plan.at + ms));
    // keep it on a quarter hour
    const d = new Date(at); d.setMinutes(Math.round(d.getMinutes() / 15) * 15, 0, 0);
    let t = d.getTime();
    if (t < min) t += 15 * 60000;
    if (t > max) t -= 15 * 60000;
    onChange({ ...plan, at: t });
  };
  return (
    <>
      <View style={styles.head}>
        <View style={styles.iconLine}><Icon name="clock" size={14} colour={C.muted} /><Text style={styles.eyebrow}>Plan a sesh</Text></View>
        <Text style={styles.h1}>When's it on?</Text>
        <Text style={styles.muted}>Up to 2 weeks ahead. Friends can say they're in, vote on where to go and chat about it before it starts. It goes live at this time.</Text>
      </View>
      <View style={styles.field}>
        <Text style={styles.label}>Date and time</Text>
        <View style={[styles.card, { gap: 12 }]}>
          <Text style={styles.title} accessibilityLabel={'Planned for ' + fmtWhen(plan.at)}>{fmtWhen(plan.at)}</Text>
          <Stepper label="Day" back="A day earlier" on="A day later" onBack={() => move(-DAY)} onOn={() => move(DAY)} />
          <Stepper label="Time" back="15 minutes earlier" on="15 minutes later" onBack={() => move(-15 * 60000)} onOn={() => move(15 * 60000)} />
        </View>
      </View>
      <View style={[styles.stack, { gap: 8 }]}>
        <Text style={styles.h2}>Who's it for?</Text>
        <View style={styles.row}>
          <Button small ghost={plan.pick} label="All my friends" pressed={!plan.pick} onPress={() => onChange({ ...plan, pick: false })} />
          <Button small ghost={!plan.pick} icon="lock" label="Pick friends" pressed={plan.pick} onPress={() => onChange({ ...plan, pick: true })} />
        </View>
        {plan.pick ? (
          friends.length ? (
            <>
              <Text style={[styles.muted, styles.small]}>Only the friends you pick can see it and join. Friends on red see it once they go green or amber.</Text>
              <PickRows list={friends} picked={plan.picked} photos={photos} onPick={(id) => onChange({ ...plan, picked: toggle(plan.picked, id) })} />
            </>
          ) : <Text style={[styles.muted, styles.small]}>Add some friends first, then you can pick who comes.</Text>
        ) : <Text style={[styles.muted, styles.small]}>Your friends on green or amber can see it and join.</Text>}
      </View>
      <Button label={plan.pick ? (n ? 'Plan it with ' + n : 'Pick at least one friend') : 'Plan it'} disabled={plan.pick && !n} onPress={onGo} />
      <Button label="Cancel" ghost onPress={onCancel} />
    </>
  );
}

function Stepper({ label, back, on, onBack, onOn }: { label: string; back: string; on: string; onBack: () => void; onOn: () => void }) {
  return (
    <View style={[styles.row, styles.between]}>
      <Text style={[styles.muted, styles.small]}>{label}</Text>
      <View style={[styles.row, { gap: 8 }]}>
        <Round icon="back" label={back} onPress={onBack} />
        <Round icon="back" flip label={on} onPress={onOn} />
      </View>
    </View>
  );
}

// The web app's round .back buttons (the crawl's tools, the steppers).
function Round({ icon, label, onPress, disabled, pressed, flip, size }: { icon: string; label: string; onPress: () => void; disabled?: boolean; pressed?: boolean; flip?: boolean; size?: number }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled, ...(pressed === undefined ? {} : { selected: pressed }) }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.round, pressed && styles.roundOn, disabled && { opacity: 0.35 }]}
    >
      <View style={flip ? { transform: [{ scaleX: -1 }] } : null}>
        <Icon name={icon} size={size || 18} colour={pressed ? C.ink : C.fg} />
      </View>
    </Pressable>
  );
}

/* ---------- the Planned list (plannedHtml) ---------- */
function PlannedList({ seshes, skipId, canPlan, v, onOpen, onJoin, onPlan }: {
  seshes: SeshT[]; skipId: string | null; canPlan: boolean; v: Venues;
  onOpen: (id: string) => void; onJoin: (id: string) => void; onPlan: () => void;
}) {
  const list = seshes.filter((s) => isPlanned(s) && s.id !== skipId)
    .sort((a, b) => new Date(a.starts_at || 0).getTime() - new Date(b.starts_at || 0).getTime());
  if (!list.length && !canPlan) return null;
  return (
    <View style={[styles.stack, styles.plannedBox]}>
      <Text style={styles.h2}>Planned</Text>
      {list.map((s) => (
        <View key={s.id} style={styles.card}>
          <View style={[styles.row, styles.between]}>
            <View style={styles.grow}>
              <Text style={[styles.eyebrow, { color: C.thinking }]}>{fmtWhen(s.starts_at)}</Text>
              <Text style={styles.title}>{s.mine ? 'Your sesh' : first(s.creator_name) + "'s sesh"}</Text>
              {s.private ? <IconLine icon="lock" colour={C.accent} text={s.mine ? 'Private' : "Private, you're invited"} /> : null}
              <Text style={[styles.muted, styles.small]}>{s.members.length} in{s.locked_venue && v.byId[s.locked_venue] ? ', going to ' + v.byId[s.locked_venue].name : ''}</Text>
            </View>
            {s.am_member ? <Button small ghost label="Open" onPress={() => onOpen(s.id)} /> : <Button small label="I'm in" onPress={() => onJoin(s.id)} />}
          </View>
        </View>
      ))}
      {!list.length ? <Text style={[styles.muted, styles.small]}>Nothing planned yet. Plan a sesh for later and your friends can say they're in.</Text> : null}
      {canPlan ? <Button ghost icon="clock" label="Plan a sesh for later" onPress={onPlan} /> : null}
    </View>
  );
}

/* ---------- the private pres address (presHtml) ---------- */
function PresCard({ s, editing, address, minute, onAddress, onMinute, onEdit, onCancel, onRemove, onSave }: {
  s: SeshT; editing: boolean; address: string; minute: number | null;
  onAddress: (t: string) => void; onMinute: (m: number | null) => void;
  onEdit: () => void; onCancel: () => void; onRemove: () => void; onSave: () => void;
}) {
  const p = s.pres;
  if (s.mine && editing) {
    const clock = minute === null ? '' : fmtTime(new Date(2000, 0, 1, Math.floor(minute / 60), minute % 60).getTime());
    const step = (by: number) => onMinute((((minute === null ? 19 * 60 : minute) + by) % 1440 + 1440) % 1440);
    return (
      <View style={styles.card}>
        <Text style={styles.h2}>Pres</Text>
        <View style={styles.field}>
          <Text style={styles.label}>Address</Text>
          <TextInput
            style={styles.input}
            value={address}
            onChangeText={onAddress}
            maxLength={200}
            autoComplete="off"
            placeholder="e.g. 12 Smith St, Northbridge"
            placeholderTextColor={C.muted}
            accessibilityLabel="Address"
          />
        </View>
        <View style={styles.field}>
          <Text style={styles.label}>Pres from (optional)</Text>
          <View style={[styles.row, styles.between]}>
            <Text style={styles.body}>{clock || 'No time set'}</Text>
            <View style={[styles.row, { gap: 8 }]}>
              <Round icon="back" label="15 minutes earlier" onPress={() => step(-15)} />
              <Round icon="back" flip label="15 minutes later" onPress={() => step(15)} />
              {minute !== null ? <Round icon="close" label="No time" size={16} onPress={() => onMinute(null)} /> : null}
            </View>
          </View>
        </View>
        <Text style={[styles.muted, styles.small]}>Only the people who have said they're in see it, from 4 hours before the sesh starts. It's never shown on the map, and it's deleted with the sesh.</Text>
        <View style={[styles.row, { gap: 8, flexWrap: 'wrap' }]}>
          <Button small label="Save" onPress={onSave} />
          <Button small ghost label="Cancel" onPress={onCancel} />
          {p ? <Button small ghost label="Remove" onPress={onRemove} /> : null}
        </View>
      </View>
    );
  }
  if (!p) return s.mine ? <Button ghost icon="home" label="Add a private pres address" onPress={onEdit} /> : null;
  const when = p.at ? 'From ' + fmtTime(p.at) : '';
  if (p.address) {
    const address = p.address;
    return (
      <View style={styles.card}>
        <View style={[styles.row, styles.between]}>
          <View style={styles.grow}>
            <IconLine icon="lock" colour={C.muted} text="Pres" eyebrow />
            <Text style={styles.title}>{address}</Text>
            {when ? <Text style={[styles.muted, styles.small]}>{when}</Text> : null}
          </View>
          {s.mine ? <Button small ghost label="Edit" onPress={onEdit} /> : null}
        </View>
        <View style={{ alignSelf: 'flex-start' }}>
          <Button small ghost label="Directions" onPress={() => Linking.openURL('https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(address)).catch(() => {})} />
        </View>
        <Text style={[styles.muted, styles.small]}>
          {s.mine && new Date(p.shows_at).getTime() > Date.now()
            ? 'The people who are in see it from ' + lower(fmtWhen(p.shows_at)) + '.'
            : 'Private: only the people in this sesh can see it.'}
        </Text>
      </View>
    );
  }
  return (
    <View style={styles.card}>
      <IconLine icon="lock" colour={C.muted} text="Pres" eyebrow />
      <Text style={[styles.muted, styles.small]}>{(when ? when + '. ' : '') + first(s.creator_name) + ' added a private pres address. You\'ll see it from ' + lower(fmtWhen(p.shows_at)) + '.'}</Text>
    </View>
  );
}

/* ---------- where to: the locked-in venue, or the vote ---------- */
function LockedCard({ id, v, onVenue }: { id: string; v: Venues; onVenue: (id: string) => void }) {
  const lv = v.byId[id];
  return (
    <View style={[styles.card, styles.lead]}>
      <Text style={[styles.eyebrow, { color: C.on }]}>Locked in</Text>
      <Text style={styles.h2}>{lv ? lv.name : 'A venue'}</Text>
      {lv ? (
        <>
          <Text style={[styles.muted, styles.small]}>{[lv.kind, hoursLine(lv), awayText(v, lv.id)].filter(Boolean).join(', ')}</Text>
          <Button label="See venue" onPress={() => onVenue(lv.id)} />
        </>
      ) : null}
    </View>
  );
}

function VoteSection({ s, myId, v, onVote, onMap, onLock }: { s: SeshT; myId: string; v: Venues; onVote: (venue: string) => void; onMap: () => void; onLock: () => void }) {
  const tally = leaderOf(s), total = s.votes.length;
  const myVote = (s.votes.filter((x) => x.user_id === myId)[0] || { venue_id: null }).venue_id;
  const picks = votePicks(v, tally);
  const best = tally.best && v.byId[tally.best];
  return (
    <>
      <View style={[styles.row, styles.between]}>
        <Text style={styles.h2}>Where to?</Text>
        <Text style={[styles.muted, styles.small]}>{total} vote{total === 1 ? '' : 's'} in</Text>
      </View>
      <View style={styles.stack}>
        {!picks.length ? <Text style={[styles.muted, styles.small]}>No venues within {RADIUS_KM} km yet. Find one on the map and vote for it there.</Text> : null}
        {picks.map((ven) => {
          const n = tally.by[ven.id] ? tally.by[ven.id].n : 0, isMine = myVote === ven.id, isLead = tally.best === ven.id;
          return (
            <View key={ven.id} style={[styles.card, isLead && styles.lead]}>
              <View style={[styles.row, styles.between]}>
                <View style={styles.grow}>
                  <Text style={styles.title}>{ven.name}</Text>
                  <Text style={[styles.muted, styles.small]}>{[ven.kind, hoursLine(ven), distanceAway(v, ven.id)].filter(Boolean).join(', ')}</Text>
                </View>
                <Button small ghost={!isMine} label={isMine ? 'Your vote' : 'Vote'} pressed={isMine} testID={'vote-' + ven.id} onPress={() => onVote(ven.id)} />
              </View>
              <View style={styles.row}>
                <View style={styles.bar}><View style={[styles.barFill, isLead && { backgroundColor: C.accent }, { width: `${total ? Math.round(n / total * 100) : 0}%` }]} /></View>
                <Text style={[styles.small, styles.strongText]}>{n} vote{n === 1 ? '' : 's'}</Text>
              </View>
            </View>
          );
        })}
      </View>
      <Button ghost label="Find more on the map" onPress={onMap} />
      {s.mine ? (
        best ? <Button label={'Lock in ' + best.name} onPress={onLock} /> : <Button label="Lock in once someone votes" disabled onPress={() => {}} />
      ) : (
        <Text style={[styles.muted, styles.small]}>{first(s.creator_name)} started this sesh and locks in the venue.</Text>
      )}
    </>
  );
}

/* ---------- the Sesh Map: a pub crawl (crawlHtml) ---------- */
function CrawlSection({ s, stops, v, onMap, onVenue, onRun }: {
  s: SeshT; stops: CrawlStop[]; v: Venues; onMap: () => void; onVenue: (id: string) => void;
  onRun: (fn: string, venue: string, extra: Record<string, unknown>, okMsg?: string) => void;
}) {
  const boss = !!s.mine;
  if (!stops.length) {
    return (
      <View style={[styles.stack, { gap: 12 }]}>
        <View style={[styles.row, styles.between]}><Text style={styles.h2}>Sesh Map</Text><Text style={[styles.muted, styles.small]}>Plan a crawl</Text></View>
        <Text style={[styles.muted, styles.small]}>Doing a pub crawl? Add the places you want to hit from the map. Everyone in the sesh sees the stops here, in order.</Text>
        <Button ghost label="Add stops from the map" onPress={onMap} />
      </View>
    );
  }
  const started = stops.some((c) => c.done), next = (stops.filter((c) => !c.done)[0] || { venue_id: null }).venue_id;
  let prev: { at: [number, number]; n: number } | null = null, total = 0;
  const steps: string[] = stops.map((c) => {
    const at = v.pins && v.pins[c.venue_id];
    let step = '';
    if (at && prev) { const d = km(prev.at, at); total += d; step = fmtKm(d) + ' from stop ' + prev.n; }
    if (at) prev = { at, n: c.position };
    return step;
  });
  return (
    <View style={[styles.stack, { gap: 12 }]}>
      <View style={[styles.row, styles.between]}>
        <Text style={styles.h2}>Sesh Map</Text>
        <Text style={[styles.muted, styles.small]}>{stops.length} stop{stops.length === 1 ? '' : 's'}</Text>
      </View>
      <CrawlSketch stops={stops} v={v} />
      <View style={styles.stack}>
        {stops.map((c, i) => {
          const ven = v.byId[c.venue_id], name = ven ? ven.name : 'A venue', isNext = started && c.venue_id === next;
          const meta = [ven && ven.kind, ven ? hoursLine(ven) : '', steps[i]].filter(Boolean).join(', ');
          return (
            <View key={c.venue_id} style={[styles.card, isNext && styles.lead]}>
              <View style={styles.row}>
                <StopNum n={c.position} done={c.done} />
                <Pressable style={styles.grow} onPress={() => onVenue(c.venue_id)} accessibilityRole="button" accessibilityLabel={name}>
                  {isNext ? <Text style={[styles.eyebrow, { color: C.on }]}>Next stop</Text> : null}
                  <Text style={[styles.title, c.done && styles.doneTitle]}>{name}</Text>
                  {meta ? <Text style={[styles.muted, styles.small]}>{meta}</Text> : null}
                </Pressable>
              </View>
              {boss || c.mine ? (
                <View style={[styles.row, { gap: 8, paddingLeft: 46 }]}>
                  {boss ? (
                    <>
                      <Round icon="up" label={'Move ' + name + ' earlier'} disabled={i === 0} onPress={() => onRun('crawl_move', c.venue_id, { p_step: -1 })} />
                      <Round icon="down" label={'Move ' + name + ' later'} disabled={i === stops.length - 1} onPress={() => onRun('crawl_move', c.venue_id, { p_step: 1 })} />
                      <Round icon="tick" label={(c.done ? 'Not done yet: ' : 'Done with ') + name} pressed={!!c.done} onPress={() => onRun('crawl_done', c.venue_id, { p_done: !c.done })} />
                    </>
                  ) : null}
                  <Round icon="close" size={16} label={'Remove ' + name} onPress={() => onRun('crawl_remove', c.venue_id, {}, 'Stop removed.')} />
                </View>
              ) : null}
            </View>
          );
        })}
      </View>
      {total ? <Text style={[styles.muted, styles.small]}>About {fmtKm(total)} from the first stop to the last, as the crow flies.</Text> : null}
      {stops.length < CRAWL_MAX ? <Button ghost label="Add more stops from the map" onPress={onMap} /> : null}
      {!boss ? <Text style={[styles.muted, styles.small]}>{first(s.creator_name)} started this sesh, so they set the order and tick off stops.</Text> : null}
    </View>
  );
}

function StopNum({ n, done }: { n: number; done: boolean }) {
  return (
    <View style={[styles.stopNum, done && styles.stopNumDone]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {done ? <Icon name="tick" size={16} colour={C.muted} /> : <Text style={styles.stopNumText}>{n}</Text>}
    </View>
  );
}

// The crawl's stops drawn where they are relative to each other, joined in order by a dotted line, as the
// web app draws them on its map (without the streets underneath).
function CrawlSketch({ stops, v }: { stops: CrawlStop[]; v: Venues }) {
  const [width, setWidth] = useState(0);
  const spots = stops.map((c) => ({ c, at: v.pins && v.pins[c.venue_id], ven: v.byId[c.venue_id] }))
    .filter((x): x is { c: CrawlStop; at: [number, number]; ven: typeof x.ven } => !!x.at);
  if (spots.length < 2) return null;
  const H = 200, pad = 28;
  // Flatten lat/lng to a plane (fine across a city), then fit it into the box keeping its shape.
  const lat0 = spots[0].at[0] * Math.PI / 180;
  const pts = spots.map((x) => ({ x: x.at[1] * Math.cos(lat0), y: -x.at[0] }));
  const minX = Math.min(...pts.map((p) => p.x)), maxX = Math.max(...pts.map((p) => p.x));
  const minY = Math.min(...pts.map((p) => p.y)), maxY = Math.max(...pts.map((p) => p.y));
  const W = width || 320;
  const scale = Math.min((W - pad * 2) / Math.max(maxX - minX, 1e-6), (H - pad * 2) / Math.max(maxY - minY, 1e-6));
  const ox = (W - (maxX - minX) * scale) / 2, oy = (H - (maxY - minY) * scale) / 2;
  const xy = pts.map((p) => [ox + (p.x - minX) * scale, oy + (p.y - minY) * scale]);
  return (
    <View
      style={styles.sketch}
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      accessible
      accessibilityLabel={'Sesh Map: ' + spots.map((x) => x.c.position + '. ' + (x.ven ? x.ven.name : 'A venue')).join(', ')}
    >
      <Svg width={W} height={H}>
        <Polyline points={xy.map((p) => p.join(',')).join(' ')} fill="none" stroke={C.accent} strokeWidth={5} strokeOpacity={0.9} strokeDasharray="0.1 11" strokeLinecap="round" />
        {spots.map((x, i) => (
          <React.Fragment key={x.c.venue_id}>
            <Circle cx={xy[i][0]} cy={xy[i][1]} r={15} fill={x.c.done ? '#2A2C33' : C.accent} stroke={x.c.done ? '#3A3C44' : '#0B0B0D'} strokeWidth={3} />
            {x.c.done
              ? <Path d="M4.5 12.5l5 5L19.5 7" transform={`translate(${xy[i][0] - 8} ${xy[i][1] - 8}) scale(0.667)`} stroke={C.muted} strokeWidth={3} fill="none" strokeLinecap="round" strokeLinejoin="round" />
              : <SvgText x={xy[i][0]} y={xy[i][1] + 5.5} fontSize={15} fontFamily={F.display} fill={C.accentInk} textAnchor="middle">{String(x.c.position)}</SvgText>}
          </React.Fragment>
        ))}
      </Svg>
    </View>
  );
}

/* ---------- the chat (chatHtml, chatItems, paintChat, refreshChat) ---------- */
function Chat({ f, seshId, myId, confirm, setConfirm }: { f: Frendzy; seshId: string; myId: string; confirm: string | null; setConfirm: (c: string | null) => void }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const list = useRef<ScrollView>(null);
  const key = useRef('');
  const current = useRef(seshId);
  const stick = useRef(false);
  const nearEnd = useRef(true);
  current.current = seshId;

  // Reads the chat; repaints only when the messages changed (or when asked to), as refreshChat does.
  const refresh = useCallback((force: boolean) => {
    const asked = seshId;
    return getMessages(asked).then((got) => {
      if (current.current !== asked) return;
      const k = JSON.stringify(got.map((m) => m.id));
      if (!force && k === key.current) return;
      const firstLoad = key.current === '';
      key.current = k;
      if (firstLoad || force) stick.current = true;
      setMessages(got);
    }, () => {});
  }, [seshId]);

  // The chat is asked again every couple of seconds while it's open, and waits while a tap is still running.
  useEffect(() => {
    key.current = ''; setMessages([]); nearEnd.current = true;
    refresh(false);
    const t = setInterval(() => {
      if (AppState.currentState === 'active' && !f.acting()) refresh(false);
    }, CHAT_POLL_MS);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seshId, refresh]);

  const send = () => {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    sendMessage(seshId, text).then(() => { setDraft(''); return refresh(true); })
      .catch((e: ApiError) => { f.say(e.message); })
      .then(() => setSending(false));
  };
  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentSize, contentOffset, layoutMeasurement } = e.nativeEvent;
    nearEnd.current = contentSize.height - contentOffset.y - layoutMeasurement.height < 60;
  };

  return (
    <View style={styles.stack}>
      <Text style={styles.h2}>Chat</Text>
      <Text style={[styles.muted, styles.small]}>Messages disappear when the sesh ends. Friends can still screenshot, so only send what you're happy for them to keep.</Text>
      <ScrollView
        ref={list}
        style={styles.chat}
        contentContainerStyle={styles.chatInner}
        nestedScrollEnabled
        onScroll={onScroll}
        scrollEventThrottle={100}
        onContentSizeChange={() => {
          if (stick.current || nearEnd.current) list.current?.scrollToEnd({ animated: false });
          stick.current = false;
        }}
        accessibilityLiveRegion="polite"
        testID="chat-list"
      >
        {!messages.length ? <Text style={[styles.muted, styles.small]}>No messages yet. Say where you're heading.</Text> : null}
        {messages.map((m) => {
          const mineMsg = m.sender === myId;
          return (
            <View key={m.id} style={[styles.msgRow, mineMsg && styles.msgRowMe]}>
              {mineMsg ? null : <View style={{ marginBottom: 18 }}><Avatar id={m.sender} name={m.name} photos={f.photos} size={36} /></View>}
              <View style={styles.msgWrap}>
                {mineMsg ? null : <Text style={styles.who}>{first(m.name)}</Text>}
                <View style={[styles.msg, mineMsg ? styles.msgMe : styles.msgThem]}>
                  <Text style={[styles.msgText, mineMsg && { color: C.accentInk }]}>{m.body}</Text>
                  <Text style={[styles.when, mineMsg ? { textAlign: 'right', color: 'rgba(5, 5, 6, 0.55)' } : null]}>{fmtTime(m.at)}</Text>
                  {mineMsg ? null : confirm === 'report:' + m.id ? (
                    <View style={styles.acts}>
                      <Text style={[styles.small, styles.body]}>Report this message?</Text>
                      <LinkBtn label="Report" onPress={() => {
                        setConfirm(null);
                        reportMessage(m.id).then(() => f.say('Reported. Thanks for telling us.'), (e: ApiError) => f.say(e.message));
                      }} />
                      <LinkBtn label="Cancel" onPress={() => setConfirm(null)} />
                    </View>
                  ) : confirm === 'block:' + m.sender ? (
                    <View style={styles.acts}>
                      <Text style={[styles.small, styles.body]}>Block {first(m.name)}?</Text>
                      <LinkBtn label="Block" onPress={() => {
                        setConfirm(null);
                        f.act('block_user', { p_user: m.sender }, 'Blocked.').then(() => refresh(true));
                      }} />
                      <LinkBtn label="Cancel" onPress={() => setConfirm(null)} />
                    </View>
                  ) : (
                    <View style={styles.acts}>
                      <LinkBtn label="Report" onPress={() => setConfirm('report:' + m.id)} />
                      <LinkBtn label="Block" onPress={() => setConfirm('block:' + m.sender)} />
                    </View>
                  )}
                </View>
              </View>
            </View>
          );
        })}
      </ScrollView>
      <View style={styles.chatForm}>
        <TextInput
          style={styles.chatInput}
          value={draft}
          onChangeText={setDraft}
          maxLength={500}
          autoComplete="off"
          placeholder="Type a message..."
          placeholderTextColor={C.muted}
          accessibilityLabel="Message your mates"
          returnKeyType="send"
          onSubmitEditing={send}
          submitBehavior="submit"
        />
        <Pressable
          style={[styles.send, sending && styles.sendOff]}
          onPress={send}
          disabled={sending}
          accessibilityRole="button"
          accessibilityLabel="Send"
          accessibilityState={{ disabled: sending }}
        >
          <Icon name="send" size={22} colour={sending ? C.muted : C.accentInk} />
        </Pressable>
      </View>
    </View>
  );
}

function LinkBtn({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} style={styles.linkBtn}>
      <Text style={styles.linkBtnText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  view: { paddingHorizontal: 18, paddingTop: 20, paddingBottom: 24, gap: 20, maxWidth: 440, width: '100%', alignSelf: 'center' },
  head: { gap: 6 },
  stack: { gap: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  between: { justifyContent: 'space-between' },
  grow: { flex: 1, minWidth: 0 },
  iconLine: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  eyebrow: { fontFamily: F.bodyBold, fontSize: 12, letterSpacing: 1.4, textTransform: 'uppercase', color: C.muted },
  h1: { fontFamily: F.display, fontSize: 32, lineHeight: 35, letterSpacing: -0.5, color: C.fg },
  h2: { fontFamily: F.displayBold, fontSize: 19, letterSpacing: -0.2, color: C.fg },
  title: { fontFamily: F.bodyBold, fontSize: 17, color: C.fg },
  body: { fontFamily: F.body, fontSize: 16, color: C.fg },
  strongText: { fontFamily: F.bodyBold, fontSize: 16, color: C.fg },
  muted: { fontFamily: F.body, fontSize: 16, lineHeight: 22, color: C.muted },
  small: { fontSize: 14, lineHeight: 20 },
  card: { backgroundColor: C.surface, borderRadius: 18, paddingVertical: 14, paddingHorizontal: 16, gap: 10, borderWidth: 2, borderColor: 'transparent' },
  lead: { borderColor: C.accent },
  avatars: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  plannedBox: { paddingTop: 18, borderTopWidth: 1, borderTopColor: C.line },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', minHeight: 32 },
  linkText: { fontFamily: F.body, fontSize: 14, color: C.muted, textDecorationLine: 'underline' },
  field: { gap: 8 },
  label: { fontFamily: F.bodyMid, fontSize: 16, color: C.fg },
  input: { height: 52, borderRadius: 14, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface, paddingHorizontal: 16, color: C.fg, fontFamily: F.body, fontSize: 16 },

  pickRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  picked: { borderColor: C.accent },
  pickBox: { width: 28, height: 28, borderRadius: 8, borderWidth: 2, borderColor: C.line, alignItems: 'center', justifyContent: 'center' },
  pickBoxOn: { backgroundColor: C.accent, borderColor: C.accent },

  round: { width: 44, height: 44, borderRadius: 22, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface, alignItems: 'center', justifyContent: 'center' },
  roundOn: { backgroundColor: C.on, borderColor: C.on },

  bar: { flex: 1, height: 8, borderRadius: 4, backgroundColor: C.line, overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: 4, backgroundColor: C.muted },

  stopNum: { width: 34, height: 34, borderRadius: 17, backgroundColor: C.accent, borderWidth: 3, borderColor: '#0B0B0D', alignItems: 'center', justifyContent: 'center', shadowColor: '#fff', shadowOpacity: 0.5, shadowRadius: 7, shadowOffset: { width: 0, height: 0 } },
  stopNumDone: { backgroundColor: C.surface2, borderColor: C.line, shadowOpacity: 0 },
  stopNumText: { fontFamily: F.display, fontSize: 16, color: C.accentInk },
  doneTitle: { color: C.muted, textDecorationLine: 'line-through' },
  sketch: { height: 200, borderRadius: 18, overflow: 'hidden', borderWidth: 1, borderColor: C.line, backgroundColor: '#141B2A' },

  chat: { maxHeight: 440, minHeight: 80 },
  chatInner: { gap: 14, paddingVertical: 4 },
  msgRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 10, maxWidth: '88%' },
  msgRowMe: { alignSelf: 'flex-end' },
  msgWrap: { gap: 4, minWidth: 0, flexShrink: 1 },
  who: { fontFamily: F.body, fontSize: 14, color: C.muted, paddingLeft: 2 },
  msg: { alignSelf: 'flex-start', paddingTop: 10, paddingHorizontal: 14, paddingBottom: 7, borderRadius: 18 },
  msgThem: { backgroundColor: C.surface2, borderBottomLeftRadius: 6 },
  msgMe: { backgroundColor: C.accent, borderBottomRightRadius: 6 },
  msgText: { fontFamily: F.body, fontSize: 16, color: C.fg },
  when: { marginTop: 3, fontFamily: F.body, fontSize: 12, color: 'rgba(255, 255, 255, 0.55)' },
  acts: { flexDirection: 'row', alignItems: 'center', gap: 14, flexWrap: 'wrap' },
  linkBtn: { minHeight: 32, paddingVertical: 4, justifyContent: 'center' },
  linkBtnText: { fontFamily: F.body, fontSize: 12, color: C.muted, textDecorationLine: 'underline' },
  chatForm: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  chatInput: { flex: 1, minWidth: 0, height: 50, borderRadius: 25, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface, paddingHorizontal: 18, color: C.fg, fontFamily: F.body, fontSize: 16 },
  send: { width: 50, height: 50, borderRadius: 25, backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center' },
  sendOff: { backgroundColor: C.surface2 }
});
