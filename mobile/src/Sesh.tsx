// The native Sesh tab: tonight's sesh, joining and starting one (open or private), planning one for later, the
// pres address, voting on where to go and locking it in, the Sesh Map (pub crawl), the chat, and ending or
// leaving. It shows the same things in the same words as sesh() and the pieces it uses in docs/app.js
// (pickerHtml, planHtml, plannedHtml, presHtml, votePicks, crawlHtml, chatHtml), and taps call the same
// database functions as the ACT list there.
// The two small street maps of the web Sesh tab (the route to the locked-in venue, and the crawl's map) are
// not drawn here: "See venue" opens the web venue page, which has the map, and the crawl is drawn as a
// treasure-map trail of its stops in order (TreasureMap in Crawl.tsx). A Crewzy crawl is picked when you start
// or plan a sesh (CrawlBuilder), and its stops are the same Sesh Map stops.
import { GreenRow, HomeBottom, HomeTop } from './Home';
import { useOnShow, useShownRef } from './Shown';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AppState, KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
  type NativeScrollEvent, type NativeSyntheticEvent
} from 'react-native';
import { addCrawlStops, getMessages, reportMessage, seshCrawl, sendMessage, type CrawlStop, type Friend, type Member, type Message, type Sesh as SeshT } from './api';
import { CHAT_POLL_MS, RADIUS_KM } from './config';
import { openFriend } from './FriendProfile';
import { CrawlBuilder, TreasureMap } from './Crawl';
import Icon from './Icon';
import MeetMiddle from './MeetMiddle';
import { LinearGradient } from 'expo-linear-gradient';
import { Avatar, Button, Face, Toast, TopBar } from './Parts';
import type { ApiError } from './session';
import type { Frendzy } from './useFrendzy';
import { C, COLOURS, F, LABELS, STOPS, fade, first, fmtLeft, fmtTime, fmtWhen, themed } from './theme';
import { awayText, distanceAway, fmtKm, hoursLine, km, leaderOf, useVenues, votePicks, type Venues } from './venues';

const CRAWL_MAX = 12;
const DAY = 86400000;

