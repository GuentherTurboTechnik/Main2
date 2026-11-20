/*
 * Host-Test für den GT15-Protokollkern: emuliert Speicher, Flash (29F400BB) und CAN.
 *   make -C firmware test
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "../src/gt15.h"
#include "../src/gt15_hal.h"

#define FLASH_BASE 0x080000ul
#define FLASH_SIZE 0x80000ul

static uint8_t ram[0x10000];
static uint8_t flash[FLASH_SIZE];
static uint16_t rpm = 0;

static uint8_t ovl0[160];
const gt15_overlay_t gt15_overlays[] = { { 0x0D1000ul, 160, ovl0 } };
const uint8_t gt15_overlay_count = 1;
const char gt15_ident[] = "GT15-HOST 0281010000 TEST";

static const uint32_t sectors[][2] = {
    {0x080000, 0x10000}, {0x090000, 0x10000}, {0x0A0000, 0x10000}, {0x0B0000, 0x10000},
    {0x0C0000, 0x10000}, {0x0D0000, 0x10000}, {0x0E0000, 0x10000}, {0x0F0000, 0x8000},
    {0x0F8000, 0x2000}, {0x0FA000, 0x2000}, {0x0FC000, 0x4000},
};
#define NSEC (sizeof(sectors) / sizeof(sectors[0]))

/* --- empfangene Frames --- */
static uint8_t txq[64][9];
static int txn;
void hal_can_send(uint16_t id, const uint8_t *d8)
{
    if (txn < 64) { txq[txn][0] = (uint8_t)(id & 0xFF); memcpy(&txq[txn][1], d8, 8); txn++; }
}

uint8_t hal_mem_read(uint32_t addr, uint8_t *dst, uint16_t n)
{
    if (addr + n <= sizeof(ram)) { memcpy(dst, ram + addr, n); return 0; }
    if (addr >= FLASH_BASE && addr + n <= FLASH_BASE + FLASH_SIZE) { memcpy(dst, flash + (addr - FLASH_BASE), n); return 0; }
    return 1;
}
uint16_t hal_rpm(void) { return rpm; }
uint16_t hal_random(void) { return 0x1234; }
uint8_t hal_sector_info(uint32_t a, uint32_t *len, uint8_t *boot)
{
    unsigned i;
    for (i = 0; i < NSEC; i++) if (sectors[i][0] == a) { *len = sectors[i][1]; *boot = (i < 2);   /* B0/B1 = Bootloader */ return 0; }
    return 1;
}
uint8_t hal_flash_range_ok(uint32_t a, uint32_t len, uint8_t allow_boot)
{
    if (a < FLASH_BASE || a + len > FLASH_BASE + FLASH_SIZE) return 0;
    if (!allow_boot && a < sectors[2][0]) return 0;
    return 1;
}
void hal_enter_boot(void) {}
uint8_t hal_flash_erase(uint32_t a)
{
    uint32_t len; uint8_t b;
    if (hal_sector_info(a, &len, &b)) return 1;
    memset(flash + (a - FLASH_BASE), 0xFF, len);
    return 0;
}
uint8_t hal_flash_program(uint32_t a, const uint8_t *d, uint16_t len)
{
    uint16_t i;
    for (i = 0; i < len; i++) {
        uint8_t *c = &flash[a - FLASH_BASE + i];
        if ((*c & d[i]) != d[i]) return 1;
        *c &= d[i];
    }
    return 0;
}
static int resets;
void hal_reset(void) { resets++; }

/* --- Test-Helfer --- */
static int fails;
#define CHECK(c, msg) do { if (!(c)) { printf("FAIL: %s (Zeile %d)\n", msg, __LINE__); fails++; } else printf("ok   %s\n", msg); } while (0)

static uint8_t seqc;
static const uint8_t *req(uint8_t cmd, const uint8_t *par, int n)
{
    uint8_t f[8] = {0};
    f[0] = cmd; f[1] = ++seqc;
    if (n) memcpy(f + 2, par, (size_t)n);
    txn = 0;
    gt15_can_rx(GT15_ID_REQ, f, 8);
    return txn ? &txq[txn - 1][1] : NULL;   /* letzte Antwort (nach evtl. pending) */
}
static int is_ok(const uint8_t *r) { return r && r[0] == 0xFF && r[1] == seqc; }

static uint32_t crc32(const uint8_t *d, uint32_t len)
{
    uint32_t c = 0xFFFFFFFFul;
    while (len) { uint16_t n = len > 0x8000 ? 0x8000 : (uint16_t)len; c = gt15_crc32_update(c, d, n); d += n; len -= n; }
    return c ^ 0xFFFFFFFFul;
}

