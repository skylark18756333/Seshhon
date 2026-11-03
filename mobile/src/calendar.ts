// "Add to calendar" for a planned sesh. It opens Google Calendar's new-event page with the sesh filled in (on an
// Android phone with the Google Calendar app, the app opens it). Nothing is read from or written to the phone's
// calendar by Crewzy itself, so it needs no permission and no new app build.
import { Linking } from 'react-native';

const HOURS = 3;   // how long the event is, as a starting point people can change in their calendar

// 20261107T120000Z, the format Google Calendar's link takes.
function stamp(d: Date): string {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

export function calendarLink({ title, start, place, note }: { title: string; start: Date; place?: string | null; note?: string | null }): string {
  const end = new Date(start.getTime() + HOURS * 3600000);
  const q = [
    'action=TEMPLATE',
    'text=' + encodeURIComponent(title),
    'dates=' + stamp(start) + '/' + stamp(end),
    'details=' + encodeURIComponent((note ? note + '\n\n' : '') + 'Planned on Crewzy. Open the app to chat, vote and see who is in.'),
    ...(place ? ['location=' + encodeURIComponent(place)] : [])
  ];
  return 'https://calendar.google.com/calendar/render?' + q.join('&');
}

export function addToCalendar(event: { title: string; start: Date; place?: string | null; note?: string | null }, onFail: (msg: string) => void) {
  Linking.openURL(calendarLink(event)).catch(() => onFail("Couldn't open your calendar. Try again in a moment."));
}
