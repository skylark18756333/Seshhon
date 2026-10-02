// Browser stand-in for the parts of React Native this app uses.
// It exists so the phone app's own code can be run and tested in a web browser.
// It is NOT used on a phone, where the real react-native takes over.
import React, { createContext, forwardRef, useContext, useImperativeHandle, useRef } from 'react';

type AnyStyle = Record<string, unknown> | null | undefined | false | AnyStyle[];
const PX_KEYS = ['lineHeight', 'letterSpacing'];

function flatten(style: AnyStyle, out: Record<string, unknown> = {}): Record<string, unknown> {
  if (!style) return out;
  if (Array.isArray(style)) { for (const s of style) flatten(s, out); return out; }
  return Object.assign(out, style);
}

function css(style: AnyStyle, base: Record<string, unknown>): React.CSSProperties {
  const f = flatten(style);
  const o: Record<string, unknown> = { ...base };
  for (const k of Object.keys(f)) {
    const v = f[k];
    if (k === 'paddingHorizontal') { o.paddingLeft = v; o.paddingRight = v; }
    else if (k === 'paddingVertical') { o.paddingTop = v; o.paddingBottom = v; }
    else if (k === 'marginHorizontal') { o.marginLeft = v; o.marginRight = v; }
    else if (k === 'marginVertical') { o.marginTop = v; o.marginBottom = v; }
    else if (k === 'flex' && typeof v === 'number') { o.flexGrow = v; o.flexShrink = 1; o.flexBasis = '0%'; }
    else if (PX_KEYS.indexOf(k) >= 0 && typeof v === 'number') o[k] = v + 'px';
    else o[k] = v;
  }
  if (o.borderWidth !== undefined && o.borderStyle === undefined) o.borderStyle = 'solid';
  if (o.borderTopWidth !== undefined) { o.borderTopStyle = 'solid'; }
  return o as React.CSSProperties;
}

const VIEW = { display: 'flex', flexDirection: 'column', position: 'relative', boxSizing: 'border-box', alignItems: 'stretch', minWidth: 0, minHeight: 0, flexShrink: 0, borderWidth: 0, borderStyle: 'solid', margin: 0, padding: 0 };
const InText = createContext(false);

type P = { style?: AnyStyle; children?: React.ReactNode; testID?: string; accessibilityLabel?: string; accessibilityRole?: string; accessibilityState?: { selected?: boolean; checked?: boolean; disabled?: boolean }; pointerEvents?: string };

function a11y(p: P) {
  const st = p.accessibilityState || {};
  return {
    'data-testid': p.testID,
    'aria-label': p.accessibilityLabel,
    'aria-selected': st.selected,
    'aria-checked': st.checked,
  };
}

export function View(p: P) {
  return <div {...a11y(p)} style={css(p.style, { ...VIEW, pointerEvents: p.pointerEvents === 'none' ? 'none' : undefined })}>{p.children}</div>;
}

export function Text(p: P) {
  const nested = useContext(InText);
  return (
    <InText.Provider value={true}>
      <span {...a11y(p)} role={p.accessibilityRole === 'header' ? 'heading' : undefined} style={css(p.style, { display: nested ? 'inline' : 'block', boxSizing: 'border-box', whiteSpace: 'pre-wrap', fontFamily: 'system-ui, sans-serif', fontSize: 14, color: '#000' })}>{p.children}</span>
    </InText.Provider>
  );
}

export function Pressable(p: P & { onPress?: () => void; disabled?: boolean }) {
  return (
    <button {...a11y(p)} disabled={p.disabled} onClick={p.onPress} role={p.accessibilityRole === 'checkbox' ? 'checkbox' : p.accessibilityRole === 'tab' ? 'tab' : undefined}
      style={css(p.style, { ...VIEW, background: 'transparent', font: 'inherit', color: 'inherit', textAlign: 'left', cursor: p.disabled ? 'default' : 'pointer' })}>
      {p.children}
    </button>
  );
}

export function TextInput(p: P & { value?: string; onChangeText?: (t: string) => void; maxLength?: number }) {
  return <input {...a11y(p)} maxLength={p.maxLength} onChange={(e) => p.onChangeText && p.onChangeText(e.target.value)} style={css(p.style, { boxSizing: 'border-box', borderStyle: 'solid', fontFamily: 'system-ui, sans-serif' })} value={p.value} />;
}

export const ScrollView = forwardRef(function ScrollView(p: P & { contentContainerStyle?: AnyStyle; keyboardShouldPersistTaps?: string }, ref) {
  const el = useRef<HTMLDivElement>(null);
  useImperativeHandle(ref, () => ({ scrollTo: ({ y }: { y: number }) => { if (el.current) el.current.scrollTop = y; } }));
  return (
    <div data-testid="scroll" ref={el} style={css(p.style, { ...VIEW, overflowY: 'auto', flexShrink: 1 })}>
      <div style={css(p.contentContainerStyle, { ...VIEW })}>{p.children}</div>
    </div>
  );
});

export const StyleSheet = { create: <T,>(styles: T): T => styles };
