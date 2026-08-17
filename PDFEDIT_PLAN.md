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
- **Phase 1 — Anmerken (Free-Kern):** ISO-32000-Annotations komplett,
  Anmerkungsliste, Formulare ausfüllen, inkrementelles Speichern.
- **Phase 2 — Organisieren & Signieren:** Seiten zusammenführen/teilen/
  drehen/umsortieren, Komprimierung, PAdES-Signatur. → Beta-Ausbau.
- **Phase 3 — inked:** Text-Editing mit Reflow, Bilder/Vektoren, OCR,
  echtes Schwärzen, Formular-Designer. → Verkaufsstart inked.
- **Phase 4 — Feinschliff:** Export (Word/Bilder), Batch-CLI, QES-Anbindung.

## 5. Website

Produktseite (beide Sprachen) im Website-Repo unter
`app/[lang]/tools/pdfedit/` + `components/pdfedit/PdfEditPage.tsx`;
Texte in `i18n/DE.ts`/`EN.ts` (`pdfEdit`), Icon `public/brand/pdfedit.svg`.
Beta-Downloads laufen über die stabilen Release-Aliase
(`pdfedit-macos-arm64.dmg` …) — gleiche Mechanik wie packed/file-port.
