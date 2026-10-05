/* Chapouu — page behaviour, scroll state and progress broadcasting.
   Runs as a classic script so the page stays fully usable even if the
   WebGL module never loads. */
(function () {
  'use strict';

  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var clamp = function (v, a, b) { return v < a ? a : v > b ? b : v; };

  /* Shared state read by the three.js module ----------------------------- */
  var state = window.chapouu = {
    p: 0,          // damped assembly progress 0..1
    raw: 0,        // undamped
    reduced: reduced,
    pointer: { x: 0, y: 0 },
    ready: false
  };

  /* Loader ---------------------------------------------------------------- */
  var loader = document.querySelector('.loader');
  var dismiss = function () {
    if (!loader || loader.classList.contains('is-gone')) return;
    loader.classList.add('is-gone');
    document.body.classList.add('is-loaded');
  };
  window.addEventListener('load', function () { setTimeout(dismiss, reduced ? 0 : 400); });
  setTimeout(dismiss, 4000); // never trap the page behind a slow asset

  /* Nav ------------------------------------------------------------------- */
  var header = document.querySelector('.site-header');
  var toggle = document.querySelector('.menu-toggle');
  var links = document.querySelector('.nav-links');

  if (toggle && links) {
    var setMenu = function (open) {
      links.classList.toggle('is-open', open);
      toggle.setAttribute('aria-expanded', String(open));
      toggle.setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation');
      document.body.classList.toggle('nav-open', open);
      document.body.style.overflow = open ? 'hidden' : '';
    };
    toggle.addEventListener('click', function () {
      setMenu(!links.classList.contains('is-open'));
    });
    links.querySelectorAll('a').forEach(function (a) {
      a.addEventListener('click', function () { setMenu(false); });
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') setMenu(false);
    });
  }

  /* Reveal on enter ------------------------------------------------------- */
  var revealables = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window && !reduced) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-in');
        io.unobserve(entry.target);
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -8% 0px' });
    revealables.forEach(function (el, i) {
      el.style.setProperty('--d', (i % 4) * 90 + 'ms');
      io.observe(el);
    });
  } else {
    revealables.forEach(function (el) { el.classList.add('is-in'); });
  }

  /* Hat picker ------------------------------------------------------------ */
  state.hat = 0;
  var hatButtons = Array.prototype.slice.call(document.querySelectorAll('.hat-btn'));
  hatButtons.forEach(function (btn) {
    btn.addEventListener('click', function () {
      var index = parseInt(btn.dataset.hat, 10) || 0;
      state.hat = index;
      hatButtons.forEach(function (other) {
        var on = other === btn;
        other.classList.toggle('is-on', on);
        other.setAttribute('aria-checked', String(on));
      });
    });
  });
  /* Arrow keys move through the group, like a real radio set */
  hatButtons.forEach(function (btn, i) {
    btn.addEventListener('keydown', function (e) {
      var step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1
        : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
      if (!step) return;
      e.preventDefault();
      var next = hatButtons[(i + step + hatButtons.length) % hatButtons.length];
      next.focus();
      next.click();
    });
  });

  /* Pointer parallax ------------------------------------------------------ */
  window.addEventListener('pointermove', function (e) {
    /* a finger scrolling the page is not a cursor to lean toward */
    if (e.pointerType && e.pointerType !== 'mouse') return;
    state.pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
    state.pointer.y = (e.clientY / window.innerHeight) * 2 - 1;
  }, { passive: true });

  /* Scroll-driven state --------------------------------------------------- */
  var build = document.getElementById('build');
  var backdrop = document.querySelector('.backdrop');
  var sticky = document.querySelector('.build-sticky');
  var meter = document.querySelector('.build-meter');
  var meterValue = document.querySelector('.build-meter em');
  var payoff = document.querySelector('.build-payoff');
  var items = Array.prototype.slice.call(document.querySelectorAll('.layer-list li'));
  var darkZones = Array.prototype.slice.call(document.querySelectorAll('[data-dark]'));

  var LAYERS = items.length || 7;
  var SPAN = 0.19;
  var LAST = 0.88;
  var step = LAYERS > 1 ? (LAST - SPAN) / (LAYERS - 1) : 0;

  var lastScroll = window.scrollY;
  var lastPct = -1;
  var lastDark = null;

  function rawProgress() {
    if (!build) return 0;
    var rect = build.getBoundingClientRect();
    var travel = build.offsetHeight - window.innerHeight;
    if (travel <= 0) return rect.top <= 0 ? 1 : 0;
    return clamp(-rect.top / travel, 0, 1);
  }

  var lastTime = 0;
  var lastP = -1;

  function tick(now) {
    /* Damp by elapsed time, not by frame, so the glide feels the same on a
       60 Hz laptop and a 120 Hz phone. */
    var dt = lastTime ? Math.min((now - lastTime) / 1000, 0.05) : 1 / 60;
    lastTime = now;

    state.raw = rawProgress();
    state.p += (state.raw - state.p) * (reduced ? 1 : 1 - Math.exp(-7.5 * dt));
    if (Math.abs(state.raw - state.p) < 0.0004) state.p = state.raw;

    var p = state.p;
    var dive = clamp(p * 2.6, 0, 1);

    /* Only touch the DOM when the number actually moved */
    if (p !== lastP) {
      lastP = p;

      /* Backdrop dives from sand into deep teal as the burger comes together.
         Type and chrome crossfade off the same number so nothing is ever
         cream-on-cream halfway through. */
      if (backdrop) backdrop.style.setProperty('--dive', dive.toFixed(3));
      if (sticky) sticky.style.setProperty('--mix', dive.toFixed(3));

      /* Per-layer highlight */
      for (var i = 0; i < items.length; i++) {
        var t0 = i * step;
        var on = clamp((p - t0) / (SPAN * 0.8), 0, 1);
        items[i].style.setProperty('--on', on.toFixed(3));
      }

      /* Meter */
      var pct = Math.round(clamp(p / LAST, 0, 1) * 100);
      if (meter && pct !== lastPct) {
        meter.style.setProperty('--p', (pct / 100).toFixed(3));
        if (meterValue) meterValue.textContent = pct + '%';
        lastPct = pct;
      }
      if (payoff) payoff.style.setProperty('--done', clamp((p - 0.9) / 0.07, 0, 1).toFixed(3));
    }

    /* Header: hide on scroll down, invert over dark zones */
    if (header) {
      var y = window.scrollY;
      var down = y > lastScroll && y > 260;
      header.classList.toggle('is-tucked', down && !(links && links.classList.contains('is-open')));
      header.classList.toggle('is-stuck', y > 40);
      lastScroll = y;

      var dark = false;
      for (var d = 0; d < darkZones.length; d++) {
        var zone = darkZones[d];
        var r = zone.getBoundingClientRect();
        if (r.top > 64 || r.bottom <= 64) continue;
        dark = zone.dataset.dark === 'progress' ? dive > 0.55 : true;
        break;
      }
      if (dark !== lastDark) { header.classList.toggle('on-dark', dark); lastDark = dark; }
    }

    requestAnimationFrame(tick);
  }

  if (reduced) { state.p = state.raw = 1; }
  requestAnimationFrame(tick);

  /* Footer year ----------------------------------------------------------- */
  var year = document.getElementById('year');
  if (year) year.textContent = new Date().getFullYear();

  /* Expose loader dismissal for the scene module */
  state.dismissLoader = dismiss;
})();
