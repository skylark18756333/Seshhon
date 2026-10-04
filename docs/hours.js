// Reads opening hours in OpenStreetMap's format ("Mo-Th 16:00-24:00; Fr,Sa 16:00-02:00; Su off")
// and works out whether a venue is open. Handles the common forms: day lists and ranges, several time
// spans, times past midnight, "off", and "24/7". Holiday and month rules (PH, Dec 25) are skipped.
// Anything else it can't read gives null, and the app shows "Hours unknown" rather than guessing.
(function (root) {
  'use strict';
  var DAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
  var NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  var SKIP = /^(PH|SH|easter|week\b|\d{4}\b|(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b)/i;

  function minutes(t) {
    var m = /^(\d{1,2}):(\d{2})$/.exec(t);
    if (!m || Number(m[2]) > 59 || Number(m[1]) > 48) return null;
    return Number(m[1]) * 60 + Number(m[2]);
  }
  function daySet(sel) {   // "Mo-Fr,Su" -> [0,1,2,3,4,6]; holiday tokens are dropped
    var out = [];
    var parts = sel.split(',');
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i].trim();
      if (/^(PH|SH)$/.test(p)) continue;
      var r = /^(Mo|Tu|We|Th|Fr|Sa|Su)(?:-(Mo|Tu|We|Th|Fr|Sa|Su))?$/.exec(p);
      if (!r) return null;
      var a = DAYS.indexOf(r[1]), b = r[2] ? DAYS.indexOf(r[2]) : a;
      for (var d = a; ; d = (d + 1) % 7) { if (out.indexOf(d) < 0) out.push(d); if (d === b) break; }
    }
    return out;
  }
  function spans(text) {   // "12:00-14:00,17:00-02:00" -> [[720,840],[1020,1560]]
    var out = [], parts = text.split(',');
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i].trim(), plus = /^(\d{1,2}:\d{2})\+$/.exec(p);
      if (plus) { var s0 = minutes(plus[1]); if (s0 === null) return null; out.push([s0, 1440]); continue; }
      var r = /^(\d{1,2}:\d{2})-(\d{1,2}:\d{2})$/.exec(p);
      if (!r) return null;
      var s = minutes(r[1]), e = minutes(r[2]);
      if (s === null || e === null || s >= 1440) return null;
      if (e <= s) e += 1440;   // runs past midnight
      out.push([s, e]);
    }
    return out;
  }

  // Returns { week: [7 lists of [start, end] minutes, Monday first], always: bool } or null.
  function parse(str) {
    if (!str || typeof str !== 'string') return null;
    var text = str.replace(/"[^"]*"/g, '').trim()
      .replace(/(\d)\s*-\s*(\d)/g, '$1-$2')     // "12:00 - 00:00"
      .replace(/(\d{2})-(\d{1,2}:\d{2})\+/g, '$1-$2')   // "11:00-18:00+" (open end): keep the listed close
      // "Mo-Th 12:00-21:00, Fr 12:00-22:00": a comma before a new day list adds a rule (\u0001)
      .replace(/([\d+])\s*,\s*(?=(?:Mo|Tu|We|Th|Fr|Sa|Su|PH|SH)\b)/g, '$1\u0001');
    if (/^24\/7$/.test(text)) return { week: DAYS.map(function () { return [[0, 1440]]; }), always: true };
    var week = DAYS.map(function () { return []; }), used = 0;
    var rules = text.split(/(;|\|\||\u0001)/);
    for (var i = 0; i < rules.length; i += 2) {
      var rule = rules[i].trim(), adds = rules[i - 1] === '\u0001';
      if (!rule) continue;
      if (SKIP.test(rule)) continue;
      var m = /^((?:(?:Mo|Tu|We|Th|Fr|Sa|Su|PH|SH)(?:-(?:Mo|Tu|We|Th|Fr|Sa|Su))?)(?:\s*,\s*(?:(?:Mo|Tu|We|Th|Fr|Sa|Su|PH|SH)(?:-(?:Mo|Tu|We|Th|Fr|Sa|Su))?))*)?\s*(.*)$/.exec(rule);
      var days = m[1] ? daySet(m[1].replace(/\s+/g, '')) : [0, 1, 2, 3, 4, 5, 6];
      if (days === null) return null;
      if (m[1] && !days.length) continue;   // a holiday-only rule
      var rest = m[2].trim(), list;
      if (rest === '' ) list = [[0, 1440]];
      else if (/^(off|closed)$/i.test(rest)) list = [];
      else if (rest === '24/7') list = [[0, 1440]];
      else { list = spans(rest); if (list === null) return null; }
      days.forEach(function (d) { week[d] = adds ? week[d].concat(list).sort(function (a, b) { return a[0] - b[0]; }) : list.slice(); });
      used++;
    }
    if (!used) return null;
    return { week: week, always: week.every(function (l) { return l.length === 1 && l[0][0] === 0 && l[0][1] >= 1440; }) };
  }

  function clock(min) {
    min = ((min % 1440) + 1440) % 1440;
    var h = Math.floor(min / 60), m = min % 60;
    if (h === 0 && m === 0) return 'midnight';
    if (h === 12 && m === 0) return 'midday';
    return (h % 12 || 12) + (m ? ':' + (m < 10 ? '0' : '') + m : '') + (h < 12 ? 'am' : 'pm');
  }

  // dow: 0 = Monday; min: minutes since midnight, both in the venue's local time.
  // Returns { open: bool, text: 'Open till 1am' | 'Opens Fri 5pm' | ... }.
  function status(h, dow, min) {
    if (!h) return null;
    if (h.always) return { open: true, text: 'Open 24 hours' };
    var w = h.week;
    // From a span ending at `end` (minutes from the start of `day`), follow spans that pick up at
    // midnight on the next day. Returns minutes from now until closing, or null if it never closes.
    function untilClose(day, end) {
      var left = end - min;
      for (var k = 0; k < 7; k++) {
        if (end !== 1440) return left;
        day = (day + 1) % 7;
        var next = w[day].filter(function (x) { return x[0] === 0; })[0];
        if (!next) return left;
        end = next[1]; left += next[1];
      }
      return null;
    }
    var y = (dow + 6) % 7, i, s;
    for (i = 0; i < w[y].length; i++) {
      s = w[y][i];
      if (s[1] > 1440 && min < s[1] - 1440) return closing(min, s[1] - 1440 - min);
    }
    for (i = 0; i < w[dow].length; i++) {
      s = w[dow][i];
      if (min >= s[0] && min < s[1]) return closing(min, untilClose(dow, s[1]));
    }
    for (var off = 0; off < 8; off++) {
      var d = (dow + off) % 7, starts = w[d].map(function (x) { return x[0]; }).filter(function (x) { return off > 0 || x > min; }).sort(function (a, b) { return a - b; });
      if (starts.length) {
        var when = off === 0 ? '' : off === 1 ? 'tomorrow ' : NAMES[d] + ' ';
        return { open: false, text: 'Opens ' + when + clock(starts[0]) };
      }
    }
    return { open: false, text: 'Closed' };
  }
  function closing(min, left) {
    if (left === null) return { open: true, text: 'Open 24 hours' };
    var soon = left <= 60;
    return { open: true, soon: soon, text: (soon ? 'Closes soon, ' : 'Open till ') + clock(min + left) };
  }

  // One line per day for the venue page: "Mon  4pm – 1am".
  function table(h) {
    if (!h) return null;
    return h.week.map(function (list, d) {
      return { day: NAMES[d], text: list.length ? list.map(function (s) { return s[0] === 0 && s[1] >= 1440 ? 'Open all day' : clock(s[0]) + ' – ' + clock(s[1]); }).join(', ') : 'Closed' };
    });
  }

  var api = { parse: parse, status: status, table: table, clock: clock };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.SeshHours = api;
})(this);
