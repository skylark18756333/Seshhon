// Every screen of the app. Each one draws from `ctx` and calls `ctx.actions`.
import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import {
  canRedeem, codeIsLive, dealWindow, formatLeft, leader, ratingAverage, tally,
  type Deal, type Status,
} from './core/rules';
import { DEALS, DEAL_TYPES, TAGS, VENUES, VENUE_IDS, type Friend } from './data/sample';
import type { AppState } from './store';
import { C, STATUS_COLOR, STATUS_LABEL } from './theme';
import { Avatar, Body, Button, Card, Chip, Eyebrow, H1, H2, Muted, Row, s } from './ui';

export type Tab = 'home' | 'sesh' | 'deals' | 'you';

export type Ctx = {
  state: AppState;
  now: number;
  hour: number;
  today: string;
  friends: Friend[];
  actions: {
    join: (name: string) => void;
    setStatus: (status: Status) => void;
    startSesh: () => void;
    vote: (venueId: string) => void;
    lock: () => void;
    endSesh: () => void;
    openVenue: (venueId: string) => void;
    openRedeem: (dealId: string) => void;
    confirmCode: (dealId: string) => void;
    setStars: (venueId: string, stars: number) => void;
    toggleTag: (venueId: string, tag: string) => void;
    suggest: (venueId: string) => void;
    setTestClock: (on: boolean) => void;
    reset: () => void;
    goTab: (tab: Tab) => void;
    back: () => void;
  };
};

const onFriends = (ctx: Ctx) => ctx.friends.filter((f) => f.status === 'on');

function votes(ctx: Ctx): Record<string, string | null> {
  const v: Record<string, string | null> = {};
  for (const f of onFriends(ctx)) v[f.id] = f.vote;
  v.me = ctx.state.sesh ? ctx.state.sesh.myVote : null;
  return v;
}

/* ---------- Welcome ---------- */
export function Welcome({ ctx }: { ctx: Ctx }) {
  const [name, setName] = useState('');
  const [adult, setAdult] = useState(false);
  const [error, setError] = useState('');
  const submit = () => {
    if (!name.trim()) return setError('Enter your first name to continue.');
    if (!adult) return setError('SeshOn is for people aged 18 and over. Tick the box to confirm.');
    ctx.actions.join(name.trim());
  };
  return (
    <View style={{ gap: 24 }}>
      <Text style={st.wordmark}>SeshOn</Text>
      <H1>Tell your friends you're up for a sesh.</H1>
      <Muted>This is a test version. Friends, venues and deals are examples, and everything you do stays on this phone.</Muted>
      <View style={{ gap: 8 }}>
        <Body>Your first name</Body>
        <TextInput accessibilityLabel="Your first name" maxLength={24} onChangeText={setName} style={st.input} testID="name" value={name} />
      </View>
      <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: adult }} onPress={() => setAdult(!adult)} style={st.check} testID="adult">
        <View style={[st.box, adult ? { backgroundColor: C.on, borderColor: C.on } : null]}>{adult ? <Text style={st.tick}>✓</Text> : null}</View>
        <Body>I am 18 or over</Body>
      </Pressable>
      {error ? <Text style={st.error} testID="join-error">{error}</Text> : null}
      <Button label="Get started" onPress={submit} testID="join" />
    </View>
  );
}

/* ---------- Home ---------- */
const STATUS_COPY: Record<Status, [string, string]> = {
  on: ["You're on.", "Friends can see you're up for a sesh."],
  thinking: ['Thinking.', "You're browsing. Friends see you might be keen, but nobody gets pinged."],
  off: ["You're off.", "You're hidden and won't get sesh alerts until you switch back."],
};

