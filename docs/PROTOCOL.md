# GT15-CAN Protokoll v1.0

Eigenes, schlankes Kalibrier- und Flash-Protokoll (angelehnt an CCP) für gepatchte
Bosch EDC15VM+ / EDC15P+ Steuergeräte (Infineon C167). Läuft auf dem Antriebs-CAN
mit **500 kbit/s**, 11-Bit-Identifier.

## 1. CAN-Identifier (Standard, konfigurierbar)

| Name | ID    | Richtung      | Inhalt                                   |
|------|-------|---------------|------------------------------------------|
| REQ  | 0x6E0 | Tool → ECU    | Kommandos (8 Byte)                        |
| BULK | 0x6E1 | Tool → ECU    | Rohdaten für Flash-Blöcke (8 Byte)        |
| RES  | 0x6E8 | ECU → Tool    | Antworten (8 Byte)                        |
| DAQ  | 0x6E9 | ECU → Tool    | Zyklische Messdaten (8 Byte)              |

Die IDs dürfen nicht mit Botschaften des Fahrzeugs kollidieren (VW Antriebs-CAN nutzt
u.a. 0x280, 0x288, 0x380, 0x388, 0x480, 0x488, 0x1A0, 0x320, 0x420, 0x5A0).
Vor dem Einsatz mit dem Bus-Monitor prüfen.

## 2. Rahmenformat

**Request (REQ):** `CMD SEQ P0 P1 P2 P3 P4 P5`
**Response (RES):** `STAT SEQ D0 D1 D2 D3 D4 D5`

* `SEQ` – Sequenzzähler, vom Tool vergeben, wird in der Antwort gespiegelt.
* `STAT`:
  * `0xFF` positive Antwort
  * `0xFE` Fehler, `D0` = Fehlercode
  * `0xFD` „pending“ – ECU arbeitet noch (z.B. Sektor löschen), Tool verlängert Timeout
* Adressen: 24 Bit, **Big Endian** im Telegramm (`A2 A1 A0`).
* Speicherinhalte (Messwerte, Kennfelder): **Little Endian** (C167-nativ).
* Nicht benutzte Bytes = 0x00. Frames immer DLC 8.

### Fehlercodes

| Code | Name            | Bedeutung                                         |
|------|-----------------|---------------------------------------------------|
| 0x01 | UNKNOWN_CMD     | Kommando unbekannt                                 |
| 0x02 | OUT_OF_RANGE    | Adresse/Länge nicht erlaubt                        |
| 0x03 | BUSY            | ECU beschäftigt                                    |
| 0x04 | NOT_ALLOWED     | Zustand verbietet es (z.B. Motor läuft, Bootsektor) |
| 0x05 | CRC_ERROR       | Prüfsumme des Datenblocks falsch                   |
| 0x06 | SEQUENCE_ERROR  | Falsche Reihenfolge (z.B. COMMIT ohne BLOCK)       |
| 0x07 | FLASH_ERROR     | Lösch-/Programmierfehler                           |
| 0x08 | LOCKED          | Nicht entsperrt (UNLOCK fehlt)                     |
| 0x09 | PARAM_ERROR     | Ungültiger Parameter                               |

## 3. Kommandos

### Sitzung

| CMD  | Name       | Parameter                    | Antwort-Daten                          |
|------|------------|------------------------------|----------------------------------------|
| 0x01 | CONNECT    | –                            | `VMAJ VMIN CAPS SEED_H SEED_L`         |
| 0x02 | UNLOCK     | `KEY_H KEY_L`                | `LEVEL`                                |
| 0x03 | DISCONNECT | –                            | –                                      |
| 0x04 | GET_ID     | `IDX`                        | 6 ASCII-Zeichen ab Offset `IDX*6`      |
| 0x05 | STATUS     | –                            | `PAGE MODE RPM_L RPM_H FLAGS`          |

* `CAPS` Bit0 = DAQ, Bit1 = RAM-Overlay, Bit2 = Flash, Bit3 = Tracing.
* `MODE` 0 = Applikation, 1 = Boot-/Flashmodus.
* `FLAGS` Bit0 = entsperrt, Bit1 = DAQ aktiv.
* Nur CONNECT, UNLOCK, GET_ID und STATUS sind im gesperrten Zustand erlaubt.

**Seed/Key** (Platzhalter – vor Einsatz in Firmware *und* Tool ändern):

```
key = (rotl16(seed XOR 0x4754, 3) + 0x1F15) AND 0xFFFF
```

### Speicherzugriff

| CMD  | Name     | Parameter              | Antwort-Daten          |
|------|----------|------------------------|------------------------|
| 0x10 | SET_MTA  | `A2 A1 A0`             | –                      |
| 0x11 | UPLOAD   | `N` (1..6)             | `N` Bytes ab MTA, MTA += N |
| 0x12 | DOWNLOAD | `N` (1..5) `D0..D4`    | – , MTA += N           |
| 0x13 | SHORT_UP | `N` (1..6) `A2 A1 A0`  | `N` Bytes ab Adresse   |

* UPLOAD/SHORT_UP lesen RAM und Flash. Liegt die Adresse in einem Overlay-Bereich und
  ist Seite RAM aktiv, wird die RAM-Kopie gelesen.
