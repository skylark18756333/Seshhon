// Frendzy web app. Loaded by index.html; kept in its own file so the page can forbid inline scripts.
(function () {
  'use strict';
  var CFG = window.SESHHON_CONFIG || window.SESSHON_CONFIG || {};
  var API_URL = String(CFG.url || '').replace(/\/+$/, '');
  var API_KEY = String(CFG.key || '');
  var POLL_MS = Number(CFG.pollMs) || 5000;
  var CHAT_POLL_MS = Number(CFG.chatPollMs) || 2500;
  var DEALS_ON = CFG.deals === true;
  var GOOGLE_ON = CFG.googleRatings === true;   // set googleRatings: true in config.js once the google-rating Edge Function and key are set up
  var CAPTCHA_KEY = String(CFG.captchaSiteKey || '');   // Cloudflare Turnstile site key; when set, sign-up asks for a quick human check   // deals are switched off for now; set deals: true in config.js to bring them back
  var SESSION_KEY = 'seshhon-session-v1';
  var INVITE_KEY = 'seshhon-pending-invite';
  var DEVICE_KEY = 'seshhon-remembered-phone';   // per account: the secret that lets this phone skip the email code (migration 0023)
  var LAST_USER_KEY = 'seshhon-last-username';   // filled in on the login screen next time
  var UNDERAGE_KEY = 'seshhon-under-18';
  var SIGNUP_KEY = 'seshhon-signup-waiting';   // name and date of birth, kept in this tab only while the age check runs
  var PROVIDER_NAMES = { yoti: 'Yoti', didit: 'Didit' };

  var COLORS = { on: 'var(--on)', thinking: 'var(--thinking)', off: 'var(--off)' };
  var LABELS = { on: 'Green', thinking: 'Amber', off: 'Red' };
  var STOPS = ['on', 'thinking', 'off'];   // left to right on the status switch: G, A, R
  var STATUS_ICON = { on: 'tick', thinking: 'query', off: 'cross' };
  var TAGS = ['Good vibe', 'Good value', 'Fast service'];
  var RADIUS_KEY = 'seshon-radius-km';
  var MAP_CENTRE = Array.isArray(CFG.mapCentre) ? CFG.mapCentre : [-31.9523, 115.8613];   // where the venue map starts: Perth CBD unless config.js says otherwise

  /* ---------- small helpers ---------- */
  function store(key, value) {
    try {
      if (value === undefined) return JSON.parse(localStorage.getItem(key) || 'null');
      if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {}
    return null;
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function initials(n) { var p = String(n || '?').trim().split(/\s+/); return esc(((p[0] || '?').charAt(0) + (p[1] ? p[1].charAt(0) : '')).toUpperCase()); }
  function first(n) { return String(n || 'Someone').trim().split(/\s+/)[0]; }
  function fmtLeft(ms) {
    if (ms < 0) ms = 0;
    var s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
    if (h > 0) return h + 'h ' + m + 'm';
    return (m < 10 ? '0' : '') + m + ':' + (r < 10 ? '0' : '') + r;
  }
  function fmtClock(hhmm) {
    var parts = String(hhmm).split(':'), h = Number(parts[0]), m = Number(parts[1]);
    if (h === 23 && m === 59) return 'midnight';
    var suffix = h >= 12 ? 'pm' : 'am', twelve = h % 12 || 12;
    return twelve + (m ? ':' + (m < 10 ? '0' : '') + m : '') + suffix;
  }

  function fmtTime(iso) {
    var d = new Date(iso);
    if (isNaN(d)) return '';
    var h = d.getHours(), m = d.getMinutes();
    return (h % 12 || 12) + ':' + (m < 10 ? '0' : '') + m + (h >= 12 ? ' pm' : ' am');
  }

  /* ---------- talking to the database ---------- */
  var session = store(SESSION_KEY);
  var refreshing = null;

  function saveSession(body) {
    if (!body || !body.access_token) throw new Error('Sign-in did not work. Try again.');
    session = {
      access_token: body.access_token,
      refresh_token: body.refresh_token,
      expires_at: body.expires_at || Math.floor(Date.now() / 1000) + (body.expires_in || 3600),
      user_id: (body.user && body.user.id) || (session && session.user_id) || null
    };
    store(SESSION_KEY, session);
  }
  function authCall(path, body) {
    return fetch(API_URL + '/auth/v1/' + path, {
      method: 'POST',
      headers: { apikey: API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).then(function (res) {
      return res.text().then(function (text) {
        var json = null;
        try { json = text ? JSON.parse(text) : null; } catch (e) {}
        if (!res.ok) {
          var err = new Error((json && (json.msg || json.message || json.error_description)) || 'Sign-in did not work. Try again.');
          err.status = res.status;
          throw err;
        }
        return json;
      });
    });
  }
  function signInAnonymously(captchaToken) {
    return authCall('signup', { data: {}, gotrue_meta_security: captchaToken ? { captcha_token: captchaToken } : {} }).then(saveSession);
  }
  // Username and password logins. Supabase Auth logs in with an email, so the username becomes an address at
  // a domain that can never receive mail (see supabase/migrations/0008_username_login.sql). No real email is used.
  function loginEmail(username) { return String(username || '').trim().toLowerCase() + '@users.seshon.invalid'; }
  function signInWithPassword(username, password, captchaToken) {
    return authCall('token?grant_type=password', {
      email: loginEmail(username), password: password,
      gotrue_meta_security: captchaToken ? { captcha_token: captchaToken } : {}
    }).then(saveSession, function (e) {
      if (e.status === 400) throw new Error('That username and password don\'t match.');
      throw e;
    });
  }

  // The human check on sign-up (Cloudflare Turnstile), so bots can't make accounts in bulk.
  // Only used when config.js has a captchaSiteKey, and Supabase Auth has CAPTCHA protection switched on.
  var captchaToken = '', captchaWidget = null, captchaLoading = false;
  function mountCaptcha() {
    var box = document.getElementById('captcha');
    if (!CAPTCHA_KEY || !box || box.childNodes.length) return;
    if (!window.turnstile) {
      if (captchaLoading) return;
      captchaLoading = true;
      var s = document.createElement('script');
      s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      s.async = true;
      s.onload = function () { captchaLoading = false; mountCaptcha(); };
      s.onerror = function () { captchaLoading = false; };
      document.head.appendChild(s);
      return;
    }
    captchaToken = '';
    captchaWidget = window.turnstile.render(box, {
      sitekey: CAPTCHA_KEY,
      callback: function (t) { captchaToken = t; },
      'expired-callback': function () { captchaToken = ''; },
      'error-callback': function () { captchaToken = ''; }
    });
  }
  function useCaptcha() {   // a token works once, so get a fresh one for any retry
    var t = captchaToken;
    captchaToken = '';
    if (window.turnstile && captchaWidget !== null) { try { window.turnstile.reset(captchaWidget); } catch (e) {} }
    return t;
  }
  function refreshSession() {
    if (!refreshing) {
      refreshing = authCall('token?grant_type=refresh_token', { refresh_token: session.refresh_token })
        .then(saveSession)
        .catch(function (e) {
          // A refresh token that is refused means this phone's sign-in is gone for good.
          if (e.status === 400 || e.status === 401 || e.status === 403) { session = null; store(SESSION_KEY, null); }
          throw e;
        })
        .then(function () { refreshing = null; }, function (e) { refreshing = null; throw e; });
    }
    return refreshing;
  }
  function rpc(fn, args, retried) {
    var ready = session && session.expires_at - Date.now() / 1000 < 60 ? refreshSession() : Promise.resolve();
    return ready.then(function () {
      if (!session) { var gone = new Error('You have been signed out.'); gone.signedOut = true; throw gone; }
      return fetch(API_URL + '/rest/v1/rpc/' + fn, {
        method: 'POST',
        headers: { apikey: API_KEY, Authorization: 'Bearer ' + session.access_token, 'Content-Type': 'application/json' },
        body: JSON.stringify(args || {})
      });
    }).then(function (res) {
      if (res.status === 401 && !retried) return refreshSession().then(function () { return rpc(fn, args, true); });
      return res.text().then(function (text) {
        var json = null;
        try { json = text ? JSON.parse(text) : null; } catch (e) {}
        if (!res.ok && json && json.code === 'PGRST202') {
          // The database is missing a function this page calls: an update in supabase/ has not been run yet.
          console.error('Frendzy database is out of date. Run supabase/update.sql in the Supabase SQL editor.', json.message);
          var old = new Error('Frendzy is being updated. Try again soon.'); old.missing = true; throw old;
        }
        if (!res.ok) throw new Error((json && json.message) || 'Something went wrong. Try again.');
        return json;
      });
    });
  }

  // The age check runs in a Supabase Edge Function, which holds the provider's keys.
  function ageCheckCall(action, extra) {
    var ready = session && session.expires_at - Date.now() / 1000 < 60 ? refreshSession() : Promise.resolve();
    return ready.then(function () {
      if (!session) { var gone = new Error('You have been signed out.'); gone.signedOut = true; throw gone; }
      var body = { action: action };
      for (var k in extra || {}) body[k] = extra[k];
      return fetch(API_URL + '/functions/v1/age-check', {
        method: 'POST',
        headers: { apikey: API_KEY, Authorization: 'Bearer ' + session.access_token, 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
    }).then(function (res) {
      return res.text().then(function (text) {
        var json = null;
        try { json = text ? JSON.parse(text) : null; } catch (e) {}
        if (!res.ok) throw new Error((json && json.message) || 'The age check is not working right now. Try again soon.');
        return json;
      });
    });
  }
  // Login codes are emailed by the email-code Edge Function, which holds the email service key.
  function emailCode(action, extra) {
    var body = { action: action };
    for (var k in extra || {}) body[k] = extra[k];
    var ready = session && session.expires_at - Date.now() / 1000 < 60 ? refreshSession() : Promise.resolve();
    return ready.then(function () {
      if (!session) throw new Error('You have been signed out.');
      return fetch(API_URL + '/functions/v1/email-code', {
        method: 'POST',
        headers: { apikey: API_KEY, Authorization: 'Bearer ' + session.access_token, 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
    }).then(function (res) {
      return res.json().catch(function () { return null; }).then(function (json) {
        if (!res.ok) throw new Error((json && json.message) || 'The email could not be sent. Try again soon.');
        return json;
      });
    });
  }
  // Google ratings come from the google-rating Edge Function, which holds the Google key. Google's terms
  // don't allow storing ratings, so they live in memory only and go when the page closes.
  var gRatings = {};   // venue id -> 'loading' | null (none) | { rating, count, url }
  function googleRating(id) {
    if (!GOOGLE_ON || !session || id in gRatings) return;
    gRatings[id] = 'loading';
    fetch(API_URL + '/functions/v1/google-rating', {
      method: 'POST',
      headers: { apikey: API_KEY, Authorization: 'Bearer ' + session.access_token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ venue: id })
    }).then(function (res) { return res.ok ? res.json() : null; }).then(function (r) {
      gRatings[id] = r && r.found ? { rating: Number(r.rating), count: Number(r.count) || 0, url: r.url } : null;
      if (r && r.enabled === false) GOOGLE_ON = false;
      render();
    }, function () { gRatings[id] = null; });
  }
  function googleLine(id) {   // "4.4 ★ on Google Maps (812)", linked to Google Maps as Google asks
    var g = gRatings[id];
    if (!g || g === 'loading') return '';
    var label = '<strong>' + g.rating.toFixed(1) + '</strong> ★ on Google Maps (' + g.count + ')';
    return /^https:\/\/(maps\.google\.com|www\.google\.com|maps\.app\.goo\.gl)\//.test(g.url || '') ? '<a href="' + esc(g.url) + '" target="_blank" rel="noopener">' + label + '</a>' : label;
  }
  function waiting(value) {   // the sign-up details waiting on the age check; sessionStorage, so they go when the tab closes
    try {
      if (value === undefined) return JSON.parse(sessionStorage.getItem(SIGNUP_KEY) || 'null');
      if (value === null) sessionStorage.removeItem(SIGNUP_KEY); else sessionStorage.setItem(SIGNUP_KEY, JSON.stringify(value));
    } catch (e) {}
    return null;
  }

  /* ---------- state ---------- */
  var D = null;            // the latest answer from api_state()
  var lastKey = '';        // used to skip redraws when nothing changed
  var clockOffset = 0;     // server time minus this phone's time
  var ui = { messages: [], tab: 'home', screen: null, confirm: null, staffError: '', offline: false, booted: false, linkShown: false, age: null, ageNote: '', ageBusy: false, auth: null, account: undefined, newCode: null, editAccount: false, twoStep: undefined, emailStep: null, sets: {} };
  ui.radiusKm = Math.min(25, Math.max(1, Number(store(RADIUS_KEY)) || 5));
  var seen = null;         // friend id -> colour at the last look, for "just went on" notices
  var acting = false;

  var view = document.getElementById('view'), tabs = document.getElementById('tabs'), toastEl = document.getElementById('toast');
  var toastTimer = null;
  function toast(msg) {
    toastEl.textContent = msg; toastEl.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { toastEl.hidden = true; }, 3600);
  }
  function now() { return Date.now() + clockOffset; }
  function perthHour() {
    try {
      var parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Australia/Perth', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(now())).split(':');
      return (Number(parts[0]) % 24) + Number(parts[1]) / 60;
    } catch (e) { var d = new Date(now()); return d.getHours() + d.getMinutes() / 60; }
  }
  function todayPerth() {
    try { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Perth', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now())); }
    catch (e) { return new Date(now()).toISOString().slice(0, 10); }
  }
  function eighteenYearsAgo() {
    var t = todayPerth().split('-');
    return (Number(t[0]) - 18) + '-' + t[1] + '-' + t[2];   // someone born on or before this date is 18 or over
  }
  function venueById(id) { return (D.venues || []).filter(function (v) { return v.id === id; })[0]; }
  function dealById(id) { return (D.deals || []).filter(function (d) { return d.id === id; })[0]; }
  // Planned seshes (migration 0025) start later. Until then they only show under "Planned", and never as tonight's sesh.
  function isPlanned(s) { return !!(s && s.planned && new Date(s.starts_at).getTime() > now()); }
  function liveSesh() { return (D.seshes || []).filter(function (s) { return s.am_member && !isPlanned(s); })[0] || null; }
  // The sesh the Sesh tab shows: one opened from the Planned list, or else the one you're in tonight.
  function mySesh() {
    var open = ui.seshId && (D.seshes || []).filter(function (s) { return s.am_member && s.id === ui.seshId; })[0];
    return open || liveSesh();
  }
  function plannedSeshes() {
    return (D.seshes || []).filter(isPlanned).sort(function (a, b) { return new Date(a.starts_at) - new Date(b.starts_at); });
  }
  // "Tonight, 8 pm", "Tomorrow, 7:30 pm" or "Sat 10 Oct, 8 pm", in this phone's time.
  function fmtWhen(iso) {
    var d = new Date(iso), t = new Date(now()), day = 86400000;
    if (isNaN(d)) return '';
    var midnight = new Date(t.getFullYear(), t.getMonth(), t.getDate()).getTime(), diff = Math.floor((d.getTime() - midnight) / day);
    var dayText = diff === 0 ? 'Today' : diff === 1 ? 'Tomorrow'
      : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()] + ' ' + d.getDate() + ' ' + ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()];
    return dayText + ', ' + fmtTime(iso);
  }
  // A datetime-local value ("2026-10-10T20:00") in this phone's time.
  function localInput(ms) {
    var d = new Date(ms), two = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + two(d.getMonth() + 1) + '-' + two(d.getDate()) + 'T' + two(d.getHours()) + ':' + two(d.getMinutes());
  }
  function inviteLink() { return location.origin + location.pathname + '?invite=' + D.me.invite_code; }

  // Whether this person still needs the third-party age check. An older database without it means "no".
  function loadAge() {
    return rpc('age_check_state').then(function (a) { ui.age = a || { required: false }; }, function () { ui.age = ui.age || { required: false }; });
  }
  function needsAgeCheck() { return !!(session && ui.age && ui.age.required && !ui.age.passed); }
  // The username, if this account has one. An older database without it means the feature is hidden.
  function loadAccount() {
    return rpc('my_account').then(function (a) { ui.account = a || null; }, function () { ui.account = 'off'; });
  }
  var photos = {}, photosKey = '', photosAt = 0;
  function loadPhotos() {
    return rpc('friend_photos').then(function (p) { photos = p || {}; photosAt = Date.now(); }, function () { photosAt = Date.now(); });
  }
  function loadSafety() {
    return rpc('my_safety').then(function (sf) { ui.safety = sf || { gender: null, women_only: false }; }, function () { ui.safety = 'off'; });
  }
  // Venues come from api_venues(), fetched on their own and kept, so the refresh every few seconds stays small.
  // An older database still sends them inside api_state(); then that copy is used.
  var VENUES = null, venuesAt = 0, venuesAsked = false;
  function loadVenues() {
    venuesAsked = true;
    return rpc('api_venues').then(function (list) {
      VENUES = Array.isArray(list) ? list : []; venuesAt = Date.now();
      if (D) { D.venues = VENUES; lastKey = ''; }
    }, function () { venuesAt = Date.now(); });
  }
  // Busy and trending venues for the map (api_buzz): counts only, never who is going where.
  var BUZZ = {}, buzzAt = 0;
  function loadBuzz() {
    buzzAt = Date.now();
    return rpc('api_buzz').then(function (list) {
      BUZZ = {};
      (Array.isArray(list) ? list : []).forEach(function (b) { BUZZ[b.id] = b; });
      if (ui.tab === 'map' && !ui.screen) { drawMap(); var l = document.getElementById('venue-list'); if (l) l.innerHTML = venueList(); }
    }, function () {});   // an older database without api_buzz: the map just has no glows
  }
  function freshVenues(maxAgeMs) {   // fetch again if older than maxAgeMs, then redraw
    if (D && D.legacyVenues) return Promise.resolve();
    if (VENUES && Date.now() - venuesAt < maxAgeMs) return Promise.resolve();
    return loadVenues().then(function () { render(); });
  }
  // Whether this login still needs its email code (migration 0018). An older database without it means "no".
  function loadTwoStep() {
    return rpc('two_step_state').then(function (t) { ui.twoStep = t || { needed: false }; }, function () { ui.twoStep = { needed: false, off: true }; });
  }
  function sendLoginCode() {
    var note = document.getElementById('ts-note'), err = document.getElementById('ts-error');
    if (note) note.textContent = 'Sending a code...';
    if (err) err.hidden = true;
    return emailCode('login').then(function (r) {
      var n = document.getElementById('ts-note');
      if (n) n.textContent = 'We sent a 6-digit code to ' + r.hint + '. It works for 10 minutes.';
    }, function (x) {
      var n = document.getElementById('ts-note'), e = document.getElementById('ts-error');
      if (n) n.textContent = '';
      if (e) { e.textContent = x.message; e.hidden = false; }
    });
  }
  // Remembered phones (migration 0023): after the email code, this phone keeps a secret for that account,
  // and its next logins skip the code for 30 days. The password is still needed.
  function rememberedPhones() { var all = store(DEVICE_KEY); return all && typeof all === 'object' ? all : {}; }
  function forgetPhone(userId) { var all = rememberedPhones(); delete all[userId]; store(DEVICE_KEY, all); }
  function rememberPhone() {
    var uid = session && session.user_id;
    if (!uid) return Promise.resolve();
    return rpc('two_step_remember_device').then(function (token) {
      var all = rememberedPhones();
      if (token) all[uid] = token; else delete all[uid];
      store(DEVICE_KEY, all);
    }, function () {});   // an older database without 0023: the code is just asked for next time
  }
  function useRememberedPhone() {
    var uid = session && session.user_id, token = uid && rememberedPhones()[uid];
    if (!token) return Promise.resolve(false);
    return rpc('two_step_use_device', { p_token: token }).then(function (ok) {
      if (!ok) { forgetPhone(uid); return false; }
      return refreshSession().then(function () { return true; });   // a fresh sign-in token, now with full access
    }, function () { return false; });
  }
  function load(quiet) {
    if (session && ui.twoStep === undefined) {
      return loadTwoStep().then(function () {
        if (!ui.twoStep.needed) return load(quiet);
        return useRememberedPhone().then(function (skipped) {
          if (skipped) { ui.twoStep = { needed: false }; return load(quiet); }
          ui.booted = true; render(); return sendLoginCode();
        });
      });
    }
    if (session && ui.twoStep.needed) { render(); return Promise.resolve(); }
    return (session && !ui.age ? loadAge() : Promise.resolve()).then(function () { return rpc('api_state'); }).then(function (data) {
      if (data && data.me && ui.account === undefined) return Promise.all([loadAccount(), loadSafety()]).then(function () { return data; });
      return data;
    }).then(function (data) {
      ui.offline = false;
      clockOffset = new Date(data.now).getTime() - Date.now();
      tidyState(data);
      noticeFriends(data);
      if (data.venues) data.legacyVenues = true; else data.venues = VENUES || [];
      var key = JSON.stringify([data.me, data.friends, data.requests_in, data.requests_out, data.seshes, data.legacyVenues ? data.venues : venuesAt, data.deals, data.staff_venues, data.blocked]);
      D = data; ui.booted = true;
      if (ui.tab === 'map' && !ui.screen && Date.now() - buzzAt > 60000) loadBuzz();
      if (data.me && !data.legacyVenues && !venuesAsked) loadVenues().then(function () { render(); });
      if (data.me && !pins && !pinsAsked) { pinsAsked = true; loadPins().then(function () { render(); }); }   // venue distances for the sesh vote list
      if (!quiet || key !== lastKey) { lastKey = key; render(); }
      // Photos change rarely: fetch them when the friend list changes, and otherwise once a minute.
      var pk = data.me ? JSON.stringify([data.me.id].concat((data.friends || []).map(function (f) { return f.id; }))) : '';
      if (pk && (pk !== photosKey || Date.now() - photosAt > 60000)) {
        photosKey = pk; photosAt = Date.now();
        var before = JSON.stringify(photos);
        loadPhotos().then(function () { if (JSON.stringify(photos) !== before) render(); });
      }
    }).catch(function (e) {
      if (e.signedOut || !session) { D = null; ui.booted = true; render(); return; }
      ui.offline = true; ui.booted = true;
      if (!quiet) toast(e.message);
      render();
    });
  }
  // Every list the screens read is always a list, even if the database leaves one out (an update not run yet),
  // so one missing piece can't stop the whole app with "Cannot read properties of undefined".
  function tidyState(data) {
    ['friends', 'requests_in', 'requests_out', 'seshes', 'deals', 'staff_venues', 'blocked'].forEach(function (k) {
      if (!Array.isArray(data[k])) data[k] = [];
    });
    if (data.venues && !Array.isArray(data.venues)) delete data.venues;
    data.seshes.forEach(function (s) {
      if (!Array.isArray(s.members)) s.members = [];
      if (!Array.isArray(s.votes)) s.votes = [];
    });
  }
  function noticeFriends(data) {
    var next = {};
    (data.friends || []).forEach(function (f) { next[f.id] = f.colour; });
    if (seen && data.me && data.me.colour !== 'off') {
      (data.friends || []).forEach(function (f) {
        if (f.colour === 'on' && seen[f.id] && seen[f.id] !== 'on') toast(first(f.name) + ' just went on.');
      });
    }
    seen = next;
  }
  // Taps are never dropped: if one action is still running, the next waits its turn.
  var actQueue = Promise.resolve(), actWaiting = 0;
  function act(fn, args, okMsg) {
    actWaiting += 1; acting = true;
    var run = function () {
      return rpc(fn, args).then(function (result) {
        if (okMsg) toast(okMsg);
        return load().then(function () { return result; });
      }).catch(function (e) { toast(e.message); return null; });
    };
    var p = actQueue.then(run);
    actQueue = p.then(function () {}, function () {});
    return p.then(function (result) { actWaiting -= 1; acting = actWaiting > 0; return result; });
  }

  var ICON = {
    home: '<path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/>',
    sesh: '<circle cx="9" cy="8" r="4"/><path d="M2 21c0-4 3-6 7-6s7 2 7 6"/><path d="M17 4a4 4 0 0 1 0 8"/><path d="M22 21c0-3-1-5-4-6"/>',
    deals: '<path d="M3 12V3h9l9 9-9 9z"/><circle cx="8" cy="8" r="1.5"/>',
    events: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
    map: '<path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/>',
    venues: '<path d="M5 3h14l-7 9z"/><path d="M12 12v8"/><path d="M8 21h8"/>',
    you: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/>',
    back: '<path d="M15 5l-7 7 7 7"/>',
    close: '<path d="M6 6l12 12"/><path d="M18 6L6 18"/>',
    send: '<path d="M21 3L10 14"/><path d="M21 3l-7 18-4-7-7-4z"/>',
    place: '<path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/>',
    arrow: '<path d="M21 3L3 10.5l7.5 3 3 7.5z"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    fork: '<path d="M7 3v8"/><path d="M4 3v5a3 3 0 0 0 6 0V3"/><path d="M7 11v10"/><path d="M17 21V3c-2.5 1-4 4-4 8h4"/>',
    // Status lamps: a tick for green (out), a question mark for amber (maybe), a cross for red (off)
    tick: '<path d="M4.5 12.5l5 5L19.5 7"/>',
    query: '<path d="M8.5 8.5a3.5 3.5 0 1 1 5.2 3c-1.1.7-1.7 1.4-1.7 2.7v.6"/><circle cx="12" cy="19" r=".6"/>',
    cross: '<path d="M6 6l12 12"/><path d="M18 6L6 18"/>',
    lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
    eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    star: '<path d="M12 3l2.7 5.6 6.1.8-4.5 4.3 1.1 6.1L12 16.9 6.6 19.8l1.1-6.1L3.2 9.4l6.1-.8z"/>'
  };
  function svg(name, size) {
    return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICON[name] + '</svg>';
  }
  function hue(name) {   // a steady colour per person for their circle until faces can be added
    var h = 0, t = String(name || '');
    for (var i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) % 360;
    return h;
  }
  function avatar(name, colour, dashed, id) {
    return '<div class="avatar' + (dashed ? ' dashed' : '') + '" style="--c:' + (colour || 'var(--line)') + '">' + face(id, name) + '</div>';
  }
  // A person's photo if they added one and you are allowed to see it, otherwise their initials.
  function face(id, name) {
    return id && photos[id] ? '<img class="pic" src="' + esc(photos[id]) + '" alt="">' : initials(name);
  }

  // The brush-script name with the traffic light beside it. With a status, only that light is lit.
  // Signed in (live), the traffic light is the status switch: tap a light to change it from any screen.
  function logo(status, live) {
    if (live) return '<div class="logo"><div class="wordmark">Frendzy</div><div class="dots switch" role="group" aria-label="Your status">' +
      STOPS.map(function (k) {
        return '<button data-act="status-here" data-v="' + k + '" aria-label="Switch to ' + LABELS[k] + '" aria-pressed="' + (k === status) + '"><i style="--c:' + COLORS[k] + '"' + (k === status ? ' class="lit"' : '') + '></i></button>';
      }).join('') + '</div></div>';
    return '<div class="logo"><div class="wordmark">Frendzy</div><div class="dots' + (status ? '' : ' all') + '" aria-hidden="true">' +
      STOPS.map(function (k) { return '<i style="--c:' + COLORS[k] + '"' + (k === status ? ' class="lit"' : '') + '></i>'; }).join('') + '</div></div>';
  }

  /* ---------- screens ---------- */
  function notConnected() {
    return '<div class="stack" style="gap:20px;margin-block:auto">' + logo() + '<h1>Not connected yet</h1>' +
      '<p class="muted">This copy of Frendzy has not been pointed at its database. Add the project address and public key to config.js.</p></div>';
  }
  function starting() {
    return '<div class="stack" style="gap:20px;margin-block:auto">' + logo() + '<p class="muted">Loading…</p></div>';
  }
  function tooYoung() {
    return '<div class="stack" style="gap:20px;margin-block:auto">' + logo() + '<h1>Frendzy is for people aged 18 and over.</h1>' +
      '<p class="muted">We can\'t set up an account for you. If you entered your date of birth wrongly, contact us through the Privacy Policy page.</p></div>';
  }
  function ageCheck() {
    var who = PROVIDER_NAMES[ui.age && ui.age.provider] || 'Our age check partner';
    var h = '<div class="stack" style="gap:20px;margin-block:auto">' + logo() + '<h1>Quick age check</h1>' +
      '<p class="muted">Frendzy is for people aged 18 and over. ' + esc(who) + ' checks your age with a quick selfie. If it can\'t tell from your face, it asks you to show ID instead.</p>' +
      '<p class="muted small">' + esc(who) + ' only tells us whether you passed. Frendzy never sees or keeps your photo or ID. See the <a href="privacy.html">Privacy Policy</a>.</p>';
    if (ui.ageNote) h += '<p class="error" id="age-note">' + esc(ui.ageNote) + '</p>';
    if (ui.age && ui.age.pending) h += '<button class="btn" data-act="age-finish"' + (ui.ageBusy ? ' disabled' : '') + '>I\'ve finished, check again</button><button class="btn ghost" data-act="age-start"' + (ui.ageBusy ? ' disabled' : '') + '>Start again</button>';
    else h += '<button class="btn" data-act="age-start"' + (ui.ageBusy ? ' disabled' : '') + '>Start age check</button>';
    return h + '</div>';
  }
  function welcome() {
    if (store(UNDERAGE_KEY)) return tooYoung();
    var invited = store(INVITE_KEY);
    return '<div class="stack" style="gap:24px;margin-block:auto">' +
      logo() +
      '<h1>Tell your friends you\'re up for a sesh.</h1>' +
      '<p class="muted">' + (invited ? 'A friend invited you. Sign up and they will get your friend request.' : 'Go green when you\'re keen, see which friends are too, and pick a place together.') + '</p>' +
      '<form id="join" class="stack" style="gap:16px" novalidate>' +
      '<div class="field"><label for="name">Your first name</label><input id="name" type="text" autocomplete="given-name" maxlength="24"></div>' +
      '<div class="field"><label for="dob">Date of birth</label><input id="dob" type="date" autocomplete="bday" min="1900-01-01"><span class="muted small">Frendzy is for people aged 18 and over. We only use this to check your age and do not keep it.</span></div>' +
      '<div class="field"><label for="join-user">Pick a username</label><input id="join-user" type="text" autocomplete="username" autocapitalize="none" spellcheck="false" maxlength="20"><span class="muted small">3 to 20 letters, numbers or _. Friends add you with it.</span></div>' +
      '<div class="field"><label for="join-pass">Make a password</label>' + passwordInput('join-pass', 'new-password') + '<span class="muted small">At least 10 characters. You use it to log in on another phone.</span></div>' +
      '<div class="field"><label for="join-email">Your email</label><input id="join-email" type="email" autocomplete="email" autocapitalize="none" spellcheck="false" maxlength="254"><span class="muted small">We email you a code to confirm it, and again whenever you log in on a new phone. Nobody else ever sees it.</span></div>' +
      (CAPTCHA_KEY ? '<div id="captcha"></div>' : '') +
      '<p id="join-error" class="error" hidden></p>' +
      '<button class="btn" type="submit" id="join-btn">Get started</button>' +
      '<p class="muted small">By continuing you agree to the <a href="terms.html">Terms</a> and <a href="privacy.html">Privacy Policy</a>.</p>' +
      '</form><button class="btn ghost" data-act="auth" data-v="login">I already have an account</button></div>';
  }
  // A password box with an eye button that shows what was typed, so typos are easy to spot.
  function passwordInput(id, autocomplete, keep) {
    return '<div class="pw"><input id="' + id + '"' + (keep ? ' data-keep' : '') + ' type="password" autocomplete="' + autocomplete + '" maxlength="72">' +
      '<button type="button" class="peek" data-act="peek" data-v="' + id + '" aria-label="Show password" aria-pressed="false">' + svg('eye', 20) + '</button></div>';
  }
  function loginScreen() {
    return '<div class="stack" style="gap:24px;margin-block:auto">' + logo() + '<h1>Log in</h1>' +
      '<form id="login" class="stack" style="gap:16px" novalidate>' +
      '<div class="field"><label for="login-user">Username</label><input id="login-user" type="text" autocomplete="username" autocapitalize="none" spellcheck="false" maxlength="20" value="' + esc(ui.loginName || store(LAST_USER_KEY) || '') + '"></div>' +
      '<div class="field"><label for="login-pass">Password</label>' + passwordInput('login-pass', 'current-password') + '</div>' +
      (CAPTCHA_KEY ? '<div id="captcha"></div>' : '') +
      '<p id="login-error" class="error" hidden></p>' +
      '<button class="btn" type="submit" id="login-btn">Log in</button></form>' +
      '<button class="btn ghost" data-act="auth" data-v="recover">Forgot your password?</button>' +
      '<button class="btn ghost" data-act="auth" data-v="">Back</button></div>';
  }
  // After the password, a login on an account with email codes waits here for the code.
  function twoStepScreen() {
    return '<div class="stack" style="gap:24px;margin-block:auto" id="two-step-screen">' + logo() + '<h1>Check your email</h1>' +
      '<p class="muted" id="ts-note">' + (ui.twoStep && ui.twoStep.hint ? 'We sent a 6-digit code to ' + esc(ui.twoStep.hint) + '.' : '') + '</p>' +
      '<form id="two-step" class="stack" style="gap:16px" novalidate>' +
      '<div class="field"><label for="ts-code">Code from the email</label><input id="ts-code" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="7" spellcheck="false"></div>' +
      '<label class="check"><input id="ts-remember" type="checkbox" checked> Remember this phone for 30 days</label>' +
      '<p id="ts-error" class="error" hidden></p>' +
      '<button class="btn" type="submit" id="ts-btn">Log in</button></form>' +
      '<button class="btn ghost" data-act="ts-resend">Send a new code</button>' +
      '<button class="btn ghost" data-act="ts-recover">Can\'t get the email? Use your recovery code</button>' +
      '<button class="btn ghost" data-act="logout">Cancel</button></div>';
  }
  // Confirming the login email, right after saving a username and password (or adding an email later).
  function emailCard() {
    return '<div class="stack" style="gap:12px"><h2>Confirm your email</h2>' +
      '<p class="muted small">We sent a 6-digit code to <strong>' + esc(ui.emailStep.hint) + '</strong>. Once it\'s confirmed, every new login asks for a code from this email as well as your password.</p>' +
      '<form id="email-confirm" class="stack" style="gap:12px" novalidate>' +
      '<div class="field"><label for="ec-code">Code from the email</label><input id="ec-code" data-keep type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="7" spellcheck="false"></div>' +
      '<p id="ec-error" class="error" hidden></p>' +
      '<button class="btn" type="submit" id="ec-btn">Confirm email</button></form>' +
      '<div class="row"><button class="btn small-btn ghost" data-act="email-resend">Send again</button><button class="btn small-btn ghost" data-act="email-skip">Later</button></div></div>';
  }
  function emailField(label) {
    return '<div class="field"><label for="save-email">' + label + '</label><input id="save-email" data-keep type="email" autocomplete="email" autocapitalize="none" spellcheck="false" maxlength="254"><span class="muted small">For login codes only. Nobody else ever sees it.</span></div>';
  }
  // A copy of a new recovery code goes to the account's confirmed email (migration 0022). It stays on
  // screen too, in case the email doesn't arrive. Accounts without a confirmed email just skip this.
  function emailRecovery() {
    var c = ui.newCode;
    if (!c || c.emailed || !session) return Promise.resolve();
    return emailCode('recovery', { username: c.username, code: c.code }).then(function (r) {
      c.emailed = r.hint;
      var el = document.getElementById('rc-emailed');
      if (el && ui.newCode === c) el.innerHTML = 'We also emailed it to <strong>' + esc(r.hint) + '</strong>. Keep that email.';
    }, function () {});
  }
  function emailsOn() { return !!(ui.twoStep && !ui.twoStep.off); }
  function recoverScreen() {
    return '<div class="stack" style="gap:24px;margin-block:auto">' + logo() + '<h1>Use your recovery code</h1>' +
      '<p class="muted">Enter the recovery code you saved when you made your password, and choose a new password.</p>' +
      '<form id="recover" class="stack" style="gap:16px" novalidate>' +
      '<div class="field"><label for="rec-user">Username</label><input id="rec-user" type="text" autocomplete="username" autocapitalize="none" spellcheck="false" maxlength="20" value="' + esc(ui.loginName || '') + '"></div>' +
      '<div class="field"><label for="rec-code">Recovery code</label><input id="rec-code" type="text" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="24" placeholder="XXXX-XXXX-XXXX-XXXX"></div>' +
      '<div class="field"><label for="rec-pass">New password</label>' + passwordInput('rec-pass', 'new-password') + '<span class="muted small">At least 10 characters.</span></div>' +
      (CAPTCHA_KEY && !session ? '<div id="captcha"></div>' : '') +
      '<p id="rec-error" class="error" hidden></p>' +
      '<button class="btn" type="submit" id="rec-btn">Set new password</button></form>' +
      '<button class="btn ghost" data-act="auth" data-v="login">Back</button></div>';
  }
  // Shown once, right after a recovery code is made.
  function codeCard() {
    return '<div class="stack" style="gap:12px" id="newcode"><h2>Save your recovery code</h2>' +
      '<p class="muted small">If you forget your password, this code is the only way back into your account. Screenshot it or write it down. It won\'t be shown again.</p>' +
      '<div class="linkbox" style="font-size:20px;font-weight:700;letter-spacing:1px;text-align:center" id="recovery-code">' + esc(ui.newCode.code) + '</div>' +
      '<p class="muted small">Your username is <strong>' + esc(ui.newCode.username) + '</strong>.</p>' +
      '<p class="small" id="rc-emailed">' + (ui.newCode.emailed ? 'We also emailed it to <strong>' + esc(ui.newCode.emailed) + '</strong>. Keep that email.' : '') + '</p>' +
      '<button class="btn" data-act="code-saved">I\'ve saved it</button></div>';
  }
  function saveForm(username, askEmail) {
    return '<form id="save-account" class="stack" style="gap:12px" novalidate>' +
      '<div class="field"><label for="save-user">Username</label><input id="save-user" data-keep type="text" autocomplete="username" autocapitalize="none" spellcheck="false" maxlength="20" value="' + esc(username || '') + '"><span class="muted small">3 to 20 letters, numbers or _. Friends who know it can add you.</span></div>' +
      '<div class="field"><label for="save-pass">' + (username ? 'New password' : 'Password') + '</label>' + passwordInput('save-pass', 'new-password', true) + '<span class="muted small">At least 10 characters.</span></div>' +
      (askEmail ? emailField('Email') : '') +
      '<p id="save-error" class="error" hidden></p>' +
      '<button class="btn" type="submit" id="save-btn">' + (username ? 'Save and get a new recovery code' : 'Save my account') + '</button></form>';
  }

  function home() {
    var me = D.me, s = me.colour;
    var copy = {
      on: ["You're green.", "Ready to go out. Friends on green or amber can see you're up for a sesh."],
      thinking: ["You're amber.", "Thinking about it. Friends see you might be keen."],
      off: ["You're red.", "You're off and hidden, and you can't see who else is out until you slide back."]
    }[s];
    var h = '<section class="stack"><div class="eyebrow">Your status</div>' +
      '<div class="status-word" id="status-word" style="color:' + COLORS[s] + '">' + copy[0] + '</div>' +
      '<p class="muted">' + copy[1] + (s !== 'off' && me.expires_at ? ' Back to red in <span data-until="' + new Date(me.expires_at).getTime() + '" data-kind="status">' + fmtLeft(new Date(me.expires_at).getTime() - now()) + '</span>.' : '') + '</p>' +
      '<div class="slide" id="status-slide" role="group" aria-label="Set your status" style="--c:' + COLORS[s] + ';--i:' + STOPS.indexOf(s) + '"><span class="knob"></span>' +
      STOPS.map(function (k) {
        return '<button class="stop" style="--l:' + COLORS[k] + '" data-act="status" data-v="' + k + '" aria-label="' + LABELS[k] + '" aria-pressed="' + (s === k) + '">' + svg(STATUS_ICON[k], 28) + '</button>';
      }).join('') + '</div></section>';

    if (D.requests_in.length) {
      h += '<section class="stack"><h2>Friend requests</h2>' + D.requests_in.map(function (r) {
        return '<div class="card"><div class="row">' + avatar(r.name) + '<div class="grow"><strong>' + esc(r.name) + '</strong> wants to add you</div></div>' +
          (ui.confirm === 'blockreq:' + r.friendship
            ? '<div class="row"><span class="small grow">Block ' + esc(first(r.name)) + '? They won\'t be able to add you again.</span><button class="btn small-btn" style="--c:var(--off);--cf:var(--ink)" data-act="block-request" data-v="' + esc(r.friendship) + '">Block</button><button class="btn small-btn ghost" data-act="cancel-confirm">Cancel</button></div></div>'
            : '<div class="row"><button class="btn small-btn" data-act="accept" data-v="' + esc(r.friendship) + '">Accept</button>' +
              '<button class="btn small-btn ghost" data-act="unfriend" data-v="' + esc(r.friendship) + '">Decline</button>' +
              '<button class="linkbtn" data-act="ask" data-v="blockreq:' + esc(r.friendship) + '">Block</button></div></div>');
      }).join('') + '</section>';
    }

    var friends = D.friends;
    if (!friends.length) {
      h += '<div class="card"><h2>Add your friends</h2><p class="muted small">Frendzy only works with friends on it. Add them by username or send them your invite link, then accept their request when it arrives.</p>' +
        addFriendForm() + '<button class="btn ghost" data-act="share">Send your invite link</button>' + linkBox() + '</div>';
    } else if (s === 'off') {
      h += '<div class="card"><h2>Friends are hidden while you\'re red</h2><p class="muted small">Slide to green or amber to see who\'s up for it tonight.</p></div>';
    } else {
      var on = friends.filter(function (f) { return f.colour === 'on'; }).length;
      var th = friends.filter(function (f) { return f.colour === 'thinking'; }).length;
      h += '<section class="stack" style="gap:4px"><div class="row between"><h2>Up for it now</h2><span class="muted small">' + on + ' green, ' + th + ' amber</span></div>' +
        '<div class="faces">' + friends.slice().sort(function (x, y) { return STOPS.indexOf(x.colour) - STOPS.indexOf(y.colour); }).map(function (f) {
          var c = f.colour === 'off' ? 'var(--line)' : COLORS[f.colour];
          return '<div class="friend face' + (f.colour === 'off' ? ' away' : '') + '" style="--c:' + c + ';--h:' + hue(f.name) + '"><div class="face-pic">' + face(f.id, f.name) + '</div>' +
            '<div class="face-name">' + esc(first(f.name)) + '</div><div class="state" style="--c:' + (f.colour === 'off' ? 'var(--muted)' : COLORS[f.colour]) + '">' + LABELS[f.colour] + '</div></div>';
        }).join('') + '</div></section>';
      var sesh = liveSesh();
      if (s === 'on') h += '<button class="btn" data-act="go-sesh">' + (sesh ? 'Open tonight\'s sesh' : 'Start a sesh') + '</button>';
      else h += '<button class="btn" style="--c:var(--thinking);--cf:var(--ink)" data-act="tab" data-v="events">See what\'s on tonight</button>';
    }
    return h;
  }

  // Add a friend by their exact username. Hidden if the database is older than usernames.
  function addFriendForm() {
    if (ui.account === 'off') return '';
    var mine = ui.account && ui.account.username;
    return '<form id="add-friend" class="stack" style="gap:8px" novalidate>' +
      '<div class="field"><label for="friend-user">Add by username</label><div class="row"><input id="friend-user" data-keep class="grow" type="text" autocomplete="off" autocapitalize="none" spellcheck="false" maxlength="21" placeholder="their username">' +
      '<button class="btn small-btn" type="submit" id="friend-btn">Add</button></div></div>' +
      (ui.addFriendError ? '<p class="error" id="friend-error">' + esc(ui.addFriendError) + '</p>' : '') +
      '<p class="muted small">' + (mine ? 'Your username is <strong>' + esc(mine) + '</strong>. Tell your friends so they can add you.' : 'Pick a username on the You page so friends can add you too.') + '</p></form>';
  }
  function linkBox() {
    return ui.linkShown ? '<p class="muted small">Copy this link and send it to a friend:</p><div class="linkbox" id="invite-link">' + esc(inviteLink()) + '</div>' : '';
  }

  // Same rule as the database: most votes wins, and a tie goes to the venue that reached its votes first.
  function leaderOf(sesh) {
    var by = {};
    sesh.votes.forEach(function (v) {
      var t = new Date(v.voted_at).getTime();
      if (!by[v.venue_id]) by[v.venue_id] = { n: 0, firstAt: t };
      by[v.venue_id].n += 1;
      if (t < by[v.venue_id].firstAt) by[v.venue_id].firstAt = t;
    });
    var best = null;
    Object.keys(by).forEach(function (id) {
      if (!best || by[id].n > by[best].n || (by[id].n === by[best].n && by[id].firstAt < by[best].firstAt)) best = id;
    });
    return { best: best, by: by };
  }

  function chatItems() {
    if (!ui.messages.length) return '<p class="muted small">No messages yet. Say where you\'re heading.</p>';
    return ui.messages.map(function (m) {
      var mineMsg = m.sender === D.me.id;
      var h = '<div class="msg-row' + (mineMsg ? ' me' : '') + '">' + (mineMsg ? '' : avatar(m.name, 'var(--line)', false, m.sender)) + '<div class="msg-wrap">' +
        (mineMsg ? '' : '<div class="who">' + esc(first(m.name)) + '</div>') +
        '<div class="msg' + (mineMsg ? ' me' : '') + '"><div>' + esc(m.body) + '</div><span class="when">' + fmtTime(m.at) + '</span>';
      if (!mineMsg) {
        if (ui.confirm === 'report:' + m.id) h += '<div class="acts"><span class="small">Report this message?</span><button class="linkbtn" data-act="report-msg" data-v="' + esc(m.id) + '">Report</button><button class="linkbtn" data-act="cancel-confirm">Cancel</button></div>';
        else if (ui.confirm === 'block:' + m.sender) h += '<div class="acts"><span class="small">Block ' + esc(first(m.name)) + '?</span><button class="linkbtn" data-act="block-user" data-v="' + esc(m.sender) + '">Block</button><button class="linkbtn" data-act="cancel-confirm">Cancel</button></div>';
        else h += '<div class="acts"><button class="linkbtn" data-act="ask" data-v="report:' + esc(m.id) + '">Report</button><button class="linkbtn" data-act="ask" data-v="block:' + esc(m.sender) + '">Block</button></div>';
      }
      return h + '</div></div></div>';
    }).join('');
  }
  function chatHtml() {
    return '<section class="stack"><h2>Chat</h2>' +
      '<p class="muted small">Messages disappear when the sesh ends. Friends can still screenshot, so only send what you\'re happy for them to keep.</p>' +
      '<div id="chat-list" class="chat" aria-live="polite">' + chatItems() + '</div>' +
      '<form id="chat-form" class="chat-form" novalidate><input id="chat-input" type="text" maxlength="500" autocomplete="off" aria-label="Message your mates" placeholder="Type a message..."><button class="send" type="submit" id="chat-send" aria-label="Send">' + svg('send', 22) + '</button></form></section>';
  }
  function paintChat(stick) {
    var el = document.getElementById('chat-list');
    if (!el) return;
    var nearEnd = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    el.innerHTML = chatItems();
    if (stick || nearEnd) el.scrollTop = el.scrollHeight;
  }
  var chatKey = '';
  function refreshChat(force) {
    var s = D && D.me ? mySesh() : null;
    if (!s || ui.tab !== 'sesh' || ui.screen) { return Promise.resolve(); }
    return rpc('get_messages', { p_sesh: s.id }).then(function (list) {
      var key = JSON.stringify((list || []).map(function (m) { return m.id; }));
      if (!force && key === chatKey) return;
      var firstLoad = chatKey === '';
      chatKey = key; ui.messages = list || [];
      paintChat(firstLoad || force);
    }).catch(function () {});
  }

  /* ---------- venue map ----------
     Venue pins come from the database. The search centre is either a spot tapped on the map or, if the person
     asks, their location from the phone. That location is kept in memory on this phone only: it is never sent,
     saved or shown to anyone else, and it is gone when the page closes. */
  var pins = null;          // venue id -> [lat, lng], or null until loaded
  var pinsAsked = false;
  // chosen: false until the person taps the map or shares their location. Until then no venues are shown
  // (a search still finds them), so the map isn't covered in 1,500 pins nobody asked for.
  var geo = { centre: MAP_CENTRE.slice(), mine: false, busy: false, chosen: false };
  var M = { el: null, map: null, circle: null, centre: null, dots: {} };

  function loadPins() {
    return rpc('venue_pins').then(function (list) {
      pins = {};
      (list || []).forEach(function (p) { pins[p.id] = [Number(p.lat), Number(p.lng)]; });
    }, function () { pins = pins || {}; });
  }
  function km(a, b) {   // distance between two [lat, lng] points along the earth's surface
    var r = Math.PI / 180, dLat = (b[0] - a[0]) * r, dLng = (b[1] - a[1]) * r;
    var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 12742 * Math.asin(Math.min(1, Math.sqrt(h)));
  }
  // Opening hours (docs/hours.js reads OpenStreetMap's format). Times are Perth time.
  var hoursCache = {};
  function hoursOf(ven) {
    if (!ven.hours || !window.SeshHours) return null;
    if (!(ven.hours in hoursCache)) hoursCache[ven.hours] = window.SeshHours.parse(ven.hours);
    return hoursCache[ven.hours];
  }
  function perthNow() {
    var dow = 0, min = 0;
    try {
      var parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Australia/Perth', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date(now()));
      parts.forEach(function (p) {
        if (p.type === 'weekday') dow = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(p.value);
        if (p.type === 'hour') min += (Number(p.value) % 24) * 60;
        if (p.type === 'minute') min += Number(p.value);
      });
    } catch (e) { var d = new Date(now()); dow = (d.getDay() + 6) % 7; min = d.getHours() * 60 + d.getMinutes(); }
    return { dow: Math.max(0, dow), min: min };
  }
  function openState(ven) {   // { open, soon, text } or null when the hours are unknown
    var h = hoursOf(ven), t = perthNow();
    return h ? window.SeshHours.status(h, t.dow, t.min) : null;
  }
  function hoursLine(ven) { var st = openState(ven); return st ? st.text : (ven.closes || 'Hours unknown'); }
  function fmtKm(d) { return d < 1 ? Math.max(100, Math.round(d * 10) * 100) + ' m' : (d < 10 ? d.toFixed(1) : Math.round(d)) + ' km'; }
  function venueCard(ven, dist, onMap) {
    return '<div class="card"><div class="row between"><div class="grow">' + (ven.is_example ? '<div class="eyebrow">Example venue</div>' : '') +
      '<div style="font-weight:700;font-size:17px">' + esc(ven.name) + '</div>' +
      '<div class="muted small">' + esc([ven.kind, hoursLine(ven)].filter(Boolean).join(', ')) + '</div>' +
      '<div class="small">' + (dist != null ? '<strong>' + fmtKm(dist) + '</strong> away, ' : '') +
      (ven.ratings ? '<strong>' + Number(ven.average).toFixed(1) + '</strong> from ' + ven.ratings + ' rating' + (ven.ratings === 1 ? '' : 's') : 'no ratings yet') + '</div></div>' +
      '<button class="btn small-btn ghost" data-act="' + (onMap && pins && pins[ven.id] ? 'map-pick' : 'venue') + '" data-v="' + esc(ven.id) + '">' + (onMap && pins && pins[ven.id] ? 'Show' : 'Open') + '</button></div></div>';
  }
  // Snap Map style tags and filters. Busy and trending come from counts (api_buzz), never anyone's location.
  var FILTERS = [['popular', 'Popular'], ['trending', 'Trending'], ['deals', 'Deals'], ['open', 'Open now']];
  function topPick(ven) { return ven.ratings >= 3 && Number(ven.average) >= 4.3; }
  function hasDeal(ven) { return DEALS_ON && D.deals.some(function (d) { return d.venue_id === ven.id; }); }
  function busyOf(ven) { return (BUZZ[ven.id] && BUZZ[ven.id].busy) || 0; }
  function tagOf(ven) {
    if (busyOf(ven)) return 'Busy tonight';
    if (BUZZ[ven.id] && BUZZ[ven.id].trending) return 'Trending this week';
    if (topPick(ven)) return 'Top pick';
    if (hasDeal(ven)) return 'Deal on';
    return '';
  }
  function filterOk(ven) {
    var f = ui.mapFilter;
    if (!f) return true;
    if (f === 'popular') return busyOf(ven) > 0 || topPick(ven);
    if (f === 'trending') return !!(BUZZ[ven.id] && BUZZ[ven.id].trending);
    if (f === 'deals') return hasDeal(ven);
    var st = openState(ven); return !!(st && st.open);
  }
  function filterChips() {
    return '<div class="map-chips" role="group" aria-label="Show only">' + FILTERS.filter(function (f) { return f[0] !== 'deals' || DEALS_ON; }).map(function (f) {
      return '<button class="chip" data-act="map-filter" data-v="' + f[0] + '" aria-pressed="' + (ui.mapFilter === f[0]) + '">' + f[1] + '</button>';
    }).join('') + '</div>';
  }
  function filterName() { return (FILTERS.filter(function (f) { return f[0] === ui.mapFilter; })[0] || [])[1] || ''; }
  // With a filter on but no spot chosen, it searches all venues, like the search box does.
  function filterHits() {
    if (!ui.mapFilter || geo.chosen) return null;
    return D.venues.filter(filterOk).map(function (ven) { return { ven: ven, d: null }; })
      .sort(function (a, b) { return busyOf(b.ven) - busyOf(a.ven) || (b.ven.ratings || 0) - (a.ven.ratings || 0) || a.ven.name.localeCompare(b.ven.name); });
  }
  // Venue search on the Map tab: matches venue names and kinds anywhere, whatever the radius.
  var SEARCH_MAX = 30, SEARCH_LIST = 6;   // pins on the map, cards under the search box
  function fold(t) { return String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim(); }
  function searchHits() {
    var words = fold(ui.venueQuery).split(' ').filter(Boolean);
    if (!words.length) return null;
    var hits = D.venues.filter(function (ven) {
      var text = ' ' + fold(ven.name + ' ' + (ven.kind || ''));
      return words.every(function (w) { return text.indexOf(' ' + w) >= 0; }) && filterOk(ven);
    }).map(function (ven) { return { ven: ven, d: pins && pins[ven.id] && geo.chosen ? km(geo.centre, pins[ven.id]) : null }; });
    var q = fold(ui.venueQuery);
    hits.sort(function (a, b) {
      var sa = fold(a.ven.name).indexOf(q) === 0 ? 0 : 1, sb = fold(b.ven.name).indexOf(q) === 0 ? 0 : 1;
      if (sa !== sb) return sa - sb;
      if (a.d != null && b.d != null) return a.d - b.d;
      return a.ven.name.localeCompare(b.ven.name);
    });
    return hits;
  }
  function searchList(hits, list) {   // list: the long list under the map (filters), else the few under the search box
    var what = ui.venueQuery && ui.venueQuery.trim() ? '<strong>' + esc(ui.venueQuery.trim()) + '</strong>' : '';
    if (ui.mapFilter) what = (what ? what + ' and ' : '') + '<strong>' + esc(filterName()) + '</strong>';
    var count = list ? ' id="venue-count"' : '', max = list ? SEARCH_MAX : SEARCH_LIST;
    if (!hits.length) return '<p class="small"' + count + '>No venues match ' + what + '.</p>';
    return '<p class="small"' + count + '><strong>' + hits.length + ' venue' + (hits.length === 1 ? '' : 's') + '</strong> match' + (hits.length === 1 ? 'es' : '') +
      (hits.length > max ? '<span class="muted">' + (list ? '. Showing the first ' + max + '.' : '. Showing the closest matches, so type more to narrow it down.') + '</span>' : '') + '</p>' +
      hits.slice(0, max).map(function (x) { return venueCard(x.ven, x.d, true); }).join('');
  }
  function searchBox() {   // results sit right under the box, so they're visible above the phone keyboard
    var hits = searchHits();
    return hits ? searchList(hits, false) : '';
  }
  function venueList() {
    var hits = filterHits();
    if (hits) return searchList(hits, true);
    if (!geo.chosen) return '<div class="card" id="venue-count"><div style="font-weight:700">Choose where to look</div>' +
      '<p class="muted small">Tap the arrow on the map to search near you, or tap the map to pick a spot. Or search for a venue by name above.</p></div>';
    if (!pins) return D.venues.map(function (v) { return venueCard(v, null); }).join('');
    var near = [], far = 0, unpinned = [];
    D.venues.forEach(function (ven) {
      if (!filterOk(ven)) return;
      if (!pins[ven.id]) { unpinned.push(ven); return; }
      var d = km(geo.centre, pins[ven.id]);
      if (d <= ui.radiusKm) near.push({ ven: ven, d: d }); else far += 1;
    });
    near.sort(function (a, b) { return a.d - b.d; });
    var h = '<p class="small" id="venue-count"><strong>' + near.length + (ui.mapFilter ? ' ' + esc(filterName().toLowerCase()) : '') + ' venue' + (near.length === 1 ? '' : 's') + '</strong> within ' + ui.radiusKm + ' km' +
      (geo.mine ? ' of you' : ' of the pin') + (far ? '<span class="muted">. ' + far + ' more further away.</span>' : '') + '</p>';
    h += near.map(function (n) { return venueCard(n.ven, n.d); }).join('');
    if (unpinned.length) h += '<div class="eyebrow" style="padding-top:8px">Not on the map yet</div>' + unpinned.map(function (v) { return venueCard(v, null); }).join('');
    return h;
  }
  function venues() {
    var h = '<div class="stack" style="gap:6px"><h1>Venues</h1><p class="muted small">Places to pick from when you start a sesh. Use the Map tab to find ones near you.</p></div><div class="stack" style="gap:12px">';
    D.venues.forEach(function (ven) { h += venueCard(ven, null); });
    return h + '</div>';
  }
  // The venues offered for a vote: anything already voted for, then the nearest few inside the map's radius,
  // so a sesh never shows hundreds of venues at once. Any other venue can be voted for from the map.
  var VOTE_PICKS = 8;
  function votePicks(tallyInfo) {
    var voted = D.venues.filter(function (v) { return tallyInfo.by[v.id]; });
    if (!pins) return voted.length ? voted : D.venues.slice(0, VOTE_PICKS);
    var near = D.venues.filter(function (v) { return pins[v.id] && !tallyInfo.by[v.id]; })
      .map(function (v) { return { v: v, d: km(geo.centre, pins[v.id]) }; })
      .filter(function (x) { return x.d <= ui.radiusKm; })
      .sort(function (a, b) { return a.d - b.d; })
      .slice(0, VOTE_PICKS).map(function (x) { return x.v; });
    return voted.concat(near);
  }
  function mapTab() {
    var h = '<div class="stack" style="gap:6px"><h1>Map</h1><p class="muted small">Pick how far you want to go.</p></div>' +
      '<div class="venue-search" role="search"><label for="venue-search" class="sr-only">Search venues</label>' + svg('search', 18) +
      '<input type="search" id="venue-search" data-keep placeholder="Search venues" autocomplete="off" enterkeyhint="search" value="' + esc(ui.venueQuery || '') + '">' +
      (ui.venueQuery ? '<button class="back" data-act="clear-search" aria-label="Clear search">' + svg('close', 16) + '</button>' : '') + '</div>' + filterChips() +
      '<div class="stack search-results" id="search-results" aria-live="polite">' + searchBox() + '</div>';
    if (window.L) {
      h += '<div class="stack" style="gap:12px"><div class="map-box"><div id="map-slot" class="map big"></div>' + mapFriends() +
        '<button class="map-fab" data-act="locate" aria-label="' + (geo.busy ? 'Finding you' : 'Near me') + '" aria-pressed="' + geo.mine + '"' + (geo.busy ? ' disabled' : '') + '>' + svg('arrow', 20) + '</button></div>' + mapPick() +
        '<div class="radius"><div class="row between"><label for="radius" class="eyebrow">How far</label><div class="radius-num"><span id="radius-label">' + ui.radiusKm + '</span><small>km</small></div></div>' +
        '<input type="range" id="radius" min="1" max="25" step="1" value="' + ui.radiusKm + '" style="--p:' + radiusFill() + '" aria-valuetext="' + ui.radiusKm + ' km">' +
        '<div class="scale" aria-hidden="true"><span>1 km</span><span>25 km</span></div></div>' +
        '<p class="muted small">' + (geo.busy ? 'Finding you...' : geo.mine ? 'Searching around you. Your location stays on this phone and is never saved or shown to friends.' : geo.chosen ? 'Tap the map to search somewhere else, or the arrow to search near you.' : '') + '</p></div>';
    }
    return h + '<div class="stack" style="gap:12px" id="venue-list">' + venueList() + '</div>';
  }
  // Friends who are out, as faces along the bottom of the map. Faces only: never where anyone is.
  function mapFriends() {
    if (D.me.colour === 'off') return '';
    var out = D.friends.filter(function (f) { return f.colour === 'on' || f.colour === 'thinking'; })
      .sort(function (x, y) { return STOPS.indexOf(x.colour) - STOPS.indexOf(y.colour); });
    if (!out.length) return '';
    return '<div class="map-friends" aria-label="Friends out tonight">' + out.map(function (f) {
      return '<div class="mini-face" style="--c:' + COLORS[f.colour] + ';--h:' + hue(f.name) + '" title="' + esc(first(f.name)) + ', ' + LABELS[f.colour] + '">' +
        '<div class="face-pic">' + face(f.id, f.name) + '</div><span>' + esc(first(f.name)) + '</span></div>';
    }).join('') + '</div>';
  }
  // The venue picked on the map, with its deals, shown straight under the map.
  function mapPick() {
    var ven = ui.mapPick && venueById(ui.mapPick);
    if (!ven) return '';
    var here = DEALS_ON ? D.deals.filter(function (d) { return d.venue_id === ven.id; }) : [], mine = mySesh(), away = geo.chosen ? awayText(ven) : '';
    return '<div class="card map-pick" id="map-pick"><div class="row between"><div class="grow">' + (ven.is_example ? '<div class="eyebrow">Example venue</div>' : '') +
      '<h2 style="font-size:22px">' + esc(ven.name) + '</h2><div class="muted small">' + esc([ven.kind, hoursLine(ven), away].filter(Boolean).join(', ')) + '</div></div>' +
      '<button class="back" data-act="map-pick" data-v="" aria-label="Close">' + svg('close', 18) + '</button></div>' +
      ratingRow(ven) +
      here.map(dealBanner).join('') +
      '<div class="row"><button class="btn small-btn" data-act="venue" data-v="' + esc(ven.id) + '">Open venue</button>' +
      (mine && !mine.locked_venue ? '<button class="btn small-btn ghost" data-act="suggest" data-v="' + esc(ven.id) + '">Vote for it</button>' : '') + '</div></div>';
  }
  // Ratings on the card under a tapped pin: SeshOn's own average, Google's, and tap-a-star to rate.
  function ratingRow(ven) {
    googleRating(ven.id);
    var g = googleLine(ven.id);
    return '<div class="stack" style="gap:4px"><div class="small">' + (ven.ratings ? '<strong>' + Number(ven.average).toFixed(1) + '</strong> ★ on Frendzy (' + ven.ratings + ')' : 'No Frendzy ratings yet') + (g ? ' · ' + g : '') + '</div>' +
      '<div class="stars small-stars" role="group" aria-label="Rate ' + esc(ven.name) + '">' + [1, 2, 3, 4, 5].map(function (n) {
        return '<button class="star" data-act="quick-star" data-v="' + esc(ven.id) + ':' + n + '" aria-label="Rate ' + n + ' star' + (n > 1 ? 's' : '') + '" aria-pressed="' + (ven.my_stars >= n) + '"><svg width="24" height="24" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" aria-hidden="true">' + ICON.star + '</svg></button>';
      }).join('') + '</div></div>';
  }
  var PIN_FILL = { near: '#1F7BFF', far: '#8A90A0', goal: '#FF4757' };
  function pinIcon(kind, open) {   // open: true, false, or null (hours unknown, no badge)
    return L.divIcon({ className: '', iconSize: [30, 40], iconAnchor: [15, 39],
      html: '<span class="pin' + (kind === 'far' ? ' far' : '') + '">' + (open === null ? '' : '<i class="pin-badge ' + (open ? 'open' : 'shut') + '"></i>') + '<svg width="30" height="40" viewBox="0 0 30 40" aria-hidden="true"><path d="M15 38.5S2.5 23.6 2.5 14a12.5 12.5 0 0 1 25 0c0 9.6-12.5 24.5-12.5 24.5z" fill="' + PIN_FILL[kind] + '" stroke="#0B0B0D" stroke-width="2"/><circle cx="15" cy="14" r="5" fill="#fff"/></svg></span>' });
  }
  // Snap Map style venue bubble: a round icon with a bold name, a tag like "Top pick", and a glow where it's busy.
  function kindGlyph(ven) {
    var k = String(ven.kind || '').toLowerCase();
    return /club|night|music|live/.test(k) ? 'events' : /restaurant|cafe|food|eat|kitchen/.test(k) ? 'fork' : 'venues';
  }
  function bubbleIcon(ven, kind, open) {
    var tag = kind === 'far' ? '' : tagOf(ven), busy = busyOf(ven);
    return L.divIcon({ className: '', iconSize: [40, 40], iconAnchor: [20, 20],
      html: '<span class="bub ' + kind + (tag ? ' tagged' : '') + (busy ? ' busy-' + busy : '') + '">' + (busy ? '<i class="heat"></i>' : '') +
        (tag ? '<b class="bub-tag">' + esc(tag) + '</b>' : '') +
        '<span class="bub-disc">' + svg(kindGlyph(ven), 20) + (open === null ? '' : '<i class="pin-badge ' + (open ? 'open' : 'shut') + '"></i>') + '</span>' +
        '<span class="bub-name">' + esc(ven.name) + '</span></span>' });
  }
  function meIcon() {   // you, as your own face, only when you chose "Near me". Never sent to anyone.
    return L.divIcon({ className: '', iconSize: [48, 48], iconAnchor: [24, 24],
      html: '<span class="me-mark"><span class="face-pic me" style="--c:var(--accent);--h:' + hue(D.me.name) + '">' + face(D.me.id, D.me.name) + '</span><b>Me</b></span>' });
  }
  function youIcon() { return L.divIcon({ className: '', iconSize: [44, 44], iconAnchor: [22, 22], html: '<span class="you-dot"></span>' }); }
  function fromName() {
    if (geo.mine) return 'you';
    return geo.centre[0] === MAP_CENTRE[0] && geo.centre[1] === MAP_CENTRE[1] ? 'the city centre' : 'the map pin';
  }
  function awayText(ven) {
    var at = pins && pins[ven.id];
    if (!at) return '';
    var d = fmtKm(km(geo.centre, at));
    return geo.mine ? d + ' away' : d + ' from ' + fromName();
  }

  // One small map, moved between screens: the route to the venue above the sesh chat, and the top of a venue page.
  var MINI = { el: null, map: null, layers: null };
  function miniSlot(kind, venueId) { return '<div id="mini-slot" class="map ' + kind + '" data-venue="' + esc(venueId) + '"></div>'; }
  function mountMini() {
    var slot = document.getElementById('mini-slot');
    if (!slot || !window.L) return;
    var ven = venueById(slot.getAttribute('data-venue')), at = ven && pins && pins[ven.id], route = slot.classList.contains('route');
    if (!at) { slot.hidden = true; return; }
    if (!MINI.map) {
      MINI.el = document.createElement('div');
      MINI.map = L.map(MINI.el, { center: at, zoom: 15, scrollWheelZoom: false, dragging: !L.Browser.mobile, attributionControl: true });
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>'
      }).addTo(MINI.map);
      MINI.map.attributionControl.setPrefix(false);
      MINI.layers = L.layerGroup().addTo(MINI.map);
    }
    MINI.el.className = slot.className;
    MINI.el.setAttribute('aria-label', route ? 'Map from ' + fromName() + ' to ' + ven.name : 'Map showing where ' + ven.name + ' is');
    slot.parentNode.replaceChild(MINI.el, slot);
    MINI.map.invalidateSize();
    MINI.layers.clearLayers();
    var goal = L.marker(at, { icon: pinIcon('goal'), keyboard: false, interactive: false }).addTo(MINI.layers);
    if (route) {
      // A straight dotted line: how far it is as the crow flies, not a walking route.
      L.polyline([geo.centre, at], { color: '#1F7BFF', weight: 6, opacity: 0.95, dashArray: '0.1 12', lineCap: 'round', interactive: false }).addTo(MINI.layers);
      L.marker(geo.centre, { icon: youIcon(), keyboard: false, interactive: false }).addTo(MINI.layers)
        .bindTooltip(geo.mine ? 'You' : fromName() === 'the city centre' ? 'City' : 'Pin', { permanent: true, direction: 'bottom', offset: [0, 10], className: 'tag you' });
      goal.bindTooltip(esc(ven.name) + '<small>' + fmtKm(km(geo.centre, at)) + '</small>', { permanent: true, direction: 'right', offset: [12, -24], className: 'tag' });
      MINI.map.fitBounds(L.latLngBounds([geo.centre, at]), { animate: false, padding: [46, 46], maxZoom: 16 });
    } else {
      MINI.map.setView(at, 16, { animate: false });
    }
  }

  function mountMap() {
    var slot = document.getElementById('map-slot');
    if (!slot || !window.L) return;
    if (!M.map) {
      M.el = document.createElement('div');
      M.el.className = 'map big';
      M.el.setAttribute('aria-label', 'Map of venues');
      M.map = L.map(M.el, { center: geo.centre, zoom: 13, attributionControl: true });
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>'
      }).addTo(M.map);
      M.map.attributionControl.setPrefix(false);
      M.circle = L.circle(geo.centre, { radius: ui.radiusKm * 1000, color: '#1F7BFF', weight: 2, dashArray: '6 6', fillColor: '#1F7BFF', fillOpacity: 0.1, interactive: false }).addTo(M.map);
      M.centre = L.marker(geo.centre, { icon: youIcon(), interactive: false, keyboard: false }).addTo(M.map);
      M.centre.look = 'pin';
      var zoomClass = function () { M.el.classList.toggle('names', M.map.getZoom() >= 15); };
      M.map.on('zoomend', zoomClass); zoomClass();
      M.map.on('click', function (e) { geo.centre = [e.latlng.lat, e.latlng.lng]; geo.mine = false; geo.chosen = true; render(); });
      M.fit = true;
    }
    slot.parentNode.replaceChild(M.el, slot);
    M.map.invalidateSize();
    drawMap();
  }
  function drawMap() {
    if (!M.map) return;
    M.circle.setLatLng(geo.centre).setRadius(ui.radiusKm * 1000).setStyle({ opacity: geo.chosen ? 1 : 0, fillOpacity: geo.chosen ? 0.1 : 0 });
    M.centre.setLatLng(geo.centre).setOpacity(geo.chosen ? 1 : 0);
    var meLook = geo.mine ? 'me:' + (photos[D.me.id] ? 1 : 0) : 'pin';
    if (M.centre.look !== meLook) { M.centre.look = meLook; M.centre.setIcon(geo.mine ? meIcon() : youIcon()); }
    // Which pins: search matches while searching; otherwise the venues inside the circle once a spot is chosen.
    var hits = searchHits() || filterHits(), show = null;
    if (hits) { show = {}; hits.slice(0, SEARCH_MAX).forEach(function (x) { show[x.ven.id] = true; }); }
    var keep = {};
    D.venues.forEach(function (ven) {
      var at = pins && pins[ven.id];
      if (!at) return;
      var inside = geo.chosen && km(geo.centre, at) <= ui.radiusKm;
      if (ui.mapPick !== ven.id && (show ? !show[ven.id] : !inside || !filterOk(ven))) return;
      keep[ven.id] = true;
      var kind = ui.mapPick === ven.id ? 'goal' : inside || show ? 'near' : 'far';
      var st = openState(ven), open = st ? st.open : null, look = [kind, open, tagOf(ven), busyOf(ven)].join(':');
      var dot = M.dots[ven.id];
      if (!dot) {
        dot = M.dots[ven.id] = L.marker(at, { icon: bubbleIcon(ven, kind, open), title: ven.name, alt: ven.name }).addTo(M.map);
        dot.look = look;
        dot.on('click', function () { ACT['map-pick'](ven.id); });
      }
      if (dot.look !== look) { dot.look = look; dot.setIcon(bubbleIcon(ven, kind, open)); }
      dot.setZIndexOffset(kind === 'goal' ? 1000 : busyOf(ven) * 100 + (tagOf(ven) ? 50 : 0));
      dot.setLatLng(at);
    });
    Object.keys(M.dots).forEach(function (id) { if (!keep[id]) { M.map.removeLayer(M.dots[id]); delete M.dots[id]; } });
    if (M.fitHits && hits && hits.length) {
      var spots = hits.slice(0, SEARCH_MAX).map(function (x) { return pins[x.ven.id]; }).filter(Boolean);
      if (spots.length) M.map.fitBounds(L.latLngBounds(spots), { animate: false, padding: [40, 40], maxZoom: 16 });
      M.fit = false;
    }
    M.fitHits = false;
    if (M.fit) { M.fit = false; M.map.fitBounds(M.circle.getBounds(), { animate: false, padding: [12, 12] }); }
  }
  function radiusFill() { return ((ui.radiusKm - 1) / 24 * 100).toFixed(1) + '%'; }
  function setRadius(v) {   // the slider moves without redrawing the page, so dragging it stays smooth
    ui.radiusKm = Math.min(25, Math.max(1, Math.round(Number(v)) || 5));
    store(RADIUS_KEY, ui.radiusKm);
    var label = document.getElementById('radius-label'), list = document.getElementById('venue-list');
    if (label) label.textContent = ui.radiusKm;
    var range = document.getElementById('radius');
    if (range) { range.style.setProperty('--p', radiusFill()); range.setAttribute('aria-valuetext', ui.radiusKm + ' km'); }
    if (list) list.innerHTML = venueList();
    drawMap();
  }

  var searchTimer = null;
  function setSearch(v) {   // updates the list and pins in place, so typing keeps the keyboard open
    ui.venueQuery = v;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(function () {
      var box = document.getElementById('search-results');
      if (box) box.innerHTML = searchBox();
      M.fitHits = true; drawMap();
    }, 150);
  }

  // Picking friends for a private sesh (migration 0024): when starting one, or inviting more to it.
  function pickerHtml() {
    var p = ui.picker, mine = mySesh(), skip = {};
    if (p.mode === 'invite' && mine) {
      (mine.invited || []).forEach(function (id) { skip[id] = true; });
      mine.members.forEach(function (m) { skip[m.id] = true; });
    }
    var list = D.friends.filter(function (f) { return !skip[f.id]; });
    var n = Object.keys(p.picked).length;
    var h = '<div class="stack" style="gap:6px"><div class="eyebrow">' + svg('lock', 14) + ' Private sesh</div><h1>' + (p.mode === 'invite' ? 'Invite more friends' : 'Who\'s invited?') + '</h1>' +
      '<p class="muted">Only the friends you pick can see this sesh and join it. Your other friends won\'t know it\'s on.</p></div>';
    if (!list.length) {
      h += '<p class="muted">' + (p.mode === 'invite' ? 'All your friends are already invited.' : 'Add some friends first, then you can pick who comes.') + '</p>';
    } else {
      h += pickRows(list, p.picked) + '<p class="muted small">Friends on red see it once they go green or amber.</p>';
    }
    h += '<button class="btn" data-act="picker-go"' + (n ? '' : ' disabled') + '>' +
      (p.mode === 'invite' ? (n ? 'Invite ' + n : 'Pick friends to invite') : (n ? 'Start private sesh with ' + n : 'Pick at least one friend')) + '</button>' +
      '<button class="btn ghost" data-act="picker-cancel">Cancel</button>';
    return h;
  }
  function pickRows(list, picked) {
    return '<div class="stack" style="gap:8px">' + list.map(function (f) {
      var on = !!picked[f.id];
      return '<button class="card pick-row' + (on ? ' picked' : '') + '" data-act="pick" data-v="' + esc(f.id) + '" aria-pressed="' + on + '">' +
        avatar(f.name, COLORS[f.colour] || COLORS.off, false, f.id) +
        '<span class="grow"><span style="font-weight:700">' + esc(f.name) + '</span><span class="muted small" style="display:block">' + esc(LABELS[f.colour] || 'Red') + '</span></span>' +
        '<span class="pick-box">' + (on ? svg('tick', 18) : '') + '</span></button>';
    }).join('') + '</div>';
  }

  // Planning a sesh for later (migration 0025): when, and for all friends or only the ones picked.
  function planHtml() {
    var p = ui.plan, n = Object.keys(p.picked).length, t = now();
    var h = '<div class="stack" style="gap:6px"><div class="eyebrow">' + svg('clock', 14) + ' Plan a sesh</div><h1>When\'s it on?</h1>' +
      '<p class="muted">Up to 2 weeks ahead. Friends can say they\'re in, vote on where to go and chat about it before it starts. It goes live at this time.</p></div>' +
      '<div class="field"><label for="plan-at">Date and time</label><input id="plan-at" data-keep type="datetime-local" step="900" value="' + esc(p.at) + '"' +
      ' min="' + localInput(t + 10 * 60000) + '" max="' + localInput(t + 14 * 86400000) + '"></div>' +
      '<div class="stack" style="gap:8px"><h2>Who\'s it for?</h2><div class="row">' +
      '<button class="btn small-btn' + (p.pick ? ' ghost' : '') + '" data-act="plan-who" data-v="all" aria-pressed="' + !p.pick + '">All my friends</button>' +
      '<button class="btn small-btn' + (p.pick ? '' : ' ghost') + '" data-act="plan-who" data-v="pick" aria-pressed="' + !!p.pick + '">' + svg('lock', 14) + ' Pick friends</button></div>';
    if (p.pick) {
      h += D.friends.length ? '<p class="muted small">Only the friends you pick can see it and join. Friends on red see it once they go green or amber.</p>' + pickRows(D.friends, p.picked)
        : '<p class="muted small">Add some friends first, then you can pick who comes.</p>';
    } else {
      h += '<p class="muted small">Your friends on green or amber can see it and join.</p>';
    }
    h += '</div><button class="btn" data-act="plan-go"' + (p.pick && !n ? ' disabled' : '') + '>' + (p.pick ? (n ? 'Plan it with ' + n : 'Pick at least one friend') : 'Plan it') + '</button>' +
      '<button class="btn ghost" data-act="plan-cancel">Cancel</button>';
    return h;
  }
  // The Planned list under the Sesh tab: seshes still to come that you're in or can join.
  function plannedHtml(skipId) {
    var list = plannedSeshes().filter(function (s) { return s.id !== skipId; });
    var canPlan = D.me.colour !== 'off';
    if (!list.length && !canPlan) return '';
    var h = '<section class="stack" style="gap:10px;padding-top:18px;border-top:1px solid var(--line)"><h2>Planned</h2>';
    h += list.map(function (s) {
      return '<div class="card"><div class="row between"><div class="grow"><div class="eyebrow" style="color:var(--thinking)">' + esc(fmtWhen(s.starts_at)) + '</div>' +
        '<div style="font-weight:700;font-size:17px">' + (s.mine ? 'Your sesh' : esc(first(s.creator_name)) + '\'s sesh') + '</div>' +
        (s.private ? '<div class="small" style="color:var(--accent)">' + svg('lock', 12) + (s.mine ? ' Private' : ' Private, you\'re invited') + '</div>' : '') +
        '<div class="muted small">' + s.members.length + ' in' + (s.locked_venue && venueById(s.locked_venue) ? ', going to ' + esc(venueById(s.locked_venue).name) : '') + '</div></div>' +
        (s.am_member ? '<button class="btn small-btn ghost" data-act="open-sesh" data-v="' + esc(s.id) + '">Open</button>'
          : '<button class="btn small-btn" data-act="join-planned" data-v="' + esc(s.id) + '">I\'m in</button>') + '</div></div>';
    }).join('');
    if (!list.length) h += '<p class="muted small">Nothing planned yet. Plan a sesh for later and your friends can say they\'re in.</p>';
    if (canPlan) h += '<button class="btn ghost" data-act="plan-sesh">' + svg('clock', 16) + ' Plan a sesh for later</button>';
    return h + '</section>';
  }

  // The private pres (pre-drinks) address (migration 0025). The database only sends the address to people who
  // are in the sesh, from 4 hours before it starts; the host always sees it. It is never put on the map.
  function presHtml(s) {
    var p = s.pres, h;
    if (s.mine && ui.presEdit === s.id) {
      var at = p && p.at ? new Date(p.at) : null, two = function (n) { return (n < 10 ? '0' : '') + n; };
      return '<div class="card"><h2>Pres</h2><div class="field"><label for="pres-address">Address</label><input id="pres-address" data-keep type="text" maxlength="200" autocomplete="off" placeholder="e.g. 12 Smith St, Northbridge" value="' + esc(p && p.address || '') + '"></div>' +
        '<div class="field"><label for="pres-time">Pres from (optional)</label><input id="pres-time" data-keep type="time" step="900" value="' + (at ? two(at.getHours()) + ':' + two(at.getMinutes()) : '') + '"></div>' +
        '<p class="muted small">Only the people who have said they\'re in see it, from 4 hours before the sesh starts. It\'s never shown on the map, and it\'s deleted with the sesh.</p>' +
        '<div class="row"><button class="btn small-btn" data-act="pres-save">Save</button><button class="btn small-btn ghost" data-act="pres-cancel">Cancel</button>' +
        (p ? '<button class="btn small-btn ghost" data-act="pres-remove">Remove</button>' : '') + '</div></div>';
    }
    if (!p) return s.mine ? '<button class="btn ghost" data-act="pres-edit">' + svg('home', 16) + ' Add a private pres address</button>' : '';
    var when = p.at ? 'From ' + fmtTime(p.at) : '';
    if (p.address) {
      h = '<div class="card"><div class="row between"><div class="grow"><div class="eyebrow">' + svg('lock', 12) + ' Pres</div><div style="font-weight:700;font-size:17px">' + esc(p.address) + '</div>' +
        (when ? '<div class="muted small">' + when + '</div>' : '') + '</div>' +
        (s.mine ? '<button class="btn small-btn ghost" data-act="pres-edit">Edit</button>' : '') + '</div>' +
        '<a class="btn small-btn ghost" style="display:inline-flex;align-items:center;justify-content:center;text-decoration:none;align-self:flex-start" target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(p.address) + '">Directions</a>' +
        (s.mine && new Date(p.shows_at).getTime() > now() ? '<p class="muted small">The people who are in see it from ' + esc(fmtWhen(p.shows_at).replace(/^(Today|Tomorrow)/, function (w) { return w.toLowerCase(); })) + '.</p>' : '<p class="muted small">Private: only the people in this sesh can see it.</p>') + '</div>';
      return h;
    }
    return '<div class="card"><div class="eyebrow">' + svg('lock', 12) + ' Pres</div><div class="muted small">' + (when ? when + '. ' : '') +
      esc(first(s.creator_name)) + ' added a private pres address. You\'ll see it from ' + esc(fmtWhen(p.shows_at).replace(/^(Today|Tomorrow)/, function (w) { return w.toLowerCase(); })) + '.</div></div>';
  }

  function sesh() {
    var me = D.me, mine = mySesh();
    if (ui.picker) return pickerHtml();
    if (ui.plan) return planHtml();
    var later = isPlanned(mine), startMs = later ? new Date(mine.starts_at).getTime() : 0;
    var h = later
      ? '<button class="linkbtn" style="align-self:flex-start" data-act="sesh-back">' + svg('back', 16) + ' All seshes</button>' +
        '<div class="stack" style="gap:6px"><div class="eyebrow" style="color:var(--thinking)">' + svg('clock', 14) + ' Planned' +
        (startMs - now() < 86400000 ? ', starts in <span data-until="' + startMs + '">' + fmtLeft(startMs - now()) + '</span>' : '') + '</div>' +
        '<h1>' + esc(fmtWhen(mine.starts_at)) + '</h1><p class="muted small">' + (mine.mine ? 'Your sesh' : esc(first(mine.creator_name)) + '\'s sesh') +
        '. It goes live at this time and is deleted 8 hours after, with the votes and chat.</p></div>'
      : (mine && mine.locked_venue && venueById(mine.locked_venue) ? '<div class="bleed">' + miniSlot('route', mine.locked_venue) + '</div>' : '') +
        '<div class="stack" style="gap:6px"><div class="eyebrow" style="color:var(--on)">' + (mine ? 'Live now' : 'Tonight') + '</div><h1>Tonight\'s sesh</h1></div>';
    if (!mine) {
      var others = D.seshes.filter(function (s) { return !s.am_member && !isPlanned(s); });
      if (others.length) {
        h += '<div class="stack">' + others.map(function (s) {
          return '<div class="card"><div class="row between"><div class="grow"><div style="font-weight:700;font-size:17px">' + esc(first(s.creator_name)) + '\'s sesh</div>' +
            (s.private ? '<div class="small" style="color:var(--accent)">' + svg('lock', 12) + ' Private, you\'re invited</div>' : '') +
            '<div class="muted small">' + s.members.length + ' in' + (s.locked_venue && venueById(s.locked_venue) ? ', going to ' + esc(venueById(s.locked_venue).name) : ', still choosing where') + '</div></div>' +
            '<button class="btn small-btn" data-act="join" data-v="' + esc(s.id) + '">Join</button></div></div>';
        }).join('') + '</div>';
      }
      if (me.colour === 'on') {
        h += '<p class="muted">' + (others.length ? 'Or start your own.' : 'Nobody has started one yet. Start a sesh and your friends on green or amber can join and vote on where to go.') + '</p>' +
          '<button class="btn' + (others.length ? ' ghost' : '') + '" data-act="start-sesh">Start a sesh</button>' +
          '<button class="btn ghost" data-act="private-sesh">' + svg('lock', 16) + ' Start a private sesh</button>';
      } else if (me.colour === 'thinking') {
        h += '<p class="muted">' + (others.length ? 'Go green to start your own.' : 'No sesh yet. Go green to start one.') + '</p><button class="btn" style="--c:var(--on);--cf:var(--ink)" data-act="status" data-v="on">Go green</button>';
      } else {
        h += '<p class="muted">You\'re red, so seshes are hidden. Go green to start one or see your friends\' plans.</p><button class="btn" style="--c:var(--on);--cf:var(--ink)" data-act="status" data-v="on">Go green</button>';
      }
      return h + plannedHtml();
    }

    h += '<div class="card"><div class="avatars">' + mine.members.map(function (m) { return avatar(m.name || '?', 'var(--on)', false, m.id); }).join('') + '</div>' +
      '<div><div style="font-weight:700">' + mine.members.length + ' in</div><div class="muted small">' +
      esc(mine.members.map(function (m) { return m.id === me.id ? 'You' : first(m.name); }).join(', ')) + '</div></div></div>';
    h += presHtml(mine);
    if (mine.private) {
      var asked = (mine.invited || []).length;
      h += '<div class="card"><div class="row between"><div class="grow"><div style="font-weight:700">' + svg('lock', 14) + ' Private sesh</div><div class="muted small">' +
        (mine.mine ? 'Only you and the ' + asked + ' friend' + (asked === 1 ? '' : 's') + ' you picked can see it.' : 'Only the friends ' + esc(first(mine.creator_name)) + ' picked can see it.') + '</div></div>' +
        (mine.mine ? '<button class="btn small-btn ghost" data-act="invite-more">Invite</button>' : '') + '</div></div>';
    }

    if (mine.locked_venue) {
      var lv = venueById(mine.locked_venue);
      h += '<div class="card lead"><div class="eyebrow" style="color:var(--on)">Locked in</div><h2>' + esc(lv ? lv.name : 'A venue') + '</h2>' +
        (lv ? '<p class="muted small">' + esc([lv.kind, hoursLine(lv), awayText(lv)].filter(Boolean).join(', ')) + '</p><button class="btn" data-act="venue" data-v="' + esc(lv.id) + '">' + (DEALS_ON ? 'See venue and deals' : 'See venue') + '</button>' : '') + '</div>';
    } else {
      var tallyInfo = leaderOf(mine), total = mine.votes.length;
      var myVote = (mine.votes.filter(function (v) { return v.user_id === me.id; })[0] || {}).venue_id;
      h += '<div class="row between"><h2>Where to?</h2><span class="muted small">' + total + ' vote' + (total === 1 ? '' : 's') + ' in</span></div><div class="stack">';
      var picks = votePicks(tallyInfo);
      if (!picks.length) h += '<p class="muted small">No venues within ' + ui.radiusKm + ' km yet. Find one on the map and vote for it there.</p>';
      picks.forEach(function (ven) {
        var n = tallyInfo.by[ven.id] ? tallyInfo.by[ven.id].n : 0, isMine = myVote === ven.id, isLead = tallyInfo.best === ven.id;
        var deal = DEALS_ON ? D.deals.filter(function (d) { return d.venue_id === ven.id && d.running; })[0] : null;
        h += '<div class="card' + (isLead ? ' lead' : '') + '"><div class="row between"><div class="grow"><div style="font-weight:700;font-size:17px">' + esc(ven.name) + '</div>' +
          '<div class="muted small">' + esc([ven.kind, hoursLine(ven), pins && pins[ven.id] ? fmtKm(km(geo.centre, pins[ven.id])) + ' away' : ''].filter(Boolean).join(', ')) + '</div></div>' +
          '<button class="btn small-btn' + (isMine ? '' : ' ghost') + '" data-act="vote" data-v="' + esc(ven.id) + '" aria-pressed="' + isMine + '">' + (isMine ? 'Your vote' : 'Vote') + '</button></div>' +
          (deal ? '<div class="deal-title small">' + esc(deal.title) + '</div>' : '') +
          '<div class="row"><div class="bar"><i style="width:' + (total ? Math.round(n / total * 100) : 0) + '%"></i></div><div class="small" style="font-weight:700">' + n + ' vote' + (n === 1 ? '' : 's') + '</div></div></div>';
      });
      h += '</div><button class="btn ghost" data-act="tab" data-v="map">Find more on the map</button>';
      if (mine.mine) {
        h += tallyInfo.best && venueById(tallyInfo.best)
          ? '<button class="btn" data-act="lock" id="lock">Lock in ' + esc(venueById(tallyInfo.best).name) + '</button>'
          : '<button class="btn" disabled id="lock">Lock in once someone votes</button>';
      } else {
        h += '<p class="muted small">' + esc(first(mine.creator_name)) + ' started this sesh and locks in the venue.</p>';
      }
    }
    h += chatHtml(mine);
    if (later) {
      h += mine.mine
        ? '<button class="btn" data-act="start-planned">Start it now</button><button class="btn ghost" data-act="end-sesh">Cancel the sesh</button>'
        : '<button class="btn ghost" data-act="leave-sesh">Can\'t make it</button>';
      return h;
    }
    h += mine.mine
      ? '<button class="btn ghost" data-act="end-sesh">End the sesh</button>'
      : '<button class="btn ghost" data-act="leave-sesh">Leave the sesh</button>';
    return h + plannedHtml(mine.id);
  }

  function dealLabel(d) {
    if (d.running) return 'Until ' + fmtClock(d.end_time);
    var h = perthHour(), start = Number(d.start_time.split(':')[0]) + Number(d.start_time.split(':')[1]) / 60;
    return h < start ? 'Starts ' + fmtClock(d.start_time) : 'Ended ' + fmtClock(d.end_time);
  }
  function dealCard(d, showVenue) {
    var ven = venueById(d.venue_id);
    return '<div class="card' + (d.running ? ' deal-active' : '') + '">' +
      '<div class="row between"><span class="eyebrow">' + esc(d.type) + '</span><span class="small muted">' + dealLabel(d) + '</span></div>' +
      '<div class="deal-title" style="font-size:17px">' + esc(d.title) + '</div>' +
      (d.is_alcohol ? '<div class="small muted">18+. Bring photo ID. Please drink responsibly.</div>' : '') +
      (showVenue && ven ? '<div class="small muted">' + esc(ven.name) + (ven.is_example ? ' (example venue)' : '') + '</div>' : '') +
      '<div class="row">' +
      (showVenue && ven ? '<button class="btn small-btn ghost" data-act="venue" data-v="' + esc(ven.id) + '">Venue</button>' : '') +
      redeemBtn(d) + '</div></div>';
  }
  function redeemBtn(d) {
    return '<button class="btn small-btn" style="--c:var(--zest);--cf:var(--ink)" data-act="redeem" data-v="' + esc(d.id) + '"' + (d.running && !d.used ? '' : ' disabled') + '>' + (d.used ? 'Used tonight' : d.running ? (d.code ? 'Show code' : 'Use deal') : 'Not on now') + '</button>';
  }
  function dealBanner(d) {
    return '<div class="deal-banner' + (d.running ? '' : ' off') + '"><div class="row between"><span class="sub">' + esc(d.type) + '</span><span class="small muted">' + dealLabel(d) + '</span></div>' +
      '<div class="big">' + esc(d.title) + '</div>' +
      (d.is_alcohol ? '<div class="small muted">18+. Bring photo ID. Please drink responsibly.</div>' : '') +
      '<div class="row">' + redeemBtn(d) + '</div></div>';
  }
  // What's on: gigs, quiz nights and live music that venues list as events. Never drink promotions.
  function events() {
    var list = D.deals.filter(function (d) { return d.type === 'Events' && !d.is_alcohol; }).map(function (d) {
      var at = pins && pins[d.venue_id];
      return { d: d, ven: venueById(d.venue_id), km: at ? km(geo.centre, at) : null };
    }).sort(function (x, y) { return (y.d.running - x.d.running) || ((x.km == null ? 1e9 : x.km) - (y.km == null ? 1e9 : y.km)); });
    var h = '<div class="stack" style="gap:6px"><h1>Events</h1><p class="muted small">What\'s on at venues tonight.</p></div>';
    if (!list.length) return h + '<div class="card"><h2>Nothing listed yet</h2><p class="muted small">Gigs, quiz nights and live music show up here when venues add them.</p></div>';
    return h + '<div class="stack" style="gap:14px">' + list.map(function (e) {
      var d = e.d, ven = e.ven;
      return '<div class="deal-banner' + (d.running ? '' : ' off') + '"><div class="row between"><span class="sub">' + esc(ven ? ven.name : 'A venue') + '</span><span class="small muted">' + dealLabel(d) + '</span></div>' +
        '<div class="big">' + esc(d.title) + '</div>' +
        (e.km != null ? '<div class="small muted">' + esc(fmtKm(e.km) + (geo.mine ? ' away' : ' from ' + fromName())) + '</div>' : '') +
        '<div class="row">' + (ven ? '<button class="btn small-btn ghost" data-act="venue" data-v="' + esc(ven.id) + '">See venue</button>' : '') + (DEALS_ON ? redeemBtn(d) : '') + '</div></div>';
    }).join('') + '</div>';
  }

  function venue(id) {
    var ven = venueById(id);
    if (!ven) return topBar(true) + '<p class="muted">That venue is no longer listed.</p>';
    var away = awayText(ven), fact = function (icon, text) { return '<div class="row">' + svg(icon, 20) + '<span class="grow">' + text + '</span></div>'; };
    var h = topBar(true) + '<div class="bleed">' + miniSlot('hero', id) + '</div>' +
      '<div class="stack" style="gap:12px">' + (ven.is_example ? '<div class="eyebrow">Example venue</div>' : '') + '<h1 class="venue-name">' + esc(ven.name) + '</h1><div class="facts">' +
      (ven.kind ? fact('place', esc(ven.kind)) : '') +
      fact('clock', esc(hoursLine(ven))) +
      (away ? fact('arrow', esc(away)) : '') +
      fact('star', ven.ratings ? '<strong>' + Number(ven.average).toFixed(1) + '</strong> from ' + ven.ratings + ' rating' + (ven.ratings === 1 ? '' : 's') : 'No ratings yet') +
      (googleRating(ven.id), googleLine(ven.id) ? fact('star', googleLine(ven.id)) : '') +
      '</div></div>';
    h += hoursBlock(ven);
    var here = D.deals.filter(function (d) { return d.venue_id === id; });
    if (DEALS_ON) h += '<div class="stack" style="gap:12px"><h2>Deals here</h2>' + (here.length ? here.map(dealBanner).join('') : '<p class="muted small">No deals here right now.</p>') + '</div>';
    h += '<div class="stack" style="gap:12px;padding-top:18px;border-top:1px solid var(--line)"><h2>Rate this venue</h2>' +
      '<div class="stars" role="group" aria-label="Star rating">' + [1, 2, 3, 4, 5].map(function (n) {
        return '<button class="star" data-act="star" data-v="' + n + '" aria-label="' + n + ' star' + (n > 1 ? 's' : '') + '" aria-pressed="' + (ven.my_stars >= n) + '"><svg width="30" height="30" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" aria-hidden="true">' + ICON.star + '</svg></button>';
      }).join('') + '</div>' +
      '<div class="chips">' + TAGS.map(function (t) {
        return '<button class="chip" data-act="tag" data-v="' + t + '" aria-pressed="' + (ven.my_tags.indexOf(t) >= 0) + '">' + t + '</button>';
      }).join('') + '</div></div>';
    var mine = mySesh();
    if (mine && !mine.locked_venue) h += '<button class="btn" data-act="suggest" data-v="' + esc(id) + '">Vote for this in ' + (isPlanned(mine) ? 'your planned sesh' : 'tonight\'s sesh') + '</button>';
    return h;
  }
  // The week's hours on a venue page, and for staff at that venue, a box to change them.
  function hoursBlock(ven) {
    var rows = window.SeshHours ? window.SeshHours.table(hoursOf(ven)) : null, today = perthNow().dow;
    var h = '<div class="stack" style="gap:8px"><h2>Opening hours</h2>';
    h += rows ? '<div class="hours">' + rows.map(function (r, i) { return '<div class="row between' + (i === today ? ' today' : '') + '"><span>' + r.day + '</span><span>' + esc(r.text) + '</span></div>'; }).join('') + '</div>'
      : '<p class="muted small">' + (ven.hours ? 'Listed as: ' + esc(ven.hours) : 'Hours unknown. Check with the venue before you go.') + '</p>';
    if ((D.staff_venues || []).indexOf(ven.id) >= 0) {
      h += '<form id="hours-form" class="stack" novalidate><div class="field"><label for="hours-input">You work here. Change the hours</label>' +
        '<input id="hours-input" type="text" autocomplete="off" maxlength="255" value="' + esc(ven.hours || '') + '" placeholder="Mo-Th 16:00-24:00; Fr,Sa 16:00-02:00; Su off"></div>' +
        '<p class="muted small">Days are Mo Tu We Th Fr Sa Su. Use 24-hour times; past midnight is fine (16:00-02:00). Leave it empty if unsure.</p>' +
        (ui.hoursError ? '<p class="error">' + esc(ui.hoursError) + '</p>' : '') +
        '<button class="btn small-btn" type="submit">Save hours</button></form>';
    }
    return h + '</div>';
  }
  // Shown above every tab: the name on the left, and your profile (the You page) at the top right.
  function topBar(back) {
    var me = D.me;
    return '<div class="top"><div class="row" style="gap:6px">' + (back ? backBtn() : '') + logo(me.colour, true) + '</div><div class="row" style="gap:10px">' +
      (ui.offline ? '<span class="pill" style="border-color:var(--off);color:var(--off)">Offline</span>' : '') +
      '<button class="avatar profile-btn" style="--c:' + COLORS[me.colour] + '" data-act="tab" data-v="you" aria-label="You"' + (ui.tab === 'you' ? ' aria-current="page"' : '') + '>' + face(me.id, me.name) + '</button></div></div>';
  }
  function backBtn() { return '<button class="back" data-act="close" aria-label="Back">' + svg('back', 20) + '</button>'; }

  function redeem(id) {
    var d = dealById(id);
    if (!d) return topBar(true) + '<p class="muted">That deal is no longer listed.</p>';
    var ven = venueById(d.venue_id) || { name: 'the venue', id: null };
    var h = topBar(true) + '<div class="eyebrow">' + esc(ven.name) + '</div>';
    if (d.used) {
      return h + '<h1>Deal used</h1><p class="deal-title">' + esc(d.title) + '</p><p class="muted">Each person can use a deal once per night. It will be available again tomorrow.</p>' +
        (ven.id ? '<button class="btn" data-act="venue" data-v="' + esc(ven.id) + '">Rate ' + esc(ven.name) + '</button>' : '');
    }
    h += '<div class="stack" style="gap:8px"><h1>Show this to staff</h1><p class="deal-title">' + esc(d.title) + '</p>' + (d.is_alcohol ? '<p class="muted small">18+. Staff will check your photo ID. Please drink responsibly.</p>' : '') + '</div>';
    if (d.code) {
      var until = new Date(d.code_expires_at).getTime();
      h += '<div class="code-box"><div class="code" id="code">' + esc(d.code) + '</div><div class="note">Staff enter this code on their phone to confirm it</div></div>' +
        '<div class="tiles"><div class="card" style="gap:2px"><div class="muted small">Code runs out in</div><div class="tile-num" data-until="' + until + '" data-kind="code">' + fmtLeft(until - now()) + '</div></div>' +
        '<div class="card" style="gap:2px"><div class="muted small">Limit</div><div class="tile-num">1 per night</div></div></div>' +
        '<p class="muted small">This screen changes by itself once staff confirm the code.</p>';
    } else if (d.running) {
      h += '<div class="card"><h2>This code ran out</h2><p class="muted small">Codes last 15 minutes so they can\'t be passed around.</p></div><button class="btn" style="--c:var(--zest);--cf:var(--ink)" data-act="redeem" data-v="' + esc(id) + '">Get a new code</button>';
    } else {
      h += '<div class="card"><h2>This deal has finished for today</h2></div>';
    }
    return h;
  }

  function you() {
    var me = D.me;
    var h = '<div class="row">' + '<div class="avatar" style="width:56px;height:56px;font-size:18px;--c:' + COLORS[me.colour] + '">' + face(me.id, me.name) + '</div><div class="grow"><h1 style="font-size:28px">' + esc(me.name) + '</h1><p class="muted small">Status: ' + LABELS[me.colour] + '</p></div></div>';

    h += '<p class="pill set-label">Settings</p>';
    h += sec('photo', '<div class="card"><h2>Your photo</h2><div class="row"><div class="face-pic me" style="--c:' + COLORS[me.colour] + ';--h:' + hue(me.name) + '">' + face(me.id, me.name) + '</div>' +
      '<p class="muted small grow">Only your friends see it on your circle, never strangers or anyone you block. Use a photo of you.</p></div>' +
      '<input type="file" id="photo-file" accept="image/*" hidden>' +
      '<div class="row"><button class="btn small-btn" data-act="pick-photo"' + (ui.photoBusy ? ' disabled' : '') + '>' + (ui.photoBusy ? 'Saving...' : photos[me.id] ? 'Change photo' : 'Add a photo') + '</button>' +
      (photos[me.id] && !ui.photoBusy ? '<button class="btn small-btn ghost" data-act="remove-photo">Remove</button>' : '') + '</div></div>', ui.photoBusy, photos[me.id] ? 'Added' : 'None yet');

    h += sec('add', '<div class="card"><h2>Add a friend</h2>' + addFriendForm() +
      '<p class="muted small">Not on Frendzy yet? Send them your invite link. When they sign up you get a friend request to accept.</p>' +
      '<button class="btn ghost" data-act="share">Send your invite link</button>' + linkBox() + '</div>', !D.friends.length);

    if (DEALS_ON && D.staff_venues.length) {
      h += '<div class="card" style="border-color:var(--thinking)"><h2>Staff: confirm a deal code</h2><p class="muted small">Type the code from the customer\'s phone. Each code works once.</p>' +
        '<form id="staff" class="stack" novalidate><div class="field"><label for="staff-code">Deal code</label><input id="staff-code" type="text" autocomplete="off" autocapitalize="characters" placeholder="SESH-0000" maxlength="12"></div>' +
        (ui.staffError ? '<p class="error" id="staff-error">' + esc(ui.staffError) + '</p>' : '') +
        '<button class="btn" style="--c:var(--zest);--cf:var(--ink)" type="submit">Confirm code</button></form></div>';
    }

    if (D.friends.length || D.requests_out.length) {
      h += sec('friends', '<div class="card"><h2>Your friends</h2>' +
        D.friends.map(function (f) {
          var asking = ui.confirm === 'unfriend:' + f.friendship, blocking = ui.confirm === 'block:' + f.id;
          return '<div class="row between"><div class="grow">' + esc(f.name) + (blocking ? '<div class="muted small">They won\'t see you or be able to add you again.</div>' : '') + '</div>' +
            (asking
              ? '<button class="btn small-btn" style="--c:var(--off);--cf:var(--ink)" data-act="unfriend" data-v="' + esc(f.friendship) + '">Remove</button><button class="btn small-btn ghost" data-act="cancel-confirm">Keep</button>'
              : blocking
              ? '<button class="btn small-btn" style="--c:var(--off);--cf:var(--ink)" data-act="block-user" data-v="' + esc(f.id) + '">Block</button><button class="btn small-btn ghost" data-act="cancel-confirm">Cancel</button>'
              : '<button class="btn small-btn ghost" data-act="ask" data-v="unfriend:' + esc(f.friendship) + '">Remove</button><button class="btn small-btn ghost" data-act="ask" data-v="block:' + esc(f.id) + '">Block</button>') + '</div>';
        }).join('') +
        D.requests_out.map(function (r) {
          return '<div class="row between"><div class="grow">' + esc(r.name) + '<div class="muted small">Waiting for them to accept</div></div>' +
            '<button class="btn small-btn ghost" data-act="unfriend" data-v="' + esc(r.friendship) + '">Cancel</button></div>';
        }).join('') + '</div>', /^(unfriend|block):/.test(ui.confirm || ''), String(D.friends.length));
    }

    h += sec('safety', safetyCard(), false, ui.safety && ui.safety.women_only ? 'Women only on' : '');

    if (D.blocked && D.blocked.length) {
      h += sec('blocked', '<div class="card"><h2>Blocked people</h2>' + D.blocked.map(function (b) {
        return '<div class="row between"><div class="grow">' + esc(b.name) + '</div><button class="btn small-btn ghost" data-act="unblock" data-v="' + esc(b.id) + '">Unblock</button></div>';
      }).join('') + '</div>', false, String(D.blocked.length));
    }


    if (ui.account !== 'off' && ui.account !== undefined) {
      var a = ui.account;
      if (ui.emailStep) h += '<div class="card" style="border-color:var(--on)">' + emailCard() + '</div>';
      else if (ui.newCode) h += '<div class="card" style="border-color:var(--on)">' + codeCard() + '</div>';
      else if (a && !ui.editAccount) {
        h += sec('login', '<div class="card"><h2>Username and password</h2><p class="muted small">You\'re logged in as <strong>' + esc(a.username) + '</strong>. Use it to log in on another phone.</p>' +
          (a.email && !ui.changeEmail ? '<p class="muted small">New logins also need a code sent to <strong>' + esc(a.email) + '</strong>.</p>'
            : emailsOn() ? '<form id="add-email" class="stack" style="gap:12px" novalidate><p class="muted small">' +
              (a.email ? 'We\'ll send a code to the new email. Until you type it, codes keep going to <strong>' + esc(a.email) + '</strong>.'
                : 'Add an email so every new login needs a code from it as well as your password.') + '</p>' +
              emailField(a.email ? 'New email' : 'Email for login codes') +
              '<p id="save-error" class="error" hidden></p><div class="row"><button class="btn small-btn" type="submit" id="save-btn">Send me a code</button>' +
              (a.email ? '<button class="btn small-btn ghost" type="button" data-act="change-email">Cancel</button>' : '') + '</div></form>' : '') +
          '<div class="row">' + (a.email && !ui.changeEmail && emailsOn() ? '<button class="btn small-btn ghost" data-act="change-email">Change email</button>' : '') +
          '<button class="btn small-btn ghost" data-act="edit-account">Change password</button><button class="btn small-btn ghost" data-act="logout">Log out</button></div></div>', false, a.username);
      } else {
        h += '<div class="card"><h2>' + (a ? 'Change password' : 'Keep your account') + '</h2>' +
          (a ? '' : '<p class="muted small">Right now your account only lives in this browser. Add a username and password so you can log in on a new phone.' + (emailsOn() ? ' Each new login will also need a code we email you.' : '') + '</p>') +
          saveForm(a ? a.username : '', !a && emailsOn()) + (a ? '<button class="btn ghost" data-act="edit-account">Cancel</button>' : '') + '</div>';
      }
    }

    h += sec('account', '<div class="card"><h2>Your account</h2><p class="muted small">' + (ui.account && ui.account !== 'off' ? 'You can log in on any phone with your username and password.' : 'Your account lives in this browser on this phone.') + ' If you work at a venue, give the organiser this ID so they can set you up as staff:</p>' +
      '<div class="linkbox" id="my-id">' + esc(me.id) + '</div>' +
      (ui.confirm === 'delete'
        ? '<p class="error">This removes your name, friends, votes and ratings for good.</p><div class="row"><button class="btn small-btn" style="--c:var(--off);--cf:var(--ink)" data-act="delete-account">Delete for good</button><button class="btn small-btn ghost" data-act="cancel-confirm">Keep my account</button></div>'
        : '<button class="btn ghost" data-act="ask" data-v="delete">Delete my account</button>') + '</div>', ui.confirm === 'delete');

    h += sec('install', '<div class="card"><h2>Put Frendzy on your home screen</h2><p class="muted small">On iPhone, tap the Share button in Safari, then Add to Home Screen. On Android, open the browser menu and tap Add to Home screen.</p></div>');
    h += sec('about', '<div class="card"><h2>About</h2><p class="small"><a href="privacy.html">Privacy Policy</a></p><p class="small"><a href="terms.html">Terms of use</a></p>' +
      (document.lastModified ? '<p class="muted small">App version from ' + esc(new Date(document.lastModified).toLocaleString([], { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })) + '</p>' : '') + '</div>');
    return h;
  }

  // Settings are drop-down sections: a card whose title you tap to open or close it. Each remembers whether it's open
  // while the screen redraws, and one with something waiting for you (a form step, a question) is always open.
  function sec(key, card, force, hint) {
    var m = card && /^<div class="card"( style="[^"]*")?><h2>([\s\S]*?)<\/h2>([\s\S]*)<\/div>$/.exec(card);
    if (!m) return card || '';
    return '<details class="card set" data-set="' + key + '"' + (m[1] || '') + (force || ui.sets[key] ? ' open' : '') + '><summary><h2>' + m[2] + '</h2>' +
      (hint ? '<span class="muted small set-hint">' + esc(hint) + '</span>' : '') + '</summary><div class="set-body">' + m[3] + '</div></details>';
  }

  // Gender is optional and private. Women and non-binary people can turn on the women and non-binary only mode. Hidden if the database is older.
  function safetyCard() {
    var sf = ui.safety;
    if (!sf || sf === 'off') return '';
    var opts = [['woman', 'Woman'], ['man', 'Man'], ['nonbinary', 'Non-binary'], ['', 'Rather not say']];
    var h = '<div class="card"><h2>Safety</h2><p class="muted small">Your gender is private. It is never shown to anyone, and you don\'t have to say.</p><div class="row" style="flex-wrap:wrap">' +
      opts.map(function (o) {
        var on = (sf.gender || '') === o[0];
        return '<button class="btn small-btn' + (on ? '' : ' ghost') + '" data-act="gender" data-v="' + o[0] + '" aria-pressed="' + on + '">' + o[1] + '</button>';
      }).join('') + '</div>';
    if (sf.gender === 'woman' || sf.gender === 'nonbinary') {
      h += '<h2 style="margin-top:8px">Women and non-binary only</h2><p class="muted small">' + (sf.women_only
        ? 'On. Only women and non-binary people can see your status, add you, or join and chat in seshes you start. Anyone else just sees you as red. In someone else\'s sesh, the people in it can still see you.'
        : 'When it\'s on, only women and non-binary people can see your status, add you, or join and chat in seshes you start.') + '</p>' +
        '<button class="btn small-btn' + (sf.women_only ? ' ghost' : '') + '" data-act="women-only" data-v="' + (sf.women_only ? 'off' : 'on') + '" aria-pressed="' + !!sf.women_only + '">' + (sf.women_only ? 'Turn off' : 'Turn on') + '</button>';
    }
    return h + '</div>';
  }

  /* ---------- render ---------- */
  // The whole screen glows in your status colour: green, amber or red.
  function glow(v) { document.body.setAttribute('data-status', v || ''); }
  function render() {
    if (drag) return; // never rebuild the screen under a finger that is sliding the status switch
    glow(D && D.me && session ? D.me.colour : '');
    var keep = document.getElementById('staff-code'), keepValue = keep ? keep.value : null, keepFocus = keep && document.activeElement === keep;
    var chatIn = document.getElementById('chat-input'), chatValue = chatIn ? chatIn.value : null, chatFocus = chatIn && document.activeElement === chatIn;
    var chatScroll = document.getElementById('chat-list'), chatTop = chatScroll ? chatScroll.scrollTop : null;
    var typing = document.activeElement && document.activeElement.id === 'name';
    var kept = {}, keptFocus = document.activeElement && document.activeElement.hasAttribute && document.activeElement.hasAttribute('data-keep') ? document.activeElement.id : null;
    Array.prototype.forEach.call(view.querySelectorAll('[data-keep]'), function (el) { kept[el.id] = el.value; });
    if (typing && !D) return; // do not wipe the sign-up form while someone is typing in it

    if (!API_URL || !API_KEY) { tabs.hidden = true; view.innerHTML = notConnected(); return; }
    if (!ui.booted) { tabs.hidden = true; view.innerHTML = starting(); return; }
    if (session && ui.twoStep && ui.twoStep.needed) {
      tabs.hidden = true;
      if (!document.getElementById('two-step-screen')) view.innerHTML = twoStepScreen();
      return;
    }
    if (needsAgeCheck() && (D && D.me || waiting())) {
      tabs.hidden = true;
      view.innerHTML = ageCheck();
      return;
    }
    if (!session || !D || !D.me) {
      tabs.hidden = true;
      var want = ui.newCode ? 'newcode' : ui.auth || 'join';
      if (!document.getElementById(want)) {
        view.innerHTML = want === 'newcode' ? '<div class="stack" style="margin-block:auto">' + logo() + codeCard() + '</div>'
          : want === 'login' ? loginScreen() : want === 'recover' ? recoverScreen() : welcome();
        mountCaptcha();
      }
      return;
    }
    if (ui.newCode && ui.newCode.after === 'home') {   // straight after sign-up: confirm the email, then save the recovery code
      tabs.hidden = true;
      if (ui.emailStep) { if (!document.getElementById('email-confirm')) view.innerHTML = '<div class="stack" style="margin-block:auto">' + logo() + emailCard() + '</div>'; }
      else if (!document.getElementById('newcode')) view.innerHTML = '<div class="stack" style="margin-block:auto">' + logo() + codeCard() + '</div>';
      return;
    }
    var html;
    if (ui.screen && ui.screen.type === 'venue') html = venue(ui.screen.id);
    else if (ui.screen && ui.screen.type === 'redeem') html = redeem(ui.screen.id);
    else html = topBar() + { home: home, sesh: sesh, map: mapTab, venues: venues, events: events, you: you }[ui.tab]();
    view.innerHTML = html;
    mountMap();
    mountMini();
    tabs.hidden = false;
    var requests = D.requests_in.length;
    var tabList = [['home', 'Home'], ['sesh', 'Sesh'], ['map', 'Map'], ['venues', 'Venues'], ['events', 'Events']];
    tabs.style.gridTemplateColumns = 'repeat(' + tabList.length + ', minmax(0, 1fr))';
    tabs.innerHTML = tabList.map(function (t) {
      return '<button data-act="tab" data-v="' + t[0] + '"' + (ui.tab === t[0] && !ui.screen ? ' aria-current="page"' : '') + '>' + svg(t[0], 22) + '<span>' + t[1] + '</span>' +
        (t[0] === 'home' && requests ? '<span class="badge" aria-label="' + requests + ' friend requests">' + requests + '</span>' : '') + '</button>';
    }).join('');

    Object.keys(kept).forEach(function (id) { var el = document.getElementById(id); if (el) el.value = kept[id]; });
    if (keptFocus && document.getElementById(keptFocus)) document.getElementById(keptFocus).focus();
    var again = document.getElementById('staff-code');
    if (again && keepValue !== null) { again.value = keepValue; if (keepFocus) again.focus(); }
    var chatAgain = document.getElementById('chat-input');
    if (chatAgain && chatValue !== null) { chatAgain.value = chatValue; if (chatFocus) chatAgain.focus(); }
    var listAgain = document.getElementById('chat-list');
    if (listAgain) { listAgain.scrollTop = chatTop !== null ? chatTop : listAgain.scrollHeight; refreshChat(false); }
    else { ui.messages = []; chatKey = ''; }
  }
  function go(top) { render(); if (top) view.scrollTop = 0; }

  function shareInvite() {
    var link = inviteLink();
    ui.linkShown = true;
    if (navigator.share) {
      navigator.share({ title: 'Frendzy', text: 'Add me on Frendzy so we can see when we\'re both up for a sesh.', url: link }).catch(function () {});
      render();
      return;
    }
    var done = function () { toast('Invite link copied.'); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(link).then(done, function () { toast('Copy the link shown below.'); });
    else toast('Copy the link shown below.');
    render();
  }

  var ACT = {
    tab: function (v) {
      if (v === 'sesh' && ui.tab === 'sesh' && !ui.screen) ui.seshId = null;   // tapping Sesh again goes back from a planned sesh
      ui.tab = v; ui.screen = null; ui.confirm = null; ui.staffError = ''; ui.picker = null; ui.plan = null; go(true);
      if (v === 'map' || v === 'venues') freshVenues(5 * 60000);
      if (v === 'map' && Date.now() - buzzAt > 60000) loadBuzz();
      if (v === 'map' || v === 'sesh' || v === 'events') loadPins().then(function () { if (ui.tab === v && !ui.screen) { if (M.map) M.fit = true; render(); } });
    },
    locate: function () {
      if (!navigator.geolocation) { toast('This phone cannot share its location. Tap the map instead.'); return; }
      geo.busy = true; render();
      navigator.geolocation.getCurrentPosition(function (pos) {
        geo.busy = false; geo.mine = true; geo.chosen = true;
        geo.centre = [pos.coords.latitude, pos.coords.longitude];   // kept in memory only, never sent anywhere
        M.fit = true; render();
      }, function () {
        geo.busy = false; render();
        toast('Could not get your location. Tap the map to pick a spot instead.');
      }, { enableHighAccuracy: false, maximumAge: 300000, timeout: 10000 });
    },
    status: function (v) {
      moveKnob(v); glow(v);
      act('set_status', { new_colour: v }, v === 'on' ? 'You\'re green. Friends who are around can see it.' : null).then(function () {
        ui.tab = 'home'; ui.screen = null; go(false);
      });
    },
    'status-here': function (v) {   // the traffic light in the header: change status and stay on this screen
      if (!D || !D.me || v === D.me.colour) return;
      glow(v);
      act('set_status', { new_colour: v }, { on: 'You\'re green. Friends who are around can see it.', thinking: 'You\'re amber.', off: 'You\'re red. You\'re hidden.' }[v]);
    },
    'go-sesh': function () {
      ui.seshId = null;
      if (liveSesh()) { ui.tab = 'sesh'; go(true); return; }
      ACT['start-sesh']();
    },
    'private-sesh': function () { ui.picker = { mode: 'start', picked: {} }; go(true); },
    'invite-more': function () { ui.picker = { mode: 'invite', picked: {} }; go(true); },
    pick: function (id) {
      var p = ui.picker || ui.plan;
      if (!p) return;
      if (p.picked[id]) delete p.picked[id]; else p.picked[id] = true;
      go(false);
    },
    'plan-sesh': function () {   // starts at the next half hour, at least an hour from now
      var t = new Date(now() + 3600000); t.setMinutes(t.getMinutes() < 30 ? 30 : 60, 0, 0);
      ui.plan = { at: localInput(t.getTime()), pick: false, picked: {} }; go(true);
    },
    'plan-who': function (v) { if (ui.plan) { ui.plan.pick = v === 'pick'; go(false); } },
    'plan-cancel': function () { ui.plan = null; go(true); },
    'plan-go': function () {
      var p = ui.plan, el = document.getElementById('plan-at'), ids = p ? Object.keys(p.picked) : [];
      if (!p || !el) return;
      var at = new Date(el.value);
      if (!el.value || isNaN(at)) { toast('Pick a date and time.'); return; }
      if (p.pick && !ids.length) return;
      act('plan_sesh', { p_at: at.toISOString(), p_friends: p.pick ? ids : null },
        p.pick ? 'Planned. Only the friends you picked can see it.' : 'Planned. Your friends can see it and say they\'re in.').then(function (r) {
        if (r) { ui.plan = null; ui.seshId = r.id; ui.tab = 'sesh'; go(true); }
      });
    },
    'pres-edit': function () { var s = mySesh(); if (s) { ui.presEdit = s.id; go(false); } },
    'pres-cancel': function () { ui.presEdit = null; go(false); },
    'pres-remove': function () {
      var s = mySesh(); if (!s) return;
      act('set_sesh_pres', { p_sesh: s.id, p_address: '', p_at: null }, 'Pres address removed.').then(function (r) { if (r) { ui.presEdit = null; go(false); } });
    },
    'pres-save': function () {
      var s = mySesh(), a = document.getElementById('pres-address'), t = document.getElementById('pres-time');
      if (!s || !a) return;
      if (!a.value.trim()) { toast('Type the address first.'); return; }
      var at = null;
      if (t && t.value) {   // that time on the day of the sesh, or the evening before for a sesh after midnight
        var start = new Date(s.starts_at), d = new Date(start), hm = t.value.split(':');
        d.setHours(Number(hm[0]), Number(hm[1]), 0, 0);
        if (d > start) d.setDate(d.getDate() - 1);
        at = d.toISOString();
      }
      act('set_sesh_pres', { p_sesh: s.id, p_address: a.value.trim(), p_at: at }, 'Pres address saved. Only the people in the sesh can see it.').then(function (r) { if (r) { ui.presEdit = null; go(false); } });
    },
    'open-sesh': function (v) { ui.seshId = v; go(true); },
    'sesh-back': function () { ui.seshId = null; go(true); },
    'join-planned': function (v) { act('join_sesh', { p_sesh: v }, 'You\'re in. It goes live at the planned time.'); },
    'start-planned': function () {
      var s = mySesh(); if (!s) return;
      act('start_planned_sesh', { p_sesh: s.id }, 'Sesh started. It\'s live now.').then(function (r) { if (r) { ui.seshId = null; go(true); } });
    },
    'picker-cancel': function () { ui.picker = null; go(true); },
    'picker-go': function () {
      var p = ui.picker, ids = p ? Object.keys(p.picked) : [], s = mySesh();
      if (!ids.length) return;
      var done = function (r) { if (r) { ui.picker = null; ui.tab = 'sesh'; go(true); } };
      if (p.mode === 'invite' && s) act('invite_to_sesh', { p_sesh: s.id, p_friends: ids }, 'Invited. They can see the sesh now.').then(done);
      else act('start_private_sesh', { p_friends: ids }, 'Private sesh started. Only the friends you picked can see it.').then(done);
    },
    'start-sesh': function () { act('start_sesh', {}, 'Sesh started. Friends who are around can join.').then(function () { ui.tab = 'sesh'; go(true); }); },
    join: function (v) { act('join_sesh', { p_sesh: v }, 'You\'re in.'); },
    'leave-sesh': function () { var s = mySesh(); if (s) { ui.seshId = null; act('leave_sesh', { p_sesh: s.id }); } },
    'end-sesh': function () { var s = mySesh(); if (s) { ui.seshId = null; act('end_sesh', { p_sesh: s.id }, isPlanned(s) ? 'Planned sesh cancelled.' : 'Sesh ended.'); } },
    vote: function (v) {
      var s = mySesh(); if (!s) return;
      var mine = (s.votes.filter(function (x) { return x.user_id === D.me.id; })[0] || {}).venue_id;
      act('cast_vote', { p_sesh: s.id, p_venue: mine === v ? null : v });
    },
    lock: function () { var s = mySesh(); if (s) act('lock_sesh', { p_sesh: s.id }, 'Locked in.').then(function () { view.scrollTop = 0; }); },
    suggest: function (v) {
      var s = mySesh(); if (!s) return;
      act('cast_vote', { p_sesh: s.id, p_venue: v }).then(function () { ui.screen = null; ui.tab = 'sesh'; go(true); });
    },
    'map-pick': function (v) {
      ui.mapPick = v || null; render();
      if (v && M.map && pins && pins[v] && !M.map.getBounds().pad(-0.1).contains(pins[v])) M.map.setView(pins[v], Math.max(M.map.getZoom(), 15), { animate: false });
      var card = document.getElementById('map-pick');
      if (card && card.scrollIntoView) card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    },
    'map-filter': function (v) {
      ui.mapFilter = ui.mapFilter === v ? '' : v; M.fitHits = !geo.chosen; render();
    },
    'clear-search': function () {
      ui.venueQuery = ''; render();
      var box = document.getElementById('venue-search'); if (box) box.focus();
    },
    venue: function (v) {
      ui.screen = { type: 'venue', id: v }; go(true);
      if (!pins) loadPins().then(function () { if (ui.screen && ui.screen.id === v) render(); });
    },
    close: function () {
      if (ui.screen && ui.screen.type === 'redeem') { var d = dealById(ui.screen.id); ui.screen = d ? { type: 'venue', id: d.venue_id } : null; }
      else ui.screen = null;
      go(true);
    },
    redeem: function (v) {
      var d = dealById(v);
      if (d && d.code) { ui.screen = { type: 'redeem', id: v }; go(true); return; }
      act('request_deal_code', { p_deal: v }).then(function (r) { if (r) { ui.screen = { type: 'redeem', id: v }; go(true); } });
    },
    'quick-star': function (v) {
      var parts = String(v).split(':'), ven = venueById(parts[0]);
      if (!ven) return;
      act('rate_venue', { p_venue: ven.id, p_stars: Number(parts[1]), p_tags: ven.my_tags }, 'Thanks, rating saved.').then(function () { return freshVenues(0); });
    },
    star: function (v) {
      var ven = venueById(ui.screen.id);
      act('rate_venue', { p_venue: ven.id, p_stars: Number(v), p_tags: ven.my_tags }, 'Rating saved.').then(function () { return freshVenues(0); });
    },
    tag: function (v) {
      var ven = venueById(ui.screen.id);
      if (!ven.my_stars) { toast('Pick your stars first.'); return; }
      var tags = ven.my_tags.indexOf(v) >= 0 ? ven.my_tags.filter(function (t) { return t !== v; }) : ven.my_tags.concat(v);
      act('rate_venue', { p_venue: ven.id, p_stars: ven.my_stars, p_tags: tags }).then(function () { return freshVenues(0); });
    },
    share: shareInvite,
    'pick-photo': function () { var f = document.getElementById('photo-file'); if (f) f.click(); },
    'remove-photo': function () { savePhoto(null); },
    'age-start': function () {
      ui.ageBusy = true; ui.ageNote = ''; render();
      ageCheckCall('start', { return_to: location.origin + location.pathname }).then(function (r) {
        if (!/^https?:\/\//.test(String(r && r.url))) throw new Error('The age check is not working right now. Try again soon.');
        location.href = r.url;   // the provider's page sends the person back here with ?age_check=done
      }).catch(function (x) { ui.ageBusy = false; ui.ageNote = x.message; render(); });
    },
    'age-finish': function () { finishAgeCheck(); },
    'report-msg': function (v) {
      ui.confirm = null;
      rpc('report_message', { p_message: v, p_reason: '' }).then(function () { toast('Reported. Thanks for telling us.'); paintChat(false); }).catch(function (e) { toast(e.message); });
    },
    'block-user': function (v) { ui.confirm = null; act('block_user', { p_user: v }, 'Blocked.'); },
    'block-request': function (v) { ui.confirm = null; act('block_request', { p_friendship: v }, 'Blocked.'); },
    gender: function (v) {
      act('set_safety', { p_gender: v || null, p_women_only: (v === 'woman' || v === 'nonbinary') && !!ui.safety.women_only }).then(function (r) { if (r) { ui.safety = r; render(); } });
    },
    'women-only': function (v) {
      act('set_safety', { p_gender: ui.safety.gender, p_women_only: v === 'on' }, v === 'on' ? 'Women and non-binary only is on.' : 'Women and non-binary only is off.').then(function (r) { if (r) { ui.safety = r; render(); } });
    },
    unblock: function (v) { act('unblock_user', { p_user: v }, 'Unblocked. You can add each other again.'); },
    accept: function (v) { act('answer_friend', { p_friendship: v, p_accept: true }, 'You\'re now friends.'); },
    unfriend: function (v) { ui.confirm = null; act('answer_friend', { p_friendship: v, p_accept: false }); },
    ask: function (v) { ui.confirm = v; go(false); },
    'cancel-confirm': function () { ui.confirm = null; go(false); },
    auth: function (v) { ui.auth = v || null; view.innerHTML = ''; render(); },
    'edit-account': function () { ui.editAccount = !ui.editAccount; go(false); },
    'ts-resend': function () { sendLoginCode(); },
    peek: function (id) {
      var input = document.getElementById(id), btn = input && input.parentNode.querySelector('.peek');
      if (!input) return;
      var show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      btn.setAttribute('aria-pressed', String(show)); btn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
      input.focus();
    },
    'ts-recover': function () {
      session = null; store(SESSION_KEY, null); D = null; ui.twoStep = undefined; ui.auth = 'recover';
      view.innerHTML = ''; render();
    },
    'email-resend': function () {
      if (!ui.emailStep) return;
      emailCode('setup', { email: ui.emailStep.email }).then(function () { toast('Code sent again.'); }, function (x) { toast(x.message); });
    },
    'email-skip': function () { ui.emailStep = null; go(false); },
    'change-email': function () { ui.changeEmail = !ui.changeEmail; go(false); },
    'code-saved': function () {
      var after = ui.newCode && ui.newCode.after;
      if (after === 'login') { ui.loginName = ui.newCode.username; ui.auth = 'login'; }
      if (after === 'home') ui.tab = 'home';
      ui.newCode = null; view.innerHTML = ''; render();
    },
    logout: function () {
      session = null; store(SESSION_KEY, null); D = null; VENUES = null; venuesAsked = false; seen = null; lastKey = '';
      ui.account = undefined; ui.safety = undefined; ui.age = null; ui.auth = null; ui.editAccount = false; ui.tab = 'home'; ui.screen = null; ui.confirm = null; ui.twoStep = undefined; ui.emailStep = null; ui.changeEmail = false;
      view.innerHTML = ''; render(); toast('Logged out. Log in again with your username and password.');
    },
    'delete-account': function () {
      var goneId = session && session.user_id;
      act('delete_account', {}).then(function () {
        if (goneId) forgetPhone(goneId);
        store(LAST_USER_KEY, null);
        session = null; store(SESSION_KEY, null); D = null; VENUES = null; venuesAsked = false; seen = null; ui.confirm = null; ui.tab = 'home'; ui.screen = null; ui.account = undefined; ui.safety = undefined; ui.age = null; ui.twoStep = undefined; ui.emailStep = null; ui.changeEmail = false;
        view.innerHTML = ''; render(); toast('Your account has been deleted.');
      });
    }
  };

  /* ---------- status switch: drag or flick the knob ---------- */
  var drag = null, swallowClick = false;
  function moveKnob(v) {
    var el = document.getElementById('status-slide');
    if (!el || STOPS.indexOf(v) < 0) return;
    el.style.setProperty('--i', STOPS.indexOf(v));
    el.style.setProperty('--c', COLORS[v]);
    [].forEach.call(el.querySelectorAll('.stop'), function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-v') === v)); });
  }
  document.addEventListener('pointerdown', function (e) {
    var el = e.target.closest('#status-slide');
    if (!el || (e.pointerType === 'mouse' && e.button !== 0)) return;
    var start = STOPS.indexOf(D && D.me ? D.me.colour : 'off');
    drag = { el: el, knob: el.querySelector('.knob'), id: e.pointerId, x0: e.clientX, t0: Date.now(), start: start, at: start,
      step: (el.getBoundingClientRect().width - 10) / 3, moved: false };
  });
  document.addEventListener('pointermove', function (e) {
    if (!drag || e.pointerId !== drag.id) return;
    var dx = e.clientX - drag.x0;
    if (!drag.moved) {
      if (Math.abs(dx) < 6) return;
      drag.moved = true;
      drag.el.classList.add('dragging');
      try { drag.el.setPointerCapture(e.pointerId); } catch (err) {}
    }
    var pos = Math.max(0, Math.min(2 * drag.step, drag.start * drag.step + dx));
    drag.knob.style.transform = 'translateX(' + pos + 'px)';
    var at = Math.round(pos / drag.step);
    if (at !== drag.at) { drag.at = at; drag.el.style.setProperty('--c', COLORS[STOPS[at]]); if (navigator.vibrate) navigator.vibrate(8); }
  });
  function endDrag(e, cancelled) {
    if (!drag || e.pointerId !== drag.id) return;
    var d = drag; drag = null;
    if (!d.moved) return;
    swallowClick = true; setTimeout(function () { swallowClick = false; }, 0);
    d.el.classList.remove('dragging');
    d.knob.style.transform = '';
    var at = d.at, dx = e.clientX - d.x0;
    // A quick flick moves at least one stop in the direction of the flick.
    if (!cancelled && at === d.start && Math.abs(dx) > 20 && Date.now() - d.t0 < 300) at = Math.max(0, Math.min(2, d.start + (dx > 0 ? 1 : -1)));
    var v = STOPS[cancelled ? d.start : at];
    if (D && D.me && v !== D.me.colour) ACT.status(v);
    else { moveKnob(STOPS[d.start]); render(); }
  }
  document.addEventListener('pointerup', function (e) { endDrag(e, false); });
  document.addEventListener('pointercancel', function (e) { endDrag(e, true); });

  document.addEventListener('input', function (e) {
    if (e.target.id === 'radius') setRadius(e.target.value);
    if (e.target.id === 'venue-search') setSearch(e.target.value);
  });
  document.addEventListener('change', function (e) {
    if (e.target.id !== 'photo-file' || !e.target.files || !e.target.files[0]) return;
    var file = e.target.files[0];
    if (!/^image\//.test(file.type)) { toast('Pick a photo.'); return; }
    shrinkPhoto(file).then(savePhoto, function () { toast('That photo could not be opened. Try a different one.'); });
  });
  document.addEventListener('change', function (e) { if (e.target.id === 'radius' && M.map) { M.fit = true; drawMap(); } });   // zoom to the circle once the slider is let go
  document.addEventListener('toggle', function (e) {   // remember which settings sections are open
    var d = e.target;
    if (d && d.classList && d.classList.contains('set')) ui.sets[d.getAttribute('data-set')] = d.open;
  }, true);
  document.addEventListener('click', function (e) {
    if (swallowClick) return;
    var b = e.target.closest('[data-act]');
    if (!b || b.disabled) return;
    var fn = ACT[b.getAttribute('data-act')];
    if (fn) fn(b.getAttribute('data-v'));
  });

  // Crops the middle square of a photo and shrinks it to 160 x 160 on this phone before it is sent.
  function shrinkPhoto(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onerror = reject;
      reader.onload = function () {
        var img = new Image();
        img.onerror = reject;
        img.onload = function () {
          var side = Math.min(img.naturalWidth, img.naturalHeight), c = document.createElement('canvas');
          if (!side) return reject(new Error('empty'));
          c.width = c.height = 160;
          c.getContext('2d').drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, 160, 160);
          var out = c.toDataURL('image/jpeg', 0.82);
          if (out.length > 60000) out = c.toDataURL('image/jpeg', 0.6);
          resolve(out);
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }
  function savePhoto(dataUrl) {
    ui.photoBusy = true; render();
    rpc('set_photo', { p_photo: dataUrl }).then(loadPhotos).then(function () { toast(dataUrl ? 'Photo saved.' : 'Photo removed.'); })
      .catch(function (e) { toast(e.message); })
      .then(function () { ui.photoBusy = false; render(); });
  }

  function sendPendingInvite() {
    var code = store(INVITE_KEY);
    if (!code) return Promise.resolve();
    store(INVITE_KEY, null);
    return rpc('request_friend', { p_code: code }).then(function (r) {
      if (r && r.state === 'accepted') toast('You and ' + first(r.name) + ' are now friends.');
      else if (r) toast('Friend request sent to ' + first(r.name) + '.');
    }).catch(function (e) { toast(e.message); });
  }

  // The username and password picked on the sign-up screen. Kept in memory only, never in storage,
  // so they are lost if the age check leaves the page; then the You page asks for them again.
  var newLogin = null;
  function saveNewLogin() {
    var l = newLogin;
    newLogin = null;
    if (!l) return Promise.resolve();
    return rpc('save_account', { p_username: l.username, p_password: l.password }).then(function (r) {
      ui.newCode = { code: r.recovery_code, username: r.username, after: 'home' };   // load() then reads the account
      store(LAST_USER_KEY, r.username);
      // Then a code to confirm the email. The account is saved either way; the email can be added later on the You page.
      if (l.email) return emailCode('setup', { email: l.email }).then(function (sent) { ui.emailStep = { email: l.email, hint: sent.hint }; }, function (x) { toast(x.message); });
    }, function (e) { ui.tab = 'you'; toast(e.message + ' Pick another username below.'); });
  }
  function finishSignUp(name, dob) {
    return rpc('api_sign_up', { p_name: name, p_birth_date: dob })
      .then(function () { waiting(null); })
      .then(saveNewLogin)
      .then(sendPendingInvite)
      .then(function () { document.activeElement && document.activeElement.blur(); view.innerHTML = ''; return load(); });
  }
  // After the provider's page sends the person back (or they tap "check again").
  function finishAgeCheck() {
    if (!session) return Promise.resolve();
    ui.ageBusy = true; ui.ageNote = ''; render();
    return ageCheckCall('finish').then(function (r) {
      var result = r && r.result;
      return loadAge().then(function () {
        if (result === 'passed') {
          var w = waiting();
          if (w && !(D && D.me)) return finishSignUp(w.name, w.dob);
          toast('Thanks, you\'re verified.');
          return load();
        }
        if (result === 'pending') ui.ageNote = 'Your check is still being looked at. This can take a few minutes.';
        else if (result === 'failed') ui.ageNote = 'We couldn\'t confirm you\'re 18 or over. You can try again, for example with ID.';
      });
    }).catch(function (x) { ui.ageNote = x.message; })
      .then(function () { ui.ageBusy = false; render(); });
  }

  document.addEventListener('submit', function (e) {
    e.preventDefault();
    if (e.target.id === 'hours-form') {
      var ven = ui.screen && venueById(ui.screen.id), val = document.getElementById('hours-input').value.trim();
      if (!ven) return;
      if (val && !(window.SeshHours && window.SeshHours.parse(val))) { ui.hoursError = 'Those hours could not be read. Try a format like: Mo-Fr 16:00-24:00; Sa,Su 12:00-02:00'; render(); return; }
      ui.hoursError = '';
      act('set_venue_hours', { p_venue: ven.id, p_hours: val }, 'Hours saved.').then(function () { return freshVenues(0); });
      return;
    }
    if (e.target.id === 'join') {
      var name = document.getElementById('name').value.trim(), dob = document.getElementById('dob').value;
      var ju = document.getElementById('join-user').value.trim().toLowerCase(), jp = document.getElementById('join-pass').value;
      var err = document.getElementById('join-error'), btn = document.getElementById('join-btn');
      var fail = function (msg) { err.textContent = msg; err.hidden = false; btn.disabled = false; };
      if (!name) return fail('Enter your first name to continue.');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dob) || dob < '1900-01-01' || dob > todayPerth()) return fail('Enter your date of birth.');
      if (dob > eighteenYearsAgo()) { store(UNDERAGE_KEY, true); view.innerHTML = tooYoung(); return; }
      if (!/^[a-z0-9_]{3,20}$/.test(ju)) return fail('Pick a username of 3 to 20 letters, numbers or _.');
      if (jp.length < 10) return fail('Use a password of at least 10 characters.');
      var je = document.getElementById('join-email').value.trim();
      if (!/^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$/.test(je)) return fail('Enter your email address. Login codes go there.');
      if (CAPTCHA_KEY && !session && !captchaToken) return fail('Wait a moment for the check above to finish, then try again.');
      btn.disabled = true; err.hidden = true;
      (session ? Promise.resolve() : signInAnonymously(useCaptcha()))
        // An older database without username_free() just skips this early check; save_account still refuses a taken name.
        .then(function () { return rpc('username_free', { p_username: ju }).catch(function (x) { if (x.missing) return true; throw x; }); })
        .then(function (free) {
          if (free === false) throw new Error('That username is taken. Try another.');
          newLogin = { username: ju, password: jp, email: je };
        })
        .then(loadAge)
        .then(function () {
          if (needsAgeCheck()) { waiting({ name: name, dob: dob }); ui.ageNote = ''; document.activeElement && document.activeElement.blur(); render(); return; }
          return finishSignUp(name, dob);
        })
        .catch(function (x) { fail(x.message); });
    }
    if (e.target.id === 'login') {
      var lu = document.getElementById('login-user').value.trim(), lp = document.getElementById('login-pass').value;
      var lerr = document.getElementById('login-error'), lbtn = document.getElementById('login-btn');
      var lfail = function (msg) { lerr.textContent = msg; lerr.hidden = false; lbtn.disabled = false; };
      if (!lu || !lp) return lfail('Enter your username and password.');
      if (CAPTCHA_KEY && !captchaToken) return lfail('Wait a moment for the check above to finish, then try again.');
      lbtn.disabled = true; lerr.hidden = true;
      signInWithPassword(lu, lp, useCaptcha()).then(function () {
        store(LAST_USER_KEY, lu.toLowerCase());
        // Straight after a recovery code, this login doesn't need the email code.
        var ticket = ui.ticket; ui.ticket = null;
        return ticket ? rpc('two_step_use_ticket', { p_ticket: ticket }).then(function (ok) { if (ok) return refreshSession(); }, function () {}) : null;
      }).then(function () {
        D = null; VENUES = null; venuesAsked = false; lastKey = ''; ui.auth = null; ui.loginName = ''; ui.account = undefined; ui.safety = undefined; ui.age = null; ui.twoStep = undefined; ui.emailStep = null; ui.changeEmail = false;
        document.activeElement && document.activeElement.blur(); view.innerHTML = '';
        return load().then(function () { if (D && D.me) return sendPendingInvite(); });
      }).catch(function (x) { lfail(x.message); });
      return;
    }
    if (e.target.id === 'recover') {
      var ru = document.getElementById('rec-user').value.trim(), rc = document.getElementById('rec-code').value, rp = document.getElementById('rec-pass').value;
      var rerr = document.getElementById('rec-error'), rbtn = document.getElementById('rec-btn');
      var rfail = function (msg) { rerr.textContent = msg; rerr.hidden = false; rbtn.disabled = false; };
      if (!ru || !rc.trim()) return rfail('Enter your username and recovery code.');
      if (rp.length < 10) return rfail('Use a password of at least 10 characters.');
      if (CAPTCHA_KEY && !session && !captchaToken) return rfail('Wait a moment for the check above to finish, then try again.');
      rbtn.disabled = true; rerr.hidden = true;
      (session ? Promise.resolve() : signInAnonymously(useCaptcha()))
        .then(function () { return rpc('recover_account', { p_username: ru, p_code: rc, p_password: rp }); })
        .then(function (r) {
          if (!r || !r.ok) return rfail((r && r.message) || 'That didn\'t work. Try again.');
          // This phone's temporary sign-in was only for the recovery; log in with the new password next.
          ui.newCode = { code: r.recovery_code, username: r.username, after: 'login' };
          return emailRecovery().then(function () {
            session = null; store(SESSION_KEY, null); ui.twoStep = undefined; ui.ticket = r.ticket || null;
            document.activeElement && document.activeElement.blur(); view.innerHTML = ''; render();
          });
        })
        .catch(function (x) { rfail(x.message); });
      return;
    }
    if (e.target.id === 'two-step') {
      var tc = document.getElementById('ts-code').value.replace(/\D/g, '');
      var terr = document.getElementById('ts-error'), tbtn = document.getElementById('ts-btn');
      var tfail = function (msg) { terr.textContent = msg; terr.hidden = false; tbtn.disabled = false; };
      if (tc.length !== 6) return tfail('Enter the 6-digit code from the email.');
      var keepPhone = document.getElementById('ts-remember').checked;
      tbtn.disabled = true; terr.hidden = true;
      rpc('two_step_check', { p_code: tc }).then(function (r) {
        if (!r || !r.ok) return tfail((r && r.message) || 'That didn\'t work. Try again.');
        // A fresh sign-in token, now with full access.
        return refreshSession().then(function () {
          if (keepPhone) return rememberPhone();
          if (session && session.user_id) forgetPhone(session.user_id);
        }).then(function () {
          ui.twoStep = { needed: false }; document.activeElement && document.activeElement.blur(); view.innerHTML = '';
          return load().then(function () { if (D && D.me) return sendPendingInvite(); });
        });
      }).catch(function (x) { tfail(x.message); });
      return;
    }
    if (e.target.id === 'email-confirm') {
      var ec = document.getElementById('ec-code').value.replace(/\D/g, '');
      var eerr = document.getElementById('ec-error'), ebtn = document.getElementById('ec-btn');
      var efail = function (msg) { eerr.textContent = msg; eerr.hidden = false; ebtn.disabled = false; };
      if (ec.length !== 6) return efail('Enter the 6-digit code from the email.');
      ebtn.disabled = true; eerr.hidden = true;
      rpc('two_step_check', { p_code: ec }).then(function (r) {
        if (!r || !r.ok) return efail((r && r.message) || 'That didn\'t work. Try again.');
        var changed = ui.account && ui.account !== 'off' && ui.account.email;
        if (ui.account && ui.account !== 'off') ui.account.email = r.email;
        var renew = ui.emailStep.renew && !ui.newCode;
        ui.emailStep = null; ui.changeEmail = false;
        toast(changed ? 'Email changed. Login codes now go to ' + r.email + '.' : 'Email confirmed. New logins will ask for a code from it.');
        rememberPhone();   // the phone that confirmed the email doesn't need a code at its next login
        // From the You page, a fresh recovery code goes to the (new) email too. The old one only exists as a hash.
        return (renew ? rpc('renew_recovery_code').then(function (c) {
          ui.newCode = { code: c.recovery_code, username: c.username, after: 'you' };
        }, function () {}) : Promise.resolve()).then(function () {
          document.activeElement && document.activeElement.blur(); render();
          emailRecovery();
        });
      }).catch(function (x) { efail(x.message); });
      return;
    }
    if (e.target.id === 'save-account' || e.target.id === 'add-email') {
      var adding = e.target.id === 'add-email';
      var su = adding ? '' : document.getElementById('save-user').value.trim().toLowerCase(), sp = adding ? '' : document.getElementById('save-pass').value;
      var emailIn = document.getElementById('save-email'), em = emailIn ? emailIn.value.trim() : '';
      var serr = document.getElementById('save-error'), sbtn = document.getElementById('save-btn');
      var sfail = function (msg) { serr.textContent = msg; serr.hidden = false; sbtn.disabled = false; };
      if (!adding && !/^[a-z0-9_]{3,20}$/.test(su)) return sfail('Pick a username of 3 to 20 letters, numbers or _.');
      if (!adding && sp.length < 10) return sfail('Use a password of at least 10 characters.');
      if (emailIn && !/^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$/.test(em)) return sfail('Enter your email address. Login codes go there.');
      sbtn.disabled = true; serr.hidden = true;
      (adding ? Promise.resolve(null) : rpc('save_account', { p_username: su, p_password: sp })).then(function (r) {
        if (r) {
          ui.account = { username: r.username }; ui.editAccount = false; store(LAST_USER_KEY, r.username);
          ui.newCode = { code: r.recovery_code, username: r.username, after: 'you' };
        }
        if (!em) return;
        // The account is saved either way; if the email can't be sent, it can be added again from here.
        return emailCode('setup', { email: em }).then(function (s) {
          ui.emailStep = { email: em, hint: s.hint, renew: adding };
        }, function (x) { if (adding) throw x; toast(x.message); });
      }).then(function () {
        document.activeElement && document.activeElement.blur(); render();
        if (!ui.emailStep) emailRecovery();   // a password change on an account that already has its email
      }).catch(function (x) { sfail(x.message); });
      return;
    }
    if (e.target.id === 'add-friend') {
      var fu = document.getElementById('friend-user'), fname = fu.value.trim(), fbtn = document.getElementById('friend-btn');
      if (!fname) { ui.addFriendError = 'Type your friend\'s username.'; go(false); return; }
      fbtn.disabled = true;
      rpc('request_friend_by_username', { p_username: fname }).then(function (r) {
        if (!r || !r.ok) { ui.addFriendError = (r && r.message) || 'That didn\'t work. Try again.'; return; }
        ui.addFriendError = ''; fu.value = ''; ui.sets.friends = true;   // open Your friends so the new request shows
        toast(r.state === 'accepted' ? 'You and ' + first(r.name) + ' are now friends.'
          : r.state === 'requested' ? 'Friend request sent to ' + first(r.name) + '.' : 'You and ' + first(r.name) + ' are already friends.');
        return load();
      }).catch(function (x) {
        ui.addFriendError = x.missing ? 'Adding by username needs a database update. Send your invite link for now.' : x.message;
      }).then(function () { var b = document.getElementById('friend-btn'); if (b) b.disabled = false; go(false); });
      return;
    }
    if (e.target.id === 'chat-form') {
      var ci = document.getElementById('chat-input'), text = ci.value.trim(), sNow = mySesh();
      if (!text || !sNow) return;
      var sendBtn = document.getElementById('chat-send'); sendBtn.disabled = true;
      rpc('send_message', { p_sesh: sNow.id, p_body: text }).then(function () {
        ci.value = ''; return refreshChat(true);
      }).catch(function (x) { toast(x.message); }).then(function () { var b = document.getElementById('chat-send'); if (b) b.disabled = false; });
      return;
    }
    if (e.target.id === 'staff') {
      var input = document.getElementById('staff-code'), code = input.value.trim().toUpperCase();
      if (!code) { ui.staffError = 'Type the code from the customer\'s phone.'; render(); return; }
      rpc('confirm_deal_code', { p_code: code }).then(function () {
        ui.staffError = ''; input.value = ''; toast('Code confirmed. Give them the deal.'); render();
        var fresh = document.getElementById('staff-code'); if (fresh) fresh.value = '';
      }).catch(function (x) { ui.staffError = x.message; render(); });
    }
  });

  /* ---------- clocks ---------- */
  setInterval(function () {
    if (!D || !D.me) return;
    var t = now(), els = view.querySelectorAll('[data-until]');
    for (var i = 0; i < els.length; i++) {
      var until = Number(els[i].getAttribute('data-until'));
      if (t >= until) { load(); return; }
      els[i].textContent = fmtLeft(until - t);
    }
  }, 1000);
  setInterval(function () {
    if (document.hidden || !session || !D || !D.me || acting) return;
    load(true);
  }, POLL_MS);
  setInterval(function () { if (!document.hidden && D && D.me && !acting) refreshChat(false); }, CHAT_POLL_MS);
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden && session && D && D.me) load(true);
  });

  /* ---------- start ---------- */
  try {
    var params = new URLSearchParams(location.search), invite = params.get('invite'), backFromCheck = params.has('age_check');
    if (invite) store(INVITE_KEY, invite.slice(0, 16));
    if (invite || backFromCheck) history.replaceState(null, '', location.pathname);
  } catch (e) {}

  render();
  if (API_URL && API_KEY) {
    if (session) load().then(function () {
      if (needsAgeCheck() && (backFromCheck || (ui.age.pending && (D && D.me || waiting())))) return finishAgeCheck();
      if (D && D.me) return sendPendingInvite().then(function () { return load(true); });
    });
    else { ui.booted = true; render(); }
  }
})();
