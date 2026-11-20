/*
 * GT15-CAN Protokoll-Kern (C90-kompatibel, für Keil C166 / Tasking / GCC)
 * Spezifikation: docs/PROTOCOL.md
 */
#include "gt15.h"
#include "gt15_hal.h"

#define FLAG_UNLOCKED 0x01u
#define FLAG_DAQ      0x02u

typedef struct { uint32_t addr; uint8_t size; } daq_entry_t;

static struct {
    uint8_t  unlocked;
    uint16_t seed;
    uint8_t  page;
    uint8_t  mode;            /* 0 = App, 1 = Boot */
    uint32_t mta;
    /* DAQ */
    daq_entry_t daq[GT15_DAQ_MAX_ENTRIES];
    uint8_t  daq_n;
    uint8_t  daq_bytes;
    uint16_t daq_period;
    uint16_t daq_acc;
    uint8_t  daq_cnt;
    /* Flash */
    uint8_t  prog_active;
    uint32_t prog_addr;
    uint16_t prog_len;
    uint16_t prog_got;
    uint8_t  prog_buf[GT15_PROG_MAX_BLOCK + 8];
} g;

/* ---------------- Hilfsfunktionen ---------------- */

uint16_t gt15_key(uint16_t seed)
{
    uint16_t v = (uint16_t)(seed ^ 0x4754u);
    v = (uint16_t)((v << 3) | (v >> 13));
    return (uint16_t)(v + 0x1F15u);
}

uint16_t gt15_crc16(const uint8_t *d, uint16_t len)
{
    uint16_t crc = 0xFFFFu;
    uint8_t b;
    while (len--) {
        crc ^= (uint16_t)(*d++) << 8;
        for (b = 0; b < 8; b++)
            crc = (crc & 0x8000u) ? (uint16_t)((crc << 1) ^ 0x1021u) : (uint16_t)(crc << 1);
    }
    return crc;
}

/* Bitweise CRC32 (spart 1 KB Tabelle). crc mit 0xFFFFFFFF starten, am Ende invertieren. */
uint32_t gt15_crc32_update(uint32_t crc, const uint8_t *d, uint16_t len)
{
    uint8_t b;
    while (len--) {
        crc ^= *d++;
        for (b = 0; b < 8; b++)
            crc = (crc & 1u) ? (crc >> 1) ^ 0xEDB88320ul : (crc >> 1);
    }
    return crc;
}

static uint32_t a24(const uint8_t *p)
{
    return ((uint32_t)p[0] << 16) | ((uint32_t)p[1] << 8) | p[2];
}

static void respond(uint8_t stat, uint8_t seq, const uint8_t *data, uint8_t n)
{
    uint8_t f[8];
    uint8_t i;
    f[0] = stat;
    f[1] = seq;
    for (i = 0; i < 6; i++) f[2 + i] = (data && i < n) ? data[i] : 0;
    hal_can_send(GT15_ID_RES, f);
}

static void ok(uint8_t seq, const uint8_t *d, uint8_t n) { respond(0xFF, seq, d, n); }
static void err(uint8_t seq, uint8_t code)              { respond(0xFE, seq, &code, 1); }
static void pending(uint8_t seq)                         { respond(0xFD, seq, 0, 0); }

static const gt15_overlay_t *find_overlay(uint32_t addr, uint16_t len)
{
    uint8_t i;
    for (i = 0; i < gt15_overlay_count; i++) {
        const gt15_overlay_t *o = &gt15_overlays[i];
        if (addr >= o->flash_addr && addr + len <= o->flash_addr + o->len) return o;
    }
    return 0;
}

/* Speicher lesen, bei aktiver RAM-Seite Overlay berücksichtigen */
static uint8_t mem_read(uint32_t addr, uint8_t *dst, uint8_t n)
{
    const gt15_overlay_t *o = g.page ? find_overlay(addr, n) : 0;
    if (o) {
        const uint8_t *src = o->ram + (uint16_t)(addr - o->flash_addr);
        uint8_t i;
        for (i = 0; i < n; i++) dst[i] = src[i];
        return 0;
    }
    return hal_mem_read(addr, dst, n);
}