type Picked = Record<string, true>;
type Picker = { mode: 'start' | 'invite'; picked: Picked };
export type Plan = { at: number; pick: boolean; picked: Picked; crawl?: boolean };
type Crawl = { sesh: string | null; stops: CrawlStop[]; key: string; off: boolean };
// The part of the sesh open under its card.
type Panel = 'chat' | 'where' | 'crawl' | 'more';
type LobbyTile = { key: string; emoji: string; title: string; note: string; colours: [string, string]; onPress: () => void };

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
  // Building a Crewzy crawl: target is the planned sesh it's for, or null to start one now with the stops.
  const [make, setMake] = useState<{ target: string | null } | null>(null);
  const [panel, setPanel] = useState<Panel | null>(null);
  const [lastMsg, setLastMsg] = useState<{ sesh: string; m: Message | null } | null>(null);
  const [making, setMaking] = useState(false);
  const scroll = useRef<ScrollView>(null);
  const shownRef = useShownRef();

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
    const load = () => seshCrawl(mineId).then((list) => {
      if (gone) return;
      const key = mineId + JSON.stringify(list);
      setCrawl((c) => (c.key === key ? c : { sesh: mineId, stops: list, key, off: false }));
    }, (e: ApiError) => { if (!gone && e.missing) setCrawl({ sesh: null, stops: [], key: '', off: true }); });
    load();
    // Read again after every refresh of the database (every five seconds), as the web app does, while Home is on show.
    const stop = f.everyRead(() => { if (shownRef.current) load(); });
    return () => { gone = true; stop(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mineId, crawl.off, f.everyRead]);
  const stops = mine && crawl.sesh === mine.id ? crawl.stops : [];
  const crawlRun = (fn: string, venue: string, extra: Record<string, unknown>, okMsg?: string) => {
    if (!mine) return;
    const id = mine.id;
    f.act(fn, { p_sesh: id, p_venue: venue, ...extra }, okMsg).then((list) => {
      if (Array.isArray(list)) setCrawl({ sesh: id, stops: list, key: id + JSON.stringify(list), off: false });
    });
  };

  if (!me) return null;
  if (make) {
    const target = make.target;
    return (
      <Frame f={f} onOpenWeb={onOpenWeb} scroll={scroll}>
        <CrawlBuilder
          v={v}
          eyebrow={target ? 'Crewzy crawl, planned' : 'Crewzy crawl'}
          goLabel={target ? 'Save the trail' : 'Start the crawl'}
          busy={making}
          onCancel={() => { setMake(null); top(); }}
          onGo={(ids) => {
            if (making) return;
            setMaking(true);
            // Start the sesh (or use the planned one), then add the stops in order.
            const got: Promise<string | null> = target ? Promise.resolve(target)
              : f.act('start_sesh', {}).then((r: any) => (r && r.id ? r.id : null));
            got.then((id) => {
              if (!id) return;
              return addCrawlStops(id, ids).then((list) => {
                setCrawl({ sesh: id, stops: list, key: id + JSON.stringify(list), off: false });
                f.say(target ? 'Trail saved. Your crew can see the stops in the sesh.' : "Crawl's on. Friends who are around can join and follow the trail.");
              }, (e: ApiError) => { f.say(e.message); }).then(() => f.refresh()).then(() => { setSeshId(id); setMake(null); top(); });
            }).finally(() => setMaking(false));
          }}
        />
      </Frame>
    );
  }
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
          crawlOption
          onChange={setPlan}
          onCancel={() => { setPlan(null); top(); }}
          onGo={() => {
            const ids = Object.keys(plan.picked);
            if (plan.pick && !ids.length) return;
            f.act('plan_sesh', { p_at: new Date(plan.at).toISOString(), p_friends: plan.pick ? ids : null },
              plan.pick ? 'Planned. Only the friends you picked can see it.' : "Planned. Your friends can see it and say they're in.").then((r) => {
              if (!r) return;
              setPlan(null); setSeshId(r.id); setPanel(null);
              if (plan.crawl && !crawl.off) setMake({ target: r.id });
              top();
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
      canPlan   // planning works on any colour (migration 0033); starting a sesh now needs green
      v={v}
      onOpen={(id) => { setSeshId(id); setPanel(null); top(); }}
      onJoin={(id) => f.act('join_sesh', { p_sesh: id }, "You're in. It goes live at the planned time.")}
      onPlan={startPlan}
    />
  );

  /* ---------- not in a sesh: the party lobby. Join a friend's sesh, or start or plan your own from the tiles ---------- */
  if (!mine) {
    const others = me.colour === 'off' ? [] : seshes.filter((s) => !s.am_member && !isPlanned(s));
    const green = me.colour === 'on';
    // Starting now needs green. Tapping a "now" tile while amber or red turns you green first, as "Go green and
    // start it now" does for a planned sesh: you asked to go out, so nobody is switched without tapping.
    const goGreen = (then: () => void) => {
      if (green) { then(); return; }
      f.act('set_status', { new_colour: 'on' }, "You're green.").then((r) => { then(); });
    };
    const tiles: LobbyTile[] = [
      { key: 'now', emoji: '⚡', title: 'Go now', note: green ? 'Friends on green and amber can join' : 'Turns you green', colours: ['#FF7A45', '#E0407A'],
        onPress: () => goGreen(() => { f.act('start_sesh', {}, 'Sesh started. Friends who are around can join.').then(top); }) },
      ...(crawl.off ? [] : [{ key: 'crawl', emoji: '📍', title: 'Crewzy crawl', note: 'A few spots a short walk apart', colours: ['#21C6A4', '#2A7FD4'] as [string, string],
        onPress: () => goGreen(() => { setMake({ target: null }); top(); }) }]),
      { key: 'plan', emoji: '🗓', title: 'Plan for later', note: 'Any day in the next 2 weeks', colours: ['#5B8CFF', '#9B5BFF'], onPress: startPlan },
      { key: 'private', emoji: '🔒', title: 'Invite only', note: 'Only friends you pick see it', colours: ['#C04BD8', '#5E3BD1'],
        onPress: () => goGreen(() => { setPicker({ mode: 'start', picked: {} }); top(); }) },
      { key: 'events', emoji: '🎶', title: "What's on", note: 'Gigs and events near you', colours: ['#F5A623', '#D4572A'], onPress: () => onOpenWeb('events') },
      { key: 'crews', emoji: '🤝', title: 'Crew catch-up', note: 'See when your crews are free', colours: ['#7AA52F', '#2E8F6A'], onPress: () => onOpenWeb('crews') }
    ];
    return (
      <Frame f={f} onOpenWeb={onOpenWeb} scroll={scroll} home>
        {others.length ? (
          <View style={styles.stack}>
            <Text style={styles.h2}>Join a sesh</Text>
            {others.map((s) => (
              <View key={s.id} style={[styles.card, styles.joinCard]}>
                <View style={styles.row}>
                  <View style={styles.faceStack}>
                    {s.members.slice(0, 3).map((m, i) => (
                      <View key={m.id} style={[styles.stackFace, { borderColor: C.bg }, i ? { marginLeft: -12 } : null]}><Face id={m.id} name={m.name} photos={f.photos} size={34} font={12} /></View>
                    ))}
                  </View>
                  <View style={styles.grow}>
                    <Text style={styles.title} numberOfLines={1}>{first(s.creator_name)}'s sesh</Text>
                    {s.private ? <IconLine icon="lock" colour={C.accent} text="Private, you're invited" /> : null}
                    <Text style={[styles.muted, styles.small]} numberOfLines={1}>
                      {s.members.length} in{s.locked_venue && v.byId[s.locked_venue] ? ', at ' + v.byId[s.locked_venue].name : ', picking a spot'}
                    </Text>
                  </View>
                  <Button small label="Join" onPress={() => f.act('join_sesh', { p_sesh: s.id }, "You're in.")} />
                </View>
              </View>
            ))}
          </View>
        ) : null}
        <Lobby
          f={f}
          tiles={tiles}
          note={me.colour === 'off' ? "You're red, so tonight's seshes are hidden. You can still plan one for later." : null}
          onSeat={() => goGreen(() => { setPicker({ mode: 'start', picked: {} }); top(); })}
        />
        <GreenRow f={f} />
        {planned}
      </Frame>
    );
  }

  /* ---------- in a sesh: one card holds it, and the part you pick opens under it ---------- */
  const later = isPlanned(mine);
  const startMs = later && mine.starts_at ? new Date(mine.starts_at).getTime() : 0;
  const creator = first(mine.creator_name);
  const asked = (mine.invited || []).length;
  const isCrawl = stops.length > 1;
  const picking = !mine.locked_venue && !(mine.planned && mine.starts_at && new Date(mine.starts_at).getTime() > Date.now());
  const open: Panel = panel && (panel !== 'crawl' || !crawl.off) ? panel : later ? 'more' : mine.locked_venue ? 'chat' : 'where';
  const latest = lastMsg && lastMsg.sesh === mine.id ? lastMsg.m : null;

  return (
    <Frame f={f} onOpenWeb={onOpenWeb} scroll={scroll} home compact={!later}>
      {later ? (
        <Pressable style={styles.linkRow} onPress={() => { setSeshId(null); setPanel(null); top(); }} accessibilityRole="button" accessibilityLabel="Back to Home">
          <Icon name="back" size={16} colour={C.muted} /><Text style={styles.linkText}>Back to Home</Text>
        </Pressable>
      ) : null}

      {!later && me.colour !== 'on' ? (   // a planned sesh has gone live: ask, never switch anyone automatically
        <View style={[styles.card, styles.lead]}>
          <Text style={styles.h2}>Your sesh is on</Text>
          <Text style={[styles.muted, styles.small]}>Go green so your friends can see you're out.</Text>
          <Button label="Go green" colour={C.on} ink onPress={() => f.setColour('on')} />
        </View>
      ) : null}

      <SeshCard
        s={mine}
        later={later}
        startMs={startMs}
        creator={creator}
        isCrawl={isCrawl}
        stops={stops}
        v={v}
        myId={me.id}
        photos={f.photos}
        latest={latest}
        panel={open}
        crawlOn={!crawl.off}
        onPanel={setPanel}
        onStarted={f.refresh}
      />

      {open === 'where' ? (
        <>
          {picking ? (
            <MeetMiddle
              s={mine}
              v={v}
              myVote={(mine.votes.filter((x) => x.user_id === me.id)[0] || { venue_id: null }).venue_id}
              onVote={(venue) => f.act('cast_vote', { p_sesh: mine.id, p_venue: venue }, 'Your vote is in.')}
            />
          ) : null}
          {mine.locked_venue ? (
            <LockedCard id={mine.locked_venue} v={v} onVenue={onVenue} />
          ) : (
            <VoteSection
              s={mine}
              myId={me.id}
              v={v}
              photos={f.photos}
              onVote={(venue) => {
                const current = (mine.votes.filter((x) => x.user_id === me.id)[0] || { venue_id: null }).venue_id;
                f.act('cast_vote', { p_sesh: mine.id, p_venue: current === venue ? null : venue });
              }}
              onMap={() => onOpenWeb('map')}
              onLock={() => f.act('lock_sesh', { p_sesh: mine.id }, 'Locked in.').then(() => { setPanel('where'); top(); })}
            />
          )}
        </>
      ) : null}

      {open === 'crawl' && !crawl.off ? (
        <CrawlSection s={mine} stops={stops} v={v} onMap={() => onOpenWeb('map')} onVenue={onVenue} onRun={crawlRun} />
      ) : null}

      {/* The chat stays mounted while another part is open, so the card can show the newest line. */}
      <View style={open === 'chat' ? null : styles.hidden}>
        <Chat f={f} seshId={mine.id} myId={me.id} confirm={confirm} setConfirm={setConfirm} onLatest={(m) => setLastMsg({ sesh: mine.id, m })} />
      </View>

      {open === 'more' ? (
        <>
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
          {later ? (
            mine.mine ? (
              <>
                <Button
                  label={me.colour === 'on' ? 'Start it now' : 'Go green and start it now'}
                  onPress={() => {
                    // Starting a sesh now needs green, so tapping this switches you to green first.
                    const start = () => f.act('start_planned_sesh', { p_sesh: mine.id }, "Sesh started. It's live now.");
                    (me.colour === 'on' ? start() : f.act('set_status', { new_colour: 'on' }, "You're green.").then(start))
                      .then((r) => { if (r) { setSeshId(null); setPanel(null); top(); } });
                  }}
                />
                <Button label="Cancel the sesh" ghost onPress={() => { setSeshId(null); setPanel(null); f.act('end_sesh', { p_sesh: mine.id }, 'Planned sesh cancelled.'); }} />
              </>
            ) : (
              <Button label="Can't make it" ghost onPress={() => { setSeshId(null); setPanel(null); f.act('leave_sesh', { p_sesh: mine.id }); }} />
            )
          ) : mine.mine
            ? <Button label="End the sesh" ghost onPress={() => { setSeshId(null); setPanel(null); f.act('end_sesh', { p_sesh: mine.id }, 'Sesh ended.'); }} />
            : <Button label="Leave the sesh" ghost onPress={() => { setSeshId(null); setPanel(null); f.act('leave_sesh', { p_sesh: mine.id }); }} />}
        </>
      ) : null}

      {later ? null : <GreenRow f={f} />}
      {later ? null : planned}
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
/* ---------- the page around every Sesh view: header, glow, scrolling body, toast ---------- */
function Frame({ f, onOpenWeb, scroll, home, compact, children }: { f: Frendzy; onOpenWeb: (tab: string) => void; scroll: React.RefObject<ScrollView | null>; home?: boolean; compact?: boolean; children: React.ReactNode }) {
  const me = f.state && f.state.me;
  return (
    <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <TopBar f={f} onOpenWeb={onOpenWeb} />
      <ScrollView ref={scroll} style={styles.fill} contentContainerStyle={styles.view} keyboardShouldPersistTaps="handled">
        {home ? <HomeTop f={f} onOpenWeb={onOpenWeb} compact={compact} /> : null}
        {children}
        {home ? <HomeBottom f={f} onOpenWeb={onOpenWeb} /> : null}
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
export function PlanView({ plan, friends, photos, crawlOption, onChange, onCancel, onGo }: {
  plan: Plan; friends: Friend[]; photos: Record<string, string>; crawlOption?: boolean;
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
      {crawlOption ? (
        <View style={[styles.stack, { gap: 8 }]}>
          <Text style={styles.h2}>What kind of sesh?</Text>
          <View style={styles.row}>
            <Button small ghost={!!plan.crawl} label="A sesh" pressed={!plan.crawl} onPress={() => onChange({ ...plan, crawl: false })} />
            <Button small ghost={!plan.crawl} label="Crewzy crawl" colour={plan.crawl ? C.thinking : undefined} ink={!!plan.crawl} pressed={!!plan.crawl} onPress={() => onChange({ ...plan, crawl: true })} />
          </View>
          <Text style={[styles.muted, styles.small]}>{plan.crawl ? 'Next you pick the stops, a short walk apart. Your crew sees the trail map.' : 'Your friends vote on where to go.'}</Text>
        </View>
      ) : null}
      <Button label={plan.pick ? (n ? (plan.crawl ? 'Next: pick the stops' : 'Plan it with ' + n) : 'Pick at least one friend') : (plan.crawl ? 'Next: pick the stops' : 'Plan it')} disabled={plan.pick && !n} onPress={onGo} />
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

/* ---------- Coming up: planned seshes as a row of small cards you swipe sideways (plannedHtml) ---------- */
function PlannedList({ seshes, skipId, canPlan, v, onOpen, onJoin, onPlan }: {
  seshes: SeshT[]; skipId: string | null; canPlan: boolean; v: Venues;
  onOpen: (id: string) => void; onJoin: (id: string) => void; onPlan: () => void;
}) {
  const list = seshes.filter((s) => isPlanned(s) && s.id !== skipId)
    .sort((a, b) => new Date(a.starts_at || 0).getTime() - new Date(b.starts_at || 0).getTime());
  if (!list.length && !canPlan) return null;
  return (
    <View style={styles.stack}>
      <View style={[styles.row, styles.between]}>
        <Text style={styles.h2}>Coming up</Text>
        <Text style={[styles.muted, styles.small]}>{list.length ? list.length + ' planned' : 'Nothing yet'}</Text>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
        {list.map((s) => {
          const at = s.locked_venue && v.byId[s.locked_venue] ? v.byId[s.locked_venue].name : null;
          return (
            <Pressable key={s.id} style={styles.chip} onPress={() => (s.am_member ? onOpen(s.id) : onJoin(s.id))}
              accessibilityRole="button" accessibilityLabel={(s.am_member ? 'Open ' : "I'm in: ") + (s.mine ? 'your sesh' : first(s.creator_name) + "'s sesh") + ', ' + fmtWhen(s.starts_at)}>
              <Text style={[styles.eyebrow, { color: C.thinking }]} numberOfLines={1}>{fmtWhen(s.starts_at)}</Text>
              <Text style={styles.chipTitle} numberOfLines={1}>{s.mine ? 'Your sesh' : first(s.creator_name) + "'s sesh"}</Text>
              <Text style={[styles.muted, styles.tiny]} numberOfLines={1}>{s.private ? 'Private, ' : ''}{s.members.length} in{at ? ', ' + at : ''}</Text>
              <Text style={[styles.chipAct, s.am_member ? { color: C.on } : null]}>{s.am_member ? "You're in" : "Tap to say I'm in"}</Text>
            </Pressable>
          );
        })}
        {canPlan ? (
          <Pressable style={[styles.chip, styles.chipAdd]} onPress={onPlan} accessibilityRole="button" accessibilityLabel="Plan a sesh for later">
            <Icon name="plus" size={20} colour={C.muted} />
            <Text style={[styles.muted, styles.small]}>Plan one</Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </View>
  );
}

/* ---------- the sesh card: who's in, where, the crawl trail, the newest chat line, and the parts to open ---------- */
function SeshCard({ s, later, startMs, creator, isCrawl, stops, v, myId, photos, latest, panel, crawlOn, onPanel, onStarted }: {
  s: SeshT; later: boolean; startMs: number; creator: string; isCrawl: boolean; stops: CrawlStop[]; v: Venues; myId: string;
  photos: Record<string, string>; latest: Message | null; panel: Panel; crawlOn: boolean; onPanel: (p: Panel) => void; onStarted: () => void;
}) {
  const kind = isCrawl ? 'crawl' : 'sesh';
  const venue = s.locked_venue && v.byId[s.locked_venue] ? v.byId[s.locked_venue] : null;
  const title = venue ? venue.name : later ? fmtWhen(s.starts_at) : isCrawl ? "Tonight's crawl" : "Tonight's sesh";
  const sub = venue ? (later ? fmtWhen(s.starts_at) : [venue.kind, hoursLine(venue)].filter(Boolean).join(', '))
    : s.votes.length ? s.votes.length + ' vote' + (s.votes.length === 1 ? '' : 's') + ' on where to go' : 'Still picking a spot';
  const who = (s.mine ? 'You' : creator) + ' started it';
  const parts: [Panel, string][] = [['chat', 'Chat'], ['where', venue ? 'Where' : 'Vote'], ...(crawlOn ? [['crawl', 'Crawl'] as [Panel, string]] : []), ['more', 'More']];
  const shown = stops.slice(0, 4);
  return (
    <LinearGradient colors={[C.heroFrom, C.heroTo]} start={{ x: 0, y: 0 }} end={{ x: 0.6, y: 1 }} style={styles.seshCard} testID="sesh-card">
      <View style={[styles.row, styles.between]}>
        <View style={styles.livePill}>
          <View style={[styles.liveDot, later ? { backgroundColor: C.thinking, shadowColor: C.thinking } : null]} />
          <Text style={styles.liveText}>{later ? 'PLANNED ' + kind.toUpperCase() : 'LIVE ' + kind.toUpperCase()}</Text>
        </View>
        {later && startMs - Date.now() < DAY ? <Text style={styles.cardSmall}>Starts in <Countdown until={startMs} onDone={onStarted} /></Text>
          : s.private ? <IconLine icon="lock" colour="#fff" text="Private" /> : null}
      </View>
      <View>
        <Text style={styles.cardTitle} numberOfLines={2}>{title}</Text>
        <Text style={styles.cardSmall} numberOfLines={1}>{sub}</Text>
      </View>
      <View style={[styles.row, styles.between]}>
        <View style={styles.faceStack}>
          {s.members.slice(0, 6).map((m, i) => (
            <Pressable key={m.id} onPress={() => { if (m.id !== myId) openFriend(m.id); }} style={[styles.stackFace, { borderColor: 'rgba(255, 255, 255, 0.9)' }, i ? { marginLeft: -10 } : null]}
              accessibilityRole="button" accessibilityLabel={m.id === myId ? 'You' : first(m.name)}>
              <Face id={m.id} name={m.name} photos={photos} size={30} font={11} />
            </Pressable>
          ))}
        </View>
        <Text style={[styles.cardSmall, styles.cardRight]} numberOfLines={1}>{s.members.length} in · {who}</Text>
      </View>
      {shown.length ? (
        <Pressable style={styles.trail} onPress={() => onPanel('crawl')} accessibilityRole="button" accessibilityLabel={'The crawl, ' + stops.length + ' stops'}>
          {shown.map((c, i) => (
            <React.Fragment key={c.venue_id}>
              {i ? <View style={styles.leg} /> : null}
              <View style={styles.trailStop}>
                <View style={[styles.trailDot, c.done && styles.trailDone]}>
                  {c.done ? <Icon name="tick" size={11} weight={3} colour="#04210F" /> : <Text style={styles.trailNum}>{c.position}</Text>}
                </View>
                <Text style={styles.trailName} numberOfLines={1}>{v.byId[c.venue_id] ? v.byId[c.venue_id].name : 'A venue'}</Text>
              </View>
            </React.Fragment>
          ))}
          {stops.length > shown.length ? <Text style={styles.trailMore}>+{stops.length - shown.length}</Text> : null}
        </Pressable>
      ) : null}
      <Pressable style={styles.peek} onPress={() => onPanel('chat')} accessibilityRole="button" accessibilityLabel="Open the sesh chat">
        {latest ? (
          <View style={styles.row}>
            <Face id={latest.sender} name={latest.name} photos={photos} size={22} font={9} />
            <Text style={styles.peekText} numberOfLines={1}><Text style={styles.peekWho}>{latest.sender === myId ? 'You' : first(latest.name)}</Text> {latest.body}</Text>
          </View>
        ) : <Text style={styles.peekMuted} numberOfLines={1}>No messages yet. Say where you're heading.</Text>}
        <View style={[styles.row, styles.between]}>
          <Text style={styles.peekMuted}>Reply to the {kind}...</Text>
          <Icon name="send" size={15} colour="#111114" />
        </View>
      </Pressable>
      <View style={styles.seg}>
        {parts.map(([k, label]) => (
          <Pressable key={k} style={[styles.segBtn, panel === k && styles.segOn]} onPress={() => onPanel(k)}
            accessibilityRole="tab" accessibilityLabel={label} accessibilityState={{ selected: panel === k }} testID={'sesh-' + k}>
            <Text style={[styles.segText, panel === k && styles.segTextOn]} numberOfLines={1}>{label}</Text>
          </Pressable>
        ))}
      </View>
    </LinearGradient>
  );
}

/* ---------- the party lobby: your seat, empty seats to fill, and big tiles to start or plan something ---------- */
function Lobby({ f, tiles, note, onSeat }: { f: Frendzy; tiles: LobbyTile[]; note: string | null; onSeat: () => void }) {
  const me = f.state && f.state.me;
  if (!me) return null;
  const greens = (f.state ? f.state.friends : []).filter((x) => x.colour === 'on');
  return (
    <View style={[styles.party, { borderColor: fade(COLOURS[me.colour], 0.6), shadowColor: COLOURS[me.colour] }]}>
      <View style={{ gap: 4 }}>
        <Text style={[styles.eyebrow, { color: COLOURS[me.colour] }]}>Start a party</Text>
        <Text style={styles.partyTitle}>{greens.length ? greens.length + ' friend' + (greens.length === 1 ? ' is' : 's are') + ' keen. What\'s the move?' : "What's the move?"}</Text>
        <Text style={[styles.muted, styles.tiny]}>Hosting earns XP for each friend who joins.</Text>
      </View>
      <View style={styles.seats}>
        <View style={styles.seat}>
          <View style={[styles.seatRing, { borderColor: COLOURS[me.colour] }]}><Face id={me.id} name={me.name} photos={f.photos} size={40} font={14} /></View>
          <Text style={styles.seatName}>You</Text>
        </View>
        {[0, 1, 2, 3].map((i) => (
          <Pressable key={i} style={styles.seat} onPress={onSeat} accessibilityRole="button" accessibilityLabel="Pick friends for a private sesh">
            <View style={styles.seatEmpty}><Icon name="plus" size={18} colour={C.muted} /></View>
            <Text style={[styles.seatName, { color: C.muted }]}>Invite</Text>
          </Pressable>
        ))}
      </View>
      {note ? <Text style={[styles.muted, styles.small]}>{note}</Text> : null}
      <View style={styles.tiles}>
        {tiles.map((t) => (
          <Pressable key={t.key} style={({ pressed }) => [styles.tileWrap, pressed && { transform: [{ scale: 0.97 }] }]} onPress={t.onPress}
            accessibilityRole="button" accessibilityLabel={t.title + '. ' + t.note} testID={'lobby-' + t.key}>
            <LinearGradient colors={t.colours} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.tile}>
              <Text style={styles.tileEmoji}>{t.emoji}</Text>
              <View>
                <Text style={styles.tileTitle} numberOfLines={1}>{t.title}</Text>
                <Text style={styles.tileNote} numberOfLines={2}>{t.note}</Text>
              </View>
            </LinearGradient>
          </Pressable>
        ))}
      </View>
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

function VoteSection({ s, myId, v, photos, onVote, onMap, onLock }: {
  s: SeshT; myId: string; v: Venues; photos: Record<string, string>; onVote: (venue: string) => void; onMap: () => void; onLock: () => void;
}) {
  const tally = leaderOf(s), total = s.votes.length;
  const myVote = (s.votes.filter((x) => x.user_id === myId)[0] || { venue_id: null }).venue_id;
  const picks = votePicks(v, tally);
  const best = tally.best && v.byId[tally.best];
  // The card on top, kept by venue so it stays put when votes move the list around.
  const [cur, setCur] = useState<string | null>(null);
  const found = picks.findIndex((x) => x.id === cur);
  const index = found >= 0 ? found : 0;
  const ven = picks[index];
  const n = ven && tally.by[ven.id] ? tally.by[ven.id].n : 0, isMine = !!ven && myVote === ven.id, isLead = !!ven && tally.best === ven.id;
  const voters = ven ? s.votes.filter((x) => x.venue_id === ven.id).map((x) => s.members.filter((m) => m.id === x.user_id)[0]).filter(Boolean) as Member[] : [];
  return (
    <>
      <View style={[styles.row, styles.between]}>
        <Text style={styles.h2}>Where to?</Text>
        <Text style={[styles.muted, styles.small]}>{total} vote{total === 1 ? '' : 's'} in</Text>
      </View>
      {!picks.length ? <Text style={[styles.muted, styles.small]}>No venues within {RADIUS_KM} km yet. Find one on the map and vote for it there.</Text> : null}
      {ven ? (
        <>
          {/* One place at a time, like a stack of cards: tick to vote for it, cross to see the next one. */}
          <View style={styles.spotStack}>
            <View style={[styles.spotBack, styles.spotBack2]} />
            <View style={[styles.spotBack, styles.spotBack1]} />
            <LinearGradient colors={[C.heroFrom, C.heroTo]} start={{ x: 0, y: 0 }} end={{ x: 0.4, y: 1 }} style={[styles.spot, isLead && styles.spotLead]} testID={'spot-' + ven.id}>
              <View style={[styles.row, styles.between]}>
                <Text style={styles.spotCount}>{index + 1} of {picks.length}</Text>
                <View style={styles.row}>
                  {voters.map((m, i) => (
                    <View key={m.id} style={[styles.spotFace, i ? { marginLeft: -12 } : null]}>
                      <Face id={m.id} name={m.name} photos={photos} size={34} font={12} />
                    </View>
                  ))}
                </View>
              </View>
              <View style={styles.spotArt}><Icon name="venues" size={72} colour="rgba(255, 255, 255, 0.35)" /></View>
              <View>
                {isMine ? <Text style={styles.spotMine}>Your vote</Text> : null}
                <Text style={styles.spotName}>{ven.name}</Text>
                <Text style={styles.spotInfo}>{[ven.kind, hoursLine(ven), distanceAway(v, ven.id)].filter(Boolean).join(', ')}</Text>
                <Text style={styles.spotInfo}>{n} vote{n === 1 ? '' : 's'}{isLead ? ', in the lead' : ''}</Text>
              </View>
            </LinearGradient>
          </View>
          <View style={[styles.row, styles.spotButtons]}>
            <Pressable style={[styles.spotBtn, styles.spotNo]} onPress={() => setCur(picks[(index + 1) % picks.length].id)}
              accessibilityRole="button" accessibilityLabel="Next place" testID={'skip-' + ven.id}>
              <Icon name="cross" size={26} weight={3} colour={C.off} />
            </Pressable>
            <Pressable style={[styles.spotBtn, styles.spotYes, isMine && styles.spotYesOn]} onPress={() => onVote(ven.id)}
              accessibilityRole="button" accessibilityLabel={isMine ? 'Your vote' : 'Vote for ' + ven.name} accessibilityState={{ selected: isMine }} testID={'vote-' + ven.id}>
              <Icon name="tick" size={28} weight={3} colour="#04210F" />
            </Pressable>
          </View>
          <Text style={[styles.muted, styles.small, styles.center]}>
            {best ? 'Leading: ' : 'No votes yet. Tick the place you want to go.'}
            {best ? <Text style={styles.strongText}>{best.name}</Text> : null}
            {best ? ', ' + (tally.by[best.id] ? tally.by[best.id].n : 0) + ' of ' + s.members.length + ' picked it' : ''}
          </Text>
        </>
      ) : null}
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
        <Text style={[styles.muted, styles.small]}>Making it a Crewzy crawl? Add a few stops a short walk apart from the map. Everyone in the sesh sees the trail here, in order.</Text>
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
      <TreasureMap stops={stops.map((c) => ({ id: c.venue_id, n: c.position, name: v.byId[c.venue_id] ? v.byId[c.venue_id].name : 'A venue', done: !!c.done }))} v={v} />
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

/* ---------- the chat (chatHtml, chatItems, paintChat, refreshChat) ---------- */
function Chat({ f, seshId, myId, confirm, setConfirm, onLatest }: { f: Frendzy; seshId: string; myId: string; confirm: string | null; setConfirm: (c: string | null) => void; onLatest?: (m: Message | null) => void }) {
  const latestCb = useRef(onLatest);
  latestCb.current = onLatest;
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
      if (latestCb.current) latestCb.current(got.length ? got[got.length - 1] : null);
    }, () => {});
  }, [seshId]);

  // The chat is asked again every couple of seconds while it's open, and waits while a tap is still running
  // or while Home is hidden behind another tab (it is read straight away when you come back).
  const shown = useShownRef();
  useOnShow(() => { refresh(false); });
  useEffect(() => {
    key.current = ''; setMessages([]); nearEnd.current = true;
    refresh(false);
    const t = setInterval(() => {
      if (AppState.currentState === 'active' && shown.current && !f.acting()) refresh(false);
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
                  <Text style={[styles.when, mineMsg ? { textAlign: 'right', color: C.mineWhen } : null]}>{fmtTime(m.at)}</Text>
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

const styles = themed(() => StyleSheet.create({
  // Your people
  person: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderWidth: 1, borderColor: C.line },
  personRing: { borderWidth: 3, borderRadius: 30, padding: 2 },
  // Pick the spot: the stack of venue cards
  spotStack: { height: 360, marginHorizontal: 8, marginTop: 4 },
  spotBack: { position: 'absolute', top: 14, bottom: -8, left: 18, right: 18, borderRadius: 28, backgroundColor: C.surface2, borderWidth: 1, borderColor: C.line },
  spotBack1: { transform: [{ rotate: '-3deg' }] },
  spotBack2: { transform: [{ rotate: '4deg' }], left: 28, right: 28 },
  spot: { flex: 1, borderRadius: 28, padding: 18, justifyContent: 'space-between', overflow: 'hidden' },
  spotLead: { borderWidth: 2, borderColor: C.on },
  spotCount: { fontFamily: F.bodyBold, fontSize: 12, color: '#fff', backgroundColor: 'rgba(0, 0, 0, 0.35)', paddingVertical: 5, paddingHorizontal: 10, borderRadius: 999, overflow: 'hidden' },
  spotFace: { borderRadius: 19, borderWidth: 2, borderColor: C.on },
  spotArt: { position: 'absolute', top: 80, left: 0, right: 0, alignItems: 'center' },
  spotMine: { alignSelf: 'flex-start', fontFamily: F.bodyBold, fontSize: 12, color: '#04210F', backgroundColor: C.on, paddingVertical: 4, paddingHorizontal: 10, borderRadius: 999, overflow: 'hidden', marginBottom: 6 },
  spotName: { fontFamily: F.display, fontSize: 28, lineHeight: 32, letterSpacing: -0.6, color: '#fff' },
  spotInfo: { fontFamily: F.body, fontSize: 14, lineHeight: 20, color: 'rgba(255, 255, 255, 0.88)' },
  spotButtons: { justifyContent: 'center', gap: 24, marginTop: 8 },
  spotBtn: { width: 62, height: 62, borderRadius: 31, alignItems: 'center', justifyContent: 'center' },
  spotNo: { backgroundColor: C.surface, borderWidth: 1, borderColor: C.line },
  spotYes: { backgroundColor: C.on, shadowColor: C.on, shadowOpacity: 0.6, shadowRadius: 14, shadowOffset: { width: 0, height: 0 } },
  spotYesOn: { borderWidth: 3, borderColor: C.fg },
  center: { textAlign: 'center' },
  hidden: { display: 'none' },
  tiny: { fontSize: 12, lineHeight: 16 },

  // The sesh card
  seshCard: { borderRadius: 26, padding: 16, gap: 12, overflow: 'hidden' },
  livePill: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(0, 0, 0, 0.25)', paddingVertical: 5, paddingHorizontal: 10, borderRadius: 999 },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: C.on, shadowColor: C.on, shadowOpacity: 1, shadowRadius: 6, shadowOffset: { width: 0, height: 0 } },
  liveText: { fontFamily: F.bodyBold, fontSize: 11, letterSpacing: 1.3, color: '#fff' },
  cardTitle: { fontFamily: F.display, fontSize: 28, lineHeight: 32, letterSpacing: -0.7, color: '#fff' },
  cardSmall: { fontFamily: F.bodyMid, fontSize: 13, lineHeight: 18, color: 'rgba(255, 255, 255, 0.9)' },
  cardRight: { flexShrink: 1, textAlign: 'right' },
  faceStack: { flexDirection: 'row', alignItems: 'center' },
  stackFace: { borderRadius: 20, borderWidth: 2 },
  trail: { flexDirection: 'row', alignItems: 'flex-start', backgroundColor: 'rgba(0, 0, 0, 0.2)', borderRadius: 16, paddingVertical: 10, paddingHorizontal: 10 },
  trailStop: { width: 64, alignItems: 'center', gap: 4 },
  trailDot: { width: 24, height: 24, borderRadius: 12, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  trailDone: { backgroundColor: C.on },
  trailNum: { fontFamily: F.bodyBold, fontSize: 12, color: '#B02A68' },
  trailName: { fontFamily: F.bodyMid, fontSize: 11, color: '#fff', textAlign: 'center', maxWidth: 64 },
  trailMore: { fontFamily: F.bodyBold, fontSize: 12, color: '#fff', marginTop: 4, marginLeft: 4 },
  leg: { flex: 1, height: 2, marginTop: 11, backgroundColor: 'rgba(255, 255, 255, 0.5)' },
  peek: { backgroundColor: 'rgba(255, 255, 255, 0.95)', borderRadius: 16, paddingVertical: 10, paddingHorizontal: 12, gap: 8 },
  peekText: { flex: 1, minWidth: 0, fontFamily: F.body, fontSize: 14, color: '#111114' },
  peekWho: { fontFamily: F.bodyBold },
  peekMuted: { fontFamily: F.body, fontSize: 14, color: '#6B6B73' },
  seg: { flexDirection: 'row', gap: 6 },
  segBtn: { flex: 1, minHeight: 40, borderRadius: 14, backgroundColor: 'rgba(255, 255, 255, 0.18)', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  segOn: { backgroundColor: '#fff' },
  segText: { fontFamily: F.bodyBold, fontSize: 13, color: '#fff' },
  segTextOn: { color: '#111114' },

  // Coming up
  chips: { gap: 10, paddingRight: 8 },
  chip: { width: 150, borderRadius: 18, padding: 12, gap: 3, backgroundColor: C.surface, borderWidth: 1, borderColor: C.line },
  chipTitle: { fontFamily: F.bodyBold, fontSize: 15, color: C.fg },
  chipAct: { fontFamily: F.bodyBold, fontSize: 12, color: C.muted, marginTop: 4 },
  chipAdd: { width: 110, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center', gap: 6 },

  // The party lobby
  joinCard: { borderWidth: 1.5, borderColor: fade(C.on, 0.5) },
  party: { backgroundColor: C.surface, borderRadius: 26, padding: 16, gap: 14, borderWidth: 1.5, shadowOpacity: C.dark ? 0.35 : 0.12, shadowRadius: 20, shadowOffset: { width: 0, height: 0 } },
  partyTitle: { fontFamily: F.display, fontSize: 22, lineHeight: 27, letterSpacing: -0.4, color: C.fg },
  seats: { flexDirection: 'row', justifyContent: 'space-between' },
  seat: { alignItems: 'center', gap: 4, width: 56 },
  seatRing: { borderWidth: 2.5, borderRadius: 26, padding: 2 },
  seatEmpty: { width: 48, height: 48, borderRadius: 24, borderWidth: 1.5, borderStyle: 'dashed', borderColor: C.muted, alignItems: 'center', justifyContent: 'center' },
  seatName: { fontFamily: F.bodyBold, fontSize: 12, color: C.fg },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  tileWrap: { width: '48%', flexGrow: 1 },
  tile: { borderRadius: 20, padding: 14, minHeight: 116, justifyContent: 'space-between' },
  tileEmoji: { fontSize: 26 },
  tileTitle: { fontFamily: F.displayBold, fontSize: 16, color: '#fff' },
  tileNote: { fontFamily: F.body, fontSize: 12, lineHeight: 16, color: 'rgba(255, 255, 255, 0.9)' },

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
  when: { marginTop: 3, fontFamily: F.body, fontSize: 12, color: C.whenText },
  acts: { flexDirection: 'row', alignItems: 'center', gap: 14, flexWrap: 'wrap' },
  linkBtn: { minHeight: 32, paddingVertical: 4, justifyContent: 'center' },
  linkBtnText: { fontFamily: F.body, fontSize: 12, color: C.muted, textDecorationLine: 'underline' },
  chatForm: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  chatInput: { flex: 1, minWidth: 0, height: 50, borderRadius: 25, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface, paddingHorizontal: 18, color: C.fg, fontFamily: F.body, fontSize: 16 },
  send: { width: 50, height: 50, borderRadius: 25, backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center' },
  sendOff: { backgroundColor: C.surface2 }
}));
