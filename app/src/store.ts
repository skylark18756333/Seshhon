// Everything the app remembers about this person, saved on the phone.
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Code, Status } from './core/rules';

export type Sesh = { myVote: string | null; locked: string | null };
export type MyRating = { stars: number; tags: string[] };

export type AppState = {
  name: string;
  status: Status;
  until: number;
  danOn: boolean;
  sesh: Sesh | null;
  codes: Record<string, Code>;
  ratings: Record<string, MyRating>;
  testClock: boolean;
};

export const initialState: AppState = {
  name: '',
  status: 'off',
  until: 0,
  danOn: false,
  sesh: null,
  codes: {},
  ratings: {},
  testClock: true,
};

const KEY = 'seshhon-state-v1';

export async function loadState(): Promise<AppState> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return initialState;
    const saved = JSON.parse(raw);
    if (!saved || typeof saved !== 'object') return initialState;
    return { ...initialState, ...saved };
  } catch {
    return initialState;
  }
}

export function saveState(state: AppState): void {
  AsyncStorage.setItem(KEY, JSON.stringify(state)).catch(() => {});
}
