// "Add to calendar" for a planned sesh. People pick Google Calendar (its new-event page, or the Google Calendar app on
// Android) or Apple Calendar and others (frendzy.au/cal.html makes a standard .ics file). Crewzy never reads or writes
// the phone's calendar itself, so it needs no permission and no new app build. Only the venue and time are included.
import { Alert, Linking } from 'react-native';

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

// The calendar page on the website (docs/cal.html): it makes a standard .ics file for Apple Calendar and others.
export function icsPageLink({ title, start, place }: { title: string; start: Date; place?: string | null }): string {
  const end = new Date(start.getTime() + HOURS * 3600000);
  return 'https://frendzy.au/cal.html?t=' + encodeURIComponent(title) + '&s=' + encodeURIComponent(start.toISOString()) + '&e=' + encodeURIComponent(end.toISOString()) +
    (place ? '&l=' + encodeURIComponent(place) : '');
}

// Asks which calendar: Google (opens the Google Calendar app or page) or Apple and others (an .ics file).
export function addToCalendar(event: { title: string; start: Date; place?: string | null; note?: string | null }, onFail: (msg: string) => void) {
  const open = (url: string) => Linking.openURL(url).catch(() => onFail("Couldn't open your calendar. Try again in a moment."));
  Alert.alert('Add to calendar', 'Which calendar do you use?', [
    { text: 'Google Calendar', onPress: () => open(calendarLink(event)) },
    { text: 'Apple Calendar or other', onPress: () => open(icsPageLink(event)) },
    { text: 'Cancel', style: 'cancel' }
  ]);
}
