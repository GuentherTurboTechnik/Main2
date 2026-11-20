# Vorbild RACE15 Studio – was die machen und wo wir stehen

Quelle: öffentliche Seiten von SkaudeTuning (skaudetuning.com/race15/…: Übersicht, Features,
Compatibility, FAQ, Release Notes 0.2.11, Lizenzbedingungen), gelesen am 20.11.2026.
Nur öffentliche Angaben. Software, Firmware-Images und Kennfeld-Bibliothek von RACE15 sind
deren geistiges Eigentum und werden **nicht** übernommen oder analysiert. Wir übernehmen
nur Konzepte und Arbeitsabläufe.

## Architektur RACE15 (laut Hersteller)

| Thema | RACE15 | GT15 (wir) |
|---|---|---|
| Steuergeräte | EDC15VM+ 1.9 VP (038906012), 2.5 VP (074906018), EDC15P+ 1.9 PD (038906019) | EDC15VM+ / EDC15P+ ✓ |
| Firmware-Ansatz | **Ein mitgeliefertes RACE15-Image pro ECU-Gruppe** ersetzt die Original-Software, damit gleiche Kennfelder über alle SW-Stände einer Gruppe | Geplant: **Basis-Image pro Familie** (ein Original-SW-Stand pro Gruppe wird einmal gepatcht) |
| Erstinstallation | K-Line Write (KWP2000) im normalen Betrieb, kein Bootmodus nötig | offen (KKL über Web Serial geplant) |
| Wiederherstellung Original | Bootmodus (BSL); über K-Line geplant | BSL über K-Line |
| Interface | **J2534 PassThru, Treiber v04.04**: empfohlen Tactrix Openport 2.0, Scanmatik SM2-PRO, getestet auch Mongoose JLR. K-Line: ISO 9141 (KW1281, 5-Baud-Init) + ISO 14230 (KWP2000, Fast-Init) | **CANable (SLCAN) über Web Serial**, K-Line per KKL-Kabel. J2534 nur über lokales Hilfsprogramm möglich |
| Verkabelung | OBD-Buchse: vorhandene CAN-H/CAN-L-Leitungen **auftrennen** und buchsenseitig auf den **Antriebs-CAN** des Motorsteuergeräts legen | gleiche Empfehlung ✓ |
| CAN | 500 kbit/s, von der Firmware hinzugefügt | 500 kbit/s, GT15-CAN-Protokoll ✓ |
| Flash-Chip | CAN-Flash **nur AM29F400BT** (Top-Boot). M29F400BB (frühe Geräte, z.B. frühe 115-PS-P+) nur ohne CAN-Flash | Standard-Layout jetzt AM29F400BT ✓ |
| Sektoren | B0–B10. Per CAN beschreibbar: **B2–B10** („V24 loader“) | B0/B1 geschützt, B2–B10 per CAN ✓ |
| Unterbrochenes Flashen | Loader suchen, betroffenen Sektor mit Tune vergleichen, Job fortsetzen (B2–B10) | ✓ ECU bleibt im Loader, Tool erkennt das und setzt per CRC32-Vergleich fort |
| Auto Flash | Gespeicherte Änderungen werden automatisch geflasht, **ECU-Reset unterbricht kurz den Motorlauf**, Bedienung durch Beifahrer | offen: bei uns Flashen nur bei Motor aus. Dafür echtes Live-Tuning über RAM-Overlay |
| Prüfsummen | „korrigiert bestimmte frühe Prüfsummen beim Öffnen“, keine Garantie für alle | offen. Idee: im eigenen Image die Prüfsummenprüfung so anpassen, dass CAN-Flashen ohne Bosch-Korrektur geht |

## Funktionen

| Funktion | RACE15 | GT15 Stand |
|---|---|---|
| Logging | 50 Hz (auch 20/10 Hz), 80+ Signale gleichzeitig, feste Motorkanäle + **16 frei wählbare DAQ-Slots**, 1000+ benannte Signale | ✓ 50/20/10 Hz, bis 112 Byte pro Zyklus frei belegbar |
| Map-Tracing | 200+ Kennfelder, Marker mit **verblassender Spur**, Spurdauer einstellbar, Tabelle + 3D | ✓ Marker mit Gewichtung + Spur (Dauer einstellbar). 3D offen |
| Replay | Aufzeichnung mit synchronen Plots und Tracing abspielen | ✓ Wiedergabe mit Kacheln, Tracing und Cursor im Plot |
| CSV-Export | ✓ | ✓ |
| Kennfeld-Editor | Tabelle, 2D, 3D, physikalische Werte, Auswahl, Zwischenablage, Undo, Vergleich mit Original, geänderte Achsen markiert | ✓ Tabelle, Undo, Original-Vergleich. 2D/3D, Zwischenablage und Achsen-Editieren offen |
| Kennfeld-Gruppen | Kraftstoff, Ladedruck, Timing, Hardware, Stage 1/2, Suche, Favoriten, „geändert“-Filter | offen (Gruppen in Definitionsdatei) |
| Projekte | lokale Projekte, Checkpoints, BIN-Export | Bin laden/speichern ✓, Checkpoints offen |
| Tune Setup | MAP-Sensor-Skalierung, PD-Injektoren (Dauer/BIP), VP N146, Hella-Steller, Launch Control, No-Lift-Shift, Linksbremsen, Glühanlage (J370) | offen, braucht Firmware-Funktionen |
| Tune Review | Plausibilitätsprüfung Kraftstoff/Ladedruck/Rauch/Timing, z.B. Pumpgrenze Turbo | offen |
| N75 Auto Tuner | schlägt Tastverhältnis-Kennfeld aus Messwerten vor | offen |
| Diagnose | Fehlerspeicher, Stellglieddiagnose | offen (KWP über K-Line) |
| AGR | **AGR-Abschaltung gesperrt** (Emissionen) | wir übernehmen diese Haltung |
| Plattform | Windows-App (WebView2), Lizenz pro PC | Browser (Chrome/Edge), ohne Installation |

## Was wir daraus ableiten (Vorschläge)

1. **Basis-Image pro Familie** statt Patch pro SW-Stand: je ein VM+-Stand (038906012) und
   ein P+-Stand (038906019) als Grundlage. Kennfelder, Definitionsdatei und Patch werden nur
   einmal gepflegt. Die Bins von ALH (VM+) und AVF (P+) passen genau in diese Gruppen.
2. **Bootloader in B0/B1** mit Gültigkeitsprüfung beim Start: Ist die Applikation (B2–B10)
   unvollständig, bleibt die ECU im CAN-Loader und kann neu beschrieben werden.
3. **Prüfsummenprüfung im eigenen Image anpassen**, damit Kalibrieränderungen per CAN ohne
   externe Korrektur funktionieren. Für das Original-Bin braucht es trotzdem eine Korrektur.
4. **Interface:** CANable bleibt erste Wahl (günstig, direkt aus dem Browser). Optional
   später J2534-Unterstützung (Openport 2.0, SM2-PRO) über ein kleines lokales Hilfsprogramm.
5. Nächste Tool-Funktionen nach Priorität: 3D-Ansicht, Kennfeld-Gruppen und Suche,
   Checkpoints, Zwischenablage, Fehlerspeicher, Tune Setup.
