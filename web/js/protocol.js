/* GT15 Studio – GT15-CAN Protokoll-Client (siehe docs/PROTOCOL.md) */
'use strict';

GT.CMD = {
  CONNECT: 0x01, UNLOCK: 0x02, DISCONNECT: 0x03, GET_ID: 0x04, STATUS: 0x05,
  SET_MTA: 0x10, UPLOAD: 0x11, DOWNLOAD: 0x12, SHORT_UP: 0x13,
  DAQ_CLEAR: 0x20, DAQ_ADD: 0x21, DAQ_START: 0x22, DAQ_STOP: 0x23,
  SET_PAGE: 0x30, CAL_INIT: 0x31, GET_OVERLAY: 0x32,
  PROG_ENTER: 0x40, PROG_ERASE: 0x41, PROG_BLOCK: 0x42, PROG_COMMIT: 0x43, CHECKSUM: 0x44, RESET: 0x4f,
};

GT.ERR = {
  0x01: 'Unbekanntes Kommando', 0x02: 'Adresse/Länge nicht erlaubt', 0x03: 'ECU beschäftigt',
  0x04: 'Nicht erlaubt (Zustand)', 0x05: 'CRC-Fehler', 0x06: 'Sequenzfehler', 0x07: 'Flash-Fehler',
  0x08: 'Gesperrt (UNLOCK fehlt)', 0x09: 'Ungültiger Parameter',
};

GT.DEFAULT_IDS = { req: 0x6e0, bulk: 0x6e1, res: 0x6e8, daq: 0x6e9 };

/** Seed/Key – Platzhalter, identisch in firmware/src/gt15.c */
GT.computeKey = (seed) => (GT.util.rotl16((seed ^ 0x4754) & 0xffff, 3) + 0x1f15) & 0xffff;

GT.ProtocolError = class extends Error {
  constructor(cmd, code) {
    super(`${GT.ERR[code] || 'Fehler 0x' + GT.util.hex(code)} (Kommando 0x${GT.util.hex(cmd)})`);
    this.code = code; this.cmd = cmd;
  }
};

