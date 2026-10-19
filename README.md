# pdfedit

Vollwertiger PDF-Editor für macOS, Windows und Linux: lesen, Anmerkungen
nach ISO-32000-Standard (kompatibel zu Acrobat, PDF Expert & Co.), Formulare
ausfüllen, signieren, Seiten organisieren — und mit **pdfedit inked**
(12 €/Jahr = 1 €/Monat) die vollständige Bearbeitung: Text mit Umbruch,
Bilder, Vektorobjekte, OCR und echtes Schwärzen. **Free** bleibt dauerhaft
kostenlos und voll nutzbar.

Produktseite: https://lan-solo.com/de/tools/pdfedit/ · Plan:
`PDFEDIT_PLAN.md` (Produktdefinition, Engine, Architektur, Roadmap).

## Status

**Version 1.0.0** (Release-Kandidat, Audit: `AUDIT-1.0.md`). In-App-Updater
wie bei keypile/packed/file-port: signierte Updates von GitHub Releases,
stiller Check beim Start und laufend, Changelog vor jeder Installation,
installiert wird erst nach Bestätigung. Releases entstehen per Git-Tag `v*`
(`.github/workflows/build.yml` baut, signiert/notarisiert, generiert das
Changelog und published `latest.json`); Test-Builds per `workflow_dispatch`.
Signatur-Key: `~/.tauri/pdfedit-updater.key`.

Funktionsumfang: Anzeigen/Suchen/Tabs, Anmerkungen (Markieren, Text,
Zeichnen — mit Farbe/Größe/Stärke/Deckkraft und Systemschriften),
formaterhaltendes Text-Ändern, Stempel & Bild-Signatur, Formulare ausfüllen
und erstellen, digitale Signatur per Zertifikat (PKCS#12 →
adbe.pkcs7.detached), Passwortschutz (AES-256, Berechtigungen),
unsichtbares Wasserzeichen, Seiten organisieren (Drag & Drop, Drehen,
Löschen, Leerseiten, Zusammenführen, Export), Komprimieren, echtes
Schwärzen (schwarz/verpixelt/weich), Bereich ersetzen, OCR (DE/EN, lokal),
Objekte-Panel, In-App-Hilfe DE/EN, Hell-/Dunkel-Modus.

## Entwicklung

```sh
pnpm install           # Frontend-Abhängigkeiten
pnpm tauri dev         # App-Grundgerüst starten
cargo check -p pdfedit-app
cargo test --workspace # Rust-Tests (Pfadprüfung, atomares Speichern, Font-Parser)
pnpm test              # Kern-Tests Frontend (pdf-lib-Logik, Signatur, Schwärzen)
# Browser-E2E (Canvas: Schwärzen, Komprimieren, OCR, JPEG 2000, UI):
pnpm exec vite --port 1437 --strictPort &
CHROME=/pfad/zu/chrome node scripts/e2e-browser.mjs
# UI-Abläufe mit gemockter Tauri-IPC (DE/EN, Hell/Dunkel, 860×560):
node scripts/ui-flows.mjs /pfad/zu/chrome http://localhost:1437 /tmp/pdfedit-shots
```

Fehler aus Rust kommen als stabile Codes (`io.locked`, `pdf.write_denied` …)
über die IPC-Grenze und werden in `src/errors.ts` übersetzt — neue Codes
immer in `i18n.ts` (DE und EN) ergänzen, `tests/i18n.test.ts` prüft das.
`read_pdf`/`write_pdf` arbeiten nur mit Pfaden aus Dialog, Drag & Drop oder
Speichern; die Webview darf nicht aus der App-URL wegnavigieren.
Speichern läuft pro Dokument nacheinander (`saveDoc` in `src/App.tsx`); ein
fehlgeschlagener Schreibvorgang markiert den Tab wieder als ungespeichert.
Unter macOS ersetzt `app_menu` (main.rs) das „Quit“ des Standardmenüs, damit
⌘Q dieselben Rückfragen auslöst wie das Schließen des Fensters.
