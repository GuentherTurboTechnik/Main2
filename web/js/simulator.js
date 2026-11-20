/* GT15 Studio – Virtuelles EDC15-Steuergerät mit gepatchter GT15-Firmware (zum Testen ohne Fahrzeug) */
'use strict';

/* ---------- Definitionen für den Simulator (Format = Definitionsdatei, siehe docs/DEFINITIONS.md) ---------- */
GT.SIM_DEFS = (() => {
  const rpmAxis = [750, 1000, 1250, 1500, 2000, 2500, 3000, 3500, 4000, 4500];
  return {
    name: 'GT15 Simulator (EDC15P+ Beispiel)',
    flashBase: 0x080000,
    flashSize: 0x80000,
    flashChip: 'AM29F400BT (Top-Boot)',
    // AM29F400BT: B0..B6 je 64 KB, B7 32 KB, B8/B9 je 8 KB, B10 16 KB. B0/B1 = Bootloader (geschützt)
    sectors: [
      [0x080000, 0x10000], [0x090000, 0x10000], [0x0a0000, 0x10000], [0x0b0000, 0x10000],
      [0x0c0000, 0x10000], [0x0d0000, 0x10000], [0x0e0000, 0x10000], [0x0f0000, 0x8000],
      [0x0f8000, 0x2000], [0x0fa000, 0x2000], [0x0fc000, 0x4000],
    ],
    bootSectors: [0x080000, 0x090000],
    channels: [
      { id: 'rpm', name: 'Drehzahl', addr: 0xf000, size: 2, factor: 1, unit: '1/min', min: 0, max: 5000, dec: 0 },
      { id: 'iq', name: 'Einspritzmenge', addr: 0xf002, size: 2, factor: 0.01, unit: 'mg/H', min: 0, max: 80, dec: 1 },
      { id: 'boost', name: 'Ladedruck Ist', addr: 0xf004, size: 2, factor: 1, unit: 'mbar', min: 900, max: 2800, dec: 0 },
      { id: 'boostSet', name: 'Ladedruck Soll', addr: 0xf006, size: 2, factor: 1, unit: 'mbar', min: 900, max: 2800, dec: 0 },
      { id: 'soi', name: 'Spritzbeginn', addr: 0xf008, size: 2, signed: true, factor: 0.01, unit: '°KW', min: -5, max: 25, dec: 1 },
      { id: 'pedal', name: 'Fahrpedal', addr: 0xf00a, size: 2, factor: 0.01, unit: '%', min: 0, max: 100, dec: 0 },
      { id: 'iqWish', name: 'Fahrerwunsch', addr: 0xf00c, size: 2, factor: 0.01, unit: 'mg/H', min: 0, max: 80, dec: 1 },
      { id: 'iqSmoke', name: 'Rauchbegrenzung', addr: 0xf00e, size: 2, factor: 0.01, unit: 'mg/H', min: 0, max: 80, dec: 1 },
      { id: 'coolant', name: 'Kühlmittel', addr: 0xf010, size: 2, signed: true, factor: 0.1, unit: '°C', min: -20, max: 120, dec: 1 },
    ],
    maps: [
      {
        id: 'driverWish', name: 'Fahrerwunsch', unit: 'mg/H', factor: 0.01, size: 2, data: 0x0d1000,
        x: { addr: 0x0d0f00, n: 10, factor: 1, unit: '1/min', label: 'Drehzahl' },
        y: { addr: 0x0d0f20, n: 8, factor: 0.01, unit: '%', label: 'Pedal' }, trace: 0xf100,
      },
      {
        id: 'smoke', name: 'Rauchbegrenzer (Ladedruck)', unit: 'mg/H', factor: 0.01, size: 2, data: 0x0d1200,
        x: { addr: 0x0d0f00, n: 10, factor: 1, unit: '1/min', label: 'Drehzahl' },
        y: { addr: 0x0d0f40, n: 8, factor: 1, unit: 'mbar', label: 'Ladedruck' }, trace: 0xf104,
      },
      {
        id: 'boostMap', name: 'Ladedruck-Sollwert', unit: 'mbar', factor: 1, size: 2, data: 0x0d1400,
        x: { addr: 0x0d0f00, n: 10, factor: 1, unit: '1/min', label: 'Drehzahl' },
        y: { addr: 0x0d0f60, n: 8, factor: 0.01, unit: 'mg/H', label: 'Menge' }, trace: 0xf108,
      },
      {
        id: 'soiMap', name: 'Spritzbeginn', unit: '°KW', factor: 0.01, size: 2, signed: true, data: 0x0d1600,
        x: { addr: 0x0d0f00, n: 10, factor: 1, unit: '1/min', label: 'Drehzahl' },
        y: { addr: 0x0d0f60, n: 8, factor: 0.01, unit: 'mg/H', label: 'Menge' }, trace: 0xf10c,
      },
      {
        id: 'torqueLim', name: 'Drehmomentbegrenzer', unit: 'mg/H', factor: 0.01, size: 2, data: 0x0d1800,
        x: { addr: 0x0d0f00, n: 10, factor: 1, unit: '1/min', label: 'Drehzahl' },
        y: null, trace: 0xf110,
      },
    ],
    _rpmAxis: rpmAxis,
  };
})();

