# pdfedit 1.0.0 — Audit (Funktion & Sicherheit)

Stand: 2026-10-19 · Basis: `39a6f24` (0.11.7) · Prüfumfang: gesamter Quellcode
(`src/`, `src-tauri/`), Konfiguration, CI-Workflow, Abhängigkeiten.

**Legende Teststatus**
- **auto** — durch automatisierten Test abgedeckt (`cargo test`, `pnpm test`
  oder Browser-E2E `scripts/e2e-browser.mjs`)
- **E2E-UI** — im echten Frontend (Chromium headless, Dev-Server) bedient
- **statisch** — nur per Code-Review geprüft (IPC-Pfad, Fehlerbehandlung,
  i18n); braucht den manuellen Test unten
- **manuell** — native Teile (Dialoge, Drag & Drop aus dem Finder/Explorer,
  Updater, WKWebView/WebView2), nur auf echtem macOS/Windows prüfbar

## 1. Testläufe

| Befehl | Ergebnis |
|---|---|
| `cargo test --workspace` | 8 Tests grün |
| `pnpm test` (tests/core.test.ts) | 13 Tests grün |
| `node scripts/e2e-browser.mjs` (Chromium headless gegen `vite --port 1437`) | 6 Tests grün |
| `pnpm exec tsc --noEmit`, `pnpm build` | fehlerfrei |
| `cargo clippy` | 2 Stil-Hinweise (vorbestehend, keine Fehler) |

Es gibt kein ESLint-Setup im Repo (kein `lint`-Script); Typprüfung über `tsc`.

## 2. Funktionsinventar

| Bereich | Funktion | Status |
|---|---|---|
| Öffnen | PDF öffnen (nativer Dialog) | statisch/manuell |
| | Drag & Drop (nur `*.pdf`) | statisch/manuell |
| | Browser-Fallback (Datei-Input) | E2E-UI |
| | Passwortgeschützte PDFs (Abfrage, falsches Passwort) | auto |
| | PDFs nur mit Berechtigungs-Passwort öffnen ohne Abfrage (**neu**) | auto |
| | Mehrere Tabs, ungespeichert-Markierung, Schließen-Rückfrage | statisch/manuell |
| Neu | Neues PDF (A3/A4/A5/Letter/Legal, hoch/quer, 1–500 Seiten) | statisch/manuell |
| Anzeigen | Rendering inkl. JPEG 2000 / JBIG2 / CCITT-Fax / CJK-CMaps (**Fix**) | auto (JPX) |
| | Zoom, Breite/Seite einpassen, Seitensprung | statisch |
| | Suche mit Trefferzähler | E2E-UI |
| | Seitenleiste: Miniaturen, Drag & Drop umsortieren | auto (Logik) / manuell (DnD) |
| | Objekte-Panel: Anmerkungen + Formularfelder (**Fix**: Release-Build) | auto (Logik) / manuell |
| Anmerken | Markieren, Text (Schriftwahl inkl. Systemschriften), Zeichnen; Farbe/Größe/Stärke/Deckkraft | E2E-UI (Leiste) / manuell |
| | Stempel: Zeichnen, Tippen, Bild | E2E-UI (Dialog) / manuell |
| Inhalte | Text ändern (formaterhaltend, eingebettete Originalschrift) | auto (applyRunEdit) / manuell |
| | Bereich ersetzen (Text/Bild) | auto (E2E) |
| | Schwärzen schwarz/verpixelt/weich + Metadaten bereinigen | auto (E2E + Kern) |
| | OCR Deutsch/Englisch, Seite/Dokument, unsichtbarer Text | auto (E2E) |
| Formulare | Felder erstellen (Text, mehrzeilig, Kontrollkästchen, Auswahlliste), bearbeiten, löschen, Namensvorschlag, Namenskonflikt | auto |
| | Ausfüllen (pdf.js-Formularlayer), Flachrechnen | statisch/manuell |
| Signatur | PKCS#12 (3DES + AES), Zertifikatsvorschau, unsichtbar/sichtbar, PDF mit vorhandenem Formular | auto (Signatur kryptografisch verifiziert) |
| Schutz | AES-256 setzen/ändern/entfernen, Berechtigungen, Speichern mit geerbtem Schutz | auto |
| Wasserzeichen | Unsichtbar setzen (alle/aktuelle Seite), Prüfen, Abgleich mit PNG, Umsortier-Erkennung | auto |
| Seiten | Umsortieren, Drehen, Löschen, Leerseite, PDF anhängen, Auswahl exportieren | auto (organizePages) / E2E-UI (Dialog) |
| Komprimieren | Presets schnell/ausgewogen/klein | auto (E2E) |
| Speichern | Speichern an Ursprungspfad, atomar (**neu**) | auto (Rust) / manuell |
| App | Updater (Check beim Start/alle 4 h/Fokus, Changelog, Installation) | statisch/manuell |
| | Hilfe (Tutorial + Handbuch DE/EN), Hell/Dunkel | E2E-UI |