GT.Client = class {
  constructor(transport, ids = GT.DEFAULT_IDS) {
    this.t = transport;
    this.ids = ids;
    this.seq = 0;
    this.pending = null;
    this.chain = Promise.resolve();
    this.onDaq = null;       // (Uint8Array) => void
    this.onMonitor = null;   // (dir, id, data) => void
    this.daqFrames = 0;
    this._daqBuf = null;
    this._daqCnt = -1;
    this._daqGot = 0;
    this.stats = { daqCycles: 0, daqLost: 0 };
    this.bulkGapEvery = 0;   // optionale Pause nach N Bulk-Frames
    this.bulkGapMs = 0;
    transport.onFrame = (id, data) => this._rx(id, data);
  }

  _rx(id, data) {
    if (this.onMonitor) this.onMonitor('RX', id, data);
    if (id === this.ids.res) {
      const p = this.pending;
      if (!p || data[1] !== p.seq) return;
      if (data[0] === 0xfd) { p.arm(); return; }
      this.pending = null;
      clearTimeout(p.timer);
      if (data[0] === 0xff) p.resolve(data.slice(2));
      else if (data[0] === 0xfe) p.reject(new GT.ProtocolError(p.cmd, data[2]));
      else p.reject(new Error('Ungültige Antwort'));
    } else if (id === this.ids.daq) {
      this._daqRx(data);
    }
  }

  _daqRx(d) {
    if (!this.daqFrames) return;
    const cnt = d[0] >> 4, idx = d[0] & 0x0f;
    if (idx === 0) {
      if (this._daqBuf && this._daqGot !== this.daqFrames) this.stats.daqLost++;
      this._daqBuf = new Uint8Array(this.daqFrames * 7);
      this._daqCnt = cnt; this._daqGot = 0;
    }
    if (!this._daqBuf || cnt !== this._daqCnt || idx >= this.daqFrames) return;
    this._daqBuf.set(d.subarray(1, 8), idx * 7);
    this._daqGot++;
    if (idx === this.daqFrames - 1) {
      if (this._daqGot === this.daqFrames) {
        this.stats.daqCycles++;
        if (this.onDaq) this.onDaq(this._daqBuf);
      } else this.stats.daqLost++;
      this._daqBuf = null;
    }
  }

  _send(id, bytes) {
    const f = new Uint8Array(8);
    f.set(bytes.slice(0, 8));
    if (this.onMonitor) this.onMonitor('TX', id, f);
    return this.t.send(id, f);
  }

  /** Einzelnes Kommando, serialisiert. Liefert Antwortdaten (6 Byte). */
  req(cmd, params = [], timeout = 200) {
    const run = () => new Promise((resolve, reject) => {
      const seq = this.seq = (this.seq + 1) & 0xff;
      const p = { seq, cmd, resolve, reject, timer: null };
      p.arm = () => {
        clearTimeout(p.timer);
        p.timer = setTimeout(() => {
          if (this.pending === p) this.pending = null;
          reject(new Error(`Timeout bei Kommando 0x${GT.util.hex(cmd)}`));
        }, timeout);
      };
      this.pending = p;
      p.arm();
      this._send(this.ids.req, [cmd, seq, ...params]).catch((e) => { this.pending = null; clearTimeout(p.timer); reject(e); });
    });
    const r = this.chain.then(run, run);
    this.chain = r.catch(() => {});
    return r;
  }

  static a24(a) { return [(a >> 16) & 0xff, (a >> 8) & 0xff, a & 0xff]; }

  async connect() {
    const r = await this.req(GT.CMD.CONNECT);
    const info = { version: `${r[0]}.${r[1]}`, caps: r[2] };
    const seed = (r[3] << 8) | r[4];
    const key = GT.computeKey(seed);
    await this.req(GT.CMD.UNLOCK, [key >> 8, key & 0xff]);
    info.ident = await this.getId();
    return info;
  }

  async disconnect() { try { await this.req(GT.CMD.DISCONNECT); } catch (_) { /* egal */ } }

  async getId() {
    let s = '';
    for (let i = 0; i < 10; i++) {
      const r = await this.req(GT.CMD.GET_ID, [i]);
      let end = false;
      for (const b of r) { if (!b) { end = true; break; } s += String.fromCharCode(b); }
      if (end) break;
    }
    return s.trim();
  }

  async status() {
    const r = await this.req(GT.CMD.STATUS);
    return { page: r[0], mode: r[1], rpm: r[2] | (r[3] << 8), flags: r[4] };
  }

  async read(addr, len, progress) {
    const out = new Uint8Array(len);
    for (let o = 0; o < len;) {
      const n = Math.min(6, len - o);
      const r = await this.req(GT.CMD.SHORT_UP, [n, ...GT.Client.a24(addr + o)]);
      out.set(r.subarray(0, n), o);
      o += n;
      if (progress && (o % 600 < 6 || o === len)) progress(o, len);
    }
    return out;
  }

  async write(addr, bytes) {
    await this.req(GT.CMD.SET_MTA, GT.Client.a24(addr));
    for (let o = 0; o < bytes.length; o += 5) {
      const chunk = Array.from(bytes.slice(o, o + 5));
      await this.req(GT.CMD.DOWNLOAD, [chunk.length, ...chunk]);
    }
  }

  async daqSetup(signals, periodMs) {
    await this.daqStop();
    await this.req(GT.CMD.DAQ_CLEAR);
    for (const s of signals) await this.req(GT.CMD.DAQ_ADD, [s.size, ...GT.Client.a24(s.addr)]);
    const r = await this.req(GT.CMD.DAQ_START, [(periodMs >> 8) & 0xff, periodMs & 0xff]);
    this.daqFrames = r[0];
    this._daqBuf = null;
    return this.daqFrames;
  }

  async daqStop() {
    this.daqFrames = 0;
    await this.req(GT.CMD.DAQ_STOP);
  }

  setPage(p) { return this.req(GT.CMD.SET_PAGE, [p]); }
  calInit() { return this.req(GT.CMD.CAL_INIT, [], 1000); }

  async overlays() {
    const list = [];
    for (let i = 0; i < 64; i++) {
      try {
        const r = await this.req(GT.CMD.GET_OVERLAY, [i]);
        list.push({ addr: (r[0] << 16) | (r[1] << 8) | r[2], len: (r[3] << 8) | r[4] });
      } catch (e) { if (e.code === 0x02) break; throw e; }
    }
    return list;
  }

  async progEnter() {
    const r = await this.req(GT.CMD.PROG_ENTER, [], 1000);
    this.daqFrames = 0;
    return (r[0] << 8) | r[1];
  }

  erase(addr) { return this.req(GT.CMD.PROG_ERASE, GT.Client.a24(addr), 3000); }

  /** Programmiert einen Block (gerade Länge, max. MAXBLOCK). Exklusiv, damit kein Kommando die Bulk-Frames stört. */
  progBlock(addr, data) {
    const len = data.length;
    const run = async () => {
      await this._rawReq(GT.CMD.PROG_BLOCK, [...GT.Client.a24(addr), len >> 8, len & 0xff], 300);
      for (let o = 0, k = 0; o < len; o += 8, k++) {
        const f = new Uint8Array(8).fill(0xff);
        f.set(data.subarray(o, Math.min(o + 8, len)));
        await this._send(this.ids.bulk, f);
        if (this.bulkGapEvery && (k + 1) % this.bulkGapEvery === 0) await GT.util.sleep(this.bulkGapMs);
      }
      const crc = GT.util.crc16(data);
      await this._rawReq(GT.CMD.PROG_COMMIT, [crc >> 8, crc & 0xff], 1000);
    };
    const r = this.chain.then(run, run);
    this.chain = r.catch(() => {});
    return r;
  }

  /** Kommando ohne Verkettung (nur innerhalb einer bereits verketteten Sequenz verwenden) */
  _rawReq(cmd, params, timeout) {
    return new Promise((resolve, reject) => {
      const seq = this.seq = (this.seq + 1) & 0xff;
      const p = { seq, cmd, resolve, reject, timer: null };
      p.arm = () => {
        clearTimeout(p.timer);
        p.timer = setTimeout(() => { if (this.pending === p) this.pending = null; reject(new Error(`Timeout bei Kommando 0x${GT.util.hex(cmd)}`)); }, timeout);
      };
      this.pending = p;
      p.arm();
      this._send(this.ids.req, [cmd, seq, ...params]).catch(reject);
    });
  }

  async checksum(addr, len) {
    const r = await this.req(GT.CMD.CHECKSUM, [...GT.Client.a24(addr), ...GT.Client.a24(len)], 3000);
    return ((r[0] << 24) | (r[1] << 16) | (r[2] << 8) | r[3]) >>> 0;
  }

  reset() { return this.req(GT.CMD.RESET, [], 500); }
};
