/* GT15 Studio – Hilfsfunktionen */
'use strict';
window.GT = window.GT || {};

GT.util = (() => {
  const hex = (v, w = 2) => v.toString(16).toUpperCase().padStart(w, '0');
  const hexBytes = (arr) => Array.from(arr, (b) => hex(b)).join(' ');

  /** Zahl aus JSON lesen: Number oder "0x..."-String */
  const num = (v) => (typeof v === 'string' ? (v.trim().toLowerCase().startsWith('0x') ? parseInt(v, 16) : parseFloat(v)) : v);

  function crc16(data, start = 0, len = data.length - start) {
    let crc = 0xffff;
    for (let i = start; i < start + len; i++) {
      crc ^= data[i] << 8;
      for (let b = 0; b < 8; b++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
    return crc;
  }

  const CRC32_TAB = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(data, start = 0, len = data.length - start) {
    let c = 0xffffffff;
    for (let i = start; i < start + len; i++) c = CRC32_TAB[(c ^ data[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  /** Makrotask ohne setTimeout-Drosselung (für den Simulator) */
  const defer = (() => {
    const ch = new MessageChannel();
    const q = [];
    ch.port1.onmessage = () => { const fn = q.shift(); if (fn) fn(); };
    return (fn) => { q.push(fn); ch.port2.postMessage(0); };
  })();

  function download(data, name, type = 'application/octet-stream') {
    const blob = data instanceof Blob ? data : new Blob([data], { type });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  function readFile(file, asText = false) {
    return new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(asText ? r.result : new Uint8Array(r.result));
      r.onerror = () => rej(r.error);
      asText ? r.readAsText(file) : r.readAsArrayBuffer(file);
    });
  }

  /** Wert aus Byte-Array lesen (Little Endian, C167) */
  function readVal(buf, off, size, signed) {
    let v = 0;
    for (let i = size - 1; i >= 0; i--) v = v * 256 + buf[off + i];
    if (signed) { const lim = 2 ** (size * 8 - 1); if (v >= lim) v -= 2 * lim; }
    return v;
  }
  function writeVal(buf, off, size, v) {
    v = Math.round(v);
    if (v < 0) v += 2 ** (size * 8);
    for (let i = 0; i < size; i++) { buf[off + i] = v & 0xff; v = Math.floor(v / 256); }
  }

  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const rotl16 = (v, n) => ((v << n) | (v >>> (16 - n))) & 0xffff;

  return { hex, hexBytes, num, crc16, crc32, sleep, defer, download, readFile, readVal, writeVal, clamp, rotl16 };
})();
