# Definitionsdatei (JSON)

Pro Software-Version eine Datei. Sie beschreibt, was GT15 Studio anzeigt und wohin es
schreibt. Adressen dürfen als Zahl oder als `"0x..."`-String angegeben werden.
Im Tool unter *Verbindung → Simulator-Beispiel → Exportieren* bekommt man eine Vorlage.

```json
{
  "name": "EDC15P+ 0281010XXX",
  "flashBase": "0x080000",
  "flashSize": "0x80000",
  "sectors": [["0x080000","0x10000"], ["0x090000","0x10000"], ["0x0A0000","0x10000"], ["0x0B0000","0x10000"],
              ["0x0C0000","0x10000"], ["0x0D0000","0x10000"], ["0x0E0000","0x10000"], ["0x0F0000","0x8000"],
              ["0x0F8000","0x2000"], ["0x0FA000","0x2000"], ["0x0FC000","0x4000"]],
  "bootSectors": ["0x080000", "0x090000"],
  "channels": [
    { "id": "rpm", "name": "Drehzahl", "addr": "0xF000", "size": 2, "factor": 1, "unit": "1/min", "min": 0, "max": 5000, "dec": 0 }
  ],
  "maps": [
    {
      "id": "driverWish", "name": "Fahrerwunsch", "unit": "mg/H", "factor": 0.01, "size": 2, "signed": false,
      "data": "0x0D1000",
      "x": { "addr": "0x0D0F00", "n": 10, "factor": 1,    "unit": "1/min", "label": "Drehzahl" },
      "y": { "addr": "0x0D0F20", "n": 8,  "factor": 0.01, "unit": "%",     "label": "Pedal" },
      "trace": "0xF100"
    }
  ]
}
```

| Feld | Bedeutung |
|------|-----------|
| `flashBase` | Adresse von Byte 0 der Bin-Datei im ECU-Adressraum |
| `sectors` | `[Start, Länge]` aller Flash-Sektoren, angezeigt als B0…B10. Standard: AM29F400BT (Top-Boot). Frühe Geräte mit M29F400BB haben ein anderes Layout! |
| `bootSectors` | Werden nie gelöscht oder beschrieben |
| `channels[]` | Messwerte: `phys = roh * factor + offset`, `size` 1/2/4, `signed` |
| `maps[].data` | Startadresse der Kennfeld-Werte (zeilenweise, Y-Zeilen × X-Spalten, Little Endian) |
| `maps[].x/y` | Achsen (Stützstellen). `y: null` = Kennlinie (1D) |
| `maps[].trace` | RAM-Adresse des 4-Byte-Trace-Slots (optional) |

Hinweis: Bei EDC15 stehen Achsen und Kennfeldgröße oft direkt vor den Daten im Flash.
Die Adressen werden pro Software-Version ermittelt, z.B. per Kennfeldsuche im Hex-Editor
oder anhand vorhandener Damos/Map-Packs.