static void cal_init(void)
{
    uint8_t i;
    for (i = 0; i < gt15_overlay_count; i++)
        hal_mem_read(gt15_overlays[i].flash_addr, gt15_overlays[i].ram, gt15_overlays[i].len);
}

/* ---------------- Öffentliche API ---------------- */

void gt15_init(void)
{
    uint16_t i;
    uint8_t *p = (uint8_t *)&g;
    for (i = 0; i < sizeof(g); i++) p[i] = 0;
    cal_init();
}

uint8_t gt15_page(void) { return g.page; }

uint32_t gt15_map_addr(uint32_t flash_addr)
{
    if (g.page) {
        const gt15_overlay_t *o = find_overlay(flash_addr, 1);
        if (o) return (uint32_t)(unsigned long)(o->ram) + (flash_addr - o->flash_addr);  /* auf C167: RAM-Adresse im Datenraum */
    }
    return flash_addr;
}

void gt15_task(uint16_t elapsed_ms)
{
    uint8_t buf[GT15_DAQ_MAX_BYTES + 7];
    uint8_t f[8];
    uint8_t i, k, nfr;
    uint8_t o = 0;

    if (g.mode || !g.daq_period || !g.daq_n) return;
    g.daq_acc += elapsed_ms;
    if (g.daq_acc < g.daq_period) return;
    g.daq_acc -= g.daq_period;
    if (g.daq_acc >= g.daq_period) g.daq_acc = 0;   /* Überlast: nicht nachholen */

    for (i = 0; i < g.daq_n; i++) {
        if (mem_read(g.daq[i].addr, &buf[o], g.daq[i].size)) {
            for (k = 0; k < g.daq[i].size; k++) buf[o + k] = 0;
        }
        o += g.daq[i].size;
    }
    while (o % 7) buf[o++] = 0;
    nfr = (uint8_t)(o / 7);
    for (k = 0; k < nfr; k++) {
        f[0] = (uint8_t)((g.daq_cnt << 4) | k);
        for (i = 0; i < 7; i++) f[1 + i] = buf[k * 7 + i];
        hal_can_send(GT15_ID_DAQ, f);
    }
    g.daq_cnt = (uint8_t)((g.daq_cnt + 1) & 0x0F);
}

static void handle_bulk(const uint8_t *d)
{
    uint8_t i;
    if (!g.prog_active || g.prog_got >= g.prog_len) return;   /* Puffer hat 8 Byte Reserve */
    for (i = 0; i < 8; i++) g.prog_buf[g.prog_got++] = d[i];
}

