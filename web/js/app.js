/* GT15 Studio – Oberfläche */
'use strict';

(() => {
  const U = GT.util;
  const $ = (id) => document.getElementById(id);

  const S = {
    transport: null, client: null, ecu: null, connected: false, busy: false,
    defs: null, bin: null, binName: '',
    page: 0, daqOn: false, daqSignals: [], values: {}, trace: {}, hist: {}, selCh: new Set(['rpm', 'iq', 'boost', 'boostSet']),
    log: null, recording: false,
    map: null, mapData: null, mapSrc: 'ecu', sel: null, undo: [], orig: {},
    mon: [], monDirty: false,
  };

  /* ---------------- Allgemein ---------------- */
  let toastTimer;
  function toast(msg, err = false) {
    const t = $('toast');
    t.textContent = msg; t.className = 'toast show' + (err ? ' err' : '');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.className = 'toast'; }, err ? 5000 : 2500);
  }
  const fail = (e) => { console.error(e); toast(e.message || String(e), true); };

  document.querySelectorAll('#tabs button').forEach((b) => b.addEventListener('click', () => {
    document.querySelectorAll('#tabs button').forEach((x) => x.classList.toggle('active', x === b));
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.id === 'tab-' + b.dataset.tab));
    if (b.dataset.tab === 'log') drawLogChart();
  }));

  const fmt = (v, dec) => (Number.isFinite(v) ? v.toFixed(dec) : '–');

  /* ---------------- Definitionen ---------------- */
  function setDefs(raw) {
    S.defs = GT.Defs.normalize(raw);
    $('defName').textContent = S.defs.name || '(ohne Namen)';
    S.hist = {};
    for (const c of S.defs.channels) S.hist[c.id] = [];
    S.selCh = new Set([...S.selCh].filter((id) => S.defs.channels.some((c) => c.id === id)));
    if (!S.selCh.size) S.defs.channels.slice(0, 3).forEach((c) => S.selCh.add(c.id));
    renderTiles(); renderMapList(); renderSectors(); updateBinInfo();
    S.map = null; S.mapData = null; renderMap();
  }

  $('defFile').addEventListener('change', async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try { setDefs(JSON.parse(await U.readFile(f, true))); toast('Definition geladen'); } catch (err) { fail(err); }
    e.target.value = '';
  });
  $('btnDefSim').addEventListener('click', () => setDefs(GT.SIM_DEFS));
  $('btnDefSave').addEventListener('click', () => S.defs && U.download(GT.Defs.serialize(S.defs), 'gt15-definition.json', 'application/json'));

  /* ---------------- Verbindung ---------------- */
  $('serialHint').textContent = GT.SlcanTransport.supported() ? '' : 'Web Serial nicht verfügbar – bitte Chrome oder Edge verwenden. Der Simulator funktioniert trotzdem.';
  $('ifaceSel').addEventListener('change', () => { $('bitrateSel').disabled = $('ifaceSel').value === 'sim'; });

  const parseId = (el) => { const v = parseInt(el.value, 16); if (!(v >= 0 && v <= 0x7ff)) throw new Error('Ungültige CAN-ID: ' + el.value); return v; };

  $('btnConnect').addEventListener('click', async () => {
    try {
      const ids = { req: parseId($('idReq')), bulk: parseId($('idBulk')), res: parseId($('idRes')), daq: parseId($('idDaq')) };
      if ($('ifaceSel').value === 'sim') {
        S.ecu = new GT.VirtualEcu(GT.SIM_DEFS);
        S.ecu.ids = ids;
        S.transport = new GT.SimTransport(S.ecu);
        if (!S.defs || S.defs.name !== GT.SIM_DEFS.name) setDefs(GT.SIM_DEFS);
      } else {
        S.ecu = null;
        S.transport = new GT.SlcanTransport();
        S.transport.onError = (m) => toast(m, true);
        S.transport.onClose = () => { if (S.connected) { toast('Interface getrennt', true); onDisconnected(); } };
      }
      await S.transport.open(parseInt($('bitrateSel').value, 10));
      S.client = new GT.Client(S.transport, ids);
      S.client.onDaq = onDaq;
      S.client.onMonitor = onMonitor;
      $('stIface').textContent = 'Verbinde …';
      const info = await S.client.connect();
      S.connected = true;
      $('ecuIdent').textContent = info.ident || '–';
      $('ecuVer').textContent = 'GT15-CAN ' + info.version;
      $('ecuCaps').textContent = ['DAQ', 'RAM-Overlay', 'Flash', 'Tracing'].filter((_, i) => info.caps & (1 << i)).join(', ');
      const ovl = await S.client.overlays();
      $('ecuOvl').textContent = ovl.length + ' Bereiche, ' + ovl.reduce((s, o) => s + o.len, 0) + ' Byte';
      await S.client.setPage(0); S.page = 0;
      await refreshStatus();
      onConnected();
      toast('Verbunden: ' + (info.ident || 'ECU'));
    } catch (e) {
      fail(e);
      try { if (S.transport) await S.transport.close(); } catch (_) { /* egal */ }
      onDisconnected();
    }
  });

  $('btnDisconnect').addEventListener('click', async () => {
    try {
      if (S.daqOn) await S.client.daqStop();
      await S.client.disconnect();
      await S.transport.close();
    } catch (e) { console.warn(e); }
    onDisconnected();
  });

  function onConnected() {
    $('stIface').textContent = S.transport.name; $('stIface').className = 'pill on';
    $('btnConnect').disabled = true; $('btnDisconnect').disabled = false;
    ['btnDaq', 'btnPage', 'btnCalInit', 'btnReadFlash', 'btnTx'].forEach((id) => { $(id).disabled = false; });
    $('simPanel').classList.toggle('hidden', !S.ecu);
    $('stPage').classList.remove('hidden');
    updateFlashButtons(); updatePage();
    if (S.map && S.mapSrc === 'ecu') loadMap(S.map);
  }

  function onDisconnected() {
    S.connected = false; S.daqOn = false; S.client = null;
    $('stIface').textContent = 'Getrennt'; $('stIface').className = 'pill';
    $('btnConnect').disabled = false; $('btnDisconnect').disabled = true;
    ['btnDaq', 'btnPage', 'btnCalInit', 'btnReadFlash', 'btnTx', 'btnRamToBin'].forEach((id) => { $(id).disabled = true; });
    $('btnDaq').textContent = 'DAQ starten';
    ['stPage', 'stDaq'].forEach((id) => $(id).classList.add('hidden'));
    $('simPanel').classList.add('hidden');
    ['ecuIdent', 'ecuVer', 'ecuCaps', 'ecuMode', 'ecuOvl'].forEach((id) => { $(id).textContent = '–'; });
    updateFlashButtons();
  }

  async function refreshStatus() {
    if (!S.client) return;
    const st = await S.client.status();
    $('ecuMode').textContent = (st.mode ? 'Bootloader' : 'Applikation') + ' · ' + st.rpm + ' 1/min';
    if (st.page !== S.page) { S.page = st.page; updatePage(); }
    return st;
  }
  setInterval(() => { if (S.connected && !S.busy) refreshStatus().catch(() => {}); }, 2000);

  /* ---------------- Simulator-Bedienung ---------------- */
  $('simEngine').addEventListener('change', (e) => { if (S.ecu) S.ecu.engineOn = e.target.checked; });
  $('simPedal').addEventListener('input', (e) => { if (S.ecu) S.ecu.pedal = +e.target.value; $('simPedalV').textContent = e.target.value + ' %'; });

  /* ---------------- Live / DAQ ---------------- */
  function renderTiles() {
    const box = $('tiles'); box.innerHTML = '';
    S.defs.channels.forEach((c, i) => {
      const el = document.createElement('div');
      el.className = 'tile' + (S.selCh.has(c.id) ? ' sel' : '');
      el.style.setProperty('--tc', GT.COLORS[i % GT.COLORS.length]);
      el.innerHTML = `<div class="n">${c.name}</div><div><span class="v" id="tv-${c.id}">–</span><span class="u">${c.unit}</span></div><div class="bar"><i id="tb-${c.id}"></i></div>`;
      el.title = `0x${U.hex(c.addr, 6)} · ${c.size} Byte · Klick = im Verlauf anzeigen`;
      el.addEventListener('click', () => { S.selCh.has(c.id) ? S.selCh.delete(c.id) : S.selCh.add(c.id); el.classList.toggle('sel'); renderLegend(); });
      box.appendChild(el);
    });
    renderLegend();
  }

  function renderLegend() {
    const parts = [];
    S.defs.channels.forEach((c, i) => {
      if (S.selCh.has(c.id)) parts.push(`<span><i style="background:${GT.COLORS[i % GT.COLORS.length]}"></i>${c.name} (${c.min}…${c.max} ${c.unit})</span>`);
    });
    $('chartLegend').innerHTML = parts.join('');
  }

  function buildDaqSignals() {
    const sig = S.defs.channels.map((c) => ({ kind: 'ch', ch: c, addr: c.addr, size: c.size }));
    for (const m of S.defs.maps) if (m.trace != null) sig.push({ kind: 'tr', map: m, addr: m.trace, size: 4 });
    let total = 0;
    return sig.filter((s) => (total += s.size) <= 112);
  }

  $('btnDaq').addEventListener('click', async () => {
    try {
      if (S.daqOn) {
        await S.client.daqStop(); S.daqOn = false;
        if (S.recording && $('logAuto').checked) stopRec();
      } else {
        S.daqSignals = buildDaqSignals();
        const n = await S.client.daqSetup(S.daqSignals, parseInt($('daqRate').value, 10));
        S.daqOn = true;
        S.client.stats = { daqCycles: 0, daqLost: 0 };
        S.daqT0 = performance.now();
        $('daqStats').textContent = `${S.daqSignals.length} Signale, ${n} Frames/Zyklus`;
        if ($('logAuto').checked && !S.recording) startRec();
      }
      $('btnDaq').textContent = S.daqOn ? 'DAQ stoppen' : 'DAQ starten';
      $('stDaq').classList.toggle('hidden', !S.daqOn); $('stDaq').classList.toggle('on', S.daqOn);
    } catch (e) { fail(e); }
  });
  $('daqRate').addEventListener('change', () => { if (S.daqOn) { $('btnDaq').click(); setTimeout(() => $('btnDaq').click(), 50); } });

  function onDaq(buf) {
    const t = performance.now();
    let o = 0;
    for (const s of S.daqSignals) {
      if (s.kind === 'ch') {
        const c = s.ch;
        const v = U.readVal(buf, o, c.size, c.signed) * c.factor + c.offset;
        S.values[c.id] = v;
        const h = S.hist[c.id];
        h.push([t, v]);
        if (h.length > 4000 || (h.length && h[0][0] < t - 32000)) h.shift();
      } else {
        S.trace[s.map.id] = [buf[o], buf[o + 1] / 255, buf[o + 2], buf[o + 3] / 255];
      }
      o += s.size;
    }
    if (S.recording) S.log.rows.push([t - S.log.t0, ...S.log.cols.map((c) => S.values[c.id])]);
    S.uiDirty = true;
  }

  const chart = new GT.LineChart($('chart'));
  let lastTiles = 0;
  function frame(now) {
    if (S.uiDirty && now - lastTiles > 100) {
      lastTiles = now; S.uiDirty = false;
      for (const c of S.defs ? S.defs.channels : []) {
        const v = S.values[c.id];
        const tv = $('tv-' + c.id); if (!tv) continue;
        tv.textContent = fmt(v, c.dec);
        $('tb-' + c.id).style.width = U.clamp(((v - c.min) / (c.max - c.min || 1)) * 100, 0, 100) + '%';
      }
      if (S.client && S.daqOn) {
        const st = S.client.stats, secs = (now - S.daqT0) / 1000;
        $('daqStats').textContent = `${S.daqSignals.length} Signale · ${(st.daqCycles / Math.max(secs, 0.001)).toFixed(0)} Zyklen/s · verloren: ${st.daqLost}`;
      }
      if (S.recording) updateLogInfo();
      drawTrace();
    }
    if (S.defs && $('tab-live').classList.contains('active')) {
      const series = [];
      S.defs.channels.forEach((c, i) => { if (S.selCh.has(c.id)) series.push({ color: GT.COLORS[i % GT.COLORS.length], min: c.min, max: c.max, pts: S.hist[c.id] }); });
      const tEnd = performance.now();
      chart.draw(series, tEnd - 30000, tEnd);
    }
    if (S.monDirty) renderMon();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  /* ---------------- Kennfelder ---------------- */
  function renderMapList() {
    const ul = $('mapList'); ul.innerHTML = '';
    for (const m of S.defs.maps) {
      const li = document.createElement('li');
      const { rows, cols } = GT.Defs.dims(m);
      li.innerHTML = `${m.name}<small>${cols}×${rows} · 0x${U.hex(m.data, 6)}${m.trace != null ? ' · Trace' : ''}</small>`;
      li.dataset.id = m.id;
      li.addEventListener('click', () => loadMap(m));
      ul.appendChild(li);
    }
  }

  function source() {
    if (S.mapSrc === 'ecu') {
      if (!S.connected) throw new Error('Nicht mit ECU verbunden (oder Quelle „Bin-Datei“ wählen)');
      return new GT.EcuSource(S.client);
    }
    if (!S.bin) throw new Error('Keine Bin-Datei geladen (Reiter „Flashen“)');
    return new GT.BinSource(S.bin, S.defs.flashBase);
  }

  async function loadMap(m) {
    S.map = m; S.sel = null; S.undo = [];
    document.querySelectorAll('#mapList li').forEach((li) => li.classList.toggle('active', li.dataset.id === m.id));
    try {
      S.mapData = await GT.readMap(source(), m);
      const key = S.mapSrc + ':' + m.id;
      if (!S.orig[key]) S.orig[key] = Float64Array.from(S.mapData.raw);
    } catch (e) { S.mapData = null; fail(e); }
    renderMap();
  }

  const phys = (m, raw) => raw * m.factor + m.offset;
  const rawOf = (m, v) => {
    let r = Math.round((v - m.offset) / m.factor);
    const bits = m.size * 8;
    const lo = m.signed ? -(2 ** (bits - 1)) : 0, hi = m.signed ? 2 ** (bits - 1) - 1 : 2 ** bits - 1;
    return U.clamp(r, lo, hi);
  };

  function heat(t) {
    const hue = 230 - U.clamp(t, 0, 1) * 230;
    return `hsl(${hue} 70% 72%)`;
  }

  function renderMap() {
    const tbl = $('mapTable');
    tbl.innerHTML = '';
    const m = S.map, d = S.mapData;
    $('mapTitle').textContent = m ? `${m.name} [${m.unit}]` : 'Kein Kennfeld gewählt';
    if (!m || !d) { $('mapInfo').textContent = ''; return; }
    $('mapInfo').textContent = `${S.mapSrc === 'ecu' ? 'ECU · Seite ' + (S.page ? 'RAM' : 'Flash') : 'Bin'} · Daten 0x${U.hex(m.data, 6)} · Faktor ${m.factor}`;
    const vals = Array.from(d.raw, (r) => phys(m, r));
    const mn = Math.min(...vals), mx = Math.max(...vals);
    const orig = S.orig[S.mapSrc + ':' + m.id];
    const head = document.createElement('tr');
    head.innerHTML = `<th class="corner">${m.y ? m.y.label + ' ↓ / ' : ''}${m.x.label} →</th>` + d.x.map((v, c) => `<th data-xc="${c}">${fmt(v, m.x.factor < 1 ? 1 : 0)}</th>`).join('');
    tbl.appendChild(head);
    for (let r = 0; r < d.rows; r++) {
      const tr = document.createElement('tr');
      const yv = m.y ? fmt(d.y[r], m.y.factor < 1 ? 1 : 0) : '';
      tr.innerHTML = `<th data-yr="${r}">${yv}</th>`;
      for (let c = 0; c < d.cols; c++) {
        const i = r * d.cols + c;
        const td = document.createElement('td');
        td.dataset.r = r; td.dataset.c = c;
        td.textContent = fmt(vals[i], m.dec);
        td.style.background = heat(mx > mn ? (vals[i] - mn) / (mx - mn) : 0.5);
        if (orig && orig[i] !== d.raw[i]) { td.classList.add('chg'); td.title = 'Original: ' + fmt(phys(m, orig[i]), m.dec); }
        tr.appendChild(td);
      }
      tbl.appendChild(tr);
    }
    paintSel();
    S.lastTraceKey = '';
    drawTrace();
  }

  function paintSel() {
    const s = S.sel;
    $('mapTable').querySelectorAll('td').forEach((td) => {
      const r = +td.dataset.r, c = +td.dataset.c;
      td.classList.toggle('sel', !!s && r >= Math.min(s.r0, s.r1) && r <= Math.max(s.r0, s.r1) && c >= Math.min(s.c0, s.c1) && c <= Math.max(s.c0, s.c1));
    });
  }

  function drawTrace() {
    const m = S.map, d = S.mapData;
    if (!m || !d) return;
    const tr = $('traceOn').checked && S.daqOn ? S.trace[m.id] : null;
    const key = tr ? tr.join(',') : '';
    if (key === S.lastTraceKey) return;
    S.lastTraceKey = key;
    const tbl = $('mapTable');
    tbl.querySelectorAll('.tr').forEach((e) => e.remove());
    tbl.querySelectorAll('th.tx').forEach((e) => e.classList.remove('tx'));
    if (!tr) return;
    const [xi, xf, yi, yf] = tr;
    const cells = [[yi, xi, (1 - xf) * (1 - yf)], [yi, xi + 1, xf * (1 - yf)], [yi + 1, xi, (1 - xf) * yf], [yi + 1, xi + 1, xf * yf]];
    for (const [r, c, w] of cells) {
      if (w < 0.03 || r >= d.rows || c >= d.cols) continue;
      const td = tbl.querySelector(`td[data-r="${r}"][data-c="${c}"]`);
      if (!td) continue;
      const o = document.createElement('i'); o.className = 'tr'; o.style.opacity = (0.25 + 0.75 * w).toFixed(2);
      td.appendChild(o);
    }
    const hx = tbl.querySelector(`th[data-xc="${xf > 0.5 ? xi + 1 : xi}"]`); if (hx) hx.classList.add('tx');
    if (m.y) { const hy = tbl.querySelector(`th[data-yr="${yf > 0.5 ? yi + 1 : yi}"]`); if (hy) hy.classList.add('tx'); }
  }

  /* Auswahl mit Maus */
  let dragging = false;
  $('mapTable').addEventListener('mousedown', (e) => {
    const td = e.target.closest('td'); if (!td) return;
    const r = +td.dataset.r, c = +td.dataset.c;
    if (e.shiftKey && S.sel) { S.sel.r1 = r; S.sel.c1 = c; } else S.sel = { r0: r, c0: c, r1: r, c1: c };
    dragging = true; paintSel(); $('mapTable').focus(); e.preventDefault();
  });
  $('mapTable').addEventListener('mouseover', (e) => {
    if (!dragging) return;
    const td = e.target.closest('td'); if (!td) return;
    S.sel.r1 = +td.dataset.r; S.sel.c1 = +td.dataset.c; paintSel();
  });
  window.addEventListener('mouseup', () => { dragging = false; });

  function selCells() {
    const s = S.sel, d = S.mapData; if (!s || !d) return [];
    const out = [];
    for (let r = Math.min(s.r0, s.r1); r <= Math.max(s.r0, s.r1); r++) for (let c = Math.min(s.c0, s.c1); c <= Math.max(s.c0, s.c1); c++) out.push(r * d.cols + c);
    return out;
  }

  let pageHintShown = false;
  async function applyEdit(fn) {
    const m = S.map, d = S.mapData;
    const idx = selCells();
    if (!idx.length) return toast('Erst Zellen auswählen');
    const changes = [];
    for (const i of idx) {
      const nr = rawOf(m, fn(phys(m, d.raw[i]), d.raw[i]));
      if (nr !== d.raw[i]) changes.push([i, d.raw[i], nr]);
    }
    if (!changes.length) return;
    S.undo.push(changes.map(([i, o]) => [i, o]));
    if (S.undo.length > 100) S.undo.shift();
    await commitCells(changes.map(([i, , n]) => [i, n]));
    if (S.mapSrc === 'ecu' && S.page === 0 && !pageHintShown) { pageHintShown = true; toast('Werte im RAM geändert – wirksam erst mit „Seite: RAM“'); }
  }

  /** Zellen setzen und zusammenhängende Bereiche schreiben */
  async function commitCells(list) {
    const m = S.map, d = S.mapData;
    for (const [i, v] of list) d.raw[i] = v;
    renderMap();
    const set = new Set(list.map(([i]) => i));
    const sorted = [...set].sort((a, b) => a - b);
    const runs = [];
    for (const i of sorted) { const last = runs[runs.length - 1]; if (last && last[1] === i - 1) last[1] = i; else runs.push([i, i]); }
    try {
      const src = source();
      for (const [a, b] of runs) {
        const bytes = new Uint8Array((b - a + 1) * m.size);
        for (let i = a; i <= b; i++) U.writeVal(bytes, (i - a) * m.size, m.size, d.raw[i]);
        await src.write(m.data + a * m.size, bytes);
      }
      if (S.mapSrc === 'bin') updateBinInfo();
    } catch (e) { fail(e); }
  }

  $('mapTable').addEventListener('keydown', (e) => {
    if (!S.mapData) return;
    const step = parseFloat($('stepVal').value) || 1;
    const k = e.key;
    if (k === '+' || k === 'Add') { applyEdit((v) => v + step); e.preventDefault(); }
    else if (k === '-' || k === 'Subtract') { applyEdit((v) => v - step); e.preventDefault(); }
    else if (k === 'PageUp') { applyEdit((v) => v + step * 10); e.preventDefault(); }
    else if (k === 'PageDown') { applyEdit((v) => v - step * 10); e.preventDefault(); }
    else if ((e.ctrlKey || e.metaKey) && k.toLowerCase() === 'z') { undo(); e.preventDefault(); }
    else if (k.startsWith('Arrow') && S.sel) {
      const dr = k === 'ArrowDown' ? 1 : k === 'ArrowUp' ? -1 : 0, dc = k === 'ArrowRight' ? 1 : k === 'ArrowLeft' ? -1 : 0;
      const r = U.clamp(S.sel.r1 + dr, 0, S.mapData.rows - 1), c = U.clamp(S.sel.c1 + dc, 0, S.mapData.cols - 1);
      S.sel = e.shiftKey ? { ...S.sel, r1: r, c1: c } : { r0: r, c0: c, r1: r, c1: c };
      paintSel(); e.preventDefault();
    } else if (/^[0-9.,]$/.test(k)) { $('setVal').value = k === ',' ? '.' : k; $('setVal').focus(); e.preventDefault(); }
  });
  $('setVal').addEventListener('keydown', (e) => { if (e.key === 'Enter') { $('btnSet').click(); $('mapTable').focus(); } });
  $('btnSet').addEventListener('click', () => { const v = parseFloat($('setVal').value); if (Number.isFinite(v)) applyEdit(() => v); });
  $('btnPct').addEventListener('click', () => { const p = parseFloat($('setVal').value); if (Number.isFinite(p)) applyEdit((v) => v * (1 + p / 100)); });

  async function undo() {
    const last = S.undo.pop(); if (!last) return;
    await commitCells(last);
  }

  $('mapSrc').addEventListener('change', (e) => { S.mapSrc = e.target.value; if (S.map) loadMap(S.map); });
  $('btnReload').addEventListener('click', () => { if (S.map) loadMap(S.map); });
  $('traceOn').addEventListener('change', () => { S.lastTraceKey = null; drawTrace(); });

  function updatePage() {
    const t = 'Seite: ' + (S.page ? 'RAM' : 'Flash');
    $('btnPage').textContent = t; $('stPage').textContent = t;
    $('stPage').className = 'pill' + (S.page ? ' ram' : '') + (S.connected ? '' : ' hidden');
    if (S.map && S.mapData && S.mapSrc === 'ecu') loadMap(S.map);
  }
  $('btnPage').addEventListener('click', async () => {
    try { await S.client.setPage(S.page ? 0 : 1); S.page ^= 1; updatePage(); } catch (e) { fail(e); }
  });
  $('btnCalInit').addEventListener('click', async () => {
    if (!confirm('Alle RAM-Kennfelder mit den Flash-Werten überschreiben?')) return;
    try { await S.client.calInit(); toast('RAM = Flash'); S.orig = {}; if (S.map) loadMap(S.map); } catch (e) { fail(e); }
  });
  $('btnRamToBin').addEventListener('click', async () => {
    try {
      if (!S.bin) throw new Error('Keine Bin-Datei geladen');
      const prev = S.page;
      if (prev !== 1) await S.client.setPage(1);
      try {
        for (const m of S.defs.maps) {
          const bytes = await S.client.read(m.data, GT.Defs.bytes(m));
          S.bin.set(bytes, m.data - S.defs.flashBase);
        }
      } finally { if (prev !== 1) await S.client.setPage(prev); }
      updateBinInfo();
      toast('RAM-Kennfelder ins Bin übernommen – jetzt flashen, um sie dauerhaft zu speichern');
    } catch (e) { fail(e); }
  });

  /* ---------------- Logging ---------------- */
  function startRec() {
    S.log = { t0: performance.now(), cols: S.defs.channels.slice(), rows: [] };
    S.recording = true;
    $('btnRec').textContent = 'Aufzeichnung stoppen';
    $('stLog').classList.remove('hidden');
    if (!S.daqOn) toast('Hinweis: DAQ läuft nicht – es kommen keine Daten');
  }
  function stopRec() {
    S.recording = false;
    $('btnRec').textContent = 'Aufzeichnung starten';
    $('stLog').classList.add('hidden');
    updateLogInfo(); drawLogChart();
  }
  function updateLogInfo() {
    const L = S.log;
    $('btnCsv').disabled = !L || !L.rows.length;
    if (!L || !L.rows.length) { $('logInfo').textContent = 'Keine Daten.'; return; }
    const dur = L.rows[L.rows.length - 1][0] / 1000;
    $('logInfo').textContent = `${L.rows.length} Datensätze · ${dur.toFixed(1)} s · ${L.cols.length} Kanäle${S.recording ? ' · läuft …' : ''}`;
  }
  $('btnRec').addEventListener('click', () => { if (!S.defs) return toast('Keine Definition geladen', true); S.recording ? stopRec() : startRec(); });
  $('btnLogClear').addEventListener('click', () => { if (S.recording) stopRec(); S.log = null; updateLogInfo(); drawLogChart(); });
  $('btnCsv').addEventListener('click', () => {
    const L = S.log;
    const head = ['Zeit_ms', ...L.cols.map((c) => `${c.name} [${c.unit}]`)].join(';');
    const lines = L.rows.map((r) => r.map((v, i) => (i === 0 ? Math.round(v) : fmt(v, L.cols[i - 1].dec + 1).replace('.', ','))).join(';'));
    const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    U.download('﻿' + [head, ...lines].join('\r\n'), `gt15-log-${ts}.csv`, 'text/csv');
  });
  const logChart = new GT.LineChart($('logChart'));
  function drawLogChart() {
    const L = S.log;
    if (!L || !L.rows.length) { logChart.draw([], 0, 1); return; }
    const series = [];
    L.cols.forEach((c, i) => {
      if (!S.selCh.has(c.id)) return;
      const ci = S.defs.channels.findIndex((x) => x.id === c.id);
      series.push({ color: GT.COLORS[ci % GT.COLORS.length], min: c.min, max: c.max, pts: L.rows.map((r) => [r[0], r[i + 1]]) });
    });
    logChart.draw(series, 0, Math.max(1, L.rows[L.rows.length - 1][0]));
  }

  /* ---------------- Bin / Flash ---------------- */
  function updateBinInfo() {
    const b = S.bin;
    $('binName').textContent = b ? S.binName : '–';
    $('binSize').textContent = b ? `${b.length} Byte (${(b.length / 1024).toFixed(0)} KB)` : '–';
    $('binCrc').textContent = b ? '0x' + U.hex(U.crc32(b), 8) : '–';
    $('binBase').textContent = S.defs ? '0x' + U.hex(S.defs.flashBase, 6) : '–';
    $('btnBinSave').disabled = !b;
    updateFlashButtons();
    renderSectors();
  }
  function updateFlashButtons() {
    const ok = !!S.bin && S.connected && !S.busy;
    $('btnCompare').disabled = !ok; $('btnFlash').disabled = !ok;
    $('btnReadFlash').disabled = !S.connected || S.busy;
    $('btnRamToBin').disabled = !S.bin || !S.connected;
  }

  $('binFile').addEventListener('change', async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const b = await U.readFile(f);
      if (S.defs && b.length !== S.defs.flashSize) toast(`Achtung: Bin hat ${b.length} Byte, Definition erwartet ${S.defs.flashSize}`, true);
      S.bin = b; S.binName = f.name; S.orig = {};
      updateBinInfo();
      if (S.map && S.mapSrc === 'bin') loadMap(S.map);
    } catch (err) { fail(err); }
    e.target.value = '';
  });
  $('btnBinSave').addEventListener('click', () => {
    const name = S.binName.replace(/(\.[^.]*)?$/, '') + '_mod.bin';
    U.download(S.bin, name);
  });

  const flog = (msg) => { const el = $('flashLog'); el.textContent += `[${new Date().toLocaleTimeString()}] ${msg}\n`; el.scrollTop = el.scrollHeight; };
  const fprog = (p, txt) => { $('flashBar').style.width = (p * 100).toFixed(1) + '%'; if (txt) $('flashState').textContent = txt; };

  const sectorState = {};
  function renderSectors() {
    const t = $('sectorTable');
    if (!S.defs) { t.innerHTML = ''; return; }
    let h = '<tr><th>#</th><th>Adresse</th><th>Größe</th><th>Bin-CRC32</th><th>ECU-CRC32</th><th>Status</th></tr>';
    S.defs.sectors.forEach(([a, len], i) => {
      const boot = S.defs.bootSectors.includes(a);
      let bc = '–';
      if (S.bin) { const o = a - S.defs.flashBase; if (o >= 0 && o + len <= S.bin.length) bc = U.hex(U.crc32(S.bin, o, len), 8); }
      const st = sectorState[a] || {};
      const ec = st.ecu != null ? U.hex(st.ecu, 8) : '–';
      let cls = '', txt = st.txt || '';
      if (boot) { cls = 'boot'; txt = 'Bootsektor (geschützt)'; }
      else if (st.ecu != null && bc !== '–') { const same = ec === bc; cls = same ? 'same' : 'diff'; txt = txt || (same ? 'identisch' : 'abweichend'); }
      h += `<tr class="${cls}"><td>${i}</td><td>0x${U.hex(a, 6)}</td><td>${len / 1024} KB</td><td>${bc}</td><td>${ec}</td><td>${txt}</td></tr>`;
    });
    t.innerHTML = h;
  }

  async function withBusy(fn) {
    S.busy = true; updateFlashButtons();
    try { return await fn(); } finally { S.busy = false; updateFlashButtons(); }
  }

  $('btnReadFlash').addEventListener('click', () => withBusy(async () => {
    try {
      const { flashBase: base, flashSize: size } = S.defs;
      if (!confirm(`Flash komplett auslesen (${size / 1024} KB)? Das dauert über CAN einige Minuten.`)) return;
      if (S.daqOn) $('btnDaq').click();
      flog(`Lese Flash 0x${U.hex(base, 6)} … ${size} Byte`);
      const t0 = performance.now();
      const data = await S.client.read(base, size, (o, n) => fprog(o / n, `Lesen … ${(o / 1024).toFixed(0)} / ${(n / 1024).toFixed(0)} KB`));
      S.bin = data; S.binName = 'ecu_read_' + new Date().toISOString().slice(0, 10) + '.bin'; S.orig = {};
      updateBinInfo();
      flog(`Fertig in ${((performance.now() - t0) / 1000).toFixed(1)} s, CRC32 0x${U.hex(U.crc32(data), 8)}`);
      fprog(1, 'Auslesen abgeschlossen.');
    } catch (e) { flog('FEHLER: ' + e.message); fail(e); }
  }));

  async function compareSectors() {
    for (const [a, len] of S.defs.sectors) {
      if (S.defs.bootSectors.includes(a)) continue;
      sectorState[a] = { ecu: await S.client.checksum(a, len) };
    }
    renderSectors();
  }
  $('btnCompare').addEventListener('click', () => withBusy(async () => {
    try { await compareSectors(); flog('Sektorvergleich abgeschlossen'); } catch (e) { fail(e); }
  }));

  $('btnFlash').addEventListener('click', () => withBusy(async () => {
    const D = S.defs, bin = S.bin, c = S.client;
    if (bin.length !== D.flashSize) return fail(new Error('Bin-Größe passt nicht zur Definition'));
    if (!confirm('Steuergerät jetzt flashen?\n\n• Zündung an, Motor AUS\n• Ladegerät angeschlossen\n• Verbindung nicht trennen\n\nBosch-Prüfsummen müssen korrigiert sein!')) return;
    const t0 = performance.now();
    try {
      if (S.daqOn) { await c.daqStop(); S.daqOn = false; $('btnDaq').textContent = 'DAQ starten'; $('stDaq').classList.add('hidden'); }
      const st = await c.status();
      if (st.rpm > 0) throw new Error('Motor läuft – bitte abstellen');
      flog('Bootloader starten …');
      const maxBlock = Math.min(256, (await c.progEnter()) || 256) & ~1;
      flog(`Bootloader aktiv, Blockgröße ${maxBlock} Byte`);
      const todo = [];
      for (const [a, len] of D.sectors) {
        if (D.bootSectors.includes(a)) continue;
        const o = a - D.flashBase;
        const local = U.crc32(bin, o, len);
        if ($('onlyChanged').checked) {
          const ecu = await c.checksum(a, len);
          sectorState[a] = { ecu };
          if (ecu === local) { flog(`Sektor 0x${U.hex(a, 6)} identisch – übersprungen`); continue; }
        }
        todo.push([a, len, local]);
      }
      renderSectors();
      if (!todo.length) flog('Keine Änderungen – nichts zu flashen.');
      const total = todo.reduce((s, x) => s + x[1], 0);
      let done = 0;
      for (const [a, len, local] of todo) {
        flog(`Lösche Sektor 0x${U.hex(a, 6)} (${len / 1024} KB) …`);
        sectorState[a] = { txt: 'löschen …' }; renderSectors();
        await c.erase(a);
        sectorState[a] = { txt: 'schreiben …' }; renderSectors();
        const o = a - D.flashBase;
        for (let p = 0; p < len; p += maxBlock) {
          const blk = bin.subarray(o + p, o + p + maxBlock);
          if (!blk.every((b) => b === 0xff)) await c.progBlock(a + p, blk);
          done += blk.length;
          if ((p / maxBlock) % 8 === 0) fprog(done / total, `Schreibe 0x${U.hex(a + p, 6)} · ${(done / 1024).toFixed(0)} / ${(total / 1024).toFixed(0)} KB`);
        }
        const ecu = await c.checksum(a, len);
        if (ecu !== local) throw new Error(`Verifikation Sektor 0x${U.hex(a, 6)} fehlgeschlagen (ECU 0x${U.hex(ecu, 8)} ≠ Bin 0x${U.hex(local, 8)})`);
        sectorState[a] = { ecu, txt: 'geflasht ✓' }; renderSectors();
        flog(`Sektor 0x${U.hex(a, 6)} verifiziert ✓`);
      }
      flog('Reset …');
      await c.reset();
      await U.sleep(600);
      const info = await c.connect();
      await c.setPage(0); S.page = 0; updatePage();
      fprog(1, `Fertig in ${((performance.now() - t0) / 1000).toFixed(1)} s.`);
      flog(`Flashen erfolgreich. ECU meldet sich: ${info.ident}`);
      toast('Flashen erfolgreich');
      S.orig = {};
    } catch (e) {
      flog('FEHLER: ' + e.message);
      flog('Die ECU bleibt im Bootloader. Vorgang kann wiederholt werden – Zündung nicht ausschalten.');
      fprog(0, 'Fehler – siehe Protokoll.');
      fail(e);
    }
  }));

  /* ---------------- Bus-Monitor ---------------- */
  function onMonitor(dir, id, data) {
    if (!$('monOn').checked) return;
    if ($('monHideDaq').checked && S.client && id === S.client.ids.daq) return;
    const f = $('monFilter').value.trim();
    if (f && parseInt(f, 16) !== id) return;
    S.mon.push(`${(performance.now() / 1000).toFixed(3).padStart(10)}  ${dir}  ${U.hex(id, 3)}  [${data.length}]  ${U.hexBytes(data)}`);
    if (S.mon.length > 1500) S.mon.splice(0, S.mon.length - 1500);
    S.monDirty = true;
  }
  function renderMon() {
    S.monDirty = false;
    const el = $('monLog');
    const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 20;
    el.textContent = S.mon.join('\n');
    if (atBottom) el.scrollTop = el.scrollHeight;
  }
  $('monClear').addEventListener('click', () => { S.mon = []; renderMon(); });
  $('btnTx').addEventListener('click', async () => {
    try {
      const id = parseInt($('txId').value, 16);
      const bytes = $('txData').value.trim().split(/[\s,]+/).filter(Boolean).map((x) => parseInt(x, 16));
      if (!(id >= 0 && id <= 0x7ff) || bytes.length > 8 || bytes.some((b) => !(b >= 0 && b <= 255))) throw new Error('Ungültiger Frame');
      onMonitor('TX', id, Uint8Array.from(bytes));
      await S.transport.send(id, bytes);
    } catch (e) { fail(e); }
  });

  /* ---------------- Start ---------------- */
  setDefs(GT.SIM_DEFS);
  window.GT_STATE = S;   // für Debugging in der Konsole
})();
