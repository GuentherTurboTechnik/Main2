# GT15 Studio – EDC15VM+ / EDC15P+ über CAN

Live-Daten, Map-Tracing, Logging, Echtzeit-Kalibrierung (RAM-Overlay) und Flashen
für gepatchte Bosch EDC15-Steuergeräte, direkt aus dem Browser über einen **CANable**.

```
PC (Chrome/Edge)                 USB              Fahrzeug
┌───────────────┐   Web Serial   ┌─────────┐  CAN-H/L 500k  ┌───────────────────┐
│ GT15 Studio   │ ─────────────► │ CANable │ ─────────────► │ EDC15 + GT15-Patch │
│ (web/)        │     SLCAN      │ (slcan) │   Antriebs-CAN │ (firmware/)        │
└───────────────┘                └─────────┘                └───────────────────┘
```

## Schnellstart (ohne Hardware)

1. `web/index.html` in Chrome oder Edge öffnen.
2. *Verbindung → Schnittstelle: Simulator → Verbinden*.
3. *Live-Daten → DAQ starten*, Pedal-Regler bewegen.
4. *Kennfelder → Fahrerwunsch → Seite: RAM*, Zellen markieren, `+` drücken: Die
   Einspritzmenge ändert sich sofort, das Tracing (orange) zeigt den aktiven Punkt.
5. *Flashen → Flash aus ECU lesen → (Kennfelder: RAM → Bin) → Flashen*. Nur geänderte
   Sektoren werden geschrieben und verifiziert.

## Mit echter Hardware

* **CANable** (oder kompatibel) mit **slcan**-Firmware, an CAN-H/CAN-L des Antriebs-CAN.
  Am bequemsten wie bei RACE15: die vorhandenen CAN-H/CAN-L-Leitungen der OBD-Buchse auftrennen
  und buchsenseitig auf den Antriebs-CAN des Motorsteuergeräts legen (Schaltplan beachten).
* Flash-Chip **AM29F400BT** für CAN-Flash (frühe Geräte mit M29F400BB: Chip-Aufdruck prüfen).
* Steuergerät mit GT15-Patch (siehe `firmware/README.md`). Erstinstallation über K-Line/BSL.
* Passende Definitionsdatei laden (`docs/DEFINITIONS.md`).

## Projektstruktur

| Pfad | Inhalt |
|------|--------|
| `web/` | PC-Oberfläche (reines HTML/JS, keine Installation, keine Abhängigkeiten) |
| `web/js/slcan.js` | SLCAN-Treiber über Web Serial |
| `web/js/protocol.js` | GT15-CAN-Client (Kommandos, DAQ, Flash) |
| `web/js/simulator.js` | Virtuelles EDC15 mit Motormodell, Overlays und Flash |
| `firmware/` | Protokollkern in C für den C167 + Host-Tests (`make -C firmware test`) |
| `docs/PROTOCOL.md` | Protokoll-Spezifikation |
| `docs/DEFINITIONS.md` | Format der Definitionsdateien |
| `docs/RACE15_VERGLEICH.md` | Vorbild RACE15 Studio: Konzepte, Vergleich, Ableitungen |

## Funktionen

* **Live-Daten:** bis 112 Byte pro Zyklus bei 50/20/10 Hz, Kacheln und 30-s-Verlauf
* **Map-Tracing:** aktive Stützstellen mit Interpolationsgewicht, verblassende Spur
* **Logging:** Aufzeichnung aller Kanäle inkl. Trace, CSV-Export, Wiedergabe mit Tracing
* **Kennfeld-Editor:** Auswahl, +/-, setzen, Prozent, Rückgängig, Änderungsmarkierung,
  Quelle ECU (live) oder Bin-Datei
* **Echtzeit:** RAM-Overlays mit Seitenumschaltung Flash/RAM, RAM → Bin übernehmen
* **Flashen über CAN:** Sektorvergleich per CRC32, nur geänderte Sektoren, Blöcke mit
  CRC16, Verifikation, Schutz von B0/B1, Drehzahlsperre, Fortsetzen nach Abbruch
* **Bus-Monitor:** Rohframes anzeigen, filtern und senden

## Offen / nächste Schritte

* Bosch-Prüfsummenkorrektur für EDC15 (Plugin-Schnittstelle im Flash-Reiter vorgesehen)
* SW-spezifische Analyse und HAL für den C167 (Hooks, Flash-Algorithmus, Bootloader)
* K-Line/BSL-Erstinstallation über KKL-Kabel (ebenfalls per Web Serial möglich)

> Eingriffe in die Motorsteuerung können die Betriebserlaubnis und die Abgaswerte
> betreffen. Nur für Motorsport, Prüfstand oder Entwicklung.
