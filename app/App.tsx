// SeshOn phone app: the shell that holds the state, the tabs and the current screen.
import React, { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { canRedeem, codeIsLive, effectiveStatus, leader, newCode, statusExpiry, tally, type Status } from './src/core/rules';
import { DEALS, FRIENDS, VENUES, VENUE_IDS, type Friend } from './src/data/sample';
import { DealsScreen, Home, RedeemScreen, SeshScreen, VenueScreen, Welcome, YouScreen, type Ctx, type Tab } from './src/screens';
import { initialState, loadState, saveState, type AppState } from './src/store';
import { C } from './src/theme';

type Screen = { type: 'venue'; id: string } | { type: 'redeem'; id: string } | null;

const TABS: { id: Tab; label: string }[] = [
  { id: 'home', label: 'Home' },
  { id: 'sesh', label: 'Sesh' },
  { id: 'deals', label: 'Deals' },
  { id: 'you', label: 'You' },
];

export default function App() {
  const [state, setState] = useState<AppState>(initialState);
  const [loaded, setLoaded] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [tab, setTab] = useState<Tab>('home');
  const [screen, setScreen] = useState<Screen>(null);
  const [toast, setToast] = useState('');
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scroll = useRef<ScrollView>(null);

  // Load what was saved on this phone, then keep saving every change.
  useEffect(() => {
    let alive = true;
    loadState().then((saved) => {
      if (!alive) return;
      setState(saved);
      setLoaded(true);
    });
    return () => { alive = false; };
  }, []);
  useEffect(() => { if (loaded) saveState(state); }, [state, loaded]);

  // One clock for every countdown on screen.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const say = (message: string) => {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 3200);
  };

  // An On or Thinking status that has run out becomes Off.
  useEffect(() => {
    if (!loaded || state.status === 'off') return;
    if (effectiveStatus(state.status, state.until, now) === 'off') {
      setState((p) => ({ ...p, status: 'off', until: 0, danOn: false, sesh: null }));
      say('Your status ran out, so you are off again.');
    }
  }, [now, loaded, state.status, state.until]);

  // Stand-in for a real friend responding: Dan goes On a few seconds after you do.
  useEffect(() => {
    if (state.status !== 'on' || state.danOn) return;
    const t = setTimeout(() => {
      setState((p) => (p.status === 'on' ? { ...p, danOn: true } : p));
      say('Dan just went on too.');
    }, 5000);
    return () => clearTimeout(t);
  }, [state.status, state.danOn]);

  const real = new Date(now);
  const hour = state.testClock ? 20.5 : real.getHours() + real.getMinutes() / 60;
  const today = real.toDateString();
  const friends: Friend[] = FRIENDS.map((f) => (f.id === 'dan' && state.danOn ? { ...f, status: 'on', note: 'Just went on' } : f));

  const top = () => scroll.current?.scrollTo({ y: 0, animated: false });
  const show = (next: Screen, nextTab?: Tab) => {
    setScreen(next);
    if (nextTab) setTab(nextTab);
    top();
  };

  const actions: Ctx['actions'] = {
    join: (name) => setState((p) => ({ ...p, name })),
    setStatus: (status: Status) => {
      const at = Date.now();
      setState((p) =>
        status === 'off'
          ? { ...p, status, until: 0, danOn: false, sesh: null }
          : { ...p, status, until: statusExpiry(status, at) },
      );
      if (status === 'on') say('You are on. Friends who are on have been told.');
      show(null, 'home');
    },
    startSesh: () => {
      setState((p) => ({ ...p, sesh: p.sesh || { myVote: null, locked: null } }));
      say('Sesh started. Everyone who is on can vote.');
      show(null, 'sesh');
    },
    vote: (venueId) => setState((p) => (p.sesh ? { ...p, sesh: { ...p.sesh, myVote: p.sesh.myVote === venueId ? null : venueId } } : p)),
    lock: () => {
      const all: Record<string, string | null> = { me: state.sesh ? state.sesh.myVote : null };
      for (const f of friends) if (f.status === 'on') all[f.id] = f.vote;
      const winner = leader(tally(all, VENUE_IDS), VENUE_IDS);
      setState((p) => (p.sesh ? { ...p, sesh: { ...p.sesh, locked: winner } } : p));
      say(VENUES[winner].name + ' is locked in.');
      top();
    },
    endSesh: () => { setState((p) => ({ ...p, sesh: null })); top(); },
    openVenue: (venueId) => show({ type: 'venue', id: venueId }),
    openRedeem: (dealId) => {
      const deal = DEALS.find((d) => d.id === dealId);
      if (!deal) return;
      const existing = state.codes[dealId];
      if (!canRedeem(deal, hour, existing, today).ok) return;
      if (!existing || !codeIsLive(existing, Date.now(), today)) {
        const fresh = newCode(Date.now(), Math.random());
        setState((p) => ({ ...p, codes: { ...p.codes, [dealId]: fresh } }));
      }
      show({ type: 'redeem', id: dealId });
    },
    confirmCode: (dealId) => {
      setState((p) => (p.codes[dealId] ? { ...p, codes: { ...p.codes, [dealId]: { ...p.codes[dealId], usedDay: today } } } : p));
      say('Code confirmed.');
      top();
    },
    setStars: (venueId, stars) => {
      setState((p) => {
        const mine = p.ratings[venueId] || { stars: 0, tags: [] };
        return { ...p, ratings: { ...p.ratings, [venueId]: { ...mine, stars } } };
      });
      say('Rating saved.');
    },
    toggleTag: (venueId, tag) =>
      setState((p) => {
        const mine = p.ratings[venueId] || { stars: 0, tags: [] };
        const tags = mine.tags.indexOf(tag) >= 0 ? mine.tags.filter((t) => t !== tag) : mine.tags.concat(tag);
        return { ...p, ratings: { ...p.ratings, [venueId]: { ...mine, tags } } };
      }),
    suggest: (venueId) => {
      setState((p) => (p.sesh ? { ...p, sesh: { ...p.sesh, myVote: venueId } } : p));
      show(null, 'sesh');
    },
    setTestClock: (on) => setState((p) => ({ ...p, testClock: on })),
    reset: () => { setState(initialState); show(null, 'home'); },
    goTab: (next) => show(null, next),
    back: () => {
      if (screen && screen.type === 'redeem') {
        const deal = DEALS.find((d) => d.id === screen.id);
        show(deal ? { type: 'venue', id: deal.venueId } : null);
      } else show(null);
    },
  };

  const ctx: Ctx = { state, now, hour, today, friends, actions };

  let body: React.ReactNode = null;
  if (!loaded) body = null;
  else if (!state.name) body = <Welcome ctx={ctx} />;
  else if (screen && screen.type === 'venue') body = <VenueScreen ctx={ctx} venueId={screen.id} />;
  else if (screen && screen.type === 'redeem') body = <RedeemScreen ctx={ctx} dealId={screen.id} />;
  else if (tab === 'home') body = <Home ctx={ctx} />;
  else if (tab === 'sesh') body = <SeshScreen ctx={ctx} />;
  else if (tab === 'deals') body = <DealsScreen ctx={ctx} />;
  else body = <YouScreen ctx={ctx} />;

  return (
    <View style={st.app}>
      <ScrollView contentContainerStyle={st.content} keyboardShouldPersistTaps="handled" ref={scroll} style={st.scroll}>
        {body}
      </ScrollView>
      {loaded && state.name ? (
        <View style={st.tabs}>
          {TABS.map((t) => {
            const current = tab === t.id && !screen;
            return (
              <Pressable accessibilityRole="tab" accessibilityState={{ selected: current }} key={t.id} onPress={() => actions.goTab(t.id)} style={st.tab} testID={'tab-' + t.id}>
                <View style={[st.tabMark, current ? { backgroundColor: C.fg } : null]} />
                <Text style={[st.tabText, current ? st.tabTextOn : null]}>{t.label}</Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}
      {toast ? (
        <View pointerEvents="none" style={st.toastWrap}>
          <Text style={st.toast} testID="toast">{toast}</Text>
        </View>
      ) : null}
    </View>
  );
}

const st = StyleSheet.create({
  app: { flex: 1, backgroundColor: C.bg },
  scroll: { flex: 1 },
  // The top padding keeps content clear of the phone's status bar.
  content: { paddingTop: 64, paddingBottom: 32, paddingHorizontal: 20 },
  tabs: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: C.line, backgroundColor: C.bg, paddingTop: 8, paddingBottom: 28, paddingHorizontal: 8 },
  tab: { flex: 1, minHeight: 50, alignItems: 'center', justifyContent: 'center', gap: 6 },
  tabMark: { width: 20, height: 3, borderRadius: 2, backgroundColor: 'transparent' },
  tabText: { color: C.muted, fontSize: 13, fontWeight: '500' },
  tabTextOn: { color: C.fg, fontWeight: '700' },
  toastWrap: { position: 'absolute', left: 16, right: 16, bottom: 110, alignItems: 'center' },
  toast: { backgroundColor: C.fg, color: C.ink, fontSize: 14, fontWeight: '700', paddingVertical: 12, paddingHorizontal: 18, borderRadius: 24, overflow: 'hidden', textAlign: 'center' },
});
