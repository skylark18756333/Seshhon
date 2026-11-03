// A screen area whose bottom always sits just above the keyboard. Android draws edge to edge (Expo 57), so the
// window isn't resized when the keyboard opens and React Native's KeyboardAvoidingView often gets the overlap wrong
// when the screen sits above the bottom bar. This measures where its own bottom is on screen and pads exactly the
// part the keyboard covers, so a chat's typing box stays just above the keyboard and moves down when it closes.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Keyboard, Platform, View, type KeyboardEvent, type StyleProp, type ViewStyle } from 'react-native';

export default function KeyboardSafe({ style, children, testID }: { style?: StyleProp<ViewStyle>; children: React.ReactNode; testID?: string }) {
  const box = useRef<View>(null);
  const bottom = useRef(0);           // this area's bottom edge, in screen pixels (its padding doesn't move it)
  const keyTop = useRef<number | null>(null);
  const [pad, setPad] = useState(0);

  const update = useCallback(() => {
    const top = keyTop.current;
    setPad(top === null ? 0 : Math.max(0, Math.round(bottom.current - top)));
  }, []);
  const measure = useCallback(() => {
    // The bottom edge moves only if the screen around it changes (say the bottom bar hides), never from our padding.
    box.current?.measureInWindow((_x, y, _w, h) => { if (h > 0) { bottom.current = y + h; update(); } });
  }, [update]);

  useEffect(() => {
    const show = (e: KeyboardEvent) => { keyTop.current = e.endCoordinates.screenY; measure(); };
    const hide = () => { keyTop.current = null; update(); };
    const subs = Platform.OS === 'ios'
      ? [Keyboard.addListener('keyboardWillShow', show), Keyboard.addListener('keyboardWillHide', hide)]
      : [Keyboard.addListener('keyboardDidShow', show), Keyboard.addListener('keyboardDidHide', hide)];
    return () => subs.forEach((s) => s.remove());
  }, [update, measure]);

  return (
    <View ref={box} style={[style, pad ? { paddingBottom: pad } : null]} onLayout={measure} testID={testID}>
      {children}
    </View>
  );
}
