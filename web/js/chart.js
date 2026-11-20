/* GT15 Studio – schlanker Canvas-Linienchart (jede Linie auf ihren eigenen Min/Max-Bereich normiert) */
'use strict';

GT.COLORS = ['#4dabf7', '#ff922b', '#51cf66', '#f06595', '#cc5de8', '#fcc419', '#22b8cf', '#ff6b6b', '#94d82d', '#845ef7'];

GT.LineChart = class {
  constructor(canvas) {
    this.c = canvas;
    this.ctx = canvas.getContext('2d');
  }

  /** series: [{name, color, min, max, unit, pts:[[t,v],...]}], tStart/tEnd in ms */
  draw(series, tStart, tEnd, cursorT = null) {
    const c = this.c, dpr = window.devicePixelRatio || 1;
    const w = c.clientWidth, h = c.clientHeight;
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
    const g = this.ctx;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const cs = getComputedStyle(document.documentElement);
    const grid = cs.getPropertyValue('--border').trim(), muted = cs.getPropertyValue('--muted').trim();
    const L = 8, R = 8, T = 8, B = 20;
    const pw = w - L - R, ph = h - T - B;
    g.strokeStyle = grid; g.lineWidth = 1; g.fillStyle = muted; g.font = '11px system-ui';
    for (let i = 0; i <= 4; i++) { const y = T + (ph * i) / 4 + 0.5; g.beginPath(); g.moveTo(L, y); g.lineTo(L + pw, y); g.stroke(); }
    const span = tEnd - tStart;
    const step = span > 20000 ? 5000 : span > 5000 ? 1000 : 500;
    for (let t = Math.ceil(tStart / step) * step; t <= tEnd; t += step) {
      const x = L + ((t - tStart) / span) * pw;
      g.fillText(((t - tEnd) / 1000).toFixed(0) + ' s', x - 10, h - 5);
    }
    g.lineWidth = 1.6; g.lineJoin = 'round';
    for (const s of series) {
      const rng = s.max - s.min || 1;
      g.strokeStyle = s.color; g.beginPath();
      let first = true;
      for (const [t, v] of s.pts) {
        if (t < tStart) continue;
        const x = L + ((t - tStart) / span) * pw;
        const y = T + ph - GT.util.clamp((v - s.min) / rng, -0.02, 1.02) * ph;
        if (first) { g.moveTo(x, y); first = false; } else g.lineTo(x, y);
      }
      g.stroke();
    }
    if (cursorT != null) {
      const x = L + ((cursorT - tStart) / span) * pw;
      g.strokeStyle = cs.getPropertyValue('--trace').trim(); g.lineWidth = 1.5;
      g.beginPath(); g.moveTo(x, T); g.lineTo(x, T + ph); g.stroke();
    }
  }
};
