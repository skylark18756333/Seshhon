// The line icons, with the same drawings as the ICON list in docs/app.js.
import React from 'react';
import Svg, { Circle, Path } from 'react-native-svg';

type Shape = { d: string } | { c: [number, number, number] };   // a line, or a circle (x, y, radius)

const ICON: Record<string, Shape[]> = {
  home: [{ d: 'M3 11l9-8 9 8' }, { d: 'M5 10v10h14V10' }],
  sesh: [{ c: [9, 8, 4] }, { d: 'M2 21c0-4 3-6 7-6s7 2 7 6' }, { d: 'M17 4a4 4 0 0 1 0 8' }, { d: 'M22 21c0-3-1-5-4-6' }],
  map: [{ d: 'M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z' }, { c: [12, 10, 2.5] }],
  venues: [{ d: 'M5 3h14l-7 9z' }, { d: 'M12 12v8' }, { d: 'M8 21h8' }],
  events: [{ d: 'M9 18V5l12-2v13' }, { c: [6, 18, 3] }, { c: [18, 16, 3] }],
  you: [{ c: [12, 8, 4] }, { d: 'M4 21c0-4 4-6 8-6s8 2 8 6' }],
  // Status lamps: a tick for green (out), a question mark for amber (maybe), a cross for red (off)
  tick: [{ d: 'M4.5 12.5l5 5L19.5 7' }],
  query: [{ d: 'M8.5 8.5a3.5 3.5 0 1 1 5.2 3c-1.1.7-1.7 1.4-1.7 2.7v.6' }, { c: [12, 19, 0.6] }],
  cross: [{ d: 'M6 6l12 12' }, { d: 'M18 6L6 18' }],
  // The Sesh tab's
  back: [{ d: 'M15 5l-7 7 7 7' }],
  close: [{ d: 'M6 6l12 12' }, { d: 'M18 6L6 18' }],
  send: [{ d: 'M21 3L10 14' }, { d: 'M21 3l-7 18-4-7-7-4z' }],
  clock: [{ c: [12, 12, 9] }, { d: 'M12 7v5l3 2' }],
  lock: [{ d: 'M7 11h10a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-6a2 2 0 0 1 2-2z' }, { d: 'M8 11V8a4 4 0 0 1 8 0v3' }],
  up: [{ d: 'M12 19V5' }, { d: 'M5 12l7-7 7 7' }],
  down: [{ d: 'M12 5v14' }, { d: 'M5 12l7 7 7-7' }]
};

export default function Icon({ name, size, colour, weight }: { name: string; size: number; colour: string; weight?: number }) {
  const shapes = ICON[name] || [];
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={colour} strokeWidth={weight || 2} strokeLinecap="round" strokeLinejoin="round">
      {shapes.map((s, i) => ('d' in s
        ? <Path key={i} d={s.d} />
        : <Circle key={i} cx={s.c[0]} cy={s.c[1]} r={s.c[2]} />))}
    </Svg>
  );
}
