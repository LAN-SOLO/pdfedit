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
- **v0.11.0 — Text- & Bildbearbeitung (inked, pragmatischer Ansatz):** Ein
  echter Content-Stream-Editor (bestehenden Text an Ort und Stelle
  umfließen lassen) ist ein Mehrmonatsprojekt für sich und würde das
  Zeitfenster bis zum Beta sprengen. Pragmatischer, ehrlich kommunizierter
  Ansatz stattdessen: Klick auf bestehenden Text/ein Bild → Region wird
  gerastert abgedeckt (Originalinhalt weg) + eine editierbare Ersatzbox
  (Text mit bestmöglich passender Schriftgröße/-farbe, oder neues Bild)
  wird exakt darüber platziert. Kein Reflow über Absatzgrenzen hinweg,
  keine Vektor-Objektbearbeitung — das steht so auch im Dialog und im
  Disclaimer, nicht nur im Kleingedruckten.
- **v0.12.0 — Letztes Beta: Politur & Gate:** Free/inked-Kennzeichnung in
  der UI (welche Werkzeuge zu welchem Tier gehören — Bezahl-Backend folgt
  separat, hier nur ehrliche UI-Kennzeichnung), Tastaturkürzel für die
  wichtigsten Aktionen, Fehlerbehandlung/Robustheit-Durchgang (jede
  Dialog-/Speicher-Fehlerpfad geprüft), Menüleiste nativ (macOS/Windows/
  Linux), finaler Regressionsdurchlauf aller Phasen v0.2.0–v0.11.0 an
  einem einzigen Dokument nacheinander. Danach beginnt der intensive Test.

## 5. Website

Produktseite (beide Sprachen) im Website-Repo unter
`app/[lang]/tools/pdfedit/` + `components/pdfedit/PdfEditPage.tsx`;
Texte in `i18n/DE.ts`/`EN.ts` (`pdfEdit`), Icon `public/brand/pdfedit.svg`.
Beta-Downloads laufen über die stabilen Release-Aliase
(`pdfedit-macos-arm64.dmg` …) — gleiche Mechanik wie packed/file-port.