int main(void)
{
    const uint8_t *r;
    uint8_t p[6];
    unsigned i;
    uint16_t key;

    for (i = 0; i < FLASH_SIZE; i++) flash[i] = (uint8_t)(i * 7 + (i >> 8));
    for (i = 0; i < 160; i++) flash[0x0D1000 - FLASH_BASE + i] = (uint8_t)i;
    ram[0xF000] = 0x34; ram[0xF001] = 0x12;
    gt15_init();

    /* Testvektor wie im Tool: key(0x1234) */
    CHECK(gt15_key(0x1234) == (uint16_t)(((((0x1234 ^ 0x4754) << 3) | ((0x1234 ^ 0x4754) >> 13)) & 0xFFFF) + 0x1F15), "Seed/Key-Formel");
    CHECK(gt15_crc16((const uint8_t *)"123456789", 9) == 0x29B1, "CRC16-CCITT Prüfwert 0x29B1");
    CHECK(crc32((const uint8_t *)"123456789", 9) == 0xCBF43926ul, "CRC32 Prüfwert 0xCBF43926");

    r = req(GT15_SET_MTA, p, 3);
    CHECK(r && r[0] == 0xFE && r[2] == GT15_E_LOCKED, "gesperrt vor UNLOCK");

    r = req(GT15_CONNECT, NULL, 0);
    CHECK(is_ok(r) && r[2] == 1 && r[5] == 0x12 && r[6] == 0x35, "CONNECT liefert Version + Seed");
    key = gt15_key(0x1235);
    p[0] = (uint8_t)(key >> 8); p[1] = (uint8_t)key;
    r = req(GT15_UNLOCK, p, 2);
    CHECK(is_ok(r), "UNLOCK mit richtigem Key");

    p[0] = 0; r = req(GT15_GET_ID, p, 1);
    CHECK(is_ok(r) && memcmp(r + 2, "GT15-H", 6) == 0, "GET_ID");

    p[0] = 2; p[1] = 0x00; p[2] = 0xF0; p[3] = 0x00;
    r = req(GT15_SHORT_UP, p, 4);
    CHECK(is_ok(r) && r[2] == 0x34 && r[3] == 0x12, "SHORT_UP liest RAM");

    /* Overlay schreiben, Seite umschalten */
    p[0] = 0x0D; p[1] = 0x10; p[2] = 0x00; req(GT15_SET_MTA, p, 3);
    p[0] = 2; p[1] = 0xAA; p[2] = 0xBB; r = req(GT15_DOWNLOAD, p, 3);
    CHECK(is_ok(r) && ovl0[0] == 0xAA && ovl0[1] == 0xBB, "DOWNLOAD schreibt RAM-Overlay");
    p[0] = 2; p[1] = 0x0D; p[2] = 0x10; p[3] = 0x00;
    r = req(GT15_SHORT_UP, p, 4);
    CHECK(is_ok(r) && r[2] == 0x00, "Seite Flash: Originalwert");
    p[0] = 1; req(GT15_SET_PAGE, p, 1);
    p[0] = 2; p[1] = 0x0D; p[2] = 0x10; p[3] = 0x00;
    r = req(GT15_SHORT_UP, p, 4);
    CHECK(is_ok(r) && r[2] == 0xAA && r[3] == 0xBB, "Seite RAM: Overlay-Wert");
    CHECK(gt15_map_addr(0x0D1002ul) != 0x0D1002ul && gt15_map_addr(0x0C0000ul) == 0x0C0000ul, "gt15_map_addr leitet nur Overlays um");
    p[0] = 0x0C; p[1] = 0x00; p[2] = 0x00; req(GT15_SET_MTA, p, 3);
    p[0] = 1; p[1] = 0; r = req(GT15_DOWNLOAD, p, 2);
    CHECK(r && r[0] == 0xFE && r[2] == GT15_E_OUT_OF_RANGE, "DOWNLOAD außerhalb Overlay abgelehnt");

    /* DAQ */
    req(GT15_DAQ_CLEAR, NULL, 0);
    p[0] = 2; p[1] = 0; p[2] = 0xF0; p[3] = 0x00; req(GT15_DAQ_ADD, p, 4);
    for (i = 0; i < 4; i++) { p[0] = 4; p[1] = 0; p[2] = 0xF1; p[3] = (uint8_t)(i * 4); r = req(GT15_DAQ_ADD, p, 4); }
    CHECK(is_ok(r) && r[3] == 18, "DAQ_ADD summiert Bytes (18)");
    p[0] = 0; p[1] = 10; r = req(GT15_DAQ_START, p, 2);
    CHECK(is_ok(r) && r[2] == 3, "DAQ_START: 3 Frames");
    txn = 0; gt15_task(5); CHECK(txn == 0, "DAQ: vor Ablauf der Periode nichts");
    gt15_task(5);
    CHECK(txn == 3 && txq[0][1] == 0x00 && txq[1][1] == 0x01 && txq[0][2] == 0x34 && txq[0][3] == 0x12, "DAQ: 3 Frames mit Header und Daten");
    txn = 0; gt15_task(10); CHECK(txn == 3 && txq[0][1] == 0x10, "DAQ: Zähler erhöht");

    /* Flash */
    rpm = 900; r = req(GT15_PROG_ENTER, NULL, 0);
    CHECK(r && r[0] == 0xFE && r[2] == GT15_E_NOT_ALLOWED, "PROG_ENTER bei laufendem Motor abgelehnt");
    rpm = 0; r = req(GT15_PROG_ENTER, NULL, 0);
    CHECK(is_ok(r) && r[2] == 1 && r[3] == 0, "PROG_ENTER, Blockgröße 256");
    p[0] = 0x08; p[1] = 0; p[2] = 0; r = req(GT15_PROG_ERASE, p, 3);
    CHECK(r && r[0] == 0xFE && r[2] == GT15_E_NOT_ALLOWED, "Bootsektor nicht löschbar");
    p[0] = 0x0D; p[1] = 0; p[2] = 0; r = req(GT15_PROG_ERASE, p, 3);
    CHECK(is_ok(r) && txn == 2 && txq[0][1] == 0xFD && flash[0x50000] == 0xFF, "Sektor gelöscht (mit pending)");
    {
        uint8_t blk[256], f[8];
        uint16_t crc;
        for (i = 0; i < 256; i++) blk[i] = (uint8_t)(255 - i);
        p[0] = 0x0D; p[1] = 0x00; p[2] = 0x00; p[3] = 0x01; p[4] = 0x00;
        r = req(GT15_PROG_BLOCK, p, 5); CHECK(is_ok(r), "PROG_BLOCK");
        for (i = 0; i < 256; i += 8) { memcpy(f, blk + i, 8); gt15_can_rx(GT15_ID_BULK, f, 8); }
        crc = gt15_crc16(blk, 256);
        p[0] = (uint8_t)(crc >> 8); p[1] = (uint8_t)(crc ^ 1);
        r = req(GT15_PROG_COMMIT, p, 2);
        CHECK(r && r[0] == 0xFE && r[2] == GT15_E_CRC, "COMMIT mit falscher CRC abgelehnt");
        p[0] = 0x0D; p[1] = 0x00; p[2] = 0x00; p[3] = 0x01; p[4] = 0x00; req(GT15_PROG_BLOCK, p, 5);
        for (i = 0; i < 256; i += 8) { memcpy(f, blk + i, 8); gt15_can_rx(GT15_ID_BULK, f, 8); }
        p[0] = (uint8_t)(crc >> 8); p[1] = (uint8_t)crc;
        r = req(GT15_PROG_COMMIT, p, 2);
        CHECK(is_ok(r) && memcmp(flash + 0x50000, blk, 256) == 0, "Block programmiert");
        p[0] = 0x0D; p[1] = 0x00; p[2] = 0x00; p[3] = 0x01; p[4] = 0x00;
        r = req(GT15_PROG_COMMIT, p, 2);
        CHECK(r && r[0] == 0xFE && r[2] == GT15_E_SEQUENCE, "COMMIT ohne BLOCK -> Sequenzfehler");
    }
    p[0] = 0x0D; p[1] = 0; p[2] = 0; p[3] = 0x01; p[4] = 0; p[5] = 0;
    r = req(GT15_CHECKSUM, p, 6);
    {
        uint32_t c = crc32(flash + 0x50000, 0x10000);
        CHECK(is_ok(r) && ((uint32_t)r[2] << 24 | (uint32_t)r[3] << 16 | (uint32_t)r[4] << 8 | r[5]) == c, "CHECKSUM CRC32 über Sektor");
    }
    r = req(GT15_RESET, NULL, 0);
    CHECK(is_ok(r) && resets == 1, "RESET");

    printf("\n%s – %d Fehler\n", fails ? "FEHLGESCHLAGEN" : "ALLE TESTS OK", fails);
    return fails ? 1 : 0;
}
