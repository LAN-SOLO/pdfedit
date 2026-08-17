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

- **Phase 0 — Shell & Renderer:** App-Grundgerüst ✅; pdfium-Rendering,
  Tabs, Zoom/Scroll/Suche.
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
