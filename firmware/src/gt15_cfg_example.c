/*
 * Beispielkonfiguration – an die jeweilige Software-Version (SW-Nr.) anpassen!
 * Die Adressen hier sind PLATZHALTER und stammen aus dem Simulator.
 * Echte Adressen ergeben sich aus der Analyse des Original-Dumps (Kennfeldsuche + Disassembly).
 */
#include "gt15.h"

const char gt15_ident[] = "GT15 0281010XXX EDC15P+ V1.0";

/* RAM-Kopien: freien, vom Original nicht genutzten RAM verwenden (Linker-Section / feste Adresse) */
static uint8_t ovl_driver_wish[160];   /* Fahrerwunsch 10x8 u16 */
static uint8_t ovl_smoke[160];         /* Rauchbegrenzer 10x8 u16 */
static uint8_t ovl_boost[160];         /* Ladedruck-Soll 10x8 u16 */
static uint8_t ovl_soi[160];           /* Spritzbeginn 10x8 s16 */
static uint8_t ovl_torque[20];         /* Drehmomentbegrenzer 10x1 u16 */

const gt15_overlay_t gt15_overlays[] = {
    { 0x0D1000ul, sizeof(ovl_driver_wish), ovl_driver_wish },
    { 0x0D1200ul, sizeof(ovl_smoke),       ovl_smoke },
    { 0x0D1400ul, sizeof(ovl_boost),       ovl_boost },
    { 0x0D1600ul, sizeof(ovl_soi),         ovl_soi },
    { 0x0D1800ul, sizeof(ovl_torque),      ovl_torque },
};
const uint8_t gt15_overlay_count = sizeof(gt15_overlays) / sizeof(gt15_overlays[0]);
