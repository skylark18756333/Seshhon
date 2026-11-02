// Crewzy crawl: a sesh with a trail of stops a short walk apart, picked when you start (or plan) the sesh.
// The stops are the Sesh Map's (crawl_stops, migration 0027), so nothing new is stored: the builder just
// adds them in order once the sesh exists. Where you are is used on this phone only, to list venues near
// you for the first stop; after that, only venues within a short walk of the last stop are offered.
// TreasureMap draws the trail: numbered stops joined by a dotted, glowing line, with an X on the last one.
import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import Svg, { Circle, G, Path, Text as SvgText } from 'react-native-svg';
import { MAP_CENTRE } from './config';
import Icon from './Icon';
import { Button } from './Parts';
import { C, F, themed } from './theme';
import { findMe, fmtKm, km, useMyPlace, type Venues } from './venues';

export const CRAWL_MAX = 12;
export const WALK_KM = 1;   // "a short walk": about 12 minutes on foot, as the crow flies
const SHOW = 8;             // venues offered at a time

// Minutes on foot for a straight-line distance (about 5 km an hour).
export function walkMin(d: number): number { return Math.max(1, Math.round(d * 12)); }
export function walkText(d: number): string { return walkMin(d) + ' min walk'; }

/* ---------- the treasure map ---------- */
export type TrailStop = { id: string; n: number; name: string; done?: boolean };

function inks() {
  const dark = C.dark;
  return {
    bg: dark ? '#0D0C08' : '#F5EAD0',
    edge: dark ? 'rgba(245, 197, 66, 0.45)' : 'rgba(150, 100, 20, 0.45)',
    contour: dark ? 'rgba(245, 197, 66, 0.09)' : 'rgba(120, 80, 10, 0.13)',
    gold: dark ? '#F5C542' : '#B7800A',
    goldInk: '#14120A',
    x: dark ? '#FF6B5E' : '#D23C2C',
    walked: dark ? 'rgba(255, 255, 255, 0.32)' : 'rgba(60, 40, 10, 0.3)',
    doneFill: dark ? '#2A2C33' : '#D8CCB0',
    doneEdge: dark ? '#3A3C44' : '#BFAF8C',
    doneInk: dark ? '#9B9EA8' : '#6B5E44',
    label: dark ? 'rgba(245, 197, 66, 0.8)' : 'rgba(120, 80, 10, 0.85)'
  };
}

// A smooth curve through the points (Catmull-Rom), one cubic piece per leg so each leg can be coloured.
function legs(p: number[][]): string[] {
  const out: string[] = [];
  for (let i = 0; i < p.length - 1; i++) {
    const p0 = p[i - 1] || p[i], p1 = p[i], p2 = p[i + 1], p3 = p[i + 2] || p[i + 1];
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    out.push(`M${p1[0]} ${p1[1]} C${c1[0]} ${c1[1]} ${c2[0]} ${c2[1]} ${p2[0]} ${p2[1]}`);
  }
  return out;
}

