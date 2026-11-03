// The Crewzy calendar, inside the app: this month and next as a grid of days. Days with a planned sesh get a glowing
// dot (green: you're in, amber: a friend's you can join). Tap a day to see its seshes, or plan one on that day.
// Seshes can be planned up to a year ahead (plan_sesh, migration 0043); days before today are shown dimmed. It reads the same planned seshes as "Coming up" and stores nothing new.
import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { Sesh as SeshT } from './api';
import Icon from './Icon';
import { Button } from './Parts';
import { C, F, fade, first, fmtTime, themed } from './theme';
import type { Venues } from './venues';
import { PLAN_AHEAD_DAYS } from './config';

const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const LONG_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const dayKey = (d: Date) => d.getFullYear() + '-' + d.getMonth() + '-' + d.getDate();
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

export default function CalendarView({ seshes, v, onBack, onOpen, onJoin, onPlanDay }: {
  seshes: SeshT[]; v: Venues;
  onBack: () => void; onOpen: (id: string) => void; onJoin: (id: string) => void; onPlanDay: (day: Date) => void;
}) {
  const today = startOfDay(new Date());
  const last = new Date(today); last.setDate(last.getDate() + PLAN_AHEAD_DAYS);
  const [month, setMonth] = useState(new Date(today.getFullYear(), today.getMonth(), 1));
  const [picked, setPicked] = useState<Date>(today);

  // The planned seshes by day.
  const byDay = useMemo(() => {
    const out: Record<string, SeshT[]> = {};
    for (const s of seshes) {
      if (!s.starts_at) continue;
      const d = new Date(s.starts_at);
      if (isNaN(d.getTime())) continue;
      (out[dayKey(d)] = out[dayKey(d)] || []).push(s);
    }
    for (const k of Object.keys(out)) out[k].sort((a, b) => new Date(a.starts_at || 0).getTime() - new Date(b.starts_at || 0).getTime());
    return out;
  }, [seshes]);

  // The grid: Monday-first weeks covering the month.
  const cells: (Date | null)[] = [];
  const lead = (month.getDay() + 6) % 7;
  for (let i = 0; i < lead; i++) cells.push(null);
  const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  for (let d = 1; d <= days; d++) cells.push(new Date(month.getFullYear(), month.getMonth(), d));
  while (cells.length % 7) cells.push(null);

  const thisMonth = month.getFullYear() === today.getFullYear() && month.getMonth() === today.getMonth();
  const lastMonth = month.getFullYear() === last.getFullYear() && month.getMonth() === last.getMonth();
  const plannable = (d: Date) => d >= today && d <= last;
  const list = byDay[dayKey(picked)] || [];
  const pickedName = picked.getTime() === today.getTime() ? 'Today' : LONG_DAYS[picked.getDay()] + ' ' + picked.getDate() + ' ' + MONTHS[picked.getMonth()].slice(0, 3);

  return (
    <View style={styles.wrap}>
      <Pressable style={styles.back} onPress={onBack} accessibilityRole="button" accessibilityLabel="Back to Home">
        <Icon name="back" size={16} colour={C.muted} /><Text style={styles.backText}>Back to Home</Text>
      </Pressable>
      <View style={styles.headRow}>
        <View style={styles.grow}>
          <Text style={styles.eyebrow}>Your calendar</Text>
          <Text style={styles.h1}>{MONTHS[month.getMonth()]}</Text>
        </View>
        <Pressable style={[styles.round, thisMonth && styles.roundOff]} disabled={thisMonth} accessibilityRole="button" accessibilityLabel="Previous month"
          onPress={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}>
          <Icon name="back" size={18} colour={thisMonth ? C.line : C.fg} />
        </Pressable>
        <Pressable style={[styles.round, lastMonth && styles.roundOff]} disabled={lastMonth} accessibilityRole="button" accessibilityLabel="Next month"
          onPress={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}>
          <View style={{ transform: [{ scaleX: -1 }] }}><Icon name="back" size={18} colour={lastMonth ? C.line : C.fg} /></View>
        </Pressable>
      </View>

      <View style={styles.card}>
        <View style={styles.week}>
          {WEEKDAYS.map((w, i) => <Text key={i} style={styles.weekday}>{w}</Text>)}
        </View>
        {Array.from({ length: cells.length / 7 }, (_, r) => (
          <View key={r} style={styles.week}>
            {cells.slice(r * 7, r * 7 + 7).map((d, i) => {
              if (!d) return <View key={i} style={styles.cell} />;
              const items = byDay[dayKey(d)] || [];
              const isToday = d.getTime() === today.getTime();
              const isPicked = d.getTime() === picked.getTime();
              const open = plannable(d);
              return (
                <Pressable key={i} style={styles.cell} onPress={() => setPicked(d)} testID={'cal-day-' + d.getDate()}
                  accessibilityRole="button" accessibilityState={{ selected: isPicked }}
                  accessibilityLabel={LONG_DAYS[d.getDay()] + ' ' + d.getDate() + (items.length ? ', ' + items.length + ' planned' : '')}>
                  <View style={[styles.day, isToday && styles.dayToday, isPicked && styles.dayPicked]}>
                    <Text style={[styles.dayNum, !open && !items.length && styles.dayDim, isPicked && styles.dayNumPicked]}>{d.getDate()}</Text>
                  </View>
                  <View style={styles.dots}>
                    {items.slice(0, 3).map((s) => (
                      <View key={s.id} style={[styles.dot, { backgroundColor: s.am_member ? C.on : C.thinking, shadowColor: s.am_member ? C.on : C.thinking }]} />
                    ))}
                  </View>
                </Pressable>
              );
            })}
          </View>
        ))}
        <View style={styles.legend}>
          <View style={styles.legendItem}><View style={[styles.dot, { backgroundColor: C.on }]} /><Text style={styles.legendText}>You're in</Text></View>
          <View style={styles.legendItem}><View style={[styles.dot, { backgroundColor: C.thinking }]} /><Text style={styles.legendText}>A friend's, join in</Text></View>
        </View>
      </View>

      <View style={styles.dayHead}>
        <Text style={styles.h2}>{pickedName}</Text>
        <Text style={styles.muted}>{list.length ? list.length + ' planned' : 'Nothing planned'}</Text>
      </View>
      {list.map((s) => {
        const at = s.locked_venue && v.byId[s.locked_venue] ? v.byId[s.locked_venue].name : null;
        return (
          <Pressable key={s.id} style={[styles.item, { borderColor: fade(s.am_member ? C.on : C.thinking, 0.5) }]}
            onPress={() => (s.am_member ? onOpen(s.id) : onJoin(s.id))} testID={'cal-sesh-' + s.id}
            accessibilityRole="button" accessibilityLabel={(s.am_member ? 'Open ' : "I'm in: ") + (s.mine ? 'your sesh' : first(s.creator_name) + "'s sesh")}>
            <Text style={[styles.time, { color: s.am_member ? C.on : C.thinking }]}>{fmtTime(new Date(s.starts_at as string).getTime())}</Text>
            <View style={styles.grow}>
              <Text style={styles.itemTitle} numberOfLines={1}>{s.mine ? 'Your sesh' : first(s.creator_name) + "'s sesh"}</Text>
              <Text style={styles.muted} numberOfLines={1}>{s.private ? 'Private, ' : ''}{s.members.length} in{at ? ', ' + at : ''}</Text>
            </View>
            <Text style={[styles.act, s.am_member ? { color: C.on } : null]}>{s.am_member ? 'Open' : "I'm in"}</Text>
          </Pressable>
        );
      })}
      {plannable(picked)
        ? <Button icon="plus" label={'Plan a sesh ' + (picked.getTime() === today.getTime() ? 'today' : 'on ' + LONG_DAYS[picked.getDay()] + ' ' + picked.getDate())} onPress={() => onPlanDay(picked)} testID="cal-plan-day" />
        : <Text style={styles.muted}>{picked < today ? 'That day has been and gone.' : 'You can plan up to a year ahead.'}</Text>}
    </View>
  );
}