/* ---------- Virtuelles Steuergerät ---------- */
GT.VirtualEcu = class {
  constructor(defs = GT.SIM_DEFS) {
    this.defs = defs;
    this.base = defs.flashBase;
    this.flash = new Uint8Array(defs.flashSize);
    this.ram = new Uint8Array(0x10000);   // 0x000000..0x00FFFF
    this.send = null;                     // (id, Uint8Array) => void
    this.ids = GT.DEFAULT_IDS;
    this.ident = 'GT15-SIM 0281010XXX EDC15P+ V1.0';
    this._buildImage();
    this._resetState();
    this.engineOn = true;
    this.pedal = 0;            // 0..100 %
    this.timer = null;
  }

  _resetState() {
    this.unlocked = false;
    this.seed = 0;
    this.page = 0;
    this.mode = 0;             // 0 = App, 1 = Boot
    this.mta = 0;
    this.daqList = [];
    this.daqPeriod = 0;
    this.daqAcc = 0;
    this.daqCnt = 0;
    this.prog = null;          // {addr, len, buf, got}
    this.rpm = 0; this.boost = 1000; this.coolant = 20;
    this._initOverlays();
  }

  /* --- Bin-Image mit Kennfeldern erzeugen --- */
  _buildImage() {
    const f = this.flash;
    let s = 0x1234;
    for (let i = 0; i < f.length; i++) { s = (s * 1103515245 + 12345) & 0x7fffffff; f[i] = (s >> 16) & 0xff; }
    // Kalibriersektor 0x0D0000 leeren (unbenutzt = 0xFF)
    f.fill(0xff, 0x0d0000 - this.base, 0x0e0000 - this.base);
    const id = new TextEncoder().encode(this.ident);
    f.set(id, 0x0d0010 - this.base); f[0x0d0010 - this.base + id.length] = 0;

    const D = this.defs, U = GT.util;
    const wr = (addr, vals, signed) => vals.forEach((v, i) => U.writeVal(f, addr - this.base + i * 2, 2, v));
    const rpm = D._rpmAxis;
    wr(0x0d0f00, rpm);
    const pedal = [0, 10, 20, 30, 45, 60, 80, 100]; wr(0x0d0f20, pedal.map((v) => v * 100));
    const boostAx = [1000, 1200, 1400, 1600, 1800, 2000, 2200, 2400]; wr(0x0d0f40, boostAx);
    const iqAx = [0, 10, 20, 30, 40, 50, 60, 70]; wr(0x0d0f60, iqAx.map((v) => v * 100));

    const grid = (ys, fn) => ys.flatMap((y) => rpm.map((x) => fn(x, y)));
    // Fahrerwunsch: Pedal × Drehzahl
    wr(0x0d1000, grid(pedal, (n, p) => Math.round(Math.max(0, Math.min(65, p * 0.65 * (1 - Math.max(0, n - 3500) / 4000))) * 100)));
    // Rauchbegrenzer: mg abhängig vom Ladedruck
    wr(0x0d1200, grid(boostAx, (n, b) => Math.round(Math.min(62, 18 + (b - 1000) * 0.03 + (n < 1500 ? -3 : 0)) * 100)));
    // Ladedruck-Soll: Menge × Drehzahl
    wr(0x0d1400, grid(iqAx, (n, q) => Math.round(Math.min(2300, 1000 + q * 22 * Math.min(1, (n - 600) / 1400)))));
    // Spritzbeginn
    wr(0x0d1600, grid(iqAx, (n, q) => Math.round((1 + n / 300 + q * 0.08) * 100)));
    // Drehmomentbegrenzer (1D)
    wr(0x0d1800, rpm.map((n) => Math.round((n < 1800 ? 40 + (n - 750) * 0.019 : 60 - Math.max(0, n - 3000) * 0.006) * 100)));
  }

  _initOverlays() {
    // RAM-Kopien der Kennfeld-Daten ab 0x00C000
    this.overlays = [];
    let ramPtr = 0xc000;
    for (const m of this.defs.maps) {
      const len = (m.y ? m.y.n : 1) * m.x.n * m.size;
      this.overlays.push({ addr: m.data, len, ram: ramPtr });
      ramPtr += (len + 1) & ~1;
    }
    this._calInit();
  }

  _calInit() {
    for (const o of this.overlays) this.ram.set(this.flash.subarray(o.addr - this.base, o.addr - this.base + o.len), o.ram);
  }

  _ovl(addr, len) {
    for (const o of this.overlays) if (addr >= o.addr && addr + len <= o.addr + o.len) return o;
    return null;
  }

  readMem(addr, len) {
    if (addr + len <= 0x10000) return this.ram.slice(addr, addr + len);
    if (addr >= this.base && addr + len <= this.base + this.flash.length) {
      const o = this.page === 1 ? this._ovl(addr, len) : null;
      if (o) return this.ram.slice(o.ram + addr - o.addr, o.ram + addr - o.addr + len);
      return this.flash.slice(addr - this.base, addr - this.base + len);
    }
    return null;
  }

  /* --- Laufzeit --- */
  start() {
    if (this.timer) return;
    this.lastT = performance.now();
    this.timer = setInterval(() => this._tick(), 5);
  }
  stop() { clearInterval(this.timer); this.timer = null; }

  _val(addr, size, signed) {
    const b = this.readMem(addr, size);
    return GT.util.readVal(b, 0, size, signed);
  }

  /** Kennfeld-Interpolation inkl. Trace-Slot (wie die gepatchte Firmware-Routine) */
  _lookup(m, xv, yv) {
    const axis = (ax, v) => {
      const pts = [];
      for (let i = 0; i < ax.n; i++) pts.push(GT.util.readVal(this.flash, ax.addr - this.base + i * 2, 2) * ax.factor);
      let i = 0;
      while (i < ax.n - 2 && v > pts[i + 1]) i++;
      let fr = (v - pts[i]) / (pts[i + 1] - pts[i]);
      fr = GT.util.clamp(fr, 0, 1);
      return { i, fr };
    };
    const ax = axis(m.x, xv);
    const ay = m.y ? axis(m.y, yv) : { i: 0, fr: 0 };
    const cols = m.x.n;
    const cell = (r, c) => this._val(m.data + (r * cols + c) * 2, 2, m.signed) * m.factor;
    const r1 = Math.min(ay.i + 1, (m.y ? m.y.n : 1) - 1);
    const v00 = cell(ay.i, ax.i), v01 = cell(ay.i, ax.i + 1), v10 = cell(r1, ax.i), v11 = cell(r1, ax.i + 1);
    const top = v00 + (v01 - v00) * ax.fr, bot = v10 + (v11 - v10) * ax.fr;
    const res = top + (bot - top) * ay.fr;
    if (m.trace) {
      const t = m.trace;
      this.ram[t] = ax.i; this.ram[t + 1] = Math.round(ax.fr * 255);
      this.ram[t + 2] = ay.i; this.ram[t + 3] = Math.round(ay.fr * 255);
    }
    return res;
  }

  _tick() {
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.lastT) / 1000);
    this.lastT = now;
    if (this.mode === 1) return;      // Bootmodus: Motorfunktionen gestoppt
    this._engine(dt);
    if (this.daqPeriod && this.daqList.length) {
      this.daqAcc += dt * 1000;
      if (this.daqAcc >= this.daqPeriod) { this.daqAcc %= this.daqPeriod; this._daqSend(); }
    }
  }

  _engine(dt) {
    const M = Object.fromEntries(this.defs.maps.map((m) => [m.id, m]));
    const U = GT.util;
    let iq = 0, iqWish = 0, iqSmoke = 0, boostSet = 1000, soi = 0;
    if (this.engineOn) {
      if (this.rpm < 600) this.rpm = 800;   // Start
      iqWish = this._lookup(M.driverWish, this.rpm, this.pedal);
      const idle = U.clamp((850 - this.rpm) * 0.05 + 5, 0, 15);
      iqWish = Math.max(iqWish, idle);
      iqSmoke = this._lookup(M.smoke, this.rpm, this.boost);
      const tLim = this._lookup(M.torqueLim, this.rpm, 0);
      iq = Math.min(iqWish, iqSmoke, tLim);
      if (this.rpm > 4700) iq = 0;          // Abregelung
      boostSet = this._lookup(M.boostMap, this.rpm, iq);
      soi = this._lookup(M.soiMap, this.rpm, iq);
      const spool = U.clamp((this.rpm - 900) / 1600, 0.1, 1);
      const target = 1000 + (boostSet - 1000) * spool * U.clamp(iq / 30, 0.2, 1.1);
      this.boost += (target - this.boost) * Math.min(1, dt * 2.5);
      const torque = iq * 6 - (this.rpm - 700) * 0.02 - 30;
      this.rpm = U.clamp(this.rpm + torque * dt * 3, 0, 4800);
      this.coolant = Math.min(90, this.coolant + dt * 0.8);
    } else {
      this.rpm = Math.max(0, this.rpm - dt * 2500);
      this.boost += (1000 - this.boost) * Math.min(1, dt * 3);
    }
    const w = (a, v, s) => U.writeVal(this.ram, a, 2, s ? v : Math.max(0, v));
    w(0xf000, this.rpm); w(0xf002, iq * 100); w(0xf004, this.boost); w(0xf006, boostSet);
    w(0xf008, soi * 100, true); w(0xf00a, this.pedal * 100); w(0xf00c, iqWish * 100);
    w(0xf00e, iqSmoke * 100); w(0xf010, this.coolant * 10, true);
  }

  _daqSend() {
    const total = this.daqList.reduce((s, e) => s + e.size, 0);
    const buf = new Uint8Array(Math.ceil(total / 7) * 7);
    let o = 0;
    for (const e of this.daqList) { buf.set(this.readMem(e.addr, e.size), o); o += e.size; }
    const n = buf.length / 7;
    for (let k = 0; k < n; k++) {
      const f = new Uint8Array(8);
      f[0] = (this.daqCnt << 4) | k;
      f.set(buf.subarray(k * 7, k * 7 + 7), 1);
      this._tx(this.ids.daq, f);
    }
    this.daqCnt = (this.daqCnt + 1) & 0x0f;
  }

  _tx(id, f) { if (this.send) this.send(id, f); }

  /* --- Protokoll-Handler --- */
  rx(id, d) {
    if (id === this.ids.bulk) return this._bulk(d);
    if (id !== this.ids.req) return;
    const cmd = d[0], seq = d[1], p = d.subarray(2);
    const ok = (...data) => { const f = new Uint8Array(8); f[0] = 0xff; f[1] = seq; f.set(data.slice(0, 6), 2); this._tx(this.ids.res, f); };
    const err = (c) => this._tx(this.ids.res, Uint8Array.of(0xfe, seq, c, 0, 0, 0, 0, 0));
    const pend = () => this._tx(this.ids.res, Uint8Array.of(0xfd, seq, 0, 0, 0, 0, 0, 0));
    const a24 = (i) => (p[i] << 16) | (p[i + 1] << 8) | p[i + 2];
    const C = GT.CMD;
    const open = [C.CONNECT, C.UNLOCK, C.GET_ID, C.STATUS];
    if (!this.unlocked && !open.includes(cmd)) return err(0x08);

    switch (cmd) {
      case C.CONNECT:
        this.seed = (Math.random() * 0xffff) | 1;
        this.unlocked = false;
        return ok(1, 0, 0x0f, this.seed >> 8, this.seed & 0xff);
      case C.UNLOCK: {
        const key = (p[0] << 8) | p[1];
        if (key !== GT.computeKey(this.seed)) return err(0x09);
        this.unlocked = true; return ok(1);
      }
      case C.DISCONNECT:
        this.unlocked = false; this.daqPeriod = 0; return ok();
      case C.GET_ID: {
        const b = new TextEncoder().encode(this.ident);
        const out = []; for (let i = 0; i < 6; i++) out.push(b[p[0] * 6 + i] || 0);
        return ok(...out);
      }
      case C.STATUS: {
        const r = Math.round(this.rpm);
        return ok(this.page, this.mode, r & 0xff, r >> 8, (this.unlocked ? 1 : 0) | (this.daqPeriod ? 2 : 0));
      }
      case C.SET_MTA: this.mta = a24(0); return ok();
      case C.UPLOAD: case C.SHORT_UP: {
        const n = p[0];
        if (n < 1 || n > 6) return err(0x09);
        const addr = cmd === C.UPLOAD ? this.mta : a24(1);
        const b = this.readMem(addr, n);
        if (!b) return err(0x02);
        if (cmd === C.UPLOAD) this.mta += n;
        return ok(...b);
      }
      case C.DOWNLOAD: {
        const n = p[0];
        if (n < 1 || n > 5) return err(0x09);
        const o = this._ovl(this.mta, n);
        if (!o) return err(0x02);
        this.ram.set(p.subarray(1, 1 + n), o.ram + this.mta - o.addr);
        this.mta += n; return ok();
      }
      case C.DAQ_CLEAR: this.daqList = []; this.daqPeriod = 0; return ok();
      case C.DAQ_ADD: {
        const size = p[0], addr = a24(1);
        if (![1, 2, 4].includes(size)) return err(0x09);
        const total = this.daqList.reduce((s, e) => s + e.size, 0) + size;
        if (total > 112 || !this.readMem(addr, size)) return err(0x02);
        this.daqList.push({ size, addr });
        return ok(this.daqList.length - 1, total);
      }
      case C.DAQ_START: {
        const per = (p[0] << 8) | p[1];
        if (per < 5 || per > 1000 || !this.daqList.length) return err(0x09);
        this.daqPeriod = per; this.daqAcc = 0;
        const total = this.daqList.reduce((s, e) => s + e.size, 0);
        return ok(Math.ceil(total / 7));
      }
      case C.DAQ_STOP: this.daqPeriod = 0; return ok();
      case C.SET_PAGE: if (p[0] > 1) return err(0x09); this.page = p[0]; return ok();
      case C.CAL_INIT: this._calInit(); return ok();
      case C.GET_OVERLAY: {
        const o = this.overlays[p[0]];
        if (!o) return err(0x02);
        return ok(o.addr >> 16, (o.addr >> 8) & 0xff, o.addr & 0xff, o.len >> 8, o.len & 0xff);
      }
      case C.PROG_ENTER:
        if (this.rpm > 0) return err(0x04);
        this.mode = 1; this.daqPeriod = 0; return ok(1, 0);   // MAXBLOCK 256
      case C.PROG_ERASE: {
        if (this.mode !== 1) return err(0x06);
        const addr = a24(0);
        const sec = this.defs.sectors.find((s) => s[0] === addr);
        if (!sec) return err(0x02);
        if (this.defs.bootSectors.includes(addr)) return err(0x04);
        pend();
        setTimeout(() => { this.flash.fill(0xff, addr - this.base, addr - this.base + sec[1]); ok(); }, 20 + sec[1] / 2000);
        return undefined;
      }
      case C.PROG_BLOCK: {
        if (this.mode !== 1) return err(0x06);
        const addr = a24(0), len = (p[3] << 8) | p[4];
        if (len < 2 || len > 256 || len & 1) return err(0x09);
        if (addr < this.base || addr + len > this.base + this.flash.length) return err(0x02);
        const boot = this.defs.sectors.find((s) => this.defs.bootSectors.includes(s[0]) && addr < s[0] + s[1] && addr + len > s[0]);
        if (boot) return err(0x04);
        this.prog = { addr, len, buf: new Uint8Array(Math.ceil(len / 8) * 8), got: 0 };
        return ok();
      }
      case C.PROG_COMMIT: {
        const pr = this.prog; this.prog = null;
        if (!pr || pr.got < pr.buf.length) return err(0x06);
        const crc = (p[0] << 8) | p[1];
        if (GT.util.crc16(pr.buf, 0, pr.len) !== crc) return err(0x05);
        const off = pr.addr - this.base;
        for (let i = 0; i < pr.len; i++) {
          const nv = pr.buf[i];
          if ((this.flash[off + i] & nv) !== nv) return err(0x07);   // Bit 0→1 geht nicht ohne Löschen
          this.flash[off + i] &= nv;
        }
        return ok();
      }
      case C.CHECKSUM: {
        const addr = a24(0), len = a24(3);
        if (addr < this.base || addr + len > this.base + this.flash.length) return err(0x02);
        const c = GT.util.crc32(this.flash, addr - this.base, len);
        return ok(c >>> 24, (c >> 16) & 0xff, (c >> 8) & 0xff, c & 0xff);
      }
      case C.RESET:
        ok();
        setTimeout(() => { this._resetState(); }, 50);
        return undefined;
      default: return err(0x01);
    }
  }

  _bulk(d) {
    const pr = this.prog;
    if (!pr || pr.got >= pr.buf.length) return;
    pr.buf.set(d, pr.got); pr.got += 8;
  }
};

/* ---------- Transport, der mit dem virtuellen Steuergerät spricht ---------- */
GT.SimTransport = class {
  constructor(ecu) {
    this.ecu = ecu;
    this.onFrame = null;
    this.name = 'Simulator';
    ecu.send = (id, f) => GT.util.defer(() => this.onFrame && this.onFrame(id, f, false));
  }
  async open() { this.ecu.start(); }
  async close() { this.ecu.stop(); }
  send(id, data) {
    const f = Uint8Array.from(data);
    GT.util.defer(() => this.ecu.rx(id, f));
    return Promise.resolve();
  }
};
