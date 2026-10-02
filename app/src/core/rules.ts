// The rules of Seshhon, with no screen or database code.
// The phone app and the tests both use this file, so the rules live in one place.

export type Status = 'on' | 'thinking' | 'off';

export const GREEN_MS = 4 * 60 * 60 * 1000; // On lasts 4 hours
export const YELLOW_MS = 2 * 60 * 60 * 1000; // Thinking lasts 2 hours
export const CODE_MS = 15 * 60 * 1000; // a deal code lasts 15 minutes

/** When a newly set status runs out. Off never runs out, so it returns 0. */
export function statusExpiry(status: Status, now: number): number {
  if (status === 'on') return now + GREEN_MS;
  if (status === 'thinking') return now + YELLOW_MS;
  return 0;
}

/** The status other people should see: an expired On or Thinking counts as Off. */
export function effectiveStatus(status: Status, until: number, now: number): Status {
  if (status === 'off') return 'off';
  return now >= until ? 'off' : status;
}

export type DealType = 'Food' | 'Drinks' | 'Entry' | 'Events';

export type Deal = {
  id: string;
  venueId: string;
  type: DealType;
  title: string;
  /** Hours on a 24-hour clock. toHour may be 24 for midnight. */
  fromHour: number;
  toHour: number;
  /** True when the deal discounts or gives away alcohol. */
  alcohol: boolean;
  /** Percentage off, when the deal is a discount. */
  discountPct?: number;
};

// Limits taken from the WA Director of Liquor Licensing policy on responsible
// promotion of liquor. They are applied to every alcohol deal, which is stricter
// than the policy requires. Have a liquor lawyer confirm before changing them.
export const MAX_ALCOHOL_DISCOUNT_PCT = 50;
export const MAX_ALCOHOL_DEAL_HOURS = 1;
export const ALCOHOL_DEALS_END_BY_HOUR = 19;
export const MAX_ALCOHOL_DEALS_PER_VENUE_PER_DAY = 2;

/** Reasons a single deal is not allowed. An empty list means it is fine. */
export function dealProblems(d: Deal): string[] {
  const problems: string[] = [];
  if (!(d.toHour > d.fromHour)) problems.push('The deal must end after it starts.');
  if (d.fromHour < 0 || d.toHour > 24) problems.push('Deal hours must be within one day.');
  if (!d.alcohol) return problems;
  if ((d.discountPct ?? 0) > MAX_ALCOHOL_DISCOUNT_PCT) {
    problems.push('Alcohol cannot be discounted by more than 50%.');
  }
  if (d.toHour - d.fromHour > MAX_ALCOHOL_DEAL_HOURS) {
    problems.push('An alcohol deal cannot run longer than 60 minutes.');
  }
  if (d.toHour > ALCOHOL_DEALS_END_BY_HOUR) {
    problems.push('An alcohol deal cannot run after 7pm.');
  }
  return problems;
}

/** Reasons a venue's full set of deals for one day is not allowed. */
export function venueDayProblems(deals: Deal[]): string[] {
  const problems: string[] = [];
  for (const d of deals) for (const p of dealProblems(d)) problems.push(d.title + ': ' + p);
  const alcohol = deals.filter((d) => d.alcohol).length;
  if (alcohol > MAX_ALCOHOL_DEALS_PER_VENUE_PER_DAY) {
    problems.push('A venue can run at most two alcohol deals per day.');
  }
  return problems;
}

export function formatHour(h: number): string {
  if (h === 24) return 'midnight';
  const whole = Math.floor(h);
  const mins = Math.round((h - whole) * 60);
  const suffix = whole >= 12 && whole < 24 ? 'pm' : 'am';
  const twelve = whole % 12 || 12;
  return twelve + (mins ? ':' + (mins < 10 ? '0' : '') + mins : '') + suffix;
}

/** Whether a deal is running at the given hour (for example 20.5 is 8:30pm). */
export function dealWindow(d: Deal, hour: number): { active: boolean; label: string } {
  if (hour < d.fromHour) return { active: false, label: 'Starts ' + formatHour(d.fromHour) };
  if (hour >= d.toHour) return { active: false, label: 'Ended ' + formatHour(d.toHour) };
  return { active: true, label: 'Until ' + formatHour(d.toHour) };
}

export type Code = { code: string; until: number; usedDay: string | null };

export type RedeemCheck =
  | { ok: true }
  | { ok: false; reason: 'not-running' | 'used-tonight' | 'not-allowed' };

/** Whether this person may get a code for this deal right now. */
export function canRedeem(d: Deal, hour: number, existing: Code | undefined, today: string): RedeemCheck {
  if (dealProblems(d).length > 0) return { ok: false, reason: 'not-allowed' };
  if (!dealWindow(d, hour).active) return { ok: false, reason: 'not-running' };
  if (existing && existing.usedDay === today) return { ok: false, reason: 'used-tonight' };
  return { ok: true };
}

/** A fresh code. `random` is a number from 0 up to (not including) 1. */
export function newCode(now: number, random: number): Code {
  const digits = 1000 + Math.floor(random * 9000);
  return { code: 'SESH-' + digits, until: now + CODE_MS, usedDay: null };
}

export function codeIsLive(c: Code, now: number, today: string): boolean {
  return c.usedDay !== today && now < c.until;
}

/** Count votes per venue. `votes` maps a person to the venue they picked. */
export function tally(votes: Record<string, string | null>, venueIds: string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const v of venueIds) counts[v] = 0;
  for (const person of Object.keys(votes)) {
    const v = votes[person];
    if (v && v in counts) counts[v] += 1;
  }
  return counts;
}

/** The venue with the most votes. Ties go to the venue listed first. */
export function leader(counts: Record<string, number>, venueIds: string[]): string {
  let best = venueIds[0];
  for (const v of venueIds) if (counts[v] > counts[best]) best = v;
  return best;
}

/** A venue's average once this person's stars are included. */
export function ratingAverage(base: number, count: number, myStars: number): { avg: number; count: number } {
  if (!myStars) return { avg: base, count };
  return { avg: (base * count + myStars) / (count + 1), count: count + 1 };
}

export function formatLeft(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h > 0) return h + 'h ' + m + 'm';
  return (m < 10 ? '0' : '') + m + ':' + (r < 10 ? '0' : '') + r;
}