// stops in order; ring = draw the "short walk" circle round the last stop (while picking stops).
export function TreasureMap({ stops, v, ring, height }: { stops: TrailStop[]; v: Venues; ring?: boolean; height?: number }) {
  const [width, setWidth] = useState(0);
  const spots = stops.map((s) => ({ s, at: v.pins && v.pins[s.id] }))
    .filter((x): x is { s: TrailStop; at: [number, number] } => !!x.at);
  if (!spots.length) return null;
  const k = inks();
  const H = height || 220, W = width || 320, pad = 30;
  // Flatten lat/lng to a plane (fine across a city), then fit it in the box keeping its shape.
  const cos = Math.cos(spots[0].at[0] * Math.PI / 180);
  const pts = spots.map((x) => ({ x: x.at[1] * cos, y: -x.at[0] }));
  const ringDeg = WALK_KM / 111.32;
  const box = pts.slice();
  const last = pts[pts.length - 1];
  // The ring only sets the size while there's one stop; after that the stops fill the box and the ring runs off it.
  if (ring && pts.length === 1) box.push({ x: last.x - ringDeg, y: last.y - ringDeg }, { x: last.x + ringDeg, y: last.y + ringDeg });
  let minX = Math.min(...box.map((p) => p.x)), maxX = Math.max(...box.map((p) => p.x));
  let minY = Math.min(...box.map((p) => p.y)), maxY = Math.max(...box.map((p) => p.y));
  const least = 0.005;   // about 500 m, so close stops don't fill the whole box
  if (maxX - minX < least) { const m = (minX + maxX) / 2; minX = m - least / 2; maxX = m + least / 2; }
  if (maxY - minY < least) { const m = (minY + maxY) / 2; minY = m - least / 2; maxY = m + least / 2; }
  const scale = Math.min((W - pad * 2) / (maxX - minX), (H - pad * 2) / (maxY - minY));
  const ox = (W - (maxX - minX) * scale) / 2, oy = (H - (maxY - minY) * scale) / 2;
  const xy = pts.map((p) => [ox + (p.x - minX) * scale, oy + (p.y - minY) * scale]);
  const paths = legs(xy);
  const started = spots.some((x) => x.s.done);
  const nextI = started ? spots.findIndex((x) => !x.s.done) : -1;
  const lastI = spots.length - 1;
  const waves = [0.18, 0.42, 0.66, 0.9].map((f) => {
    const y = H * f, a = 14;
    return `M-10 ${y} C${W * 0.2} ${y - a}, ${W * 0.35} ${y + a * 1.6}, ${W * 0.55} ${y} S${W * 0.9} ${y - a}, ${W + 10} ${y + a * 0.5}`;
  });
  return (
    <View
      style={[styles.map, { height: H, backgroundColor: k.bg, borderColor: k.edge }]}
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      accessible
      accessibilityLabel={'Trail map: ' + spots.map((x) => x.s.n + '. ' + x.s.name + (x.s.done ? ', done' : '')).join(', ')}
    >
      <Svg width={W} height={H}>
        {waves.map((d, i) => <Path key={'w' + i} d={d} stroke={k.contour} strokeWidth={1} fill="none" />)}
        <G transform={`translate(${W - 26} ${H - 30})`}>
          <Circle r={15} fill="none" stroke={k.label} strokeOpacity={0.45} />
          <Path d="M0 -12 L3.5 0 L0 12 L-3.5 0 Z" fill={k.label} fillOpacity={0.6} />
          <SvgText y={-18} fontSize={9} fontFamily={F.display} fill={k.label} textAnchor="middle">N</SvgText>
        </G>
        {ring ? <Circle cx={xy[lastI][0]} cy={xy[lastI][1]} r={ringDeg * scale} fill={k.gold} fillOpacity={0.05} stroke={k.gold} strokeOpacity={0.35} strokeWidth={1.5} strokeDasharray="4 5" /> : null}
        {paths.map((d, i) => <Path key={'g' + i} d={d} stroke={k.gold} strokeOpacity={spots[i + 1].s.done ? 0 : 0.2} strokeWidth={8} strokeLinecap="round" fill="none" />)}
        {paths.map((d, i) => (
          <Path key={'t' + i} d={d} stroke={spots[i + 1].s.done ? k.walked : k.gold} strokeWidth={3.5} strokeLinecap="round" strokeDasharray="0.1 9" fill="none" />
        ))}
        {spots.map((x, i) => {
          const [cx, cy] = xy[i];
          if (x.s.done) {
            return (
              <G key={x.s.id}>
                <Circle cx={cx} cy={cy} r={13} fill={k.doneFill} stroke={k.doneEdge} strokeWidth={3} />
                <Path d="M4.5 12.5l5 5L19.5 7" transform={`translate(${cx - 8} ${cy - 8}) scale(0.667)`} stroke={k.doneInk} strokeWidth={3} fill="none" strokeLinecap="round" strokeLinejoin="round" />
              </G>
            );
          }
          if (i === lastI && spots.length > 1 && i !== nextI) {
            return (
              <G key={x.s.id}>
                <Circle cx={cx} cy={cy} r={18} fill={k.x} fillOpacity={0.18} />
                <Path d={`M${cx - 9} ${cy - 9} L${cx + 9} ${cy + 9} M${cx + 9} ${cy - 9} L${cx - 9} ${cy + 9}`} stroke={k.x} strokeWidth={5} strokeLinecap="round" />
              </G>
            );
          }
          const next = i === nextI;
          return (
            <G key={x.s.id}>
              {next ? <Circle cx={cx} cy={cy} r={23} fill={C.on} fillOpacity={0.2} /> : null}
              <Circle cx={cx} cy={cy} r={next ? 16 : 14} fill={next ? C.on : k.gold} stroke={k.bg} strokeWidth={3} />
              <SvgText x={cx} y={cy + 5} fontSize={14} fontFamily={F.display} fill={next ? '#06210F' : k.goldInk} textAnchor="middle">{String(x.s.n)}</SvgText>
            </G>
          );
        })}
      </Svg>
    </View>
  );
}

