/* Time-of-day ground (BUILD-PROMPT §2 / BRIEF R4): the page ground carries a
   subtle wash that follows the CURRENT prayer segment. Reads the state the
   marketing shim publishes (localStorage 'mkt_state'); pages without the
   clock fall back to the same illustrative Haverfordwest boundaries the shim
   bakes in (source of truth: marketing-shim.js ILLUSTRATIVE). */
(function () {
  'use strict';
  var FALLBACK = { Fajr: '03:15', Sunrise: '05:07', Dhuhr: '13:24', Asr: '17:47', Maghrib: '21:41', Isha: '23:33' };
  var SEGMENT = { Fajr: 'dawn', Sunrise: 'morning', Dhuhr: 'midday', Asr: 'afternoon', Maghrib: 'dusk', Isha: 'night' };

  function times() {
    try {
      var s = JSON.parse(localStorage.getItem('mkt_state'));
      if (s && s.times && s.times.Fajr) return s.times;
    } catch (e) {}
    return FALLBACK;
  }

  function apply() {
    var t = times(), now = new Date;
    var nowH = now.getHours() + now.getMinutes() / 60;
    var ORDER = ['Fajr', 'Sunrise', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'];
    var pts = [];
    ORDER.forEach(function (n) {
      var m = String(t[n] || '').match(/(\d{1,2}):(\d{2})/);
      if (m) pts.push({ n: n, h: +m[1] + m[2] / 60 });
    });
    var seg = 'night';
    for (var i = 0; i < pts.length; i++) {
      var a = pts[i].h, b = pts[(i + 1) % pts.length].h;
      if (a < b ? nowH >= a && nowH < b : nowH >= a || nowH < b) { seg = SEGMENT[pts[i].n]; break; }
    }
    document.documentElement.setAttribute('data-tod', seg);
  }

  apply();
  setInterval(apply, 60000);
  document.addEventListener('castadhan:times', apply);

  // On the clock page only: preload the CURRENT period's wedge scene so the
  // dial's brightest wedge paints as early as possible (segment names match
  // the production scene filenames).
  if (document.querySelector('.cp-dial')) {
    var seg = document.documentElement.getAttribute('data-tod') || 'midday';
    var l = document.createElement('link');
    l.rel = 'preload'; l.as = 'image'; l.href = 'static/scenes/' + seg + '.jpg';
    document.head.appendChild(l);
  }
})();
