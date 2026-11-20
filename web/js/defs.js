/* GT15 Studio – Definitionsdateien und Speicherquellen */
'use strict';

GT.Defs = {
  /** Rohdaten (JSON, Adressen auch als "0x..."-Strings) in einheitliche Form bringen */
  normalize(raw) {
    const n = GT.util.num;
    const d = JSON.parse(JSON.stringify(raw));
    d.flashBase = n(d.flashBase ?? 0x080000);
    d.flashSize = n(d.flashSize ?? 0x80000);
    d.sectors = (d.sectors || []).map((s) => [n(s[0]), n(s[1])]);
    d.bootSectors = (d.bootSectors || []).map(n);
    d.channels = (d.channels || []).map((c, i) => ({
      id: c.id || 'ch' + i, name: c.name || 'Kanal ' + i, addr: n(c.addr), size: n(c.size || 2), signed: !!c.signed,
      factor: n(c.factor ?? 1), offset: n(c.offset ?? 0), unit: c.unit || '', min: n(c.min ?? 0), max: n(c.max ?? 100), dec: n(c.dec ?? 1),
    }));
    const axis = (a) => (a ? { addr: n(a.addr), n: n(a.n), factor: n(a.factor ?? 1), offset: n(a.offset ?? 0), unit: a.unit || '', label: a.label || '', signed: !!a.signed, size: n(a.size || 2) } : null);
    d.maps = (d.maps || []).map((m, i) => ({
      id: m.id || 'map' + i, name: m.name || 'Kennfeld ' + i, unit: m.unit || '', factor: n(m.factor ?? 1), offset: n(m.offset ?? 0),
      size: n(m.size || 2), signed: !!m.signed, data: n(m.data), x: axis(m.x), y: axis(m.y), trace: m.trace != null ? n(m.trace) : null,
      dec: m.dec != null ? n(m.dec) : (n(m.factor ?? 1) >= 1 ? 0 : 2),
    }));
    delete d._rpmAxis;
    return d;
  },

  /** Für Export: Adressen als Hex-Strings */
  serialize(d) {
    const h = (v) => '0x' + v.toString(16).toUpperCase();
    const o = JSON.parse(JSON.stringify(d));
    o.flashBase = h(d.flashBase); o.flashSize = h(d.flashSize);
    o.sectors = d.sectors.map((s) => [h(s[0]), h(s[1])]);
    o.bootSectors = d.bootSectors.map(h);
    o.channels.forEach((c) => { c.addr = h(c.addr); });
    o.maps.forEach((m) => {
      m.data = h(m.data); if (m.trace != null) m.trace = h(m.trace);
      if (m.x) m.x.addr = h(m.x.addr); if (m.y) m.y.addr = h(m.y.addr);
    });
    return JSON.stringify(o, null, 2);
  },

  dims(m) { return { rows: m.y ? m.y.n : 1, cols: m.x.n }; },
  bytes(m) { const { rows, cols } = GT.Defs.dims(m); return rows * cols * m.size; },
};

/** Speicherquelle: ECU über Protokoll */
GT.EcuSource = class {
  constructor(client) { this.client = client; this.kind = 'ecu'; }
  read(addr, len) { return this.client.read(addr, len); }
  write(addr, bytes) { return this.client.write(addr, bytes); }
};

/** Speicherquelle: Bin-Datei im Speicher */
GT.BinSource = class {
  constructor(bin, base) { this.bin = bin; this.base = base; this.kind = 'bin'; }
  _off(addr, len) {
    const o = addr - this.base;
    if (o < 0 || o + len > this.bin.length) throw new Error(`Adresse 0x${GT.util.hex(addr, 6)} liegt außerhalb der Bin-Datei`);
    return o;
  }
  async read(addr, len) { const o = this._off(addr, len); return this.bin.slice(o, o + len); }
  async write(addr, bytes) { const o = this._off(addr, bytes.length); this.bin.set(bytes, o); }
};

/** Kennfeld komplett lesen: Achsen (physikalisch) + Rohwerte */
GT.readMap = async (src, m) => {
  const U = GT.util;
  const readAxis = async (a) => {
    if (!a) return [null];
    const b = await src.read(a.addr, a.n * a.size);
    return Array.from({ length: a.n }, (_, i) => U.readVal(b, i * a.size, a.size, a.signed) * a.factor + a.offset);
  };
  const x = await readAxis(m.x);
  const y = await readAxis(m.y);
  const b = await src.read(m.data, GT.Defs.bytes(m));
  const { rows, cols } = GT.Defs.dims(m);
  const raw = new Float64Array(rows * cols);
  for (let i = 0; i < raw.length; i++) raw[i] = U.readVal(b, i * m.size, m.size, m.signed);
  return { x, y, raw, rows, cols };
};
