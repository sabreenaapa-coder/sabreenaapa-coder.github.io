/* ============================================================================
 * CastAdhan — THE PRODUCTION CLOCK, reused (BUILD-PROMPT v1.8 §3)
 * ----------------------------------------------------------------------------
 * Lifted from the production clock module (`cpInit` in the live web clock at
 * ~/Documents/prayer-clock-web/index.html — itself console.html's clock made
 * static). The rendering code is UNMODIFIED: buildFace24, drawF24, setHands24,
 * windUpClock, the mandala rings, and the native aurora
 * (initAurora / updateAurora / drawAurora) are verbatim.
 *
 * Removed (page chrome around the dial, NOT the dial): the admin view, the
 * 12-hour/ottoman face + mode toggle, speaker cards, moon/weather/Hijri
 * widgets. Every render function is element-guarded, so absent chrome no-ops.
 *
 * Site-specific additions live ONLY in the clearly marked "SITE DRIVERS"
 * section at the bottom (the "Watch the prayer day" sweep — a thin driver over
 * the unchanged production render path — and boot wiring).
 *
 * Data comes from marketing-shim.js answering the same /api/* calls the
 * product answers (the same mechanism as the live clock's prayer-shim.js).
 * ========================================================================== */
(function cpInit() {
  const CX = 100, CY = 100;
  const $cp = id => document.getElementById(id);
  const localName = p => typeof prayerName === "function" ? prayerName(p) : p;
  const pad = n => String(n).padStart(2, "0");
  const parseHM = s => typeof parseTime === "function" ? parseTime(s) : (() => {
    if (!s || s === "undefined") return null;
    const [h, m] = String(s).split(":").map(Number);
    if (isNaN(h) || isNaN(m)) return null;
    const d = new Date;
    d.setHours(h, m, 0, 0);
    return d;
  })();
  const pt = (r, deg) => {
    const a = deg * Math.PI / 180;
    return { x: CX + r * Math.sin(a), y: CY - r * Math.cos(a) };
  };
  const SVGNS = "http://www.w3.org/2000/svg";

  function setRot(id, deg) {
    const el = $cp(id);
    if (el) el.setAttribute("transform", `rotate(${deg} 100 100)`);
  }

  /* ---- mandala orbit rings (behind the dial) ----------------------------- */
  const MANDALA = [
    { baseR: 85, petals: [{ k: 10, amp: 9, sharp: 1.9, w: .06 }], stroke: "rgba(212,175,55,0.38)", width: .8 },
    { baseR: 89, petals: [{ k: 14, amp: 6.5, sharp: 2.1, w: -.045 }], stroke: "rgba(240,150,205,0.22)", width: .6 },
    { baseR: 82, petals: [{ k: 8, amp: 8, sharp: 1.7, w: .034 }], stroke: "rgba(185,140,238,0.18)", width: .6 }
  ];
  const mandalaEls = [];

  function ringPath(baseR, petals, t) {
    const N = 240;
    let d = "";
    for (let i = 0; i <= N; i++) {
      const th = i / N * Math.PI * 2;
      let rr = baseR;
      for (const p of petals) rr += p.amp * Math.pow(.5 + .5 * Math.cos(p.k * th + p.w * t), p.sharp);
      const x = 100 + rr * Math.cos(th), y = 100 + rr * Math.sin(th);
      d += (i === 0 ? "M" : "L") + x.toFixed(2) + " " + y.toFixed(2) + " ";
    }
    return d + "Z";
  }

  function buildMandala() {
    const root = $cp("cp-orbits");
    if (!root) return;
    root.innerHTML = "";
    mandalaEls.length = 0;
    MANDALA.forEach(cfg => {
      const p = document.createElementNS(SVGNS, "path");
      p.setAttribute("fill", "none");
      p.setAttribute("stroke", cfg.stroke);
      p.setAttribute("stroke-width", cfg.width);
      p.setAttribute("stroke-linejoin", "round");
      p.setAttribute("d", ringPath(cfg.baseR, cfg.petals, 0));
      root.appendChild(p);
      mandalaEls.push({ el: p, cfg: cfg });
    });
  }

  /* ---- the native aurora (#cp-aurora) — reproduced EXACTLY as it ships.
     96px canvas, CSS-upscaled ~138% + blurred; palette shifts with the current
     prayer segment / time of day (owner override of the no-green/no-gradient
     guardrail — fidelity to the production clock wins). ---------------------- */
  const AW = 96, AH = 96, ACX = 48, ACY = 48, AEDGE = 48;
  const A_SPAN = 1.38;
  let auroraCtx = null, auroraImg = null;

  function initAurora() {
    const cv = $cp("cp-aurora");
    if (!cv || !cv.getContext) return;
    auroraCtx = cv.getContext("2d");
    auroraImg = auroraCtx.createImageData(AW, AH);
  }
  const _hx = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const AU_KEYS = [
    { p: 0, c: ["#38D66B", "#1ED6B5", "#31C7FF"] },
    { p: .25, c: ["#1ED6B5", "#31C7FF", "#397BFF"] },
    { p: .5, c: ["#397BFF", "#6548E8", "#8B5CF6"] },
    { p: .75, c: ["#8B5CF6", "#C026D3", "#E11D8F"] },
    { p: .9, c: ["#E11D48", "#F43F5E", "#F97316"] }
  ].map(k => ({ p: k.p, c: k.c.map(_hx) }));
  const AU_FINAL = ["#6B0F2A", "#9F1239", "#E11D48", "#A21CAF"].map(_hx);
  const AU_SUNRISE = ["#9B1B1B", "#E03616", "#F59E0B", "#FFD24A"].map(_hx);
  const AU_ZENITH = ["#FFFBEA", "#FFF0B8", "#FFE08A", "#F4B12A"].map(_hx);
  let _auPal = AU_KEYS[0].c.slice();
  let _auRay = 0;
  let _auMode = "normal";

  function _lerpPal(A, B, u) {
    return A.map((col, i) => col.map((v, j) => v + (B[i][j] - v) * u));
  }

  function _normalPal(progress) {
    let i = 0;
    while (i < AU_KEYS.length - 1 && progress >= AU_KEYS[i + 1].p) i++;
    if (i >= AU_KEYS.length - 1) return AU_KEYS[AU_KEYS.length - 1].c;
    const k0 = AU_KEYS[i], k1 = AU_KEYS[i + 1];
    return _lerpPal(k0.c, k1.c, Math.max(0, Math.min(1, (progress - k0.p) / (k1.p - k0.p))));
  }

  function updateAurora(now) {
    const cv = $cp("cp-aurora");
    const times = _lastTimes || window.currentPrayers || {};
    const toH = nm => {
      const t = parseHM(timeOf(times, nm));
      return t ? t.getHours() + t.getMinutes() / 60 : null;
    };
    const nowH = now.getHours() + now.getMinutes() / 60 + now.getSeconds() / 3600;
    const sr = toH("Sunrise"), mg = toH("Maghrib");
    const z = sr != null && mg != null ? (sr + mg) / 2 : null;
    let pal = _auPal, mode = "normal";
    if (sr != null && nowH >= sr && nowH < sr + 20 / 60) {
      pal = AU_SUNRISE;
      mode = "forbidden_sunrise";
    } else if (z != null && nowH >= z - 5 / 60 && nowH <= z + 5 / 60) {
      pal = AU_ZENITH;
      mode = "forbidden_zenith";
    } else {
      const ORDER = ["Fajr", "Sunrise", "Dhuhr", "Asr", "Maghrib", "Isha"];
      const pts = ORDER.map(n => {
        const h = toH(n);
        return h == null ? null : { n: n, h: h };
      }).filter(Boolean);
      const inSeg = (a, b) => a < b ? nowH >= a && nowH < b : nowH >= a || nowH < b;
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i].h, b = pts[(i + 1) % pts.length].h;
        if (inSeg(a, b)) {
          const span = (b - a + 24) % 24 || 24, elapsed = (nowH - a + 24) % 24;
          const minsLeft = (span - elapsed) * 60;
          if (minsLeft <= 15) {
            pal = AU_FINAL;
            mode = "final15";
          } else {
            pal = _normalPal(Math.max(0, Math.min(1, elapsed / span)));
          }
          break;
        }
      }
    }
    _auPal = pal;
    _auRay = 0;
    _auMode = mode;
    if (cv) {
      cv.style.opacity = "1";
      cv.style.filter = "blur(6px)";
    }
    window._auPal = _auPal;
    window._auRay = 0;
    const dc = document.getElementById("dash-aurora");
    if (dc) {
      dc.style.opacity = "1";
      dc.style.filter = "blur(6px)";
    }
  }

  function drawAurora(t) {
    if (!auroraCtx) return;
    const d = auroraImg.data;
    for (let y = 0; y < AH; y++) {
      for (let x = 0; x < AW; x++) {
        const idx = (y * AW + x) * 4;
        const nx = (x - ACX) / AEDGE, ny = (y - ACY) / AEDGE;
        const f = Math.sqrt(nx * nx + ny * ny) * A_SPAN;
        let env = Math.exp(-((f - 1.02) * (f - 1.02)) / .035);
        const gate = Math.min(Math.max((f - .82) / .06, 0), 1);
        env *= gate;
        if (env < .014) {
          d[idx + 3] = 0;
          continue;
        }
        let wx = nx * 3.06 + .35 * Math.sin(ny * 2.3 + t * .25);
        let wy = ny * 3.06 + .35 * Math.cos(nx * 2.1 - t * .2);
        let n = 0, amp = .55, fr = 1;
        for (let o = 0; o < 4; o++) {
          n += amp * Math.sin(wx * fr + t * .12 * (o + 1)) * Math.cos(wy * fr * 1.27 - t * .09 * (o + 1));
          const tmp = wx;
          wx = wy * 1.6 + n * .6;
          wy = -tmp * 1.6 - n * .6;
          amp *= .55;
          fr *= 1.95;
        }
        n = n * .5 + .5;
        if (n < 0) n = 0;
        else if (n > 1) n = 1;
        if (_auRay > 0) {
          n += _auRay * .32 * Math.sin(f * 7.5 - t * .6);
          if (n < 0) n = 0;
          else if (n > 1) n = 1;
        }
        let mix = .5 + .5 * Math.sin(Math.atan2(ny, nx) - t * .05);
        let s = mix * .72 + n * .28;
        if (s < 0) s = 0;
        else if (s > 1) s = 1;
        const P = _auPal, K = P.length;
        let seg = Math.floor(s * (K - 1));
        if (seg > K - 2) seg = K - 2;
        if (seg < 0) seg = 0;
        const su = s * (K - 1) - seg, ca = P[seg], cb = P[seg + 1];
        d[idx] = ca[0] + (cb[0] - ca[0]) * su;
        d[idx + 1] = ca[1] + (cb[1] - ca[1]) * su;
        d[idx + 2] = ca[2] + (cb[2] - ca[2]) * su;
        const ridge = 1 - Math.abs(2 * n - 1);
        const w = Math.pow(n * .15 + ridge * .85, 3);
        d[idx + 3] = env * (.25 + .66 * w) * 255;
      }
    }
    auroraCtx.putImageData(auroraImg, 0, 0);
  }
  let _reduce = false;

  function setHands(now) {
    const s = now.getSeconds() + now.getMilliseconds() / 1e3;
    const m = now.getMinutes() + s / 60;
    const h = now.getHours() % 12 + m / 60;
    setRot("cp-hHand", h / 12 * 360);
    setRot("cp-mHand", _windMinAngle != null ? _windMinAngle : m / 60 * 360);
    setRot("cp-sHand", _windSecAngle != null ? _windSecAngle : s / 60 * 360);
  }
  let _mode24 = false;
  let _lastTimes = null, _lastNext = null, _lastHist = {};
  let _windTime = null, _windRAF = null, _windWedges = null, _windWedgeKey = null;
  let _windSecAngle = null, _windMinAngle = null;

  function _clockNow() {
    return _windTime || new Date;
  }

  function _wedgeAt(deg) {
    const W = _windWedges;
    if (!W || W.length < 2) return null;
    deg = (deg % 360 + 360) % 360;
    for (const w of W) {
      if (w.a0 < w.a1 ? deg >= w.a0 && deg < w.a1 : deg >= w.a0 || deg < w.a1) return w;
    }
    return null;
  }
  const _windAngle = d => (d.getHours() + d.getMinutes() / 60) / 24 * 360;

  /* ---- the wind-up flourish on load (production v1.13.0 behaviour) -------- */
  function windUpClock(testNow) {
    if (_windRAF) {
      cancelAnimationFrame(_windRAF);
      _windRAF = null;
    }
    _windWedgeKey = null;
    _windSecAngle = null;
    _windMinAngle = null;
    const use24 = !document.body.classList.contains("cp-active") || _mode24;
    const real = testNow instanceof Date ? testNow : new Date;
    const drawNormal = d => {
      if (use24) {
        drawF24(_lastTimes || window.currentPrayers || {}, _lastNext, _lastHist, d);
        setHands24(d);
      } else setHands(d);
    };
    if (_reduce) {
      _windTime = null;
      drawNormal(real);
      return;
    }
    const period = use24 ? 864e5 : 432e5;
    const mid = new Date(real);
    mid.setHours(0, 0, 0, 0);
    const span0 = (real - mid) % period;
    const extra = real.getHours() < 6 ? period : 0;
    const span = span0 + extra;
    const durMs = span / period * 360 / 72 * 1e3;
    if (durMs < 80) {
      _windTime = null;
      drawNormal(real);
      return;
    }
    const startV = real.getTime() - span, t0 = performance.now();
    const endT = new Date(Date.now() + durMs);
    const secTarget = (endT.getSeconds() + endT.getMilliseconds() / 1e3) / 60 * 360;
    const minTarget = (endT.getMinutes() + endT.getSeconds() / 60) / 60 * 360;
    const render = (d, p) => {
      _windSecAngle = secTarget * p;
      _windMinAngle = minTarget * p;
      if (use24) {
        const wk = (_wedgeAt(_windAngle(d)) || {}).name || null;
        if (wk !== _windWedgeKey) {
          _windWedgeKey = wk;
          drawF24(_lastTimes || window.currentPrayers || {}, _lastNext, _lastHist, d);
        }
        setHands24(d);
      } else setHands(d);
    };
    _windTime = new Date(startV);
    render(_windTime, 0);
    const step = ts => {
      const p = Math.min(1, (ts - t0) / durMs);
      _windTime = new Date(startV + p * span);
      render(_windTime, p);
      if (p < 1) _windRAF = requestAnimationFrame(step);
      else {
        _windTime = null;
        _windSecAngle = null;
        _windMinAngle = null;
        _windRAF = null;
        drawNormal(new Date);
      }
    };
    _windRAF = requestAnimationFrame(step);
  }
  window.__windUp = windUpClock;

  /* ---- the 24-hour face: 0 (midnight) top, clockwise, noon bottom --------- */
  const ang0 = hoursFloat => hoursFloat / 24 * 360;
  const DIAL_CP = { w: "cp-f24-wedges", sp: "cp-f24-spokes", mk: "cp-f24-markers", num: "cp-f24-num", ticks: "cp-f24-ticks", h: "cp-h24", s: "cp-s24" };
  const DIAL_ADMIN = { w: "cp-f24b-wedges", sp: "cp-f24b-spokes", mk: "cp-f24b-markers", num: "cp-f24b-num", ticks: "cp-f24b-ticks", h: "cp-h24b", s: "cp-s24b" };

  function DT() {
    const b = document.body.classList;
    if (b.contains("cp-active")) return _mode24 ? DIAL_CP : null;
    if (b.contains("clock-mode") || b.contains("simple-mode")) return null;
    return DIAL_ADMIN;
  }

  function buildFace24(t) {
    const num = $cp(t.num), ticks = $cp(t.ticks);
    if (num) {
      num.innerHTML = "";
      for (let h = 0; h < 24; h++) {
        const p = pt(85, ang0(h));
        const t = document.createElementNS(SVGNS, "text");
        t.setAttribute("x", p.x);
        t.setAttribute("y", p.y + 2.3);
        t.textContent = h;
        num.appendChild(t);
      }
    }
    if (ticks) {
      ticks.innerHTML = "";
      for (let h = 0; h < 24; h++) {
        const o = pt(95, ang0(h)), i = pt(92, ang0(h));
        const ln = document.createElementNS(SVGNS, "line");
        ln.setAttribute("x1", o.x);
        ln.setAttribute("y1", o.y);
        ln.setAttribute("x2", i.x);
        ln.setAttribute("y2", i.y);
        ticks.appendChild(ln);
      }
    }
  }
  const PERIOD_WEDGE = {
    Fajr: "rgba(138,106,166,0.30)",
    Sunrise: "rgba(201,161,74,0.26)",
    Dhuhr: "rgba(224,184,78,0.24)",
    Asr: "rgba(223,139,62,0.26)",
    Maghrib: "rgba(194,93,114,0.30)",
    Isha: "rgba(58,70,117,0.36)"
  };

  function annSector(rIn, rOut, a0, a1) {
    const large = ((a1 - a0) % 360 + 360) % 360 > 180 ? 1 : 0;
    const oS = pt(rOut, a0), oE = pt(rOut, a1), iE = pt(rIn, a1), iS = pt(rIn, a0);
    return `M ${oS.x.toFixed(2)} ${oS.y.toFixed(2)} A ${rOut} ${rOut} 0 ${large} 1 ${oE.x.toFixed(2)} ${oE.y.toFixed(2)}` + ` L ${iE.x.toFixed(2)} ${iE.y.toFixed(2)} A ${rIn} ${rIn} 0 ${large} 0 ${iS.x.toFixed(2)} ${iS.y.toFixed(2)} Z`;
  }

  function drawF24(times, nextName, hist, now) {
    const T = DT();
    if (!T) return;
    const wedges = $cp(T.w);
    if (!wedges) return;
    const spokes = $cp(T.sp), markers = $cp(T.mk);
    const ORDER = ["Fajr", "Sunrise", "Dhuhr", "Asr", "Maghrib", "Isha"];
    const pts = ORDER.map(n => {
      const t = parseHM(timeOf(times, n));
      return t ? { n: n, h: t.getHours() + t.getMinutes() / 60 } : null;
    }).filter(Boolean);
    wedges.innerHTML = "";
    if (spokes) spokes.innerHTML = "";
    if (markers) markers.innerHTML = "";
    const SCENE = {
      Isha: "static/scenes/night.jpg",
      Fajr: "static/scenes/dawn.jpg",
      Sunrise: "static/scenes/morning.jpg",
      Dhuhr: "static/scenes/midday.jpg",
      Asr: "static/scenes/afternoon.jpg",
      Maghrib: "static/scenes/dusk.jpg"
    };
    _windWedges = pts.length >= 2 ? pts.map((p, i) => ({
      a0: ang0(p.h),
      a1: ang0(pts[(i + 1) % pts.length].h),
      src: SCENE[p.n] || SCENE.Isha,
      name: p.n
    })) : null;
    const RIN = 34, ROUT = 80;
    const nowH = now.getHours() + now.getMinutes() / 60 + now.getSeconds() / 3600;
    const inSeg = (a, b) => a < b ? nowH >= a && nowH < b : nowH >= a || nowH < b;
    const baseDisc = document.createElementNS(SVGNS, "circle");
    baseDisc.setAttribute("cx", 100);
    baseDisc.setAttribute("cy", 100);
    baseDisc.setAttribute("r", ROUT);
    baseDisc.setAttribute("fill", "#0a0d18");
    wedges.appendChild(baseDisc);
    let _seq = 0;

    function pane(a0, a1, src, fill, dim, came) {
      const d = annSector(RIN, ROUT, a0, a1);
      const base = document.createElementNS(SVGNS, "path");
      base.setAttribute("d", d);
      base.setAttribute("fill", fill || "rgba(159,176,196,0.15)");
      if (dim) {
        base.setAttribute("class", "cp-inactive-wedge");
        base.setAttribute("opacity", "0.18");
      }
      wedges.appendChild(base);
      const cpId = "cpseg" + _seq++;
      const cp = document.createElementNS(SVGNS, "clipPath");
      cp.setAttribute("id", cpId);
      const cpp = document.createElementNS(SVGNS, "path");
      cpp.setAttribute("d", d);
      cp.appendChild(cpp);
      wedges.appendChild(cp);
      const img = document.createElementNS(SVGNS, "image");
      img.setAttribute("href", src);
      img.setAttributeNS("http://www.w3.org/1999/xlink", "href", src);
      img.setAttribute("x", 20);
      img.setAttribute("y", 20);
      img.setAttribute("width", 160);
      img.setAttribute("height", 160);
      img.setAttribute("preserveAspectRatio", "xMidYMid slice");
      img.setAttribute("clip-path", "url(#" + cpId + ")");
      if (dim) {
        img.setAttribute("class", "cp-inactive-wedge");
        img.setAttribute("opacity", "0.18");
      }
      wedges.appendChild(img);
      if (came) {
        const lead = document.createElementNS(SVGNS, "path");
        lead.setAttribute("d", d);
        lead.setAttribute("fill", "none");
        lead.setAttribute("stroke", "rgba(192,192,192,0.55)");
        lead.setAttribute("stroke-width", "2");
        lead.setAttribute("vector-effect", "non-scaling-stroke");
        wedges.appendChild(lead);
      }
    }
    if (pts.length >= 2) {
      const L = pts.length;
      let ci = -1;
      for (let i = 0; i < L; i++) {
        if (inSeg(pts[i].h, pts[(i + 1) % L].h)) {
          ci = i;
          break;
        }
      }
      const block = new Set;
      let startIdx = ci;
      if (ci >= 0) {
        block.add(ci);
        if (pts[ci].n === "Fajr") {
          startIdx = (ci - 1 + L) % L;
          block.add(startIdx);
        } else {
          const nextIdx = (ci + 1) % L;
          for (let j = 0; j < ci; j++) block.add(j);
          if (nextIdx === 0) block.delete(0);
          startIdx = Math.min(...block);
        }
      }
      for (let i = 0; i < L; i++) {
        if (block.has(i)) continue;
        const a = pts[i], b = pts[(i + 1) % L];
        pane(ang0(a.h), ang0(b.h), SCENE[a.n] || SCENE.Isha, PERIOD_WEDGE[a.n], true, true);
      }
      const inner = document.createElementNS(SVGNS, "circle");
      inner.setAttribute("cx", 100);
      inner.setAttribute("cy", 100);
      inner.setAttribute("r", RIN);
      inner.setAttribute("fill", "none");
      inner.setAttribute("stroke", "rgba(212,175,55,0.38)");
      inner.setAttribute("stroke-width", "0.7");
      wedges.appendChild(inner);
      if (ci >= 0) {
        const a0 = ang0(pts[startIdx].h), a1 = ang0(pts[(ci + 1) % L].h);
        const dA = annSector(RIN, ROUT, a0, a1);
        const glow = document.createElementNS(SVGNS, "path");
        glow.setAttribute("d", dA);
        glow.setAttribute("fill", "none");
        glow.setAttribute("stroke", "rgba(255,211,107,0.30)");
        glow.setAttribute("stroke-width", "5");
        wedges.appendChild(glow);
        const glow2 = document.createElementNS(SVGNS, "path");
        glow2.setAttribute("d", dA);
        glow2.setAttribute("fill", "none");
        glow2.setAttribute("stroke", "rgba(255,224,150,0.55)");
        glow2.setAttribute("stroke-width", "3");
        wedges.appendChild(glow2);
        const baseA = document.createElementNS(SVGNS, "path");
        baseA.setAttribute("d", dA);
        baseA.setAttribute("fill", PERIOD_WEDGE[pts[ci].n] || "rgba(159,176,196,0.15)");
        wedges.appendChild(baseA);
        const cpA = document.createElementNS(SVGNS, "clipPath");
        cpA.setAttribute("id", "cpsegA");
        const cppA = document.createElementNS(SVGNS, "path");
        cppA.setAttribute("d", dA);
        cpA.appendChild(cppA);
        wedges.appendChild(cpA);
        const imgA = document.createElementNS(SVGNS, "image");
        const srcA = SCENE[pts[ci].n] || SCENE.Isha;
        imgA.setAttribute("href", srcA);
        imgA.setAttributeNS("http://www.w3.org/1999/xlink", "href", srcA);
        imgA.setAttribute("x", 20);
        imgA.setAttribute("y", 20);
        imgA.setAttribute("width", 160);
        imgA.setAttribute("height", 160);
        imgA.setAttribute("preserveAspectRatio", "xMidYMid slice");
        imgA.setAttribute("clip-path", "url(#cpsegA)");
        imgA.setAttribute("class", "cp-active-wedge");
        wedges.appendChild(imgA);
        const rimA = document.createElementNS(SVGNS, "path");
        rimA.setAttribute("d", dA);
        rimA.setAttribute("fill", "none");
        rimA.setAttribute("stroke", "rgba(255,218,120,0.95)");
        rimA.setAttribute("stroke-width", "1.2");
        wedges.appendChild(rimA);
      }
    }
    const COL = { fired: "#5fb55f", missed: "#c0392b", next: "#D4AF37", upcoming: "#c9b27a" };
    pts.forEach(p => {
      const deg = ang0(p.h), m = pt(80, deg);
      if (spokes) {
        const s0 = pt(34, deg), s1 = pt(80, deg);
        const ln = document.createElementNS(SVGNS, "line");
        ln.setAttribute("x1", s0.x);
        ln.setAttribute("y1", s0.y);
        ln.setAttribute("x2", s1.x);
        ln.setAttribute("y2", s1.y);
        ln.setAttribute("stroke", "rgba(255,255,255,0.14)");
        ln.setAttribute("stroke-width", "0.5");
        spokes.appendChild(ln);
      }
      if (markers) {
        const st = statusFor(p.n, timeOf(times, p.n), nextName, hist, now);
        const c = document.createElementNS(SVGNS, "circle");
        c.setAttribute("cx", m.x);
        c.setAttribute("cy", m.y);
        c.setAttribute("r", st === "next" ? 3.4 : 2.4);
        c.setAttribute("stroke", "#0c0c0c");
        c.setAttribute("stroke-width", "1");
        if (st === "upcoming") {
          c.setAttribute("fill", "#171717");
          c.setAttribute("stroke", "#8a7d52");
        } else {
          c.setAttribute("fill", COL[st]);
          if (st === "next") {
            c.setAttribute("stroke", "#fff3c4");
            c.setAttribute("stroke-width", "1.2");
          }
        }
        markers.appendChild(c);
      }
    });
  }

  function setHands24(now) {
    const T = DT();
    if (!T) return;
    const s = now.getSeconds() + now.getMilliseconds() / 1e3;
    const m = now.getMinutes() + s / 60;
    const h = now.getHours() + m / 60;
    setRot(T.h, ang0(h));
    setRot(T.s, _windSecAngle != null ? _windSecAngle : s / 60 * 360);
  }

  function applyClockMode(mode) {
    _mode24 = mode === "24";
    document.body.classList.toggle("cp-mode24", _mode24);
    const tg = $cp("cp-modetoggle");
    if (tg) tg.textContent = _mode24 ? "12-hour clock" : "24-hour clock";
    const now = new Date;
    if (_mode24) {
      drawF24(_lastTimes || window.currentPrayers || {}, _lastNext, _lastHist, now);
      setHands24(now);
    } else setHands(now);
  }
  let _spin0 = null, _mandalaT = -1, _auroraT = -1;

  function spin(ts) {
    if (_spin0 == null) _spin0 = ts;
    const t = (ts - _spin0) / 1e3;
    const at = t * 3;
    const now = _clockNow();
    const cpA = document.body.classList.contains("cp-active");
    if (cpA) {
      if (_mode24) setHands24(now);
      else setHands(now);
    } else setHands24(now);
    if (cpA && t - _mandalaT >= .066) {
      _mandalaT = t;
      for (const m of mandalaEls) m.el.setAttribute("d", ringPath(m.cfg.baseR, m.cfg.petals, at));
      const root = $cp("cp-orbits");
      if (root) {
        const s = 1 + .012 * Math.sin(at * 2 * Math.PI / 90);
        root.setAttribute("transform", `translate(${(100 - 100 * s).toFixed(3)} ${(100 - 100 * s).toFixed(3)}) scale(${s.toFixed(4)})`);
        root.setAttribute("opacity", (.78 + .22 * Math.sin(at * 2 * Math.PI / 120)).toFixed(3));
      }
    }
    if (cpA && t - _auroraT >= .083) {
      _auroraT = t;
      drawAurora(at);
    }
    requestAnimationFrame(spin);
  }

  function tickClock() {
    if (_dayRAF) return; // SITE: during the "watch the prayer day" sweep the readout follows the sweep
    const now = new Date;
    const tEl = $cp("cp-time");
    if (tEl) tEl.textContent = now.toLocaleTimeString("en-GB", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true
    }).toLowerCase();
    updateDateLine(now);
    tickCountdown(now);
    updateAurora(now);
    if (_reduce && !_mode24) setHands(now);
  }
  let cpHijriFull = "";

  function updateDateLine(now) {
    const el = $cp("cp-date");
    if (!el) return;
    const greg = now.toLocaleDateString("en-GB", {
      weekday: "short",
      day: "numeric",
      month: "long",
      year: "numeric"
    });
    el.textContent = cpHijriFull ? `${greg} · ${cpHijriFull}` : greg;
  }
  let cpNext = null;

  function tickCountdown(now) {
    const el = $cp("cp-count");
    if (!el) return;
    if (!cpNext || !cpNext.when) {
      el.textContent = "Next: —";
      return;
    }
    const diff = +cpNext.when - +now;
    const nm = localName(cpNext.name);
    if (diff <= 0) {
      el.innerHTML = `Now: <b>${nm}</b>`;
      return;
    }
    const h = Math.floor(diff / 36e5);
    const m = Math.floor(diff % 36e5 / 6e4);
    el.innerHTML = h > 0 ? `Next: <b>${nm}</b> in ${h}h ${pad(m)}m` : `Next: <b>${nm}</b> in ${m}m`;
  }

  function statusFor(name, timeStr, nextName, hist, now) {
    if (name === nextName) return "next";
    const t = parseHM(timeStr);
    const e = hist[name];
    if (e) {
      if (e === "PASS") return "fired";
      if (e === "FAIL") return "missed";
    }
    if (name === "Sunrise") return t && t <= now ? "fired" : "upcoming";
    if (t && t <= now) return "fired";
    return "upcoming";
  }

  function timeOf(times, name) {
    if (name === "Sunrise") return times.Sunrise || times.sunrise || times.sunrise_time || null;
    return times[name] || null;
  }

  function currentPeriodName(times, now) {
    const ORDER = ["Fajr", "Sunrise", "Dhuhr", "Asr", "Maghrib", "Isha"];
    const pts = ORDER.map(n => {
      const t = parseHM(timeOf(times, n));
      return t ? { n: n, h: t.getHours() + t.getMinutes() / 60 } : null;
    }).filter(Boolean);
    if (pts.length < 2) return null;
    const nowH = now.getHours() + now.getMinutes() / 60 + now.getSeconds() / 3600;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i].h, b = pts[(i + 1) % pts.length].h;
      if (a < b ? nowH >= a && nowH < b : nowH >= a || nowH < b) return pts[i].n;
    }
    return null;
  }

  function computeNext(state, times, now) {
    const np = state.next_prayer;
    if (np && np.name && (np.effective_when_iso || np.when_iso)) {
      return { name: np.name, when: new Date(np.effective_when_iso || np.when_iso) };
    }
    if (typeof getNextPrayerFallback === "function") {
      const fb = getNextPrayerFallback(times, now);
      if (fb) return { name: fb.name, when: fb.when };
    }
    return null;
  }

  function setOffline(msg) {
    const el = $cp("cp-offline");
    if (el) el.textContent = msg || "";
  }

  function fmtClock(d) {
    return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  }
  async function refreshData() {
    const now = new Date;
    let state;
    try {
      const res = await fetch("/api/state");
      state = await res.json();
    } catch (e) {
      setOffline("Clock offline · last update " + (cpLastOk ? fmtClock(cpLastOk) : "—"));
      return;
    }
    const times = { ...state.prayer_times || {} };
    if (state.prayer_times && state.prayer_times.Sunrise) times.Sunrise = state.prayer_times.Sunrise;
    else if (state.sunrise_time) times.Sunrise = state.sunrise_time;
    else if (state.sunrise) times.Sunrise = state.sunrise;
    if (state.location) {
      const el = $cp("cp-location");
      if (el) el.textContent = `${state.location.city || ""}, ${state.location.country || ""}`.replace(/^, |, $/, "");
    }
    const nextName = state.next_prayer && state.next_prayer.name || null;
    cpNext = computeNext(state, times, now);
    const hist = {};
    try {
      const hres = await fetch("/api/play_history?limit=200");
      const hj = await hres.json();
      if (hj && hj.ok && Array.isArray(hj.entries)) {
        const today = String(state.now || now.toISOString()).slice(0, 10);
        for (const e of hj.entries) {
          if (e.audio_type !== "adhan") continue;
          if (!String(e.ts_local || "").startsWith(today)) continue;
          if (e.status === "PASS" || e.status === "DISCOVERY_RECOVERED") hist[e.prayer_name] = "PASS";
          else if (e.status === "FAIL" || e.status === "NO_SPEAKERS") hist[e.prayer_name] = "FAIL";
        }
      }
    } catch (e) {}
    _lastTimes = times;
    _lastNext = nextName;
    _lastHist = hist;
    drawF24(times, nextName, hist, now);
    tickCountdown(now);
    cpLastOk = new Date;
    setOffline("");
  }
  let cpLastOk = null;

  /* ---- production cinematic demo (?demo=SECONDS) — kept for the owner's
     screenshot/video pipeline; inert unless the query param is present. ------ */
  function cinematicDemo() {
    const qs = new URLSearchParams(location.search);
    if (!qs.has("demo")) return;
    const secs = Math.max(4, parseFloat(qs.get("demo")) || 60);
    const SPEED = 86400 / secs;
    const RealDate = Date;
    const midnight = (() => {
      const d = new RealDate;
      d.setHours(0, 0, 0, 0);
      return d.getTime();
    })();
    const clock = () => window.performance && performance.now ? performance.now() : RealDate.now();
    const t0 = clock();
    let seekMs = null;
    const vms = () => seekMs != null ? seekMs : midnight + (clock() - t0) / 1e3 * SPEED * 1e3 % 864e5;

    function FakeDate(...a) {
      return a.length ? new RealDate(...a) : new RealDate(vms());
    }
    FakeDate.prototype = RealDate.prototype;
    FakeDate.now = () => vms();
    FakeDate.parse = RealDate.parse;
    FakeDate.UTC = RealDate.UTC;
    try {
      window.Date = FakeDate;
    } catch (e) {}
    document.body.classList.add("cp-demo");
    applyClockMode("24");
    let lastPaint = -1;

    function paint() {
      const t = clock();
      if (t - lastPaint < 55) return;
      lastPaint = t;
      const now = new FakeDate;
      try {
        drawF24(_lastTimes || window.currentPrayers || {}, _lastNext, _lastHist, now);
      } catch (e) {}
      try {
        setHands24(now);
      } catch (e) {}
      try {
        updateAurora(now);
      } catch (e) {}
    }
    (function raf() {
      paint();
      requestAnimationFrame(raf);
    })();
    setInterval(paint, 200);
  }

  /* ========================================================================
   * SITE DRIVERS — marketing-embed additions (BUILD-PROMPT v1.8 §3).
   * Thin drivers over the UNCHANGED production render path above.
   * ====================================================================== */
  let _dayRAF = null;

  /* "↺ Watch the prayer day": the hand sweeps clockwise through the full 24h
     over ~12s, wedges + aurora updating in sync (the same render calls the
     production demo mode makes). Cancellable: click the button again, or
     interact with the dial. */
  function watchPrayerDay() {
    if (_dayRAF) {
      cancelDaySweep();
      return;
    }
    if (_windRAF) { // don't fight the load flourish
      cancelAnimationFrame(_windRAF);
      _windRAF = null;
      _windTime = null;
      _windSecAngle = null;
      _windMinAngle = null;
    }
    const btn = $cp("cp-daybtn");
    if (btn) {
      btn.setAttribute("aria-pressed", "true");
      btn.textContent = "◼ Stop the sweep";
    }
    const start = new Date, t0 = performance.now(), DUR = 12000;
    const tEl = $cp("cp-time"), cEl = $cp("cp-count");
    const step = ts => {
      const p = Math.min(1, (ts - t0) / DUR);
      const d = new Date(start.getTime() + p * 864e5);
      _windTime = d; // production override hook — spin()'s hands follow it
      const wk = (_wedgeAt(_windAngle(d)) || {}).name || null;
      if (wk !== _windWedgeKey) {
        _windWedgeKey = wk;
        drawF24(_lastTimes || window.currentPrayers || {}, _lastNext, _lastHist, d);
        // SITE: let the page (the manuscript plate) follow the sweep
        try { document.dispatchEvent(new CustomEvent("castadhan:sweep", { detail: { period: wk } })); } catch (e) {}
      }
      setHands24(d);
      updateAurora(d);
      if (_reduce) drawAurora(0);
      if (tEl) tEl.textContent = d.toLocaleTimeString("en-GB", { hour: "numeric", minute: "2-digit", hour12: true }).toLowerCase();
      if (cEl) {
        const period = currentPeriodName(_lastTimes || {}, d);
        if (period) cEl.innerHTML = `Now: <b>${period}</b>`;
      }
      if (p < 1) _dayRAF = requestAnimationFrame(step);
      else cancelDaySweep();
    };
    _dayRAF = requestAnimationFrame(step);
  }

  function cancelDaySweep() {
    if (_dayRAF) {
      cancelAnimationFrame(_dayRAF);
      _dayRAF = null;
    }
    _windTime = null;
    _windWedgeKey = null;
    const btn = $cp("cp-daybtn");
    if (btn) {
      btn.setAttribute("aria-pressed", "false");
      btn.textContent = "↺ Watch the prayer day";
    }
    const now = new Date;
    drawF24(_lastTimes || window.currentPrayers || {}, _lastNext, _lastHist, now);
    setHands24(now);
    updateAurora(now);
    if (_reduce) drawAurora(0);
    tickClock();
    try { document.dispatchEvent(new CustomEvent("castadhan:sweep-end")); } catch (e) {}
  }
  window.__castadhanWatchDay = watchPrayerDay;
  window.__castadhanRefresh = refreshData; // used by "Show my city" for an instant redraw

  /* SITE: while the adhan sample plays, the aurora leans toward gold — the
     clock witnessing the sound. Implemented by WRAPPING updateAurora (the
     production function body is untouched); the palette is nudged after the
     production computation, exactly as the demo modes swap palettes. */
  let _adhanLean = false;
  const _updateAuroraProd = updateAurora;
  updateAurora = function (now) {
    _updateAuroraProd(now);
    if (_adhanLean) {
      const GOLD = [[231, 200, 120], [212, 175, 55], [166, 124, 41], [120, 90, 32]];
      _auPal = _auPal.map((c, i) => {
        const g = GOLD[Math.min(i, GOLD.length - 1)];
        return c.map((v, j) => v + (g[j] - v) * 0.55);
      });
      window._auPal = _auPal;
    }
  };
  window.__castadhanAdhanLean = function (on) {
    _adhanLean = !!on;
    updateAurora(new Date);
    if (_reduce) drawAurora(0);
  };

  function boot() {
    buildMandala();
    initAurora();
    buildFace24(DIAL_CP);
    applyClockMode("24"); // SITE: the marketing embed ships only the production 24-hour face
    tickClock();
    refreshData();
    setInterval(tickClock, 1e3);
    setInterval(refreshData, 15e3);
    _reduce = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    if (_reduce) {
      setHands24(new Date);
      drawAurora(0);
    } else requestAnimationFrame(spin);
    windUpClock();
    // SITE wiring: the sweep button + interacting with the dial cancels a sweep
    const dayBtn = $cp("cp-daybtn");
    if (dayBtn) dayBtn.addEventListener("click", watchPrayerDay);
    const dial = document.querySelector(".cp-dial");
    if (dial) dial.addEventListener("pointerdown", () => { if (_dayRAF) cancelDaySweep(); });
    // SITE: rest when unseen — while the dial is scrolled out of view, lift the
    // body.cp-active flag so spin()'s per-frame work (hands, mandala, the
    // per-pixel aurora) no-ops. The production render path is untouched: it
    // already gates everything on that class. On re-entry, redraw immediately.
    if (dial && "IntersectionObserver" in window) {
      const vis = new IntersectionObserver(es => {
        es.forEach(e => {
          document.body.classList.toggle("cp-active", e.isIntersecting);
          if (e.isIntersecting) {
            const now = _clockNow();
            drawF24(_lastTimes || window.currentPrayers || {}, _lastNext, _lastHist, now);
            setHands24(now);
          }
        });
      }, { rootMargin: "160px 0px" });
      vis.observe(dial);
    }
  }
  const _start = () => {
    boot();
    cinematicDemo();
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", _start);
  else _start();
})();
