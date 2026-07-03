/* ============================================================================
 * CastAdhan marketing site — client-side data shim
 * ----------------------------------------------------------------------------
 * Same mechanism as the live web clock's prayer-shim.js: intercepts the
 * production clock module's same-origin /api/* calls and answers them in the
 * browser, so the module runs unmodified.
 *
 * One marketing-specific difference (BUILD-PROMPT v1.8 §3, "Honesty by
 * default" / BRIEF B3): on load the clock shows STATIC ILLUSTRATIVE
 * Haverfordwest times instantly — no geolocation prompt, no network call.
 * A visitor who clicks "Show my city" opts in: geolocate → reverse-geocode →
 * Aladhan by coordinates — the same path the live free clock uses.
 * ========================================================================== */
(function () {
  'use strict';

  /* Illustrative times: Haverfordwest, Wales (51.8014, -4.9714), ISNA
     (method 2), Shafi'i (school 0) — fetched from api.aladhan.com on
     Fri 03/07/2026 and baked in. Static by design; the caption says so. */
  var ILLUSTRATIVE = {
    label: 'Haverfordwest, Wales', country: 'United Kingdom',
    times: { Fajr: '03:15', Sunrise: '05:07', Dhuhr: '13:24', Asr: '17:47', Maghrib: '21:41', Isha: '23:33' }
  };
  var DEFAULT_METHOD = 2, DEFAULT_SCHOOL = 0; // same defaults as the live clock's shim

  function getSaved() {
    try { return JSON.parse(localStorage.getItem('mkt_city')); } catch (e) { return null; }
  }
  function setSaved(c) { try { localStorage.setItem('mkt_city', JSON.stringify(c)); } catch (e) {} }

  var STATE = {
    live: false,                      // false → serving the illustrative times
    city: { label: ILLUSTRATIVE.label, country: ILLUSTRATIVE.country, lat: null, lon: null, tz: null },
    times: ILLUSTRATIVE.times,
    error: null
  };

  var _realFetch = window.fetch.bind(window);

  /* ---- live times from Aladhan (by coords; cached per location+date) ------ */
  function ddmmyyyy(d) { function p(n) { return (n < 10 ? '0' : '') + n; } return p(d.getDate()) + '-' + p(d.getMonth() + 1) + '-' + d.getFullYear(); }
  function cacheKey(c) { return 'mkt_t_' + [c.lat, c.lon, new Date().toISOString().slice(0, 10)].join('|'); }
  function hhmm(s) { var m = String(s || '').match(/(\d{1,2}):(\d{2})/); return m ? (m[1].padStart(2, '0') + ':' + m[2]) : ''; }

  function loadTimes(c) {
    var ck = cacheKey(c), cached = null;
    try { cached = localStorage.getItem(ck); } catch (e) {}
    if (cached) {
      try {
        STATE.times = JSON.parse(cached);
        STATE.city = c; STATE.live = true; STATE.error = null;
        publish();
        return Promise.resolve(true);
      } catch (e) {}
    }
    var url = 'https://api.aladhan.com/v1/timings/' + ddmmyyyy(new Date()) +
      '?latitude=' + c.lat + '&longitude=' + c.lon + '&method=' + DEFAULT_METHOD + '&school=' + DEFAULT_SCHOOL;
    return _realFetch(url).then(function (r) { return r.json(); }).then(function (j) {
      if (!j || j.code !== 200 || !j.data) throw new Error('lookup failed');
      var t = j.data.timings, out = {};
      ['Fajr', 'Sunrise', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'].forEach(function (k) { if (t[k]) out[k] = hhmm(t[k]); });
      STATE.times = out;
      STATE.city = c; STATE.live = true; STATE.error = null;
      try { localStorage.setItem(ck, JSON.stringify(out)); } catch (e) {}
      publish();
      return true;
    }).catch(function (e) {
      STATE.error = e.message || 'lookup failed';
      return false;
    });
  }

  /* Publish the current state for the rest of the page (time-of-day ground,
     mobile legend, caption). Consumed by tod.js and the page glue script. */
  function publish() {
    try {
      localStorage.setItem('mkt_state', JSON.stringify({
        label: STATE.city.label, country: STATE.city.country,
        live: STATE.live, times: STATE.times, date: new Date().toISOString().slice(0, 10)
      }));
    } catch (e) {}
    try { document.dispatchEvent(new CustomEvent('castadhan:times', { detail: shimState() })); } catch (e) {}
  }

  function shimState() {
    return { live: STATE.live, label: STATE.city.label, country: STATE.city.country, times: STATE.times };
  }
  window.__castadhanState = shimState;

  /* ---- build the /api/state payload the clock module expects -------------- */
  function buildState() {
    var pt = STATE.times || {}, now = new Date;
    var adhans = ['Fajr', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'], nxt = null;
    for (var i = 0; i < adhans.length; i++) {
      var v = pt[adhans[i]];
      if (!v) continue;
      var hm = v.split(':'), w = new Date(now);
      w.setHours(+hm[0], +hm[1], 0, 0);
      if (w > now) { nxt = { name: adhans[i], when: w, t: v }; break; }
    }
    if (!nxt && pt.Fajr) {
      var h2 = pt.Fajr.split(':'), w2 = new Date(now);
      w2.setDate(w2.getDate() + 1);
      w2.setHours(+h2[0], +h2[1], 0, 0);
      nxt = { name: 'Fajr', when: w2, t: pt.Fajr };
    }
    var np = nxt ? { name: nxt.name, when_iso: nxt.when.toISOString(), effective_when_iso: nxt.when.toISOString(), time_pretty: nxt.t, effective_time_pretty: nxt.t, shifted: false } : null;
    return {
      ok: true,
      location: { city: (STATE.city.label || '').split(',')[0], country: STATE.city.country || '' },
      prayer_times: pt,
      next_prayer: np,
      now: now.toISOString(),
      scheduler_running: true,
      devices: { speakers: [] }
    };
  }

  /* ---- fetch shim ---------------------------------------------------------- */
  function json(o) { return new Response(JSON.stringify(o), { status: 200, headers: { 'Content-Type': 'application/json' } }); }
  window.fetch = function (input, init) {
    var url = (typeof input === 'string') ? input : (input && input.url) || '', path = url.split('?')[0];
    if (/^https?:\/\//i.test(url) && url.indexOf(location.origin) !== 0) return _realFetch(input, init); // external → pass through
    if (/\/api\/state$/.test(path)) return Promise.resolve(json(buildState()));
    if (/\/api\/play_history$/.test(path)) return Promise.resolve(json({ ok: true, entries: [] }));
    if (/\/api\/speaker\/status$/.test(path)) return Promise.resolve(json({ ok: true, status: {} }));
    if (/\/api\//.test(path)) return Promise.resolve(json({ ok: true }));
    return _realFetch(input, init);
  };

  /* ---- returning visitor who already opted in → their saved city ----------- */
  var saved = getSaved();
  if (saved && saved.lat != null) {
    STATE.city = saved;
    loadTimes(saved).then(function (ok) {
      if (ok && window.__castadhanRefresh) window.__castadhanRefresh();
    });
  } else {
    publish();
  }

  /* ---- "Show my city" (opt-in; the ONLY path that asks for location) ------- */
  function cleanCountry(c) { return String(c || '').replace(/\s*\(the\)$/i, ''); }

  window.__castadhanShowMyCity = function (onStatus) {
    var say = typeof onStatus === 'function' ? onStatus : function () {};
    if (!navigator.geolocation) { say('error', 'Location isn’t available in this browser.'); return; }
    say('busy', 'Finding your city…');
    navigator.geolocation.getCurrentPosition(function (pos) {
      var lat = pos.coords.latitude, lon = pos.coords.longitude, tz = null;
      try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (e) {}
      _realFetch('https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=' + lat + '&longitude=' + lon + '&localityLanguage=en')
        .then(function (r) { return r.json(); })
        .then(function (g) {
          var label = [g.city || g.locality, cleanCountry(g.countryName)].filter(Boolean).join(', ') || 'Your location';
          return { label: label, country: cleanCountry(g.countryName), lat: lat, lon: lon, tz: tz };
        })
        .catch(function () { return { label: 'Your location', country: '', lat: lat, lon: lon, tz: tz }; })
        .then(function (c) {
          loadTimes(c).then(function (ok) {
            if (!ok) { say('error', 'Couldn’t fetch times — please try again.'); return; }
            setSaved(c);
            if (window.__castadhanRefresh) window.__castadhanRefresh();
            say('done', 'Live times for ' + c.label);
          });
        });
    }, function () {
      say('error', 'Location was declined — the clock stays on its example city.');
    }, { timeout: 8000, maximumAge: 600000 });
  };
})();
