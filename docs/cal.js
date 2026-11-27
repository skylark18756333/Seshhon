// Add to calendar: the Crewzy phone app opens this page with the sesh in the address (title, start, end, venue).
// "Apple Calendar or other" makes a standard .ics file in the browser; iPhone, Android and computer calendars all
// open it. "Google Calendar" opens Google's new-event page. Nothing is sent anywhere: it all happens on this page.
(function () {
  var q = new URLSearchParams(location.search);
  var title = (q.get('t') || 'Crewzy sesh').slice(0, 120), place = (q.get('l') || '').slice(0, 120);
  var start = new Date(q.get('s') || ''), end = new Date(q.get('e') || '');
  var box = document.getElementById('cal');
  if (isNaN(start)) { box.innerHTML = '<p>This calendar link is missing its time. Go back to Crewzy and tap Add to calendar again.</p>'; return; }
  if (isNaN(end) || end <= start) end = new Date(start.getTime() + 3 * 3600000);
  var stamp = function (d) { return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, ''); };
  var esc = function (s) { return String(s).replace(/[\;,]/g, '\\$&').replace(/\n/g, '\\n'); };
  var note = 'Planned on Crewzy. Open the app to chat, vote and see who is in.';
  var ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Crewzy//Sesh//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'BEGIN:VEVENT',
    'UID:' + stamp(start) + '-' + Math.random().toString(36).slice(2) + '@frendzy.au', 'DTSTAMP:' + stamp(new Date()),
    'DTSTART:' + stamp(start), 'DTEND:' + stamp(end), 'SUMMARY:' + esc(title), place ? 'LOCATION:' + esc(place) : '', 'DESCRIPTION:' + esc(note),
    'BEGIN:VALARM', 'TRIGGER:-PT1H', 'ACTION:DISPLAY', 'DESCRIPTION:' + esc(title), 'END:VALARM', 'END:VEVENT', 'END:VCALENDAR'].filter(Boolean).join('\r\n');
  var google = 'https://calendar.google.com/calendar/render?action=TEMPLATE&text=' + encodeURIComponent(title) + '&dates=' + stamp(start) + '/' + stamp(end) +
    '&details=' + encodeURIComponent(note) + (place ? '&location=' + encodeURIComponent(place) : '');
  var when = start.toLocaleString('en-AU', { weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit' });
  document.getElementById('what').textContent = title;
  document.getElementById('when').textContent = when + (place ? ', ' + place : '');
  var apple = document.getElementById('apple'), goog = document.getElementById('google');
  apple.href = URL.createObjectURL(new Blob([ics], { type: 'text/calendar;charset=utf-8' }));
  apple.download = 'crewzy-sesh.ics';
  goog.href = google;
})();
