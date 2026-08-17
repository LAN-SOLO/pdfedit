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
- **v0.7.0 — Stempel & Signatur (eigener Dialog):** Ersetzt die in v0.4.0
  entfernten kaputten pdf.js-Werkzeuge durch echte, selbst gebaute: Bild
  auswählen (Datei-Dialog) oder Unterschrift zeichnen/eingeben (Canvas/
  Schreibschrift-Font) → als Bild in eine neue Annotationsebene auf die
  Seite platzieren, verschieben/skalieren, dauerhaft in `saveDocument()`
  eingebacken. Bewusst *visuelle* Signatur, keine kryptografische PAdES —
  das bleibt laut Produktdefinition ein späteres, externes-Anbieter-Thema
  und wird im Dialog auch so benannt (keine falschen Versprechen).
- **v0.8.0 — Komprimierung:** Bild-Downsampling/Requalifizierung beim
  Speichern (Presets „schnell/ausgewogen/klein"), Dateigröße spürbar
  senken ohne Textqualität zu verlieren (nur eingebettete Bilder anfassen).
- **v0.9.0 — Schwärzen (inked):** Bereich markieren → Seite an der Stelle
  wirklich rastern (Inhalt darunter entfernt, nicht nur überdeckt) +
  Bestätigungsdialog (irreversibel) + Metadaten-Reinigung (Autor/Titel/
  XMP) als Option. Reuse der Pages-Panel-Thumbnail-Rendering-Technik.
- **v0.10.0 — OCR (inked):** `tesseract.js` (WASM, lokal, kein Netzwerk)
  legt eine unsichtbare, durchsuchbare Textebene über gescannte Seiten.
  Start mit Deutsch + Englisch, weitere Sprachpakete nachladbar. Größter
  Einzel-Brocken bisher (WASM-Worker-Integration, Sprachdaten-Bundling in
  Tauri) — entsprechend mehr Testzeit einplanen.
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