/* ---------- picking the stops ---------- */
export function CrawlBuilder({ v, eyebrow, goLabel, busy, onGo, onCancel }: {
  v: Venues; eyebrow: string; goLabel: string; busy: boolean; onGo: (ids: string[]) => void; onCancel: () => void;
}) {
  const [stops, setStops] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const here = useMyPlace(false);
  const pins = v.pins;
  const name = (id: string) => (v.byId[id] ? v.byId[id].name : 'A venue');
  const lastId = stops[stops.length - 1];
  const lastAt = lastId && pins ? pins[lastId] : null;
  const from: [number, number] = lastAt || here || MAP_CENTRE;
  const q = query.trim().toLowerCase();
  const offered = !pins ? [] : v.list
    .filter((ven) => !ven.is_example && pins[ven.id] && stops.indexOf(ven.id) < 0)
    .filter((ven) => !q || ven.name.toLowerCase().indexOf(q) >= 0 || (ven.kind || '').toLowerCase().indexOf(q) >= 0)
    .map((ven) => ({ ven, d: km(from, pins[ven.id]) }))
    .filter((x) => !lastAt || x.d <= WALK_KM)
    .sort((a, b) => a.d - b.d)
    .slice(0, SHOW);
  // Walking time of each leg, and in total.
  let total = 0;
  const leg = stops.map((id, i) => {
    if (!i || !pins) return null;
    const a = pins[stops[i - 1]], b = pins[id];
    if (!a || !b) return null;
    const d = km(a, b); total += d;
    return d;
  });
  const full = stops.length >= CRAWL_MAX;
  const add = (id: string) => { if (!full) { setStops((s) => s.concat(id)); setQuery(''); } };
  const remove = (id: string) => setStops((s) => s.filter((x) => x !== id));
  const trail: TrailStop[] = stops.map((id, i) => ({ id, n: i + 1, name: name(id) }));

  return (
    <>
      <View style={styles.headRow}>
        <Pressable onPress={onCancel} accessibilityRole="button" accessibilityLabel="Back" style={styles.round}>
          <Icon name="back" size={18} colour={C.fg} />
        </Pressable>
        <View style={styles.grow}>
          <Text style={[styles.eyebrow, { color: C.thinking }]}>{eyebrow}</Text>
          <Text style={styles.h1}>Map out the trail</Text>
        </View>
      </View>
      {stops.length ? (
        <View style={{ gap: 6 }}>
          <TreasureMap stops={trail} v={v} ring={!full} />
          {stops.length === 1 ? <Text style={[styles.muted, styles.small]}>The dashed ring is a short walk from your first stop.</Text> : null}
        </View>
      ) : (
        <Text style={styles.muted}>Pick a few spots close enough to walk between. Your crew sees the trail in the sesh, in order, and you tick off each stop as you go.</Text>
      )}

      {stops.length ? (
        <View style={styles.stack}>
          {stops.map((id, i) => {
            const isLast = i === stops.length - 1 && stops.length > 1;
            const d = leg[i];
            return (
              <View key={id} style={[styles.stop, isLast && styles.stopLast]}>
                <View style={[styles.num, isLast && styles.numLast]}>
                  {isLast ? <Icon name="cross" size={14} colour={inks().x} /> : <Text style={styles.numText}>{i + 1}</Text>}
                </View>
                <View style={styles.grow}>
                  <Text style={styles.title} numberOfLines={1}>{name(id)}</Text>
                  <Text style={[styles.muted, styles.small]}>
                    {!i ? 'Start here' : d === null ? '' : d > WALK_KM ? fmtKm(d) + ' from stop ' + i + ', a longer walk' : walkText(d) + ' from stop ' + i}
                  </Text>
                </View>
                <Pressable onPress={() => remove(id)} accessibilityRole="button" accessibilityLabel={'Remove ' + name(id)} style={styles.round}>
                  <Icon name="close" size={16} colour={C.fg} />
                </Pressable>
              </View>
            );
          })}
        </View>
      ) : null}

      {full ? <Text style={[styles.muted, styles.small]}>That's the most stops a crawl can have ({CRAWL_MAX}).</Text> : (
        <View style={{ gap: 10 }}>
          <Text style={styles.h2}>{stops.length ? 'Add the next stop' : 'Pick the first stop'}</Text>
          <View style={styles.search}>
            <Icon name="search" size={18} colour={C.muted} />
            <TextInput
              style={styles.input} value={query} onChangeText={setQuery} placeholder="Search venues" placeholderTextColor={C.muted}
              autoCorrect={false} autoCapitalize="none" returnKeyType="search" accessibilityLabel="Search venues"
            />
          </View>
          <Text style={[styles.muted, styles.small]}>
            {lastAt ? 'Within a short walk of ' + name(lastId) + '.' : here ? 'Closest to you first. Your location stays on this phone.' : 'Closest to the city centre first.'}
          </Text>
          {!lastAt && !here ? (
            <Pressable onPress={() => findMe(true)} accessibilityRole="button" style={styles.link}>
              <Icon name="arrow" size={14} colour={C.muted} />
              <Text style={styles.linkText}>Use where I am</Text>
            </Pressable>
          ) : null}
          {!pins ? <Text style={[styles.muted, styles.small]}>Loading venues...</Text> : offered.length ? (
            <View style={styles.offers}>
              {offered.map(({ ven, d }) => (
                <Pressable key={ven.id} onPress={() => add(ven.id)} accessibilityRole="button" accessibilityLabel={'Add ' + ven.name + ', ' + (lastAt ? walkText(d) : fmtKm(d) + ' away')} style={styles.offer}>
                  <Text style={styles.offerName} numberOfLines={1}>+ {ven.name}</Text>
                  <Text style={[styles.muted, styles.tiny]} numberOfLines={1}>{lastAt ? walkText(d) : fmtKm(d) + ' away'}{ven.kind ? ', ' + ven.kind : ''}</Text>
                </Pressable>
              ))}
            </View>
          ) : (
            <Text style={[styles.muted, styles.small]}>
              {q ? 'No venues match that' + (lastAt ? ' within a short walk.' : '.') : 'Nothing else is listed within a short walk of ' + name(lastId) + '. You can go with the stops you have.'}
            </Text>
          )}
        </View>
      )}

      <View style={{ gap: 8 }}>
        {stops.length > 1 ? <Text style={[styles.muted, styles.small, { textAlign: 'center' }]}>{stops.length} stops, about {walkMin(total)} min walking in total</Text> : null}
        <Button
          label={stops.length < 2 ? 'Pick at least 2 stops' : busy ? 'Setting it up...' : goLabel}
          colour={stops.length < 2 || busy ? undefined : C.thinking}
          ink={stops.length >= 2 && !busy}
          disabled={stops.length < 2 || busy}
          onPress={() => onGo(stops)}
        />
        <Button label="Cancel" ghost onPress={onCancel} />
      </View>
    </>
  );
}

