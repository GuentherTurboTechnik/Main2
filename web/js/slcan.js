/* GT15 Studio – SLCAN (Lawicel) Transport über Web Serial (CANable mit slcan-Firmware) */
'use strict';

GT.SlcanTransport = class {
  constructor() {
    this.port = null;
    this.reader = null;
    this.writer = null;
    this.onFrame = null;   // (id, Uint8Array, ext) => void
    this.onError = null;   // (msg) => void
    this.onClose = null;
    this._rxBuf = '';
    this._wchain = Promise.resolve();
    this._enc = new TextEncoder();
    this.name = 'CANable (SLCAN)';
  }

  static supported() { return 'serial' in navigator; }

  /** bitrateCode: S0=10k S1=20k S2=50k S3=100k S4=125k S5=250k S6=500k S7=800k S8=1M */
  async open(bitrateCode = 6) {
    if (!GT.SlcanTransport.supported()) throw new Error('Web Serial wird von diesem Browser nicht unterstützt (Chrome oder Edge verwenden).');
    this.port = await navigator.serial.requestPort();
    await this.port.open({ baudRate: 115200, bufferSize: 65536 });
    this.writer = this.port.writable.getWriter();
    this._readLoop();
    await this._writeRaw('\r\r\r');     // Puffer leeren
    await this._writeRaw('C\r');        // evtl. offenen Kanal schließen
    await GT.util.sleep(50);
    await this._writeRaw(`S${bitrateCode}\r`);
    await this._writeRaw('O\r');
    await GT.util.sleep(50);
  }

  async close() {
    try { await this._writeRaw('C\r'); } catch (_) { /* ignorieren */ }
    try { if (this.reader) await this.reader.cancel(); } catch (_) { /* ignorieren */ }
    try { if (this.writer) { this.writer.releaseLock(); } } catch (_) { /* ignorieren */ }
    try { if (this.port) await this.port.close(); } catch (_) { /* ignorieren */ }
    this.port = this.reader = this.writer = null;
  }

  send(id, data, ext = false) {
    const d = Array.from(data);
    let s = ext ? 'T' + id.toString(16).toUpperCase().padStart(8, '0') : 't' + id.toString(16).toUpperCase().padStart(3, '0');
    s += d.length.toString(16);
    for (const b of d) s += b.toString(16).toUpperCase().padStart(2, '0');
    return this._writeRaw(s + '\r');
  }

  _writeRaw(str) {
    const p = this._wchain.then(() => this.writer.write(this._enc.encode(str)));
    this._wchain = p.catch(() => {});
    return p;
  }

  async _readLoop() {
    const dec = new TextDecoder();
    while (this.port && this.port.readable) {
      this.reader = this.port.readable.getReader();
      try {
        for (;;) {
          const { value, done } = await this.reader.read();
          if (done) break;
          this._rxBuf += dec.decode(value, { stream: true });
          this._parse();
        }
      } catch (e) {
        if (this.onError) this.onError('Serieller Lesefehler: ' + e.message);
      } finally {
        try { this.reader.releaseLock(); } catch (_) { /* ignorieren */ }
      }
      break;
    }
    if (this.onClose) this.onClose();
  }

  _parse() {
    let i;
    while ((i = this._rxBuf.search(/[\r\x07]/)) >= 0) {
      const line = this._rxBuf.slice(0, i);
      const term = this._rxBuf[i];
      this._rxBuf = this._rxBuf.slice(i + 1);
      if (term === '\x07') { if (this.onError) this.onError('SLCAN meldet Fehler (BELL)'); continue; }
      if (!line) continue;
      const t = line[0];
      if (t === 't' || t === 'T') {
        const ext = t === 'T';
        const idLen = ext ? 8 : 3;
        const id = parseInt(line.substr(1, idLen), 16);
        const dlc = parseInt(line[1 + idLen], 16);
        const data = new Uint8Array(dlc);
        for (let k = 0; k < dlc; k++) data[k] = parseInt(line.substr(2 + idLen + k * 2, 2), 16);
        if (this.onFrame) this.onFrame(id, data, ext);
      }
      // 'z'/'Z' (TX-Bestätigung) und Antworten auf Befehle werden ignoriert
    }
  }
};
