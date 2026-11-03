// A safety net for phones where the native Google map closes the whole app (a crash in the map itself, which no
// JS error screen can catch). Just before a native map opens we leave a note on the phone; once it has stayed up
// for a few seconds the note is wiped. If the app dies while the map is opening, the note is still there on the
// next launch, so the native map is switched off on that phone and the simple web map is used instead.
// The switch-off is tied to the app update it happened on: the next over-the-air update tries the full map again.
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Updates from 'expo-updates';

const OPENING = 'map-opening', OFF = 'map-off', SAFE_MS = 6000;
const build = () => String(Updates.updateId || 'embedded');

let off = false;

/** Read once at launch: true when the native map should stay off on this phone. */
export async function mapCrashedBefore(): Promise<boolean> {
  try {
    const [opening, offFor] = await Promise.all([AsyncStorage.getItem(OPENING), AsyncStorage.getItem(OFF)]);
    if (opening) {
      await AsyncStorage.multiSet([[OFF, build()]]);
      await AsyncStorage.removeItem(OPENING);
      off = true;
    } else off = offFor === build();
  } catch { off = false; }
  return off;
}

export function mapIsOff(): boolean { return off; }

/** Call as a native map mounts; returns the clean-up to call on unmount. */
export function mapOpening(): () => void {
  let done = false;
  AsyncStorage.setItem(OPENING, '1').catch(() => {});
  const t = setTimeout(() => { done = true; AsyncStorage.removeItem(OPENING).catch(() => {}); }, SAFE_MS);
  return () => { clearTimeout(t); if (!done) AsyncStorage.removeItem(OPENING).catch(() => {}); };
}