// The Crewzy crawl button under "Start a sesh", and in Planned.
export function CrawlCard({ onPress, note }: { onPress: () => void; note?: string }) {
  const k = inks();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel="Crewzy crawl" style={({ pressed }) => [styles.card, pressed && { opacity: 0.8 }]}>
      <Svg width={58} height={58} viewBox="0 0 64 64">
        <Path d="M2 16a14 14 0 0 1 14-14h32a14 14 0 0 1 14 14v32a14 14 0 0 1-14 14H16A14 14 0 0 1 2 48z" fill={k.bg} stroke={k.edge} />
        <Path d="M12 46 C 20 40, 18 30, 28 30 S 40 20, 50 16" fill="none" stroke={k.gold} strokeWidth={3} strokeLinecap="round" strokeDasharray="0.1 7" />
        <Circle cx={12} cy={46} r={5} fill={k.gold} />
        <Circle cx={28} cy={30} r={5} fill={k.gold} />
        <Path d="M45 11 L55 21 M55 11 L45 21" stroke={k.x} strokeWidth={3.5} strokeLinecap="round" />
      </Svg>
      <View style={styles.grow}>
        <Text style={styles.cardTitle}>Crewzy crawl</Text>
        <Text style={[styles.muted, styles.small]}>{note || 'Line up a few spots close enough to walk between. Your crew gets the trail map.'}</Text>
      </View>
      <View style={{ transform: [{ scaleX: -1 }] }}><Icon name="back" size={18} colour={C.thinking} /></View>
    </Pressable>
  );
}

