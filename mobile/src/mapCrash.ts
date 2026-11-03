// A safety net for phones where the native Google map closes the whole app (a crash in the map itself, which no
// JS error screen can catch). Just before a native map opens we leave a note on the phone, naming the app update
// that is running; once the map has stayed up for a few seconds, or the app goes to the background, the note is
// wiped. If the app dies while the map is opening, the note is still there on the next launch, so the native map is
// switched off on that phone and the simple web map is used instead.
// Not a crash: the app restarting into a new over-the-air update (the note names the old update, so it's ignored),
// or the app being closed from the recent-apps list (it goes to the background first, which wipes the note).
// The switch-off is tied to the update it happened on: the next over-the-air update tries the full map again.
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Updates from 'expo-updates';
import { AppState } from 'react-native';

const OPENING = 'map-opening', OFF = 'map-off', SAFE_MS = 6000;
const build = () => String(Updates.updateId || 'embedded');

let off = false;

/** Read once at launch: true when the native map should stay off on this phone. */
export async function mapCrashedBefore(): Promise<boolean> {
  try {
    const [opening, offFor] = await Promise.all([AsyncStorage.getItem(OPENING), AsyncStorage.getItem(OFF)]);
    if (opening) await AsyncStorage.removeItem(OPENING);
    if (opening === build()) {
      await AsyncStorage.setItem(OFF, build());
      off = true;
    } else off = offFor === build();
  } catch { off = false; }
  return off;
}

export function mapIsOff(): boolean { return off; }

/** Call as a native map mounts; returns the clean-up to call on unmount. */
export function mapOpening(): () => void {
  let done = false;
  const clear = () => { if (done) return; done = true; clearTimeout(t); sub.remove(); AsyncStorage.removeItem(OPENING).catch(() => {}); };
  AsyncStorage.setItem(OPENING, build()).catch(() => {});
  const t = setTimeout(clear, SAFE_MS);
  const sub = AppState.addEventListener('change', (s) => { if (s !== 'active') clear(); });
  return clear;
}
