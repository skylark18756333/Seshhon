// The map safety net (#117, #118) is switched off (Sarah, 2026-11-03): it switched phones that were fine onto the
// simple web map. It now only wipes the notes it left on the phone, so every phone gets the full map back, and it
// never switches anything off again.
import AsyncStorage from '@react-native-async-storage/async-storage';

/** Wipes the old safety-net notes. Always false: the native map is never switched off. */
export async function mapCrashedBefore(): Promise<boolean> {
  try { await AsyncStorage.multiRemove(['map-opening', 'map-off']); } catch { /* nothing to wipe */ }
  return false;
}

export function mapIsOff(): boolean { return false; }

const noop = () => {};
/** No longer leaves a note. */
export function mapOpening(): () => void { return noop; }
