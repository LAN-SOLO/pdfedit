# pdfedit — Produkt- und Implementierungsplan

Ein vollwertiger PDF-Editor für macOS, Windows und Linux, der die Messlatte
von PDF Expert (UX), PDF24 (kostenlose Werkzeugkiste) und Acrobat Pro
(vollständige Bearbeitung, Standards) zusammen nimmt — nativ, lokal und
auch für Linux, wo es diese Klasse sonst praktisch nicht gibt. **Free**
bleibt dauerhaft kostenlos und voll nutzbar; **pdfedit inked** (12 €/Jahr =
1 €/Monat) schaltet die vollständige Bearbeitung frei.

Produktseite: https://lan-solo.com/de/tools/pdfedit/

## 1. Produktdefinition

### Pläne & Preise (fixiert, siehe Landing Page)

| | Free | inked |
|---|---|---|
| Preis | 0 € (dauerhaft) | 12 €/Jahr (1 €/Monat) |
| Lesen & Navigation (Tabs, Suche, Lesezeichen) | ✓ | ✓ |
| Anmerkungen nach ISO 32000 (Kommentare, Markierungen, Stempel, Freihand, Formen) | ✓ | ✓ |
| Formulare ausfüllen (AcroForms) & flach rechnen | ✓ | ✓ |
| Signieren (Bild + digitale Signatur PAdES) | ✓ | ✓ |
| Seiten organisieren: zusammenführen, teilen, drehen, umsortieren, komprimieren | ✓ | ✓ |
| **Text bearbeiten mit Umbruch, Bilder & Vektorobjekte** | — | ✓ |
| **OCR** (gescannte PDFs durchsuchbar & editierbar) | — | ✓ |
| **Echtes Schwärzen** (Inhalte entfernen, nicht überdecken) + Metadaten-Reinigung | — | ✓ |
| Formulare erstellen/bearbeiten | — | ✓ |

### Alleinstellungsmerkmale

1. **Linux als First-Class-Plattform:** Acrobat Pro und PDF Expert existieren
   dort nicht — pdfedit liefert die volle Editor-Klasse auf allen drei OS.
2. **Anmerkungen wirklich standardkonform:** alles wird als ISO-32000-
   Annotations gespeichert und bleibt in Acrobat & Co. sichtbar UND dort
   weiter editierbar — kein proprietäres Overlay.
3. **Ehrliches Schwärzen:** Redaction entfernt Inhalte tatsächlich aus dem
   Content-Stream (inkl. Text unter Bildern nach OCR) statt schwarze
   Rechtecke darüberzulegen.
4. **Lokal & privat:** keine Cloud-Pflicht, kein Konto, keine Telemetrie —
   Verträge und Personalunterlagen verlassen das Gerät nicht.

### Harte Randbedingungen (ehrlich einplanen!)

- **Textbearbeitung hat physikalische Grenzen:** PDFs betten oft nur
  Font-Subsets ein. Fehlende Zeichen ersetzt pdfedit aus dem passendsten
  System-Font und kennzeichnet das sichtbar — wir versprechen keine
  pixelidentische Reproduktion fremder Layouts in jedem Fall.
- **Keine 1:1-Acrobat-Parität von Tag 1:** Maßstab ist die PDF-Spezifikation
  (ISO 32000), nicht jede Acrobat-Nische (JavaScript-Formulare, XFA). XFA
  ist deprecated und wird nur angezeigt/konvertiert, nicht editiert.
- **Digitale Signaturen:** PAdES-Signaturen erstellen und prüfen ja —
  qualifizierte Signaturen (QES) brauchen externe Anbieter/Hardware und
  kommen später über Schnittstellen, nicht als Eigenbau-Versprechen.
- **Lokal rechnen:** OCR und Komprimierung laufen auf dem Gerät — gleiche
  Disziplin wie bei [[secrets]], [[keypile]], [[packed]] und [[file-port]].

## 2. Engine & Bibliotheken (Rust-Core)

| Baustein | Ansatz/Crate | Phase |
|---|---|---|
| Rendering | `pdfium-render` (Chrome-PDF-Engine, batteriegeprüft) | 0 |
| Parsen/Schreiben (inkrementell) | `lopdf` + eigene Objektmodell-Schicht | 0 |
| Anmerkungen (ISO 32000 Annots) | eigenes Modell auf lopdf, Serialisierung spec-konform | 1 |
| Formulare (AcroForms) | lopdf + Feldmodell; Flatten via pdfium | 1 |
| Text-Editing/Reflow | eigener Content-Stream-Editor + `harfbuzz`/`rustybuzz` Shaping | 3 |
| OCR | `tesseract` (leptess) lokal, Sprachpakete nachladbar | 3 |
| Schwärzen | Content-Stream-Rewrite + Bild-Rasterung der Region | 3 |
| Signaturen | `openssl`/`rustls` + PAdES (ETSI EN 319 142) | 2 |
| Komprimierung | Bild-Resampling + Objektstrom-Optimierung | 2 |

## 3. Architektur

```
pdfedit/
├── core/       # Rust: Objektmodell, Annots, Formulare, Redaction, OCR-Anbindung
├── cli/        # pdfedit-CLI (merge/split/compress/ocr) — treibt den Core
└── src-tauri/  # Desktop-App (Tauri 2, wie keypile/packed/file-port)
```

- **UI-Leitbild (PDF-Expert-Klasse):** Tabs, durchgehende Seitenleiste
  (Thumbnails/Gliederung/Anmerkungsliste), ein Werkzeugband das nach
  Kontext wechselt (Lesen ↔ Anmerken ↔ Bearbeiten), alles per Tastatur
  erreichbar, Dark/Light. Rendering im Canvas mit Tiling für große Dokumente.
- **Updates:** In-App-Updater steht bereits (signiert, Changelog vorab).

## 4. Roadmap

