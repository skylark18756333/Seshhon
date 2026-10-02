import type { Status } from './core/rules';

export const C = {
  bg: '#121110',
  surface: '#1F1D1A',
  surface2: '#2A2723',
  line: '#3A362F',
  fg: '#F4F1EA',
  muted: '#ABA59B',
  on: '#3DDC84',
  thinking: '#F5C542',
  off: '#F0524B',
  ink: '#121110',
};

export const STATUS_COLOR: Record<Status, string> = { on: C.on, thinking: C.thinking, off: C.off };
export const STATUS_LABEL: Record<Status, string> = { on: 'On', thinking: 'Thinking', off: 'Off' };