## 3. Gefundene und behobene Fehler

1. **Schwärzen ließ den Originaltext in der Datei** (kritisch). pdf-lib schreibt
   alle registrierten Objekte; `removePage`+`insertPage` ließ den alten
   Content-Stream im PDF. Jetzt: Seite an Ort und Stelle ersetzen
   (`src/pdfScrub.ts`), Struktur-Baum verwerfen, Sweep über unerreichbare
   Objekte. Gilt auch für „Bereich ersetzen“. Test: Text ist weder roh noch
   in entpackten Streams auffindbar.
2. **Scans mit JPEG 2000 / JBIG2 / CCITT-Fax blieben leer** — pdf.js v6 braucht
   `wasmUrl`; außerdem fehlten CMaps (CJK). Vite-Plugin liefert die Dateien
   aus `pdfjs-dist` mit.
3. **Objekte-Panel ohne Formularfelder im Release-Build** — Vergleich über
   `constructor.name`, die Minifizierung benennt Klassen um (mit minifiziertem
   Bundle nachgewiesen). Jetzt `instanceof`.
4. **Seiten organisieren zerstörte Formulare/Lesezeichen/Metadaten** — Neuaufbau
   per `copyPages`. Jetzt in-place (`organizePages`), gelöschte Seiten samt
   Feldern wirklich entfernt; geerbtes `/Rotate` korrekt.
5. **PDFs mit reinem Berechtigungs-Passwort ließen sich nicht öffnen.**
6. **Komprimieren verlor die Soft-Mask** (Transparenz) und hätte CMYK-JPEGs mit
   falschen Farben neu kodiert.
7. Speichern unter Windows/Linux ohne `.pdf`-Endung möglich → wird ergänzt.
8. Passwortgeschützte PDFs im Seiten-Dialog anhängen → verständliche Meldung.
9. pdf.js-Dokumente nach Schwärzen/OCR/Bereich ersetzen freigegeben (Speicher).
10. Debug-Globals (`__debugPdfjs`, `__debugViewer`) nur noch im Dev-Modus;
    Diagnose-PDF nicht mehr im App-Bundle.

## 4. Sicherheitsbefunde