- **Phase 0 — Shell & Renderer:** App-Grundgerüst ✅; PDF-Anzeige ✅
  (v0.2.0: öffnen per Dialog/Drag & Drop, lazy Rendering, Zoom, Fit-Width —
  pragmatisch über pdf.js im Webview; die Rust-Engine mit pdfium übernimmt
  das Rendering, sobald die Bearbeitungs-Phasen sie ohnehin brauchen).
  Noch offen: Tabs ✅ (v0.3.0), Suche ✅ (v0.4.0).
- **Phase 1 — Anmerken (v0.4.0):** ISO-32000-Annotationseditor über pdf.js'
  eigenen `PDFViewer`/`AnnotationEditorUIManager` (dieselbe Engine wie
  Firefox' PDF-Viewer): Markieren (Highlight), Freitext/Notiz, Zeichnen
  (Ink), Bild-Stempel, Unterschrift; Suche im Dokument über
  `PDFFindController`. Speichern über `pdfDocument.saveDocument()` bäckt
  alle Änderungen in echte, Acrobat-lesbare Annotationsobjekte (verifiziert:
  `/Subtype /Highlight` mit QuadPoints, Farbe, Appearance-Stream). AcroForm-
  Formularfelder rendern bereits interaktiv (pdf.js' `ENABLE_FORMS`), volles
  Ausfüllen/Speichern folgt als nächster Schritt.
  **Wichtige Lektion:** Ein gezeichneter, aber noch nicht committeter Strich
  hängt in einer „laufenden Editier-Sitzung" — Tab-Wechsel/Speichern muss
  den Editor-Modus zurücksetzen UND auf das (asynchrone!)
  `annotationeditormodechanged`-Event warten, sonst geht der Strich
  stillschweigend verloren. Zusätzlich: „dirty" muss schon beim ersten
  Pointerdown in einem Zeichenwerkzeug gesetzt werden, nicht erst nach dem
  Commit — sonst bricht die Dirty-Prüfung den Commit-Versuch selbst ab.
  **Bild-Stempel und Unterschrift bewusst (noch) nicht im Werkzeugkasten:**
  pdf.js' eingebaute Editoren dafür erwarten die volle Firefox-Viewer-Chrome
  (Datei-Picker-Anbindung, Zeichnen/Tippen/Hochladen-Dialog) — ohne die
  reagieren die Werkzeuge zwar nicht mit einem Absturz, aber auch mit
  nichts. Kommt als eigener, selbst gebauter Dialog zurück (mit dem
  Formulare/Signieren-Meilenstein).
- **Phase 2a — Seiten organisieren (v0.5.0):** Eigenes Miniaturansichten-Panel
  (`PagesPanel.tsx`, da pdf.js' Standalone-`PDFViewer` keinen
  Thumbnail-Viewer exportiert — Seiten werden selbst per `page.render()` in
  kleine Canvases gerendert). Umsortieren (Auf/Ab statt Drag&Drop — robuster
  und leichter testbar), Drehen (90°-Schritte), Löschen, leere Seite
  einfügen, weitere PDF anhängen (Merge), Seitenauswahl als neue Datei
  exportieren. Alles über pdf-lib (`copyPages`, `addPage`, `setRotation`) —
  „Übernehmen" ersetzt das Arbeitsdokument im Speicher (macht dirty, kein
  Diskzugriff), der Export-Button schreibt sofort eine neue Datei.
  **Zwei weitere Lektionen:** (1) `PDFViewer.cleanup()` räumt nur
  unfertige Renderings weg, nicht die DOM — beim Dokumentaustausch im
  selben Tab (Übernehmen/Checkpoint) muss der Viewer-Container manuell
  geleert werden, sonst rendern alte und neue Seiten übereinander. (2) React
  18 StrictMode führt State-Updater-Funktionen im Dev-Modus absichtlich
  doppelt aus, um Nebenwirkungen aufzudecken — ein Nebeneffekt (Seiten
  laden) innerhalb eines `setSources`-Updaters führte zu doppelt
  angehängten Seiten beim Merge (nur im Dev-Server sichtbar, Produktions-
  Build ist nicht betroffen, aber der Code war trotzdem unsauber und wurde
  korrigiert).
### Weg zum letzten Beta-Release (Stand 2026-08-18)

Ab hier: jede Phase = eine getaggte, gebaute, auf dem Test-Mac installierte
und funktional verifizierte Version, bevor die nächste beginnt — genau wie
v0.2.0–v0.5.0. Kein Phasenwechsel ohne grünen `cargo check`, grünen
Frontend-Build und mindestens einen echten Bearbeiten-Speichern-Neuladen-
Zyklus im Browser plus (wo relevant) Byte-Level-Kontrolle der gespeicherten
Datei. Reihenfolge nach Risiko: Tractable-und-hoher-Nutzen zuerst, die zwei
wirklich schwierigen Brocken (OCR, Text-/Bildbearbeitung) zuletzt, mit
entsprechend mehr Testzeit.

- **v0.6.0 — Formulare ✅:** AcroForm-Ausfüllen rendert über pdf.js'
  `ENABLE_FORMS` bereits interaktiv — mit einer per pdf-lib erzeugten
  echten Formular-Testdatei verifiziert (Textfeld + Checkbox, beide
  ausgefüllt, gespeichert, `/AS /Yes` und der Feldwert im gespeicherten
  PDF bestätigt). Neu: „Formular flach rechnen" (Button erscheint nur,
  wenn `pdfDocument.getFieldObjects()` echte Felder findet) — bäckt die
  Werte per pdf-lib `form.flatten()` dauerhaft in die Seite ein; danach
  keine Formularfelder mehr, Inhalt bleibt aber echter, durchsuchbarer
  Text (per Volltextsuche 1/1-Treffer bestätigt, nicht nur optisch).
  **Lektion:** Bei pdf-lib-generierten PDFs liegen Dictionary-Objekte oft
  in komprimierten Object-Streams — rohes Byte-Grep auf `/AcroForm` &Co.
  liefert dort systematisch falsche Negative. Für Struktur-Verifikation
  entweder dekomprimieren oder (robuster) die App selbst über pdf.js
  live parsen lassen. Zweite Lektion: beim wiederholten Testen mit
  gleichem Dateinamen im Download-Ordner immer prüfen, ob wirklich die
  neue Datei vorliegt, nicht eine alte gleichen Namens von einem
  früheren Testlauf — hat hier für eine ganze Verifikationsrunde eine
  falsche Fährte gelegt.
