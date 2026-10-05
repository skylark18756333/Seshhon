// The short walkthrough shown once after someone signs up, and again from "Show the tour" on the You page.
// Kept in its own file (loaded before app.js) so the page can forbid inline scripts. app.js opens it with FrendzyTour.open().
(function () {
  'use strict';
  var COLORS = { on: 'var(--on)', thinking: 'var(--thinking)', off: 'var(--off)' };

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function face(name, colour, hue) {
    return '<div class="friend face' + (colour === 'off' ? ' away' : '') + '" style="--c:' + (colour === 'off' ? 'var(--line)' : COLORS[colour]) + ';--h:' + hue + '">' +
      '<div class="face-pic">' + name.charAt(0) + '</div><div class="face-name">' + name + '</div>' +
      '<div class="state" style="--c:' + (colour === 'off' ? 'var(--muted)' : COLORS[colour]) + '">' + { on: 'Green', thinking: 'Amber', off: 'Red' }[colour] + '</div></div>';
  }
  var PIN = '<svg width="30" height="40" viewBox="0 0 30 40" aria-hidden="true"><path d="M15 39s13-13.4 13-23.5C28 7.5 22.2 2 15 2S2 7.5 2 15.5C2 25.6 15 39 15 39z" fill="#1F7BFF" stroke="#0B0B0D" stroke-width="2"/><circle cx="15" cy="15" r="5" fill="#fff"/></svg>';

  // Each step: a picture made from the app's own pieces, a heading and a line or two.
  function steps(name) {
    return [
      {
        art: '<div class="logo tour-logo"><div class="wordmark">Frendzy</div><div class="dots all"><i style="--c:var(--on)"></i><i style="--c:var(--thinking)"></i><i style="--c:var(--off)"></i></div></div>',
        title: name ? 'Welcome, ' + esc(name) + '.' : 'Welcome to Frendzy.',
        body: 'Frendzy is for getting off your phone and out with your mates. Here\'s how it works in five quick steps.'
      },
      {
        art: '<div class="slide tour-slide" aria-hidden="true"><span class="knob"></span><span class="stop">G</span><span class="stop">A</span><span class="stop">R</span></div>',
        title: 'Slide to show you\'re up for it',
        body: '<strong style="color:var(--on)">Green</strong> means you\'re keen to go out. <strong style="color:var(--thinking)">Amber</strong> means you\'re thinking about it. ' +
          '<strong style="color:var(--off)">Red</strong> means you\'re off and hidden. You start on red, and green or amber goes back to red by itself later.'
      },
      {
        art: '<div class="faces tour-faces" aria-hidden="true">' + face('Mia', 'on', 320) + face('Jay', 'thinking', 200) + face('Sam', 'off', 30) + '</div>',
        title: 'Bring your friends',
        body: 'Frendzy only works with friends on it. Send them your invite link, then accept their request. Friends show up as faces lit in their status colour, and only friends see your photo.'
      },
      {
        art: '<div class="tour-chat" aria-hidden="true"><div class="msg">Who\'s keen tonight?</div><div class="msg me">Me! Vote for a spot</div>' +
          '<div class="row tour-vote"><span class="small">The Bird</span><span class="bar"><i style="width:70%;background:var(--accent)"></i></span><span class="small muted">3</span></div></div>',
        title: 'Start a sesh',
        body: 'When you\'re green, start a sesh. Friends join, vote on where to go and chat. When the sesh ends, its votes and chat are deleted.'
      },
      {
        art: '<div class="tour-map" aria-hidden="true"><span class="tour-pin" style="left:22%;top:60%">' + PIN + '</span><span class="tour-pin" style="left:74%;top:50%">' + PIN + '</span>' +
          '<span class="tour-pin hot" style="left:47%;top:42%">' + PIN + '</span><span class="tour-tag" style="left:47%;top:58%">The Bird<small>Open till 2am</small></span></div>',
        title: 'Find a place',
        body: 'On the Map, choose where to look and how far you\'ll go. Tap a pin to see the venue, its hours and rating. The Events tab shows what\'s on tonight.'
      },
      {
        art: '<div class="tour-shield" aria-hidden="true"><svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6z"/><path d="M8.5 12l2.5 2.5 4.5-5"/></svg></div>',
        title: 'You\'re in control',
        body: 'Block anyone in one tap. Women and non-binary people can turn on a women and non-binary only mode under Safety on your profile. You can see this tour again from there too.'
      }
    ];
  }

  var box = null, list = [], at = 0, done = null, before = null, startX = null;

  function paint() {
    var s = list[at], last = at === list.length - 1;
    box.innerHTML = '<div class="tour-card" role="dialog" aria-modal="true" aria-labelledby="tour-title" aria-describedby="tour-body">' +
      '<div class="row between"><span class="eyebrow">' + (at + 1) + ' of ' + list.length + '</span>' +
      (last ? '' : '<button class="linkbtn tour-skip" data-tour="skip">Skip</button>') + '</div>' +
      '<div class="tour-art">' + s.art + '</div>' +
      '<h1 id="tour-title" tabindex="-1">' + s.title + '</h1><p id="tour-body" class="muted">' + s.body + '</p>' +
      '<div class="tour-dots" aria-hidden="true">' + list.map(function (x, i) { return '<i' + (i === at ? ' class="on"' : '') + '></i>'; }).join('') + '</div>' +
      '<div class="row">' + (at ? '<button class="btn ghost" data-tour="back">Back</button>' : '') +
      '<button class="btn" data-tour="next">' + (last ? 'Let\'s go' : at ? 'Next' : 'Show me') + '</button></div></div>';
    document.getElementById('tour-title').focus();
  }
  function move(by) {
    var to = at + by;
    if (to < 0) return;
    if (to >= list.length) return close();
    at = to; paint();
  }
  function close() {
    if (!box) return;
    box.remove(); box = null;
    var app = document.getElementById('app');
    if (app) { app.removeAttribute('inert'); app.removeAttribute('aria-hidden'); }
    document.removeEventListener('keydown', onKey, true);
    var fn = done; done = null;
    if (before && before.focus && document.contains(before)) before.focus();
    if (fn) fn();
  }
  function onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'ArrowRight') move(1);
    else if (e.key === 'ArrowLeft') move(-1);
    else if (e.key === 'Tab') {   // keep focus inside the tour
      var f = box.querySelectorAll('button, [tabindex="-1"]'), firstEl = f[0], lastEl = f[f.length - 1];
      if (e.shiftKey && document.activeElement === firstEl) { e.preventDefault(); lastEl.focus(); }
      else if (!e.shiftKey && document.activeElement === lastEl) { e.preventDefault(); firstEl.focus(); }
    }
  }

  window.FrendzyTour = {
    // opts.name: the person's first name for the welcome; opts.onClose: called once when it is finished or skipped.
    open: function (opts) {
      opts = opts || {};
      if (box) return;
      list = steps(opts.name); at = 0; done = opts.onClose || null; before = document.activeElement;
      box = document.createElement('div');
      box.className = 'tour';
      box.addEventListener('click', function (e) {
        var b = e.target.closest('[data-tour]');
        if (!b) return;
        var what = b.getAttribute('data-tour');
        if (what === 'skip') close(); else move(what === 'back' ? -1 : 1);
      });
      // Swipe left or right to move between steps.
      box.addEventListener('pointerdown', function (e) { startX = e.target.closest('button') ? null : e.clientX; });
      box.addEventListener('pointerup', function (e) {
        if (startX === null) return;
        var dx = e.clientX - startX; startX = null;
        if (Math.abs(dx) > 50) move(dx < 0 ? 1 : -1);
      });
      document.body.appendChild(box);
      var app = document.getElementById('app');
      if (app) { app.setAttribute('inert', ''); app.setAttribute('aria-hidden', 'true'); }
      document.addEventListener('keydown', onKey, true);
      paint();
    },
    isOpen: function () { return !!box; }
  };
})();