const styles = themed(() => StyleSheet.create({
  map: { borderRadius: 18, overflow: 'hidden', borderWidth: 1.5 },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  grow: { flex: 1, minWidth: 0 },
  eyebrow: { fontFamily: F.bodyBold, fontSize: 12, letterSpacing: 1.4, textTransform: 'uppercase' },
  h1: { fontFamily: F.display, fontSize: 26, lineHeight: 30, letterSpacing: -0.4, color: C.fg },
  h2: { fontFamily: F.displayBold, fontSize: 19, letterSpacing: -0.2, color: C.fg },
  title: { fontFamily: F.bodyBold, fontSize: 16, color: C.fg },
  muted: { fontFamily: F.body, fontSize: 16, lineHeight: 22, color: C.muted },
  small: { fontSize: 14, lineHeight: 20 },
  tiny: { fontSize: 12, lineHeight: 16 },
  stack: { gap: 8 },
  round: { width: 44, height: 44, borderRadius: 22, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface, alignItems: 'center', justifyContent: 'center' },
  stop: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 16, backgroundColor: C.surface, borderWidth: 1, borderColor: 'transparent' },
  stopLast: { borderColor: 'rgba(255, 107, 94, 0.4)', backgroundColor: 'rgba(255, 107, 94, 0.08)' },
  num: { width: 30, height: 30, borderRadius: 15, backgroundColor: C.thinking, alignItems: 'center', justifyContent: 'center' },
  numLast: { backgroundColor: C.dark ? '#2A1412' : '#F7DCD7' },
  numText: { fontFamily: F.display, fontSize: 14, color: '#14120A' },
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, height: 48, borderRadius: 24, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface, paddingHorizontal: 16 },
  input: { flex: 1, minWidth: 0, height: 46, color: C.fg, fontFamily: F.body, fontSize: 16 },
  link: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', minHeight: 32 },
  linkText: { fontFamily: F.body, fontSize: 14, color: C.muted, textDecorationLine: 'underline' },
  offers: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  offer: { width: '48.5%', minHeight: 56, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 14, borderWidth: 1, borderColor: C.line, justifyContent: 'center' },
  offerName: { fontFamily: F.bodyBold, fontSize: 14, color: C.fg },
  card: {
    flexDirection: 'row', alignItems: 'center', gap: 14, padding: 14, borderRadius: 22, borderWidth: 1.5,
    borderColor: 'rgba(245, 197, 66, 0.6)', backgroundColor: C.dark ? 'rgba(245, 197, 66, 0.09)' : 'rgba(245, 197, 66, 0.16)',
    shadowColor: '#F5C542', shadowOpacity: C.dark ? 0.25 : 0, shadowRadius: 14, shadowOffset: { width: 0, height: 0 }
  },
  cardTitle: { fontFamily: F.display, fontSize: 19, color: C.fg, marginBottom: 2 }
}));