void gt15_can_rx(uint16_t id, const uint8_t *d, uint8_t dlc)
{
    uint8_t cmd, seq;
    const uint8_t *p;
    uint8_t r[6];

    if (id == GT15_ID_BULK) { handle_bulk(d); return; }
    if (id != GT15_ID_REQ || dlc < 2) return;

    cmd = d[0];
    seq = d[1];
    p = d + 2;

    if (!g.unlocked && cmd != GT15_CONNECT && cmd != GT15_UNLOCK && cmd != GT15_GET_ID && cmd != GT15_STATUS) {
        err(seq, GT15_E_LOCKED);
        return;
    }

    switch (cmd) {
    case GT15_CONNECT:
        g.seed = (uint16_t)(hal_random() | 1u);
        g.unlocked = 0;
        r[0] = GT15_VER_MAJOR; r[1] = GT15_VER_MINOR; r[2] = 0x0F;
        r[3] = (uint8_t)(g.seed >> 8); r[4] = (uint8_t)g.seed;
        ok(seq, r, 5);
        break;

    case GT15_UNLOCK:
        if ((((uint16_t)p[0] << 8) | p[1]) != gt15_key(g.seed) || !g.seed) { err(seq, GT15_E_PARAM); break; }
        g.unlocked = 1;
        r[0] = 1;
        ok(seq, r, 1);
        break;

    case GT15_DISCONNECT:
        g.unlocked = 0; g.daq_period = 0;
        ok(seq, 0, 0);
        break;

    case GT15_GET_ID: {
        uint8_t i, end = 0;
        uint16_t base = (uint16_t)p[0] * 6u, n = 0;
        while (gt15_ident[n]) n++;
        for (i = 0; i < 6; i++) {
            if (end || base + i >= n) { r[i] = 0; end = 1; }
            else r[i] = (uint8_t)gt15_ident[base + i];
        }
        ok(seq, r, 6);
        break;
    }

    case GT15_STATUS: {
        uint16_t rpm = hal_rpm();
        r[0] = g.page; r[1] = g.mode; r[2] = (uint8_t)rpm; r[3] = (uint8_t)(rpm >> 8);
        r[4] = (uint8_t)((g.unlocked ? FLAG_UNLOCKED : 0) | (g.daq_period ? FLAG_DAQ : 0));
        ok(seq, r, 5);
        break;
    }

    case GT15_SET_MTA:
        g.mta = a24(p);
        ok(seq, 0, 0);
        break;

    case GT15_UPLOAD:
    case GT15_SHORT_UP: {
        uint8_t n = p[0];
        uint32_t addr = (cmd == GT15_UPLOAD) ? g.mta : a24(p + 1);
        if (n < 1 || n > 6) { err(seq, GT15_E_PARAM); break; }
        if (mem_read(addr, r, n)) { err(seq, GT15_E_OUT_OF_RANGE); break; }
        if (cmd == GT15_UPLOAD) g.mta += n;
        ok(seq, r, n);
        break;
    }

    case GT15_DOWNLOAD: {
        uint8_t n = p[0], i;
        const gt15_overlay_t *o;
        if (n < 1 || n > 5) { err(seq, GT15_E_PARAM); break; }
        o = find_overlay(g.mta, n);
        if (!o) { err(seq, GT15_E_OUT_OF_RANGE); break; }
        for (i = 0; i < n; i++) o->ram[(uint16_t)(g.mta - o->flash_addr) + i] = p[1 + i];
        g.mta += n;
        ok(seq, 0, 0);
        break;
    }

    case GT15_DAQ_CLEAR:
        g.daq_n = 0; g.daq_bytes = 0; g.daq_period = 0;
        ok(seq, 0, 0);
        break;

    case GT15_DAQ_ADD: {
        uint8_t size = p[0];
        uint32_t addr = a24(p + 1);
        uint8_t tmp[4];
        if (size != 1 && size != 2 && size != 4) { err(seq, GT15_E_PARAM); break; }
        if (g.daq_n >= GT15_DAQ_MAX_ENTRIES || g.daq_bytes + size > GT15_DAQ_MAX_BYTES || hal_mem_read(addr, tmp, size)) {
            err(seq, GT15_E_OUT_OF_RANGE); break;
        }
        g.daq[g.daq_n].addr = addr;
        g.daq[g.daq_n].size = size;
        g.daq_bytes = (uint8_t)(g.daq_bytes + size);
        r[0] = g.daq_n++; r[1] = g.daq_bytes;
        ok(seq, r, 2);
        break;
    }

    case GT15_DAQ_START: {
        uint16_t per = (uint16_t)(((uint16_t)p[0] << 8) | p[1]);
        if (per < 5 || per > 1000 || !g.daq_n) { err(seq, GT15_E_PARAM); break; }
        g.daq_period = per; g.daq_acc = 0;
        r[0] = (uint8_t)((g.daq_bytes + 6) / 7);
        ok(seq, r, 1);
        break;
    }

    case GT15_DAQ_STOP:
        g.daq_period = 0;
        ok(seq, 0, 0);
        break;

    case GT15_SET_PAGE:
        if (p[0] > 1) { err(seq, GT15_E_PARAM); break; }
        g.page = p[0];
        ok(seq, 0, 0);
        break;

    case GT15_CAL_INIT:
        cal_init();
        ok(seq, 0, 0);
        break;

    case GT15_GET_OVERLAY: {
        const gt15_overlay_t *o;
        if (p[0] >= gt15_overlay_count) { err(seq, GT15_E_OUT_OF_RANGE); break; }
        o = &gt15_overlays[p[0]];
        r[0] = (uint8_t)(o->flash_addr >> 16); r[1] = (uint8_t)(o->flash_addr >> 8); r[2] = (uint8_t)o->flash_addr;
        r[3] = (uint8_t)(o->len >> 8); r[4] = (uint8_t)o->len;
        ok(seq, r, 5);
        break;
    }

    case GT15_PROG_ENTER:
        if (hal_rpm() != 0) { err(seq, GT15_E_NOT_ALLOWED); break; }
        g.daq_period = 0;
        g.mode = 1;
        r[0] = (uint8_t)(GT15_PROG_MAX_BLOCK >> 8); r[1] = (uint8_t)GT15_PROG_MAX_BLOCK;
        ok(seq, r, 2);
        hal_enter_boot();
        break;

    case GT15_PROG_ERASE: {
        uint32_t addr = a24(p), len;
        uint8_t boot;
        if (!g.mode) { err(seq, GT15_E_SEQUENCE); break; }
        if (hal_sector_info(addr, &len, &boot)) { err(seq, GT15_E_OUT_OF_RANGE); break; }
        if (boot) { err(seq, GT15_E_NOT_ALLOWED); break; }
        pending(seq);
        if (hal_flash_erase(addr)) err(seq, GT15_E_FLASH);
        else ok(seq, 0, 0);
        break;
    }

    case GT15_PROG_BLOCK: {
        uint32_t addr = a24(p);
        uint16_t len = (uint16_t)(((uint16_t)p[3] << 8) | p[4]);
        if (!g.mode) { err(seq, GT15_E_SEQUENCE); break; }
        if (len < 2 || len > GT15_PROG_MAX_BLOCK || (len & 1u)) { err(seq, GT15_E_PARAM); break; }
        if (!hal_flash_range_ok(addr, len, 0)) { err(seq, GT15_E_NOT_ALLOWED); break; }
        g.prog_addr = addr; g.prog_len = len; g.prog_got = 0; g.prog_active = 1;
        ok(seq, 0, 0);
        break;
    }

    case GT15_PROG_COMMIT: {
        uint16_t crc = (uint16_t)(((uint16_t)p[0] << 8) | p[1]);
        if (!g.prog_active || g.prog_got < g.prog_len) { g.prog_active = 0; err(seq, GT15_E_SEQUENCE); break; }
        g.prog_active = 0;
        if (gt15_crc16(g.prog_buf, g.prog_len) != crc) { err(seq, GT15_E_CRC); break; }
        pending(seq);
        if (hal_flash_program(g.prog_addr, g.prog_buf, g.prog_len)) err(seq, GT15_E_FLASH);
        else ok(seq, 0, 0);
        break;
    }

    case GT15_CHECKSUM: {
        uint32_t addr = a24(p), len = a24(p + 3), crc = 0xFFFFFFFFul;
        uint8_t tmp[32];
        if (!hal_flash_range_ok(addr, len, 1)) { err(seq, GT15_E_OUT_OF_RANGE); break; }
        pending(seq);
        while (len) {
            uint16_t n = len > sizeof(tmp) ? (uint16_t)sizeof(tmp) : (uint16_t)len;
            hal_mem_read(addr, tmp, n);
            crc = gt15_crc32_update(crc, tmp, n);
            addr += n; len -= n;
        }
        crc ^= 0xFFFFFFFFul;
        r[0] = (uint8_t)(crc >> 24); r[1] = (uint8_t)(crc >> 16); r[2] = (uint8_t)(crc >> 8); r[3] = (uint8_t)crc;
        ok(seq, r, 4);
        break;
    }

    case GT15_RESET:
        ok(seq, 0, 0);
        hal_reset();
        break;

    default:
        err(seq, GT15_E_UNKNOWN_CMD);
        break;
    }
}