| # | Schwere | Befund | Status |
|---|---|---|---|
| S1 | hoch | Geschwärzte Inhalte blieben in der Datei (siehe 3.1) | behoben |
| S2 | mittel | `read_pdf` las beliebige Dateien (kompromittierte Webview → Datei-Exfiltration) | behoben: nur `*.pdf`, nur reguläre Dateien |
| S3 | mittel | `write_pdf` schrieb an beliebige Pfade | behoben: nur Pfade, die in der Sitzung geöffnet oder per Dialog gewählt wurden, nur `*.pdf`, Daten müssen mit `%PDF-` beginnen; atomar |
| S4 | niedrig | `read_font` nur per Endung beschränkt | behoben: nur aus System-Schriftordnern, kanonisiert (kein `../`, Symlinks aufgelöst) |
| S5 | niedrig | Capability `dialog:default` ungenutzt freigegeben | entfernt (Dialoge laufen nur in Rust) |
| S6 | niedrig | CSP ohne `object-src`/`base-uri`/`form-action` | ergänzt (`'none'`/`'self'`/`'none'`) |
| S7 | info | `node-forge` ≤1.4.0: GHSA-86w9-cpqp-85rv (PKCS#1-Signaturprüfung) | offen — kein gepatchtes Release auf npm (latest = 1.4.0); pdfedit **prüft** keine Signaturen mit forge, es erzeugt nur welche → nicht ausnutzbar |
| S8 | info | `source-map-js` <1.2.2 (nur Build-Tooling) | behoben (1.2.2) |
| S9 | info | Struktur-Baum, Lesezeichen-Titel, Anhänge | Struktur-Baum wird beim Schwärzen entfernt; Lesezeichen-Titel und eingebettete Dateien werden **nicht** angefasst (siehe Grenzen) |

Geprüft ohne Befund:
- **CSP**: `default-src 'self'`, Skripte nur `'self'` + `'wasm-unsafe-eval'`
  (Tesseract/pdf.js-WASM), kein `unsafe-eval`; keine externen Hosts — die App
  lädt zur Laufzeit nichts aus dem Netz außer dem Update-Check (Rust).
- **XSS**: kein `dangerouslySetInnerHTML`, kein `innerHTML` mit Daten; Changelog
  wird als Text gerendert; pdf.js-Scripting (`quickjs`) nicht aktiviert.
- **Updater**: Minisign-Pubkey gesetzt, Endpoint HTTPS (GitHub Releases),
  Installation erst nach Bestätigung, Signatur wird vom Tauri-Updater geprüft.
- **TLS**: nirgends deaktiviert.
- **Krypto**: Passwortschutz AES-256 (@cantoo/pdf-lib, PDF 2.0 R6);
  Signatur SHA-256 mit Signed Attributes; P12-Passwort und Schlüssel bleiben
  im Speicher, werden nicht gespeichert oder geloggt. Arbeitskopie geschützter
  PDFs liegt unverschlüsselt nur im RAM.
- **localStorage**: nur Theme und Tutorial-Flag.
- **Temp-Dateien**: nur die Speicher-Temp-Datei im Zielordner, wird bei Fehler
  gelöscht.
- **Fehlermeldungen**: zeigen Dateipfade/OS-Fehler nur dem Nutzer selbst.

## 5. Bekannte Grenzen (bewusst, dokumentiert)

- **Text ändern** überdeckt den Original-Run und schreibt neuen Text darüber —
  der alte Text bleibt unsichtbar in der Datei (Hilfe und Dialog sagen das;
  für echtes Entfernen: Schwärzen).
- **Schwärzen / Bereich ersetzen** machen die betroffene Seite zum Bild; alle
  Formularfelder des Dokuments werden flachgerechnet; der Tagged-PDF-Baum wird
  verworfen. Lesezeichen-Titel, eingebettete Dateien und Dokument-JavaScript
  werden nicht bereinigt.
- **Signieren** schreibt das Dokument neu (kein inkrementelles Update) —
  vorhandene Signaturen werden dabei ungültig. Kein Zeitstempel (TSA), keine
  LTV-Daten; nur RSA-Schlüssel. Signaturen werden nicht geprüft/angezeigt.
- **Berechtigungs-only-PDFs**: Einschränkungen entfallen beim Speichern
  (Owner-Passwort unbekannt); Hinweis beim Öffnen.
- **Komprimieren** kodiert nur RGB-/Graustufen-JPEGs neu.
- **Seiten exportieren** erzeugt ein neues Dokument (ohne Formular-Katalog).
- **OCR**: Deutsch und Englisch.
- Update-Fehlermeldungen aus Rust sind deutsch, auch in der englischen UI.

## 6. Windows-spezifische Prüfung (statisch)

- Pfade: Rust nutzt `Path`/`PathBuf` durchgehend; Windows-Schriftordner
  `%WINDIR%\Fonts` und `%LOCALAPPDATA%\Microsoft\Windows\Fonts`; `canonicalize`
  liefert `\\?\`-Pfade — Allow-Liste speichert Original- und kanonische Form,
  daher passt der vom Frontend zurückgegebene Pfad (Test: macOS `/var` vs
  `/private/var`, gleicher Mechanismus).
- Dateiname im Tab: Frontend trennt an `/` und `\`.
- Atomares Speichern: `rename` ersetzt unter Windows die Zieldatei; ist sie in
  einem anderen Programm gesperrt (z. B. Acrobat), meldet pdfedit den Fehler —
  wie vorher.
- Tests nehmen keine Unix-Pfade an (Rust-Tests über `temp_dir()`; der
  Font-Test überspringt fehlende macOS-Dateien).
- `windows_subsystem = "windows"` nur im Release, NSIS `currentUser`.
- CI: `pnpm test` läuft jetzt auf allen Runnern mit; Signatur/Notarisierung
  unverändert.

## 7. Manuelle Testliste (macOS und Windows, beide Sprachen)

Vorbereitung: Test-Build aus CI (`workflow_dispatch`, Version 1.0.0) installieren.
Testdateien: ein Text-PDF, ein Scan (am besten Fax/JBIG2 oder JPEG 2000), ein
Formular-PDF, ein passwortgeschütztes PDF, ein PDF mit „Drucken nicht
erlaubt“ (nur Berechtigungen), ein `.p12`-Zertifikat.

1. Start: Fenster öffnet, Version 1.0.0 auf der Startseite, Update-Check ohne Fehler.
2. PDF öffnen per Dialog **und** per Drag & Drop aus Finder/Explorer; Nicht-PDF
   ziehen → passiert nichts.
3. Scan-PDF: Seite sichtbar (nicht leer), Miniaturen in der Seitenleiste.
4. Suche, Zoom, Einpassen, Seitensprung.
5. Markieren / Text (Systemschrift wählen) / Zeichnen; Farbe & Stärke ändern;
   speichern, in einem anderen Viewer öffnen → Anmerkungen da.
6. Text ändern: Wort anklicken, ändern, Schrift bleibt; speichern.
7. Formularfeld anlegen, im Objekte-Panel sehen (**Release-Build!**),
   bearbeiten, löschen; Formular ausfüllen, flachrechnen.
8. Seiten-Dialog: drehen, löschen, Leerseite, PDF anhängen, anwenden → Formular
   bleibt ausfüllbar; Auswahl exportieren → Speichern-Dialog (Windows: Name ohne
   `.pdf` eintippen → Datei endet trotzdem auf `.pdf`).
9. Seitenleiste: Seite per Drag & Drop verschieben.
10. Schwärzen (alle drei Stile): danach Text im geschwärzten Bereich nicht mehr
    kopierbar/suchbar, auch nicht in einem anderen Viewer.
11. OCR auf Scan (DE+EN) → danach durchsuchbar.
12. Komprimieren → Größe sinkt, Bilder korrekt.
13. Signieren unsichtbar und sichtbar mit `.p12` → in Acrobat Reader „gültig,
    nicht verändert“ (Vertrauensstatus je nach Zertifikat).
14. Schutz setzen → schließen → neu öffnen (Passwortabfrage, falsches Passwort);
    Schutz entfernen. „Drucken nicht erlaubt“-PDF öffnet ohne Abfrage mit Hinweis.
15. Wasserzeichen setzen, prüfen, Seiten umsortieren → Prüfung meldet es.
16. Neues PDF anlegen (Speichern-Dialog), bearbeiten, speichern.
17. Ungespeicherte Änderungen: Tab schließen und Fenster schließen → Rückfrage;
    „Abbrechen“ lässt die App offen.
18. Speichern einer Datei, die in einem anderen Programm geöffnet ist (Windows) →
    verständlicher Fehler, Original unbeschädigt.
19. Hilfe (DE/EN-Umschalter), Hell/Dunkel-Umschalter.
20. Updater: sobald ein höheres Release existiert, Changelog-Dialog → Installation.

## 8. Verifikation (unabhängige Zweitprüfung, 2026-10-19)

Zweiter Prüfer, Ziel: die Aussagen oben widerlegen. Alle Suiten selbst neu
ausgeführt; danach drei echte Fehler behoben (Commit nach `f1bf2e7`).

**Testläufe (nach den Fixes)**

| Befehl | Ergebnis |
|---|---|
| `cargo test --workspace` | 9 grün (neu: Pfade mit Leerzeichen/Umlauten, `.PDF` groß) |
| `pnpm test` | 14 grün (neu: gelöschte Seite trotz Lesezeichen/Link weg) |
| `scripts/e2e-browser.mjs` (Chromium headless, `vite --port 1437`) | 6 grün |
| `tsc --noEmit`, `pnpm build` | fehlerfrei; `dist/pdfjs/{cmaps,wasm,iccs}` per `vite preview` mit HTTP 200 ausgeliefert |
| `cargo clippy` | 2 Stil-Hinweise (unverändert) |
| `pnpm audit --prod` | 1 high: node-forge GHSA-86w9-cpqp-85rv, npm hat weiterhin nur 1.4.0 |

**Widerlegte bzw. eingeschränkte Aussagen**

1. *„Ungespeicherte Änderungen → Rückfrage“ (Hilfe, Testliste Punkt 17)* — war
   in der App **wirkungslos, auf macOS und Windows**: `tauri-plugin-dialog`
   ersetzt per Init-Skript `window.confirm` durch eine `async`-Funktion. Sie
   gibt ein Promise zurück (immer truthy), `!window.confirm(...)` war also immer
   `false` — Tab bzw. Fenster schlossen ohne Rückfrage, Änderungen weg. Der
   aufgerufene Befehl `plugin:dialog|confirm` existiert in 2.7 nicht einmal.
   Im Browser-E2E nicht sichtbar, weil dort das echte `window.confirm` gilt.
   **Fix:** neuer Rust-Befehl `confirm_dialog` (nativer OK/Abbrechen-Dialog,
   Fenster als Parent, Buttons „Verwerfen und schließen/beenden“ DE/EN),
   Frontend `askConfirm()` in `src/api.ts`; schlägt der Dialog fehl, gilt
   „Abbrechen“. `window.confirm` wird in Tauri nirgends mehr benutzt.
2. *„Gelöschte Seiten verschwinden vollständig aus der Datei“ (Hilfe, Seiten)* —
   stimmte nur ohne Verweise. Zeigt ein Lesezeichen, ein benanntes Ziel, ein
   Link oder ein Widget-`/P` auf die gelöschte Seite, blieb das Seitenobjekt
   erreichbar und der Unreachable-Sweep ließ ihren **Inhaltsstrom samt Text in
   der Datei** (Test zuerst rot reproduziert). **Fix:** gelöschte Seiten werden
   in `organizePages` zu einer leeren `/Type /Page`-Hülle geleert; Lesezeichen
   und Links bleiben lesbar (pdf.js: Outline + Annotation geprüft), zeigen nur
   ins Leere.
3. *„write_pdf: nur in dieser Sitzung geöffnete/gewählte Pfade“* — formal
   richtig, aber `read_pdf` nimmt jeden `*.pdf`-Pfad vom Frontend an und
   schaltet ihn damit schreibbar. Eine kompromittierte Webview könnte also
   jede vorhandene PDF-Datei lesen und mit gültigem PDF überschreiben. Rest-
   risiko **niedrig** (CSP `default-src 'self'`, pdf.js-Scripting aus, keine
   Fremd-Inhalte); eine Bindung an Rust-seitig erfasste Dialog-/Drop-Pfade
   würde Drag & Drop berühren, das hier nicht nativ testbar ist — offen
   gelassen, dokumentiert.
4. *Komprimieren behält `/Mask`* — für Farbschlüssel-Masken (`/Mask [Bereiche]`)
   falsch: nach verlustbehafteter Neukodierung (Grau → RGB) passen Werte und
   Komponentenzahl nicht mehr. **Fix:** solche Bilder werden übersprungen;
   Stencil-Masken (Stream) und `/SMask` bleiben wie gehabt erhalten.

**Kleinere Ergänzungen**

- Seiten-Dialog „PDF anhängen“: PDFs mit nur Berechtigungs-Einschränkungen
  werden jetzt (wie beim Öffnen) mit leerem Passwort entschlüsselt und
  angehängt statt abgelehnt; Hilfe DE/EN angepasst.
- `ensure_pdf_ext`: hängt der Speichern-Dialog `.pdf` nicht selbst an und gibt
  es `name.pdf` schon, wird diese Datei ohne OS-Rückfrage ersetzt (der Dialog
  hat nur `name` geprüft). Selten (Windows/Linux, Name ohne Endung); notiert.

**Bestätigt (selbst geprüft)**

- Version 1.0.0 in `package.json`, `tauri.conf.json`, `src-tauri/Cargo.toml`,
  `Cargo.lock` (`pdfedit-app 1.0.0`); App liest sie zur Laufzeit per
  `getVersion()`, keine hartkodierte Versionsangabe im UI.
- `build.yml`: Frontend-Build vor `cargo test`, `pnpm test` auf allen Runnern
  (Node 22 = lokal getestete Version, Tests ohne Unix-Pfadannahmen),
  Signatur/Notarisierung unverändert; der Updater-Archiv-Rename passt zu
  `productName` `pdfedit`.
- Invoke-Namen/Argumente stimmen mit den Rust-Signaturen überein
  (`dataB64` → `data_b64`, `okLabel` → `ok_label` usw.).
- pdf.js-Ressourcen: unter `tauri://` (macOS) nutzt pdf.js XHR, unter
  `http://tauri.localhost` (Windows) `fetch` — beides nur statisch geprüft.

**Manuell zusätzlich (zu Abschnitt 7)**

- Punkt 17 jetzt mit nativem Dialog: Tab mit Änderungen schließen →
  „Verwerfen und schließen“ / „Abbrechen“; Fenster schließen → „Verwerfen
  und beenden“ / „Abbrechen“; beide Sprachen, macOS (Sheet am Fenster) und
  Windows.
- Seiten löschen in einem PDF mit Inhaltsverzeichnis-Lesezeichen → Lesezeichen
  der gelöschten Seite tut nichts, Rest funktioniert.