const styles = themed(() => StyleSheet.create({
  wrap: { gap: 14 },
  grow: { flex: 1, minWidth: 0 },
  back: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', minHeight: 40 },
  backText: { fontFamily: F.bodyMid, fontSize: 15, color: C.muted },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  eyebrow: { fontFamily: F.bodyBold, fontSize: 12, letterSpacing: 1.4, textTransform: 'uppercase', color: C.muted },
  h1: { fontFamily: F.display, fontSize: 30, letterSpacing: -0.6, color: C.fg },
  h2: { fontFamily: F.displayBold, fontSize: 19, color: C.fg },
  muted: { fontFamily: F.body, fontSize: 14, lineHeight: 20, color: C.muted },
  round: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: C.surface, borderWidth: 1, borderColor: C.line },
  roundOff: { opacity: 0.5 },
  card: { backgroundColor: C.surface, borderRadius: 24, borderWidth: 1, borderColor: C.line, padding: 10, gap: 2 },
  week: { flexDirection: 'row' },
  weekday: { flex: 1, textAlign: 'center', fontFamily: F.bodyBold, fontSize: 12, color: C.muted, paddingVertical: 6 },
  cell: { flex: 1, alignItems: 'center', paddingVertical: 3, minHeight: 50 },
  day: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  dayToday: { borderWidth: 1.5, borderColor: C.fg },
  dayPicked: { backgroundColor: C.accent, borderWidth: 0 },
  dayNum: { fontFamily: F.bodyBold, fontSize: 15, color: C.fg },
  dayNumPicked: { color: C.accentInk },
  dayDim: { color: C.muted, opacity: 0.55 },
  dots: { flexDirection: 'row', gap: 3, height: 7, marginTop: 2 },
  dot: { width: 7, height: 7, borderRadius: 4, shadowOpacity: 0.9, shadowRadius: 4, shadowOffset: { width: 0, height: 0 } },
  legend: { flexDirection: 'row', gap: 16, justifyContent: 'center', paddingTop: 6, paddingBottom: 2 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendText: { fontFamily: F.body, fontSize: 12, color: C.muted },
  dayHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  item: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 18, backgroundColor: C.surface, borderWidth: 1.5 },
  time: { fontFamily: F.displayBold, fontSize: 16, minWidth: 64 },
  itemTitle: { fontFamily: F.bodyBold, fontSize: 16, color: C.fg },
  act: { fontFamily: F.bodyBold, fontSize: 14, color: C.thinking }
}));