export function Home({ ctx }: { ctx: Ctx }) {
  const { state, actions } = ctx;
  const status = state.status;
  const on = onFriends(ctx).length;
  return (
    <View style={{ gap: 20 }}>
      <Row between>
        <Text style={st.wordmark}>SeshOn</Text>
        <Text style={st.pill}>TEST VERSION</Text>
      </Row>
      <View style={{ gap: 10 }}>
        <Eyebrow>Your status</Eyebrow>
        <Text style={[st.statusWord, { color: STATUS_COLOR[status] }]} testID="status-word">{STATUS_COPY[status][0]}</Text>
        <Muted>
          {STATUS_COPY[status][1]}
          {status !== 'off' ? ' Back to off in ' + formatLeft(state.until - ctx.now) + '.' : ''}
        </Muted>
        <View style={st.switch}>
          {(['on', 'thinking', 'off'] as Status[]).map((k) => {
            const active = status === k;
            return (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                key={k}
                onPress={() => actions.setStatus(k)}
                style={[st.seg, active ? { backgroundColor: STATUS_COLOR[k], borderColor: STATUS_COLOR[k] } : null]}
                testID={'status-' + k}
              >
                <View style={[st.dot, { backgroundColor: active ? C.ink : STATUS_COLOR[k] }]} />
                <Text style={[st.segText, active ? { color: C.ink } : null]}>{STATUS_LABEL[k]}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {status === 'off' ? (
        <Card>
          <H2>Friends are hidden while you're off</H2>
          <Muted>Switch to On or Thinking to see who's up for it tonight.</Muted>
        </Card>
      ) : (
        <View style={{ gap: 4 }}>
          <Row between>
            <H2>Up for it now</H2>
            <Muted>{on + ' on, ' + (ctx.friends.length - on) + ' thinking'}</Muted>
          </Row>
          <Muted>Example friends</Muted>
          {ctx.friends.map((f) => (
            <View key={f.id} style={st.friend}>
              <Avatar color={STATUS_COLOR[f.status]} dashed={f.status === 'thinking'} name={f.name} />
              <View style={s.grow}>
                <Body>{f.name}</Body>
                <Muted>{f.note}</Muted>
              </View>
              <Text style={[st.friendState, { color: STATUS_COLOR[f.status] }]}>{STATUS_LABEL[f.status]}</Text>
            </View>
          ))}
        </View>
      )}

      {status === 'on' ? (
        <Button label={state.sesh ? "Open tonight's sesh" : 'Start a sesh'} onPress={() => (state.sesh ? actions.goTab('sesh') : actions.startSesh())} testID="go-sesh" />
      ) : null}
      {status === 'thinking' ? <Button color={C.thinking} label="See tonight's deals" onPress={() => actions.goTab('deals')} /> : null}
    </View>
  );
}

/* ---------- Sesh ---------- */
export function SeshScreen({ ctx }: { ctx: Ctx }) {
  const { state, actions } = ctx;
  const head = (
    <View style={{ gap: 6 }}>
      <Eyebrow color={C.on}>{state.sesh ? 'Live now' : 'No sesh yet'}</Eyebrow>
      <H1>Tonight's sesh</H1>
    </View>
  );
  if (!state.sesh) {
    return (
      <View style={{ gap: 20 }}>
        {head}
        {state.status === 'on' ? (
          <>
            <Muted>Start a sesh and everyone who is on gets asked to join and vote on where to go.</Muted>
            <Button label="Start a sesh" onPress={actions.startSesh} testID="start-sesh" />
          </>
        ) : (
          <>
            <Muted>You need to be On to start a sesh.</Muted>
            <Button label="Go on" onPress={() => actions.setStatus('on')} />
          </>
        )}
      </View>
    );
  }
  const members = onFriends(ctx);
  const who = (
    <Card>
      <Row gap={14}>
        <Row gap={4}>
          <Avatar color={C.on} name={state.name} />
          {members.map((f) => <Avatar color={C.on} key={f.id} name={f.name} />)}
        </Row>
      </Row>
      <Text style={st.bold}>{members.length + 1 + ' in'}</Text>
      <Muted>{'You, ' + members.map((f) => f.name.split(' ')[0]).join(', ')}</Muted>
    </Card>
  );
  if (state.sesh.locked) {
    const v = VENUES[state.sesh.locked];
    return (
      <View style={{ gap: 20 }}>
        {head}
        {who}
        <Card border={C.on} thick>
          <Eyebrow color={C.on}>Locked in</Eyebrow>
          <H2>{v.name}</H2>
          <Muted>{v.kind + ', ' + v.km + ' km from the group, ' + v.close}</Muted>
          <Button label="See venue and deals" onPress={() => actions.openVenue(v.id)} testID="locked-venue" />
        </Card>
        <Button ghost label="End the sesh" onPress={actions.endSesh} />
      </View>
    );
  }
  const counts = tally(votes(ctx), VENUE_IDS);
  const total = VENUE_IDS.reduce((a, v) => a + counts[v], 0);
  const lead = leader(counts, VENUE_IDS);
  return (
    <View style={{ gap: 20 }}>
      {head}
      {who}
      <Row between>
        <H2>Where to?</H2>
        <Muted>{total + (total === 1 ? ' vote in' : ' votes in')}</Muted>
      </Row>
      <View style={s.stack}>
        {VENUE_IDS.map((id) => {
          const v = VENUES[id];
          const n = counts[id];
          const mine = state.sesh !== null && state.sesh.myVote === id;
          const isLead = id === lead && n > 0;
          const deal = DEALS.find((d) => d.venueId === id && dealWindow(d, ctx.hour).active);
          return (
            <Card border={isLead ? C.on : undefined} key={id} thick={isLead}>
              <Row between>
                <View style={s.grow}>
                  <Text style={st.venueName}>{v.name}</Text>
                  <Muted>{v.km + ' km from the group, ' + v.close}</Muted>
                </View>
                <Button ghost={!mine} label={mine ? 'Your vote' : 'Vote'} onPress={() => actions.vote(id)} small testID={'vote-' + id} />
              </Row>
              {deal ? <Text style={[s.dealTitle, { fontSize: 14 }]}>{deal.title}</Text> : null}
              <Row>
                <View style={st.bar}>
                  <View style={{ width: ((total ? Math.round((n / total) * 100) : 0) + '%') as `${number}%`, height: 8, borderRadius: 4, backgroundColor: isLead ? C.on : C.muted }} />
                </View>
                <Text style={st.bold}>{n + (n === 1 ? ' vote' : ' votes')}</Text>
              </Row>
            </Card>
          );
        })}
      </View>
      <Button label={'Lock in ' + VENUES[lead].name} onPress={actions.lock} testID="lock" />
    </View>
  );
}

/* ---------- Deals ---------- */
function DealCard({ ctx, deal, showVenue }: { ctx: Ctx; deal: Deal; showVenue: boolean }) {
  const win = dealWindow(deal, ctx.hour);
  const check = canRedeem(deal, ctx.hour, ctx.state.codes[deal.id], ctx.today);
  const label = check.ok ? 'Use deal' : check.reason === 'used-tonight' ? 'Used tonight' : 'Not on now';
  const v = VENUES[deal.venueId];
  return (
    <Card border={win.active ? C.thinking : undefined}>
      <Row between>
        <Eyebrow>{deal.type}</Eyebrow>
        <Muted>{win.label}</Muted>
      </Row>
      <Text style={s.dealTitle}>{deal.title}</Text>
      {showVenue ? <Muted>{v.name + ', ' + v.km + ' km away'}</Muted> : null}
      <Row>
        {showVenue ? <Button ghost label="Venue" onPress={() => ctx.actions.openVenue(v.id)} small testID={'venue-' + deal.id} /> : null}
        <Button color={C.thinking} disabled={!check.ok} label={label} onPress={() => ctx.actions.openRedeem(deal.id)} small testID={'use-' + deal.id} />
      </Row>
    </Card>
  );
}

export function DealsScreen({ ctx }: { ctx: Ctx }) {
  const [filter, setFilter] = useState<string>('All');
  const list = DEALS.filter((d) => filter === 'All' || d.type === filter);
  return (
    <View style={{ gap: 20 }}>
      <View style={{ gap: 6 }}>
        <H1>Deals near you</H1>
        <Muted>{'Example venues. ' + (ctx.state.testClock ? 'Test clock is set to Friday 8:30pm.' : 'Using the real time on this phone.')}</Muted>
      </View>
      <View style={s.chips}>
        {DEAL_TYPES.map((t) => <Chip key={t} label={t} onPress={() => setFilter(t)} selected={filter === t} />)}
      </View>
      <View style={{ gap: 12 }}>
        {list.length ? list.map((d) => <DealCard ctx={ctx} deal={d} key={d.id} showVenue />) : <Muted>No deals of this type tonight.</Muted>}
      </View>
    </View>
  );
}

/* ---------- Venue ---------- */
export function VenueScreen({ ctx, venueId }: { ctx: Ctx; venueId: string }) {
  const { state, actions } = ctx;
  const v = VENUES[venueId];
  const mine = state.ratings[venueId] || { stars: 0, tags: [] };
  const r = ratingAverage(v.baseRating, v.ratingCount, mine.stars);
  return (
    <View style={{ gap: 20 }}>
      <BackButton onPress={actions.back} />
      <View style={{ gap: 6 }}>
        <H1>{v.name}</H1>
        <Muted>{r.avg.toFixed(1) + ' from ' + r.count + ' ratings. ' + v.kind + ', ' + v.km + ' km, ' + v.close}</Muted>
      </View>
      <View style={{ gap: 12 }}>
        <H2>Deals here</H2>
        {DEALS.filter((d) => d.venueId === venueId).map((d) => <DealCard ctx={ctx} deal={d} key={d.id} showVenue={false} />)}
      </View>
      <View style={st.rateBlock}>
        <H2>Rate this venue</H2>
        <Row gap={2}>
          {[1, 2, 3, 4, 5].map((n) => (
            <Pressable accessibilityLabel={n + (n === 1 ? ' star' : ' stars')} accessibilityRole="button" accessibilityState={{ selected: mine.stars >= n }} key={n} onPress={() => actions.setStars(venueId, n)} style={st.star} testID={'star-' + n}>
              <Text style={[st.starText, { color: mine.stars >= n ? C.thinking : C.muted }]}>{mine.stars >= n ? '★' : '☆'}</Text>
            </Pressable>
          ))}
        </Row>
        <View style={s.chips}>
          {TAGS.map((t) => <Chip key={t} label={t} onPress={() => actions.toggleTag(venueId, t)} selected={mine.tags.indexOf(t) >= 0} />)}
        </View>
      </View>
      {state.sesh && !state.sesh.locked ? <Button label="Vote for this in tonight's sesh" onPress={() => actions.suggest(venueId)} /> : null}
    </View>
  );
}

/* ---------- Redeem ---------- */
export function RedeemScreen({ ctx, dealId }: { ctx: Ctx; dealId: string }) {
  const { state, actions } = ctx;
  const deal = DEALS.find((d) => d.id === dealId) as Deal;
  const v = VENUES[deal.venueId];
  const code = state.codes[dealId];
  const top = (
    <Row>
      <BackButton onPress={actions.back} />
      <Text style={st.bold}>{v.name}</Text>
    </Row>
  );
  if (code && code.usedDay === ctx.today) {
    return (
      <View style={{ gap: 20 }}>
        {top}
        <H1>Deal used</H1>
        <Text style={s.dealTitle}>{deal.title}</Text>
        <Muted>Each person can use a deal once per night. It will be available again tomorrow.</Muted>
        <Button label={'Rate ' + v.name} onPress={() => actions.openVenue(v.id)} />
      </View>
    );
  }
  const live = code ? codeIsLive(code, ctx.now, ctx.today) : false;
  return (
    <View style={{ gap: 20 }}>
      {top}
      <View style={{ gap: 8 }}>
        <H1>Show this at the bar</H1>
        <Text style={s.dealTitle}>{deal.title}</Text>
      </View>
      {live ? (
        <>
          <View style={st.codeBox}>
            <Text style={st.code} testID="code">{code.code}</Text>
            <Text style={st.codeNote}>Staff type this code in to confirm it</Text>
          </View>
          <Row>
            <View style={s.grow}>
              <Card>
                <Muted>Code runs out in</Muted>
                <Text style={st.tileNum}>{formatLeft(code.until - ctx.now)}</Text>
              </Card>
            </View>
            <View style={s.grow}>
              <Card>
                <Muted>Limit</Muted>
                <Text style={st.tileNum}>1 per night</Text>
              </Card>
            </View>
          </Row>
          <Muted>In the real app the venue confirms the code on their side. Here, press the button to play the staff member.</Muted>
          <Button label="Staff: confirm this code" onPress={() => actions.confirmCode(dealId)} testID="confirm" />
        </>
      ) : (
        <>
          <Card>
            <H2>This code ran out</H2>
            <Muted>Codes last 15 minutes so they can't be passed around.</Muted>
          </Card>
          <Button color={C.thinking} label="Get a new code" onPress={() => actions.openRedeem(dealId)} />
        </>
      )}
    </View>
  );
}

/* ---------- You ---------- */
export function YouScreen({ ctx }: { ctx: Ctx }) {
  const { state, actions } = ctx;
  return (
    <View style={{ gap: 20 }}>
      <Row>
        <Avatar color={STATUS_COLOR[state.status]} name={state.name} size={56} />
        <View>
          <Text style={st.youName}>{state.name}</Text>
          <Muted>{'Status: ' + STATUS_LABEL[state.status]}</Muted>
        </View>
      </Row>
      <Card>
        <H2>Test clock</H2>
        <Muted>Deals only work during their hours. The test clock pretends it is Friday 8:30pm so you can try them at any time of day.</Muted>
        <View style={s.chips}>
          <Chip label="Friday 8:30pm" onPress={() => actions.setTestClock(true)} selected={state.testClock} testID="clock-test" />
          <Chip label="Real time" onPress={() => actions.setTestClock(false)} selected={!state.testClock} testID="clock-real" />
        </View>
      </Card>
      <Card>
        <H2>What this test version does</H2>
        <Muted>Your status, votes, deal codes and ratings work and are saved on this phone only. The friends, venues and deals are examples. Nothing is sent to anyone.</Muted>
      </Card>
      <Card>
        <H2>Start again</H2>
        <Muted>Clears your name and everything you have done here.</Muted>
        <Button ghost label="Reset the test version" onPress={actions.reset} testID="reset" />
      </Card>
    </View>
  );
}

function BackButton({ onPress }: { onPress: () => void }) {
  return (
    <Pressable accessibilityLabel="Back" accessibilityRole="button" onPress={onPress} style={st.back} testID="back">
      <Text style={st.backText}>‹</Text>
    </Pressable>
  );
}

const st = StyleSheet.create({
  wordmark: { color: C.fg, fontSize: 24, fontWeight: '800', letterSpacing: -0.5 },
  pill: { color: C.muted, fontSize: 12, fontWeight: '700', letterSpacing: 0.8, borderWidth: 1, borderColor: C.line, borderRadius: 999, paddingVertical: 5, paddingHorizontal: 10 },
  statusWord: { fontSize: 52, lineHeight: 56, fontWeight: '800', letterSpacing: -1.5 },
  switch: { flexDirection: 'row', gap: 8, marginTop: 6 },
  seg: { flex: 1, height: 52, borderRadius: 26, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  segText: { color: C.fg, fontSize: 15, fontWeight: '700' },
  dot: { width: 10, height: 10, borderRadius: 5 },
  friend: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 54 },
  friendState: { fontSize: 13, fontWeight: '700' },
  bold: { color: C.fg, fontSize: 14, fontWeight: '700' },
  venueName: { color: C.fg, fontSize: 17, fontWeight: '700' },
  bar: { flex: 1, height: 8, borderRadius: 4, backgroundColor: C.line, overflow: 'hidden' },
  input: { height: 52, borderRadius: 14, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface, color: C.fg, paddingHorizontal: 16, fontSize: 16 },
  check: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 44 },
  box: { width: 24, height: 24, borderRadius: 6, borderWidth: 2, borderColor: C.muted, alignItems: 'center', justifyContent: 'center' },
  tick: { color: C.ink, fontSize: 16, fontWeight: '800', lineHeight: 20 },
  error: { color: C.off, fontSize: 14, fontWeight: '500' },
  rateBlock: { gap: 12, paddingTop: 18, borderTopWidth: 1, borderTopColor: C.line },
  star: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  starText: { fontSize: 32, lineHeight: 36 },
  back: { width: 44, height: 44, borderRadius: 22, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface, alignItems: 'center', justifyContent: 'center' },
  backText: { color: C.fg, fontSize: 26, lineHeight: 28, fontWeight: '700' },
  codeBox: { backgroundColor: C.fg, borderRadius: 20, paddingVertical: 28, paddingHorizontal: 20, alignItems: 'center', gap: 10 },
  code: { color: C.ink, fontSize: 38, fontWeight: '800', letterSpacing: 3 },
  codeNote: { color: '#5C574F', fontSize: 14 },
  tileNum: { color: C.fg, fontSize: 22, fontWeight: '700' },
  youName: { color: C.fg, fontSize: 28, fontWeight: '800' },
});