* DOWNLOAD schreibt **nur** in Overlay-Bereiche (Flash-Adresse wird auf die RAM-Kopie
  umgeleitet). Das Flash selbst wird nie per DOWNLOAD verändert.

### Messdaten (DAQ) und Map-Tracing

| CMD  | Name      | Parameter                 | Antwort-Daten              |
|------|-----------|---------------------------|----------------------------|
| 0x20 | DAQ_CLEAR | –                         | –                          |
| 0x21 | DAQ_ADD   | `SIZE A2 A1 A0` (SIZE 1/2/4) | `INDEX TOTAL_BYTES`     |
| 0x22 | DAQ_START | `PER_H PER_L` (ms, 5..1000) | `NFRAMES`                |
| 0x23 | DAQ_STOP  | –                         | –                          |

* Maximal 112 Byte (16 Frames × 7 Byte) pro Zyklus.
* DAQ-Frame auf ID DAQ: `HDR D0..D6`, `HDR = (CNT << 4) | FRAME_IDX`.
  `CNT` (0..15) zählt pro Zyklus hoch, alle Frames eines Zyklus tragen denselben `CNT`.
  Die Signale sind in der Reihenfolge von DAQ_ADD lückenlos gepackt.

**Tracing:** Die gepatchte Kennfeld-Interpolationsroutine schreibt für jedes
getracte Kennfeld einen 4-Byte-Slot ins RAM:

```
Byte 0: X-Index (Stützstelle links)    Byte 1: X-Anteil (0..255 → 0..1)
Byte 2: Y-Index (Stützstelle unten)    Byte 3: Y-Anteil (0..255)
```

Das Tool nimmt diese Slots einfach als `SIZE=4` in die DAQ-Liste auf.

### Kalibrierung (RAM-Overlay)

| CMD  | Name        | Parameter | Antwort-Daten               |
|------|-------------|-----------|-----------------------------|
| 0x30 | SET_PAGE    | `PAGE` (0 = Flash, 1 = RAM) | –             |
| 0x31 | CAL_INIT    | –         | – (alle Overlays Flash → RAM kopieren) |
| 0x32 | GET_OVERLAY | `IDX`     | `A2 A1 A0 LEN_H LEN_L` (Fehler OUT_OF_RANGE am Listenende) |

Mit `PAGE = 1` benutzt die Motorsteuerung die RAM-Kopien der Kennfelder → Änderungen
wirken sofort („Echtzeit“). Dauerhaft übernommen werden sie, indem das Tool die
Overlay-Werte in das Bin übernimmt und den Sektor per Flash-Ablauf neu schreibt.

### Flash

| CMD  | Name        | Parameter                    | Antwort-Daten      |
|------|-------------|------------------------------|--------------------|
| 0x40 | PROG_ENTER  | `FLAGS` (Bit0 = bei laufendem Motor erlaubt) | `MAXBLOCK_H MAXBLOCK_L` |
| 0x41 | PROG_ERASE  | `A2 A1 A0` (Sektorstart)     | – (vorher 0xFD pending) |
| 0x42 | PROG_BLOCK  | `A2 A1 A0 LEN_H LEN_L`       | –                  |
| 0x43 | PROG_COMMIT | `CRC_H CRC_L`                | – (vorher 0xFD pending) |
| 0x44 | CHECKSUM    | `A2 A1 A0 L2 L1 L0`          | `CRC32` (4 Byte, Big Endian) |
| 0x4F | RESET       | –                            | – (danach Neustart) |

Ablauf:

1. `PROG_ENTER` – standardmäßig nur bei stehendem Motor (Drehzahl 0). Mit `FLAGS` Bit0
   auch bei laufendem Motor (**Auto Flash**, wie RACE15): Der Motor geht dabei aus bzw. setzt
   nach dem Reset kurz aus. ECU stoppt DAQ und Endstufen, springt in den Flash-Bootloader.
2. Pro Sektor: `CHECKSUM` vergleichen → bei Gleichheit überspringen.
3. `PROG_ERASE` (Bootsektor wird mit NOT_ALLOWED abgelehnt).
4. Pro Block (max. 256 Byte, gerade Länge): `PROG_BLOCK` → Tool sendet
   `ceil(LEN/8)` Frames auf BULK (je 8 Datenbytes, letzter Frame mit 0xFF aufgefüllt)
   → `PROG_COMMIT` mit CRC16 über die `LEN` Datenbytes. Blöcke, die nur 0xFF enthalten,
   werden übersprungen.
5. `CHECKSUM` über den Sektor zur Verifikation.
6. `RESET`.

### Prüfsummen

* **CRC16**: CCITT, Poly 0x1021, Init 0xFFFF, keine Reflexion, kein XOR-Out.
* **CRC32**: IEEE 802.3 (Poly 0x04C11DB7 reflektiert, Init/XOR-Out 0xFFFFFFFF).

Hinweis: Diese Prüfsummen sichern nur die Übertragung. Die **Bosch-internen
Prüfsummen der EDC15-Software** müssen vor dem Flashen separat im Bin korrigiert werden.

## 4. Timeouts (Empfehlung)

| Vorgang       | Timeout                       |
|---------------|-------------------------------|
| Standard      | 200 ms                        |
| PROG_ERASE    | 3000 ms, jede 0xFD-Antwort verlängert |
| PROG_COMMIT   | 1000 ms, jede 0xFD-Antwort verlängert |
