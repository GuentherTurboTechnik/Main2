/*
 * GT15 – Plattform-Schnittstelle. Für das echte Steuergerät in C167-spezifischem Code
 * implementieren (CAN-Message-Objekte, huge-Pointer, Flash-Algorithmus 29Fxxx).
 */
#ifndef GT15_HAL_H
#define GT15_HAL_H

#include <stdint.h>

/* CAN-Frame senden (DLC 8). Darf nicht blockieren; ggf. in TX-Queue legen. */
void hal_can_send(uint16_t id, const uint8_t *d8);

/* Speicher lesen (RAM oder Flash). 0 = ok, sonst Adresse ungültig. */
uint8_t hal_mem_read(uint32_t addr, uint8_t *dst, uint16_t n);

/* Aktuelle Motordrehzahl in 1/min (für Sicherheitsabfrage vor dem Flashen) */
uint16_t hal_rpm(void);

/* Zufallswert für den Seed (z.B. aus Timer-Register) */
uint16_t hal_random(void);

/* Flash-Geometrie: Sektor zu Startadresse. 0 = gültig. is_boot = 1 für geschützte Sektoren. */
uint8_t hal_sector_info(uint32_t sector_addr, uint32_t *len, uint8_t *is_boot);
/* Prüft, ob [addr, addr+len) komplett im Flash liegt und keinen Bootsektor berührt */
uint8_t hal_flash_range_ok(uint32_t addr, uint32_t len, uint8_t allow_boot);

/* Applikation anhalten (Endstufen aus, Interrupts außer CAN aus) und Flash-Code aus RAM ausführen */
void hal_enter_boot(void);
/* Sektor löschen / Daten programmieren (blockierend). 0 = ok. */
uint8_t hal_flash_erase(uint32_t sector_addr);
uint8_t hal_flash_program(uint32_t addr, const uint8_t *data, uint16_t len);

/* Neustart (Watchdog oder SRST) */
void hal_reset(void);

#endif