- **v0.7.0 — Stempel & Signatur ✅ (eigener Dialog):** Ersetzt die in v0.4.0
  entfernten kaputten pdf.js-Werkzeuge durch echte, selbst gebaute: Bild
  auswählen (Datei-Dialog) oder Unterschrift zeichnen/eingeben (Canvas/
  Schreibschrift-Font) → als Bild in eine neue Annotationsebene auf die
  Seite platzieren, verschieben/skalieren, dauerhaft in `saveDocument()`
  eingebacken. Bewusst *visuelle* Signatur, keine kryptografische PAdES —
  das bleibt laut Produktdefinition ein späteres, externes-Anbieter-Thema
  und wird im Dialog auch so benannt (keine falschen Versprechen).
  Technisch über pdf.js' eigene (undokumentierte, aber stabile)
  `AnnotationEditorLayer.pasteEditor(options, params)`-API gelöst: liefert
  man ihr ein `bitmapFile` (unser erzeugtes PNG), erzeugt sie denselben
  voll interaktiven Stempel-Editor (Greifpunkte, Alt-Text-Button) wie
  pdf.js' eigene Werkzeuge — spart eine komplette Drag/Resize-Eigenbau-UI.
  Alle drei Modi (Zeichnen, Eintippen, Bild) einzeln bis zum Byte-Level
  verifiziert: platziert → gespeichert → Datei frisch neu geöffnet →
  eingebrannter, nicht-interaktiver Stempel bestätigt, plus Struktur-Check
  (`/Subtype /Image`-XObject im gespeicherten PDF vorhanden).
  **Lektion 1 (Z-Index-Konflikt):** pdf.js' eigene schwebende Editor-UI
  (Greifpunkte, Alt-Text-/Löschen-Button eines ausgewählten Editors) nutzt
  Z-Index bis 100001 — eigene Modals müssen darüber liegen, sonst fangen
  pdf.js' Buttons Klicks/Drags ab, die dem eigenen Dialog galten. Fix:
  `.overlay { z-index: 100010; }` mit Kommentar im CSS.
  **Lektion 2 (Canvas-Verifikation):** Ein erster Pixel-Check auf „nicht-
  weiß" (`data[i] < 250`) zählte transparente Canvas-Pixel fälschlich als
  „gezeichnet" mit, weil deren Alpha=0-Standard einen R-Wert von 0 liefert
  — meldete 100 % „gezeichnete" Fläche auf einer leeren Canvas. Robuster
  Check muss den Alpha-Kanal einbeziehen (`alpha>200 && rot<50` = echt
  gezeichnet, `alpha===0` = transparenter Hintergrund).
  **Lektion 3 (Test-Werkzeug-Grenze, keine App-Grenze):** Das synthetische
  `left_click_drag` des Browser-Test-Tools erzeugt zu wenige echte
  Pointermove-Zwischenereignisse, damit die eigene Zeichenlogik (die auf
  kontinuierliches `pointermove` angewiesen ist, wie eine echte Maus es
  liefert) einen Strich zieht — bestätigt durch direktes Dispatchen einer
  vollständigen Pointer-Event-Sequenz per JS, die zuverlässig zeichnet.
  Kein Bug im Produkt, nur eine Einschränkung des Testwerkzeugs bei
  einzelnen, groben Drag-Gesten.
- **v0.8.0 — Komprimierung ✅:** Eigener Dialog mit drei Presets
  (schnell/ausgewogen/klein = Skalierung 85/65/45 % + JPEG-Qualität
  82/72/55 %). Bewusst auf eingebettete Plain-JPEGs (`/Filter /DCTDecode`,
  kein Filter-Array) beschränkt — der mit Abstand häufigste Platzfresser
  in echten PDFs (Scans, Fotos). Roh-Sample-Bitmaps (FlateDecode-Pixel),
  JPEG2000, CCITT-Fax und mehrfach gefilterte Streams bleiben unangetastet,
  statt eine schwer verifizierbare verlustbehaftete Pixel-Rekonstruktion
  für diese Fälle zu riskieren. Technisch: pdf-lib low-level (`PDFRawStream`,
  `context.assign`) ersetzt den Bild-XObject-Stream in-place am selben Ref —
  jede Seite, die dasselbe (geteilte) Bild referenziert, sieht automatisch
  die neue Version. Dekodieren/Neukodieren läuft über die Browser-eigene
  Canvas-Pipeline (`createImageBitmap` → `canvas.drawImage` → `toBlob`),
  keine externe Bildbibliothek nötig. Nur wenn das Ergebnis wirklich
  kleiner ist als das Original wird ersetzt (einzelne Bilder still
  übersprungen, sonst nichts).
  Verifiziert bis zum Byte-Level: Dict-Werte (`/Width`, `/Height`,
  `/ColorSpace`, `/Filter`) nach der Kompression exakt wie erwartet
  (inkl. zweimal hintereinander angewendeter Presets — 1024→666→300 px,
  exakte erwartete Rundung beider Skalierungsfaktoren), der eingebettete
  JPEG-Stream selbst per `createImageBitmap` echt dekodiert und auf die
  richtige Pixelgröße geprüft (kein korrupter Stream), „keine Bilder
  gefunden"-Pfad an einem reinen Text-PDF bestätigt (Dokument bleibt
  unverändert, nicht dirty).
  **Lektion:** Der Browser-„Speichern"-Download (`<a download>` auf eine
  Blob-URL) ist beim automatisierten Testen unzuverlässig, sobald die
  Browser-Erweiterung selbst kurz die Verbindung verliert (reisst dabei
  auch den React-App-Zustand komplett zurück auf die Startseite — kein
  Bug im Produkt, die Erweiterung trennt/lädt dabei die Seite neu).
  Robuster Verifikationsweg: `URL.createObjectURL` im Seitenkontext
  kurzzeitig abfangen und die tatsächlich gespeicherten Bytes direkt
  auslesen, statt auf die Ankunft einer Datei im Downloads-Ordner zu
  warten.
