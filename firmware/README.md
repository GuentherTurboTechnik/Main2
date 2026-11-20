# GT15 Firmware-Patch für EDC15VM+ / EDC15P+

Das Konzept: Die originale Bosch-Software bleibt erhalten. Sie wird **gepatcht**, nicht
ersetzt. Eigener Code kommt in freie Flash-Bereiche, und an wenigen Stellen werden
Sprünge in diesen Code eingesetzt (Hooks).

```
┌────────────────── Original-Software ──────────────────┐
│ CAN-Empfangs-ISR ──hook──► gt15_can_rx()               │
│ 10-ms-Task       ──hook──► gt15_task(10)               │
│ Kennfeld-Lookup  ──hook──► gt15_map_addr() + Trace-Slot │
└────────────────────────────────────────────────────────┘
         │                         │
         ▼                         ▼
   RAM-Overlays             Flash-Bootloader (RAM-Code)
 (Echtzeit-Kalibrierung)    Erase/Program 29Fxxx über CAN
```

## Inhalt

| Datei | Zweck |
|-------|-------|
| `src/gt15.c/.h` | Portabler Protokollkern (C90), komplett nach `docs/PROTOCOL.md` |
| `src/gt15_hal.h` | Plattform-Schnittstelle, für den C167 zu implementieren |
| `src/gt15_cfg_example.c` | Beispiel: Kennung + Overlay-Tabelle (Platzhalter-Adressen!) |
| `test/host_test.c` | Host-Test mit emuliertem Speicher/Flash/CAN (`make test`) |

## Basis-Image pro Familie (wie RACE15)

Nicht jeder SW-Stand wird einzeln gepatcht. Pro ECU-Gruppe wird **ein** Original-Stand als
Basis gewählt und einmal gepatcht. Alle Steuergeräte der Gruppe bekommen dieses Image:

| Gruppe | Familie | Motoren | Basis (von uns) |
|---|---|---|---|
| 038906012 | EDC15VM+ | 1.9 TDI VP 90/110 PS (z.B. ALH) | ALH-Datenstand |
| 038906019 | EDC15P+ | 1.9 TDI PD 100–160 PS (z.B. AVF) | AVF-Datenstand |
| 074906018 | EDC15VM+ | 2.5 TDI VP | später |

Vorteil: Einsprungstellen, Kennfeld-Adressen, Definitionsdatei und Prüfsummen werden nur einmal
gepflegt. Fahrzeugspezifisches (MAP-Sensor, Injektoren …) wird über Kennfelder/Schalter eingestellt.

## Flash-Aufteilung (AM29F400BT)

| Sektor | Inhalt | per CAN beschreibbar |
|---|---|---|
| B0, B1 (je 64 KB) | Reset-Vektoren, Start-Code, **GT15-CAN-Loader** | nein |
| B2–B10 | Applikation und Kalibrierung | ja |

Beim Start prüft der Loader die Gültigkeit der Applikation (CRC über B2–B10 bzw. Marker). Ist
sie ungültig (z.B. unterbrochenes Flashen), bleibt die ECU im Loader und meldet `MODE = 1`.
GT15 Studio erkennt das beim Verbinden und setzt den Flashvorgang fort.

> M29F400BB (Bottom-Boot, in manchen frühen Geräten) hat ein anderes Sektor-Layout und wird
> für CAN-Flash vorerst nicht unterstützt, genau wie bei RACE15.

## Schritte für ein echtes Steuergerät

1. **Original sichern:** Den Dump per K-Line/BSL auslesen (z.B. mit NefMoto, Galletto
   oder einem KKL-Kabel) und doppelt ablegen. Software-Nummer notieren.
2. **Analyse** (pro SW-Version einmalig), mit Ghidra/IDA und C166-Prozessormodul:
   * CAN-Controller-Init und Empfangs-ISR finden (C167CR: Message-Objekte ab `0xEF10`).
   * Freie Message-Objekte für REQ/BULK (Empfang) und RES/DAQ (Senden) wählen.
   * Zyklischen Task (z.B. 10 ms) finden.
   * Kennfeld-Interpolationsroutine(n) finden. Bei EDC15 werden Kennfelder über
     Zeiger/Deskriptoren adressiert. Dort `gt15_map_addr()` einschleifen und die
     berechneten Stützstellen-Indizes/-Anteile in die Trace-Slots schreiben.
   * Freien RAM (für Overlays, DAQ-Puffer, Trace-Slots) und freien Flash finden.
3. **HAL implementieren:** `hal_can_send`, `hal_mem_read` (huge-Pointer), `hal_rpm`
   (Drehzahl-Variable der Original-Software), Flash-Algorithmus für den verbauten
   29F400/29F800 (Bottom-/Top-Boot beachten), `hal_enter_boot`.
4. **Bootloader:** Während Erase/Program kann aus dem Flash kein Code laufen. Deshalb
   kopiert `hal_enter_boot()` die Flash-Routinen und eine minimale CAN-Empfangsschleife
   ins interne RAM und arbeitet dort weiter. Der Sektor mit Reset-Vektor und Bootloader
   wird nie gelöscht. Fällt der Flash-Vorgang aus, bleibt die ECU im Bootloader
   ansprechbar. Als letzte Rettung bleibt immer der C167-BSL über K-Line.
5. **Bauen:** Mit Keil C166 oder Tasking für die freie Flash-Adresse linken und
   Hooks per Hex-Patch setzen. Danach die **Bosch-Prüfsummen** korrigieren. Im Image die
   Prüfsummenprüfung so anpassen, dass spätere Kalibrieränderungen per CAN ohne externe
   Korrektur laufen.
6. **Erstinstallation** über K-Line (KWP2000 im normalen Betrieb, wie RACE15) oder BSL.
   Ab dann läuft alles über CAN mit GT15 Studio.
7. **Definitionsdatei** (`docs/DEFINITIONS.md`) für diese SW-Version erstellen.

## Hinweise

* `stdint.h`: Fehlt es im Compiler, die Typen `uint8_t`, `uint16_t` und `uint32_t` selbst definieren.
* `gt15_can_rx()` läuft im ISR-Kontext. `PROG_ERASE`, `PROG_COMMIT` und `CHECKSUM`
  blockieren, sind aber nur im Bootmodus bzw. bei stehendem Motor sinnvoll. `CHECKSUM` in
  der Applikation ggf. in den Task verlagern.
* Seed/Key in `gt15_key()` **und** `web/js/protocol.js` durch eigenes Geheimnis ersetzen.
