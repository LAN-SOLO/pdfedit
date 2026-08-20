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

**Beta-Grundgerüst released.** Die App-Shell mit **In-App-Updater** steht
(gleiches Muster wie keypile/packed/file-port): signierte Updates von GitHub
Releases, stiller Check beim Start, „Nach Updates suchen"-Button — und vor
jeder Installation zeigt die App das Changelog, installiert wird erst nach
Bestätigung. Releases entstehen per Git-Tag `v*` (`.github/workflows/build.yml`
baut, signiert, generiert das Changelog aus den Commits und published
`latest.json`). Signatur-Key: `~/.tauri/pdfedit-updater.key`.

Stand v0.11.0: Anzeigen/Suchen/Tabs, Anmerkungen (Markieren, Text, Zeichnen —
mit Eigenschaften-Leiste für Farbe/Größe/Stärke/Deckkraft), Stempel &
Bild-Signatur, Formulare ausfüllen **und erstellen** (Textfeld,
Kontrollkästchen, Auswahlliste), **digitale Signatur per Zertifikat**
(PKCS#12 → adbe.pkcs7.detached), **Passwortschutz** (AES-256 setzen/ändern/
entfernen, Berechtigungen; geschützte PDFs öffnen), Seiten organisieren,
Komprimieren, echtes Schwärzen, OCR, Bereich bearbeiten, In-App-Hilfe mit
Tutorial & Handbuch.

## Entwicklung

```sh
pnpm install           # Frontend-Abhängigkeiten
pnpm tauri dev         # App-Grundgerüst starten
cargo check -p pdfedit-app
```
