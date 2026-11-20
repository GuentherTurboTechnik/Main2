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
   Hooks per Hex-Patch setzen. Danach die **Bosch-Prüfsummen** korrigieren.
6. **Erstinstallation** über K-Line/BSL. Ab dann läuft alles über CAN mit GT15 Studio.
7. **Definitionsdatei** (`docs/DEFINITIONS.md`) für diese SW-Version erstellen.

## Hinweise

* `stdint.h`: Fehlt es im Compiler, die Typen `uint8_t`, `uint16_t` und `uint32_t` selbst definieren.
* `gt15_can_rx()` läuft im ISR-Kontext. `PROG_ERASE`, `PROG_COMMIT` und `CHECKSUM`
  blockieren, sind aber nur im Bootmodus bzw. bei stehendem Motor sinnvoll. `CHECKSUM` in
  der Applikation ggf. in den Task verlagern.
* Seed/Key in `gt15_key()` **und** `web/js/protocol.js` durch eigenes Geheimnis ersetzen.
