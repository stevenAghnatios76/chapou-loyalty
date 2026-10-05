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
    var narrow = window.matchMedia('(max-width: 720px)');
    var isOpen = function () { return links.classList.contains('is-open'); };

    /* On phones the closed menu is only clipped out of sight, so keep it out
       of the tab order and the accessibility tree until it is open. */
    var syncInert = function () { links.inert = narrow.matches && !isOpen(); };

    var setMenu = function (open) {
      links.classList.toggle('is-open', open);
      toggle.setAttribute('aria-expanded', String(open));
      document.body.classList.toggle('nav-open', open);
      document.body.style.overflow = open ? 'hidden' : '';
      syncInert();
    };
    syncInert();
    if (narrow.addEventListener) narrow.addEventListener('change', function () {
      if (!narrow.matches && isOpen()) setMenu(false);
      syncInert();
    });

    toggle.addEventListener('click', function () {
      var open = !isOpen();
      setMenu(open);
      if (open) links.querySelector('a').focus();
    });
    links.querySelectorAll('a').forEach(function (a) {
      a.addEventListener('click', function () { setMenu(false); });
    });
    document.addEventListener('keydown', function (e) {
      if (!isOpen()) return;
      if (e.key === 'Escape') {
        setMenu(false);
        toggle.focus();
      } else if (e.key === 'Tab') {
        /* Keep Tab inside the open overlay: the button, then its links. */
        var stops = [toggle].concat(Array.prototype.slice.call(links.querySelectorAll('a')));
        var first = stops[0], last = stops[stops.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
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
  var buildPhoto = document.querySelector('.build-photo');
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
      if (buildPhoto) buildPhoto.style.setProperty('--dive', dive.toFixed(3));
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

  /* Gallery reel ---------------------------------------------------------- */
  /* Two rows drift in opposite directions and lean further with the scroll,
     like the ticker. Each row is doubled so the loop has no seam; the copies
     are hidden from screen readers and the tab order. */
  var reel = document.querySelector('[data-reel]');
  var tiles = reel ? Array.prototype.slice.call(reel.querySelectorAll('.reel-tile')) : [];
  tiles.forEach(function (tile, i) { tile.dataset.index = i; });

  if (reel && !reduced) {
    var rows = Array.prototype.slice.call(reel.querySelectorAll('.reel-row')).map(function (row) {
      var originals = Array.prototype.slice.call(row.children);
      originals.forEach(function (li) {
        var copy = li.cloneNode(true);
        copy.setAttribute('aria-hidden', 'true');
        copy.querySelector('button').tabIndex = -1;
        row.appendChild(copy);
      });
      return { el: row, first: originals[0], twin: row.children[originals.length], dir: parseFloat(row.dataset.speed) || 1, period: 0, drift: 0 };
    });
    reel.classList.add('is-live');

    var measure = function () {
      rows.forEach(function (r) { r.period = r.twin.offsetLeft - r.first.offsetLeft; });
    };
    measure();
    window.addEventListener('resize', measure, { passive: true });

    var reelOn = false;
    var reelHold = false;
    var reelSpeed = 1;
    var reelTime = 0;

    var reelTick = function (now) {
      if (!reelOn) { reelTime = 0; return; }
      var dt = reelTime ? Math.min((now - reelTime) / 1000, 0.05) : 0;
      reelTime = now;
      /* ease to a stop under the cursor instead of freezing mid-motion */
      reelSpeed += ((reelHold ? 0 : 1) - reelSpeed) * (1 - Math.exp(-6 * dt));
      var lean = window.scrollY * 0.3;
      for (var i = 0; i < rows.length; i++) {
        var r = rows[i];
        if (!r.period) continue;
        r.drift += dt * 24 * reelSpeed;
        var x = ((r.drift + lean) * r.dir) % r.period;
        if (x < 0) x += r.period;
        r.el.style.transform = 'translate3d(' + (-x).toFixed(2) + 'px,0,0)';
      }
      requestAnimationFrame(reelTick);
    };

    /* lazy-loading cannot see a tile that slides in sideways, so once the reel
       is close, fetch every thumbnail and nothing ever drifts in blank */
    var warmReel = function () {
      reel.querySelectorAll('img[loading="lazy"]').forEach(function (img) { img.loading = 'eager'; });
    };

    if ('IntersectionObserver' in window) {
      var warmIo = new IntersectionObserver(function (entries) {
        if (!entries[0].isIntersecting) return;
        warmReel();
        warmIo.disconnect();
      }, { rootMargin: '900px 0px' });
      warmIo.observe(reel);

      new IntersectionObserver(function (entries) {
        var on = entries[0].isIntersecting;
        if (on && !reelOn) { reelOn = true; requestAnimationFrame(reelTick); }
        reelOn = on;
      }, { rootMargin: '120px 0px' }).observe(reel);
    } else {
      warmReel();
      reelOn = true;
      requestAnimationFrame(reelTick);
    }

    reel.addEventListener('pointerenter', function (e) { if (e.pointerType === 'mouse') reelHold = true; });
    reel.addEventListener('pointerleave', function () { reelHold = false; });
    reel.addEventListener('focusin', function () { reelHold = true; });
    reel.addEventListener('focusout', function () { reelHold = false; });
  }

  /* Lightbox -------------------------------------------------------------- */
  var box = document.querySelector('.lightbox');
  if (reel && box && typeof box.showModal === 'function') {
    var boxImg = box.querySelector('.lightbox-img');
    var boxCount = box.querySelector('.lightbox-count');
    var boxText = box.querySelector('.lightbox-text');
    var current = 0;
    var pad = function (n) { return (n < 10 ? '0' : '') + n; };

    var show = function (i) {
      current = (i + tiles.length) % tiles.length;
      var tile = tiles[current];
      var alt = tile.querySelector('img').alt;
      boxImg.classList.add('is-loading');
      boxImg.onload = function () { boxImg.classList.remove('is-loading'); };
      boxImg.src = tile.dataset.full;
      boxImg.alt = alt;
      boxText.textContent = alt;
      boxCount.textContent = pad(current + 1) + ' / ' + pad(tiles.length);
      /* warm up the neighbours so arrowing through feels instant */
      [current - 1, current + 1].forEach(function (n) {
        new Image().src = tiles[(n + tiles.length) % tiles.length].dataset.full;
      });
    };

    reel.addEventListener('click', function (e) {
      var tile = e.target.closest('.reel-tile');
      if (!tile) return;
      show(parseInt(tile.dataset.index, 10) || 0);
      box.showModal();
      document.documentElement.style.overflow = 'hidden';
    });
    box.addEventListener('close', function () {
      document.documentElement.style.overflow = '';
      boxImg.removeAttribute('src');
    });
    var swiped = false;
    box.addEventListener('click', function (e) {
      if (swiped) { swiped = false; return; }
      var action = e.target.closest('[data-lightbox]');
      if (action) {
        var what = action.dataset.lightbox;
        if (what === 'close') box.close();
        else show(current + (what === 'next' ? 1 : -1));
        return;
      }
      /* a click on the dark around the photo closes it */
      if (!e.target.closest('.lightbox-img, .lightbox-caption')) box.close();
    });
    box.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowRight') show(current + 1);
      if (e.key === 'ArrowLeft') show(current - 1);
    });

    var swipeX = null;
    box.addEventListener('pointerdown', function (e) {
      swiped = false;
      if (e.pointerType !== 'mouse') swipeX = e.clientX;
    });
    box.addEventListener('pointerup', function (e) {
      if (swipeX === null) return;
      var dx = e.clientX - swipeX;
      swipeX = null;
      if (Math.abs(dx) > 45) { swiped = true; show(current + (dx < 0 ? 1 : -1)); }
    });
  }

  /* Section photo drift --------------------------------------------------- */
  var driftBgs = reduced ? [] : Array.prototype.slice.call(document.querySelectorAll('.sec-bg[data-drift]'));
  if (driftBgs.length) {
    var driftQueued = false;
    var drift = function () {
      driftQueued = false;
      var vh = window.innerHeight;
      driftBgs.forEach(function (bg) {
        var rect = bg.getBoundingClientRect();
        if (rect.bottom < -100 || rect.top > vh + 100) return;
        /* -1 when the section's centre is at the bottom of the screen, +1 at the top */
        var t = clamp(1 - ((rect.top + rect.height / 2) / vh), -0.5, 1.5) * 2 - 1;
        var room = rect.height * 0.1; // the image overhangs 12% each side
        bg.style.setProperty('--drift', (t * room * 0.7).toFixed(1) + 'px');
      });
    };
    window.addEventListener('scroll', function () {
      if (driftQueued) return;
      driftQueued = true;
      requestAnimationFrame(drift);
    }, { passive: true });
    window.addEventListener('resize', drift);
    drift();
  }

  /* Footer year ----------------------------------------------------------- */
  var year = document.getElementById('year');
  if (year) year.textContent = new Date().getFullYear();

  /* Expose loader dismissal for the scene module */
  state.dismissLoader = dismiss;
})();