- **v0.9.0 — Schwärzen ✅ (inked):** Eigenes Werkzeug „Schwärzen" — Rechteck(e)
  direkt über der pdf.js-Seite aufziehen (eigener Overlay, nicht pdf.js'
  Annotationssystem), „Anwenden" rastert jede markierte Seite **komplett**
  neu (via pdf.js, gleiche Technik wie Pages-Panel-Thumbnails) mit den
  Markierungen bereits als deckend schwarze Rechtecke in die Pixel
  gemalt, dann ersetzt eine brandneue pdf-lib-Seite (nicht die alte
  mutiert) die betroffene Seite komplett — kein Leftover-Content-Stream,
  keine `/Annots` (Formularfelder/Notizen auf der Seite sind mit weg).
  AcroForm-Feldwerte auf betroffenen Seiten werden vor dem Rastern über
  das bestehende `form.flatten()` (v0.6.0) gebacken, sonst blieben sie im
  Feld-Dict extrahierbar, obwohl unsichtbar. Bestätigungsdialog
  (irreversibel, mit Auflistung was mitentfernt wird) + optionale
  Metadaten-Reinigung (Autor/Titel/Thema/Stichwörter/Ersteller-Programm +
  XMP-Metadatenstream).
  Bis zum Byte-Level verifiziert: Ziel-Textzeile nach dem Schwärzen mit 0
  extrahierbaren Text-Items auf der betroffenen Seite (`getTextContent()`),
  andere Seite unverändert durchsuchbar, exakte Pixel-Stichprobe an der
  erwarteten Koordinate (94 % reines Schwarz vs. 100 % Weiß in einer
  Kontrollregion), XMP-Stream nach Bereinigung im rohen Datei-Byte-Strom
  nicht mehr auffindbar (nicht nur die Referenz entfernt).
  **Lektion 1 (pdf-lib-Objektmüll):** Nur die Catalog-Referenz auf den
  XMP-Metadata-Stream zu löschen reicht nicht — pdf-lib serialisiert beim
  Speichern alle registrierten Objekte, nicht nur die vom Trailer aus
  erreichbaren. Das verwaiste Objekt muss zusätzlich explizit aus dem
  `PDFContext` gelöscht werden (`context.delete(ref)`), sonst stehen die
  XMP-Rohdaten trotzdem noch in der Datei.
  **Lektion 2 (Testumgebung, kein Produktfehler):** `page.render()` hängt
  in Chrome komplett, wenn der automatisierte Tab laut
  `document.visibilityState` nicht sichtbar ist (im Hintergrund/verdeckt)
  — Chrome pausiert `requestAnimationFrame` für unsichtbare Tabs, worauf
  pdf.js' mehrstufiges Rendering angewiesen ist. Reproduziert mit einem
  von der App komplett unabhängigen Minimal-Snippet; sobald der Tab
  sichtbar war, lief derselbe Aufruf sofort durch. Betraf in diesem
  Zustand auch das längst ausgelieferte Pages-Panel (dessen Thumbnails
  aus demselben Grund hingen) — kein Hinweis auf einen echten Regressions-
  Bug dort, nur ein Beleg dafür, dass Rendering-Verifikation einen
  sichtbaren Browser-Tab braucht.
