/*
 * GT15-CAN – Kalibrier-/Flash-Protokoll für gepatchte Bosch EDC15 (C167)
 * Portabler Protokoll-Kern. Plattformspezifisches in gt15_hal.h.
 * Spezifikation: docs/PROTOCOL.md
 */
#ifndef GT15_H
#define GT15_H

#include <stdint.h>

#define GT15_VER_MAJOR 1
#define GT15_VER_MINOR 0

/* CAN-Identifier (11 Bit) */
#ifndef GT15_ID_REQ
#define GT15_ID_REQ   0x6E0u
#define GT15_ID_BULK  0x6E1u
#define GT15_ID_RES   0x6E8u
#define GT15_ID_DAQ   0x6E9u
#endif

#define GT15_DAQ_MAX_ENTRIES 32u
#define GT15_DAQ_MAX_BYTES   112u   /* 16 Frames * 7 Byte */
#define GT15_PROG_MAX_BLOCK  256u

/* Kommandos */
enum {
    GT15_CONNECT = 0x01, GT15_UNLOCK = 0x02, GT15_DISCONNECT = 0x03, GT15_GET_ID = 0x04, GT15_STATUS = 0x05,
    GT15_SET_MTA = 0x10, GT15_UPLOAD = 0x11, GT15_DOWNLOAD = 0x12, GT15_SHORT_UP = 0x13,
    GT15_DAQ_CLEAR = 0x20, GT15_DAQ_ADD = 0x21, GT15_DAQ_START = 0x22, GT15_DAQ_STOP = 0x23,
    GT15_SET_PAGE = 0x30, GT15_CAL_INIT = 0x31, GT15_GET_OVERLAY = 0x32,
    GT15_PROG_ENTER = 0x40, GT15_PROG_ERASE = 0x41, GT15_PROG_BLOCK = 0x42, GT15_PROG_COMMIT = 0x43,
    GT15_CHECKSUM = 0x44, GT15_RESET = 0x4F
};

/* Fehlercodes */
enum {
    GT15_E_UNKNOWN_CMD = 0x01, GT15_E_OUT_OF_RANGE = 0x02, GT15_E_BUSY = 0x03, GT15_E_NOT_ALLOWED = 0x04,
    GT15_E_CRC = 0x05, GT15_E_SEQUENCE = 0x06, GT15_E_FLASH = 0x07, GT15_E_LOCKED = 0x08, GT15_E_PARAM = 0x09
};

/* Overlay-Eintrag: Kennfeld-Daten im Flash und ihre RAM-Kopie */
typedef struct {
    uint32_t flash_addr;
    uint16_t len;
    uint8_t *ram;
} gt15_overlay_t;

/* Von der Konfiguration bereitzustellen (siehe gt15_cfg_example.c) */
extern const gt15_overlay_t gt15_overlays[];
extern const uint8_t gt15_overlay_count;
extern const char gt15_ident[];

/* --- API für die gepatchte Steuergeräte-Software --- */
void gt15_init(void);
/* Aus dem CAN-Empfangsinterrupt bzw. -polling für die IDs REQ und BULK aufrufen */
void gt15_can_rx(uint16_t id, const uint8_t *data, uint8_t dlc);
/* Zyklisch aufrufen (z.B. im 1-ms- oder 10-ms-Task), elapsed_ms = Zeit seit letztem Aufruf */
void gt15_task(uint16_t elapsed_ms);
/* In die Kennfeld-Lookup-Routine einhängen: liefert die aktive Datenquelle (Flash oder RAM-Kopie) */
uint32_t gt15_map_addr(uint32_t flash_addr);
/* Aktive Kalibrierseite (0 = Flash, 1 = RAM) */
uint8_t gt15_page(void);

uint16_t gt15_key(uint16_t seed);
uint16_t gt15_crc16(const uint8_t *d, uint16_t len);
uint32_t gt15_crc32_update(uint32_t crc, const uint8_t *d, uint16_t len);

#endif
