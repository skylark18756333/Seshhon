// Whether the screen around a component is the one on show. Home and the Map stay loaded (hidden) after you
// leave them, so coming back is instant and the map doesn't have to be drawn from scratch; while hidden, their
// own timers (the chat, busy venues, the Sesh Map's stops) wait instead of asking the database for nothing.
import { createContext, useContext, useEffect, useRef } from 'react';

export const Shown = createContext(true);
export function useShown(): boolean { return useContext(Shown); }

// A ref that always says whether the screen is on show, for timers and callbacks set up once.
export function useShownRef(): { current: boolean } {
  const shown = useShown();
  const ref = useRef(shown);
  ref.current = shown;
  return ref;
}

// Runs fn whenever the screen comes back on show after being hidden.
export function useOnShow(fn: () => void): void {
  const shown = useShown();
  const was = useRef(shown);
  const call = useRef(fn); call.current = fn;
  useEffect(() => {
    if (shown && !was.current) call.current();
    was.current = shown;
  }, [shown]);
}