- **v0.9.1 — UI/UX-Überarbeitung ✅:** Auf ausdrücklichen Wunsch vor OCR
  eingeschoben — Nutzer-Feedback direkt am laufenden Beta-Build: reine
  Text-Buttons ohne Icons wirkten unübersichtlich, nicht am Niveau
  etablierter PDF-Tools (PDF Expert, Acrobat, Preview). Eigenes,
  handgezeichnetes SVG-Icon-Set (keine neue Abhängigkeit) für alle
  Werkzeuge/Aktionen; neue dauerhafte Seitenleiste mit Seiten-
  Miniaturansichten (Klick springt zur Seite) statt nur per Modal
  erreichbar — Reorder/Rotieren/Zusammenführen bleibt im bestehenden
  Pages-Dialog, der jetzt über die Seitenleiste erreichbar ist. Werkzeug-
  Leiste in klare Gruppen sortiert (Anmerken | Dokument-Aktionen) mit
  Trenner; „aktives Werkzeug" bekommt einen eigenen, dezenten Akzent-Stil
  statt denselben kräftigen Blauton wie der Speichern-Button zu teilen —
  vorher standen beide optisch im selben Rang, was die eigentliche
  Haupt-Aktion (Speichern) verwässerte. Zoom/Fit-Kontrollen als
  zusammengefasste „Segmented"-Gruppe statt lose Einzel-Buttons.
  Getestet bis zur Fenster-Untergrenze (860px) — Werkzeugleiste scrollt
  dort horizontal statt zu brechen. Nebenbei: veralteten Beta-Text auf
  dem Startbildschirm korrigiert (nannte Formulare/Signieren/Bearbeitung
  noch als „kommend", obwohl seit v0.6.0–v0.9.0 bereits ausgeliefert).
- **v0.10.0 — OCR ✅ (inked):** `tesseract.js` 7.0.0, komplett lokal — Worker-
  Skript, WASM-Core (nur die LSTM-Varianten: Basis, SIMD, RelaxedSIMD;
  die Nicht-LSTM-Legacy-Varianten werden nicht gebraucht, da
  `tessdata_fast` reine LSTM-Trainingsdaten sind) und die Sprachdaten für
  Deutsch/Englisch (`tesseract-ocr/tessdata_fast`, ~5,5 MB zusammen)
  liegen als statische Assets unter `public/tessdata/` (~28 MB Gesamt-
  paket) — standardmäßig lädt tesseract.js alle drei von einem jsDelivr-
  CDN, das haben wir über `workerPath`/`corePath`/`langPath` + `gzip:
  false` explizit auf die lokalen Pfade umgebogen. Dafür musste die CSP
  in `tauri.conf.json` um `script-src 'self' 'wasm-unsafe-eval'` ergänzt
  werden (WebAssembly-Kompilierung braucht dieses Schlüsselwort, getrennt
  von und schwächer als `'unsafe-eval'`).
  Der eigentliche OCR-Dialog: Bereich (aktuelle Seite/alle Seiten) +
  Sprachauswahl, läuft Seite für Seite (rendert via pdf.js wie beim
  Schwärzen, erkennt Text via tesseract.js, legt pro erkanntem Wort einen
  unsichtbaren Textblock exakt an dessen Position). Technisch spannendster
  Teil: pdf-lib kennt keine „unsichtbarer Text"-Option in `drawText()` —
  das ist der PDF-native Text-Rendering-Modus 3 (`Tr`-Operator), den es
  nur als Low-Level-Operator-Baustein gibt (`page.pushOperators
  (setTextRenderingMode(TextRenderingMode.Invisible))` vor den
  `drawText()`-Aufrufen). Zusätzlich wird pro Wort die Schriftgröße aus
  der erkannten Bounding-Box-Höhe abgeleitet und die Breite per
  `Tz`-Operator (`setCharacterSqueeze`) auf die exakt gemessene
  Bounding-Box-Breite gestaucht/gestreckt — sonst passen Auswahlrahmen
  beim Markieren nicht zum sichtbaren Wort, obwohl der Text stimmt.
  Bis zum Byte-Level verifiziert: erkannter Text exakt wortgleich mit
  einem synthetisch erzeugten „Scan" (Text als Rasterbild ohne echte
  Textebene, vorher 0 Text-Items bestätigt), `getTextContent()` nach OCR
  liefert den vollständigen Text, Content-Stream nach Dekomprimierung
  bestätigt den `3 Tr`-Operator direkt vor den Wort-Objekten, frisches
  Neu-Rendering der gespeicherten Datei zeigt keine sichtbaren Artefakte
  (Text bleibt echt unsichtbar, keine doppelte Darstellung).
  **Lektion:** Größter Einzel-Brocken wie erwartet — aber die eigentliche
  Schwierigkeit lag nicht bei WASM/Worker-Integration (die lief nach der
  Recherche zu den lokalen Pfaden im ersten Anlauf durch), sondern bei
  der PDF-nativen Unsichtbar-Text-Konvention (Tr 3 statt Opacity 0, plus
  Tz-Streckung für Positionstreue) — genau der Teil, der beim
  oberflächlichen Testen (nur „wird Text gefunden?") unauffällig geblieben
  wäre, aber bei einem Byte-Level-Check sofort aufgefallen ist.
- **v0.11.0 — Acrobat-Parität: Formulare erstellen, digital signieren,
  Passwortschutz, Werkzeug-Eigenschaften ✅:** Vier Feature-Blöcke in einem
  Release, alle vorab als Node-Prototyp gegen die echten Module verifiziert,
  dann im Browser-E2E:
  - **Werkzeug-Eigenschaften-Leiste:** Bei Markieren/Text/Zeichnen erscheint
    eine Leiste mit Farbfeldern und Slidern (Text: Farbe+Größe; Zeichnen:
    Farbe+Stärke+Deckkraft; Markieren: Farbe+Stärke). Technisch über
    `AnnotationEditorUIManager.updateParams()` (erreichbar via
    `pdfViewer._layerProperties.annotationEditorUIManager` — gleiche
    Stabilitätsklasse wie `_pages`). Wirkt auf die Auswahl ODER als Default
    für neue Anmerkungen. **Lektion:** `INK_OPACITY` erwartet in pdf.js v6
    die 0–1-Skala (`(opacity ?? 1) * 255` im Alpha-Picker), nicht 0–100 wie
    im alten Viewer-Toolbar-Code. Grenze ehrlich dokumentiert: Schriftart/
    Ausrichtung des FreeText-Editors sind in pdf.js fest — steht so im
    Handbuch, nicht versteckt.
  - **Formularfelder erstellen** (`formFields.ts` + Drag-Platzierung wie beim
    Schwärzen): Textfeld/mehrzeilig/Kontrollkästchen/Auswahlliste als echte
    AcroForm-Felder via pdf-lib (`createTextField` …, `addToPage` mit
    y-Flip aus Seiten-Prozenten). Feldnamen-Vorschlag (`feld_N`) wird schon
    während des Aufziehens berechnet; Namenskollision → verständliche
    Meldung, Dialog bleibt offen. Sofort ausfüllbar (ENABLE_FORMS),
    Flachrechnen-Button erscheint automatisch.
  - **Digitale Signatur** (`sign.ts` + SignDialog): PKCS#12 (.p12/.pfx) via
    node-forge — funktioniert mit modernen (AES/PBES2) UND legacy (3DES)
    Dateien. Placeholder low-level über pdf-lib (Sig-Dict + Widget + 
    AcroForm/SigFlags, `useObjectStreams: false` für literale Offsets),
    ByteRange-Fixup, CMS `adbe.pkcs7.detached` mit SHA-256 und signierten
    Attributen (contentType, messageDigest, signingTime). Kryptografisch
    selbst-verifiziert (messageDigest == Digest der ByteRanges; RSA über
    DER(SET der signedAttrs) prüft gegen Signer-Zertifikat). Sichtbares
    Feld (aufziehen, Appearance mit Name/Datum) oder unsichtbar; Dialog
    zeigt nach Zertifikat+Passwort sofort CN/Aussteller/Gültigkeit. Nach dem
    Signieren werden die Bytes UNVERÄNDERT auf Platte geschrieben (kein
    Resave — der würde als „nach Signatur geändert" auffallen). Kombination
    mit Passwortschutz bewusst blockiert (Verschlüsseln würde die Signatur
    brechen) — klare Meldung statt kaputter Datei.
  - **Passwortschutz** (`protect.ts` + ProtectDialog + PasswordPrompt):
    pdf-lib gegen den Fork `@cantoo/pdf-lib` 2.9.1 getauscht (Alias
    `pdf-lib@npm:@cantoo/pdf-lib` — alle bestehenden Imports/Low-Level-
    Nutzungen unverändert). Setzen/Ändern: AES-256 mit User-/Owner-Passwort
    und Berechtigungen (Drucken/Kopieren/Ändern/Ausfüllen/Kommentieren,
    per pdf.js `getPermissions()` byte-genau bestätigt). Geschützte PDFs:
    Öffnen-Prompt (falsches Passwort → Meldung, richtiges → auf), Arbeits-
    kopie wird IM SPEICHER entschlüsselt (alle Werkzeuge funktionieren
    ohne Passwort-Durchreichen), Speichern verschlüsselt wieder mit dem
    bekannten Passwort („geerbter Schutz", im Dialog so benannt) — bis
    „Passwort entfernen" unverschlüsselt speichert.
    **Lektion (Fork-Innereien):** Nach `load(bytes, {password})` bleiben
    drei Leichen im Objekt-Kontext, die einen Resave vergiften: das alte
    /Encrypt-Dict, alte /ObjStm-Rohströme (Ciphertext) und der alte
    XRef-Stream als PDFInvalidObject — dessen Dict (`/Encrypt 7 0 R`)
    wird beim nächsten Parse wieder als Trailer-Info eingelesen und lässt
    die „entschlüsselte" Datei erneut als verschlüsselt erscheinen.
    `decryptPdf()` räumt alle drei plus `trailerInfo.Encrypt` ab.
  - Außerdem: Update-Zugang überall (Hilfe-Fenster hat jetzt Footer mit
    Version + „Nach Updates suchen"/Update-Button; Tabbar zeigt bei
    verfügbarem Update einen Button; ?-FAB bekommt einen Badge-Punkt),
    Tutorial um zwei Schritte erweitert und `SEEN_KEY` auf v2 — zeigt sich
    nach dem Update einmalig erneut. Handbuch: drei neue Kapitel
    (Formularfelder, Digital signieren, Passwort & Berechtigungen) + 
    „Anmerken & Eigenschaften". Die vier Drag-Modi (Schwärzen, Bereich,
    Formularfeld, Signaturfeld) teilen sich jetzt einen `useRegionDrag`-
    Hook statt vier Kopien.
    **Lektion (Testumgebung):** Ein Vite-Dev-Server aus einer FRÜHEREN
    Session hielt Port 1420 und servierte das alte pdf-lib-Prebundle —
    `doc.encrypt is not a function`, obwohl Quellcode und node_modules
    längst richtig waren. Bei „Modul-API fehlt im Browser, in Node aber
    da" zuerst `lsof -iTCP:<port>` prüfen, nicht den eigenen Code.
- **v0.11.2 — Inhalte ändern: Textzeilen editieren, Systemschriften,
  Wasserzeichen, Seiten-DnD, Blur-Schwärzen ✅:**
  - **Text ändern (`textEdit.ts` + TextEditDialog):** Klick auf eine
    bestehende Textzeile (Lokalisierung über pdf.js' Text-Layer, funktioniert
    bei jedem digital erzeugten PDF) → Dialog mit vorbefülltem Zeilentext,
    Schrift-/Größen-/Farbwahl (inkl. freiem Farbwähler). Original wird mit
    der vom Canvas GESAMPELTEN Hintergrundfarbe überdeckt, Ersatz als echter
    Text geschrieben (durchsuchbar, mit eingebetteter Wunschschrift).
    Grenzen stehen im Dialog UND Handbuch (Original bleibt unsichtbar in der
    Datei; Laufweite nicht immer exakt). Größenschätzung: Text-Layer-Spans
    sind exakt fontgroß → Zeilen-BBox-Höhe ≈ Punktgröße (14pt-Probe: 14.5).
  - **Systemschriften fürs Text-Werkzeug:** Rust-Kommandos
    `list_system_fonts`/`read_font` (TTF/OTF, macOS/Windows/Linux-Pfade),
    Live-Preview via FontFace; beim Speichern regeneriert
    `freetextFont.ts` die FreeText-Appearance mit der via fontkit
    eingebetteten Schrift (pdf.js selbst kennt keinen Font-Parameter).
    **Lektion:** fontkits Subsetter crasht an manchen System-TTFs (Apples
    Arial) — und zwar erst bei save(). Deshalb Subset-Probe in einem
    Wegwerf-Dokument, Fallback Voll-Einbettung (`embedChosenFont`).
  - **Unsichtbares Wasserzeichen (`watermark.ts`):** PNG mit Transparenz,
    opacity 0 auf gewählte/alle Seiten + /LSWM-Seiteneintrag (SHA-256 des
    PNG, Positionsindex, Zeitstempel). Prüfen-Tab meldet Seiten ohne
    Marke (= möglicherweise ausgetauscht), Positionsabweichungen
    (= umsortiert), gemischte Hashes und optional Abgleich gegen das
    Original-PNG. Ehrlich beschriftet: Alltags-Manipulationserkennung,
    kein Kryptobeweis. Byte-verifiziert: Austausch/Umsortierung/Fremd-PNG
    werden alle erkannt, `/ca 0` bestätigt Unsichtbarkeit.
  - **Seiten-DnD in der Seitenleiste (`pages.ts`):** Flacher /Kids-Reorder
    in-place — Formularfelder überleben (byte-verifiziert), Fallback
    copyPages bei verschachtelten Bäumen. **Lektion:** pdf-libs
    removePage+insertPage mit derselben PDFPage korrumpiert den Seitenbaum
    („kid reference points to wrong type") — Kids-Array direkt umsortieren.
  - **Schwärzen mit Verpixeln:** Mosaik (runterskalieren + hochskalieren
    ohne Smoothing, Blockgröße ≥16px im 3x-Raster) als Alternative zu
    Schwarz; Warnung im Dialog, dass verpixelter Text rekonstruierbar sein
    kann.
  - **Laufende Update-Prüfung:** Check zusätzlich alle 4 h + beim
    Fenster-Fokus (30-min-Drossel); Auto-Dialog genau einmal pro gefundener
    Version, danach Badge/Tabbar/Hilfe-Footer. Löschen-Icon der
    Editor-Toolbar: WKWebView-Fallback als selbstenthaltenes
    background-image (Maske+light-dark() unangetastet, nur überstimmt).
  - **Wichtiger Genauigkeits-Fix für ALLE Overlay-Modi:** `.page` trägt
    einen 9px-transparenten Rahmen — Prozentwerte gegen die .page-Box
    landeten sichtbar daneben (bei 33 % Zoom ≈ eine Zeile zu tief).
    Neuer Anker `pageAnchor()` = `.canvasWrapper` (rahmenlos, exakt
    canvasgroß, per CSS position:relative) für Drag-Regionen UND
    Overlay-Marker (Schwärzen, Bereich, Formularfeld, Signatur, Textzeile).
  - **Lektion (Testumgebung, zwei Stunden gekostet):** pdf.js baut
    Text-/Editor-Layer erst, wenn der Tab SICHTBAR ist — in
    Hintergrund-Tabs der Browser-Automation „hängt" der Aufbau beliebig
    lange und CDP-Evaluates laufen in Timeouts. Erst ein Screenshot (macht
    den Tab kurz aktiv) lässt die Layer entstehen. Zusätzlich hielt ZWEIMAL
    ein alter Vite-Server aus einer früheren Session den Port und servierte
    veraltete Prebundles („doc.encrypt is not a function", obwohl Quelle
    korrekt). Regel: Bei Browser-E2E immer zuerst `lsof -iTCP:<port>`
    prüfen und vor Layer-Abfragen einen Screenshot machen.
- **v0.11.3 — Formaterhaltendes Text-Editieren ✅ (das Killerfeature-
  Fundament):** „Text ändern" arbeitet jetzt run-basiert statt zeilen-
  basiert und erhält die Formatierung:
  - **Erkennung über `getTextContent` statt DOM-Spans:** exakte Baseline,
    Breite und Punktgröße pro Text-Item direkt aus dem Content-Stream;
    der Klick trifft den einheitlich formatierten RUN (fettes Label und
    regulärer Wert einer Zeile sind getrennt editierbar). Die
    Originalschrift kommt als echter PostScript-Name über
    `page.commonObjs.get(item.fontName).name` (z. B. „Helvetica-Bold",
    „BAAAAA+TimesNewRomanPS-BoldMT"), Ascent/Descent aus `tc.styles`.
  - **`fontMatch.ts`:** PS-Name → Familie + Fett/Kursiv (Subset-Präfix,
    MT/PS-Suffixe, CamelCase-Spacing; „Roman" bewusst nicht gestrippt,
    sonst wird „TimesNewRoman" zu „Times New"). Matching in drei Stufen:
    exakt installiert → Familien-Treffer → Standard-Ersatz derselben
    Klasse, inkl. Metrik-Zwillinge (Arial↔Helvetica, TimesNewRoman↔Times,
    CourierNew↔Courier zählen als Familien-Treffer). Der Dialog sagt,
    welche Stufe griff („Passende Schrift installiert" / „Nächster
    Treffer" / „Ersatz — Laufweite kann abweichen").
  - **Alle 12 Base-14-Schnitte** als Standard-Tier (`StdFontKey`),
    Fett/Kursiv-Erkennung wählt automatisch den richtigen Schnitt vor
    (verifiziert: Helvetica-Bold→„Helvetica Fett", -Oblique→„Kursiv").
  - **Exakte Reproduktion:** Ersatz an der Original-Baseline mit
    Originalgröße; Textfarbe wird aus den Canvas-Pixeln des Runs
    gesampelt (dunkelster Wert), Hintergrund als Mehrheitsfarbe. Ist der
    neue Text breiter als der Original-Run, wird die Laufweite per
    `Tz`-Operator (setCharacterSqueeze, wie beim OCR-Layer) bis minimal
    82 % verdichtet — byte-verifiziert: „Auftragsnummer" (96,1 pt natur)
    landet auf 87,1 pt im 86,6-pt-Slot, Nachbar-Run-Position unverändert.
  - **Rust liest echte Font-Namen:** eigener `name`-Table-Parser (Familie,
    Schnitt, voller Name; 64-KiB-Head reicht) — das Font-Dropdown zeigt
    „Arial — Bold" statt Datei-Stems mit Hash-Suffixen, und das Matching
    bekommt saubere Familiennamen. Unit-Test gegen Apples Arial.ttf.
  - **Lektion (Browser-E2E):** Das Tutorial-Overlay (SEEN_KEY-Bump!)
    fängt nach jedem frischen Origin den ersten Klick ab — vor jedem
    E2E-Lauf `.hlp-close` klicken.
- **v0.11.4 — Objekte-Panel & Feinschliff-Runde ✅ (User-Feedback-Batch):**
  - **Objekte-Panel:** Seitenleiste mit zwei Tabs („Seiten"/„Objekte").
    Der Objekte-Tab listet Sitzungs-Anmerkungen (über pdf.js'
    `uiManager.getEditors(page)` — ein Generator! — mit `id`,
    `constructor._type`, `div.textContent` als Label) und die
    Formularfelder des Dokuments (`listFormFields` via pdf-lib inkl.
    Widget-Rect→Seiten-Zuordnung). Klick = `setSelected` (nach
    Modus-Wechsel + ~150 ms, der Wechsel ist async), × = `ui.delete()`
    (undo-fähig; Liste braucht einen verzögerten Zweit-Refresh, pdf.js
    hängt den Editor asynchron aus). Felder: Klick öffnet den
    FormFieldDialog im Edit-Modus (updateFormField = remove+recreate am
    selben Widget-Rect), × löscht via `form.removeField`. Photoshop-artige
    Gruppen/Z-Reihenfolge bewusst Roadmap — steht so im Handbuch.
  - **Select-Werkzeug lässt wirklich los:** `unselectAll()` beim Wechsel
    auf Auswahl — vorher blieben Stempel-Griffe sichtbar und ein aktives
    Freihand-Markieren konnte weiterzeichnen.
  - **Voller Farbwähler überall:** `<input type="color">` neben den
    Swatches für Markieren/Text/Zeichnen (und im Text-ändern- und
    Stempel-Dialog). Verifiziert: pdf.js akzeptiert freie
    Highlight-Farben jenseits der konfigurierten Preset-Liste
    (Editor.color = #8b5cf6).
  - **Schwärzen: echtes Weichzeichnen** als dritte Variante (zweistufiges
    geglättetes Down/Upscale — funktioniert ohne ctx.filter überall),
    Verpixeln bleibt, Warnhinweis gilt für beide.
  - **„Bearbeiten" → „Ersetzen"** (der Button beschrieb nie Bearbeitung),
    Ersatztext im Bereich jetzt oben-links, max. 18 pt, mit Umbruch statt
    boxhoher Riesenbuchstaben.
  - **Stempel-Tippen ausgebaut:** Schriftwahl (Schreibschrift, Handschrift,
    Serifen, Serifenlos, Marker), Größe, Farbe inkl. Farbwähler; Canvas
    wird passgenau zum Text bemessen (2x für Schärfe).
  - **Formularfelder entschärft:** einzeilige Felder und Dropdowns bekommen
    Standard-Kontrollhöhe (18–32 pt, oben im aufgezogenen Kasten) und
    feste 11-pt-Schrift statt riesiger Auto-Skalierung; Checkboxen auf
    26 pt gedeckelt.
  - **Löschen-Icon der Editor-Toolbar, dritter Anlauf:** Das
    ::before-Pseudo-Element entsteht in WKWebView offenbar gar nicht
    (pdf.js' Nesting-Regeln) — Icon liegt jetzt als background-image
    direkt auf dem Button, ::before wird unterdrückt.
- **v0.11.5 — Hotfix „Text ändern" in der Desktop-App ✅:** In der
  WKWebView der App (NICHT in Chrome, NICHT in Playwright-WebKit 26.5 —
  beides reproduzierte fehlerfrei, inkl. eines Nachbaus mit eingebetteten
  Subset-Fonts) warf der Klick-Pfad „TypeError: undefined is not a
  function (near '...i of t...')" — die WebKit-Signatur eines for-of über
  etwas Nicht-Iterierbares. Da die exakte Stelle aus dem Screenshot nicht
  hervorgeht: kompletter Klick-Pfad defensiv umgebaut (Index-Schleifen
  statt for-of, Array.isArray-Guard auf getTextContent().items,
  Destrukturierungen von convertToPdf/ViewportPoint durch Indexzugriffe
  ersetzt, Map-Iteration via forEach) — die Fehlerklasse ist damit
  konstruktiv ausgeschlossen. Zusätzlich enthält der Fehler-Toast von
  „Text ändern" jetzt die oberste Stack-Zeile, damit ein etwaiger
  Restfehler per Screenshot exakt lokalisierbar ist.
  **Neues Testwerkzeug:** Playwright-WebKit (scratchpad/wkrepro) — echte
  WebKit-Engine headless für WKWebView-Paritätstests; hätte künftige
  Safari-only-Bugs vor dem Release gefangen und gehört in jeden
  E2E-Durchlauf vor dem Tagging.
- **v0.12.0 — Text- & Bildbearbeitung (inked, pragmatischer Ansatz):** Ein
  echter Content-Stream-Editor (bestehenden Text an Ort und Stelle
  umfließen lassen) ist ein Mehrmonatsprojekt für sich und würde das
  Zeitfenster bis zum Beta sprengen. Pragmatischer, ehrlich kommunizierter
  Ansatz stattdessen: Klick auf bestehenden Text/ein Bild → Region wird
  gerastert abgedeckt (Originalinhalt weg) + eine editierbare Ersatzbox
  (Text mit bestmöglich passender Schriftgröße/-farbe, oder neues Bild)
  wird exakt darüber platziert. Kein Reflow über Absatzgrenzen hinweg,
  keine Vektor-Objektbearbeitung — das steht so auch im Dialog und im
  Disclaimer, nicht nur im Kleingedruckten.
- **v0.13.0 — Letztes Beta: Politur & Gate:** Free/inked-Kennzeichnung in
  der UI (welche Werkzeuge zu welchem Tier gehören — Bezahl-Backend folgt
  separat, hier nur ehrliche UI-Kennzeichnung), Tastaturkürzel für die
  wichtigsten Aktionen, Fehlerbehandlung/Robustheit-Durchgang (jede
  Dialog-/Speicher-Fehlerpfad geprüft), Menüleiste nativ (macOS/Windows/
  Linux), finaler Regressionsdurchlauf aller Phasen v0.2.0–v0.12.0 an
  einem einzigen Dokument nacheinander. Danach beginnt der intensive Test.

## 5. Website

Produktseite (beide Sprachen) im Website-Repo unter
`app/[lang]/tools/pdfedit/` + `components/pdfedit/PdfEditPage.tsx`;
Texte in `i18n/DE.ts`/`EN.ts` (`pdfEdit`), Icon `public/brand/pdfedit.svg`.
Beta-Downloads laufen über die stabilen Release-Aliase
(`pdfedit-macos-arm64.dmg` …) — gleiche Mechanik wie packed/file-port.
