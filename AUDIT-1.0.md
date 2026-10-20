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
- ~~**Seiten exportieren** erzeugt ein neues Dokument (ohne Formular-Katalog).~~
  Runde 2: behoben (Export nutzt denselben Weg wie „Anwenden“, siehe Abschnitt 9).
- **OCR**: Deutsch und Englisch.
- ~~Update-Fehlermeldungen aus Rust sind deutsch, auch in der englischen UI.~~
  Runde 2: behoben (Fehlercodes, Übersetzung im Frontend, siehe Abschnitt 9).

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

## 9. Runde 2 (2026-10-20)

Basis: `f487365`. Ziel: jede Funktion fehlerfrei auf macOS und Windows,
Muster L1–L13 aus den anderen Apps gegen pdfedit geprüft und behoben.

**Testläufe**

| Befehl | Ergebnis |
|---|---|
| `cargo test --workspace` | 16 bestanden (neu: Fehlercodes, Retry, lange Namen, parallele Saves, Lese-Allow-Liste, Navigations-Sperre, Windows-Gerätenamen) |
| `cargo check --target x86_64-pc-windows-msvc --workspace --tests` (vom Mac, ohne Linken) | fehlerfrei, ebenso `cargo clippy` für Windows |
| `pnpm test` | 20 bestanden (neu: `tests/i18n.test.ts` — DE/EN-Parität, alle Backend-Codes übersetzt, Update-Datum, lokales Signaturdatum; Seiten-Export mit Formular) |
| `pnpm build` (tsc + vite) | fehlerfrei |
| `scripts/e2e-browser.mjs` (Chromium) | 6 bestanden |
| `scripts/ui-flows.mjs` (Chromium, gemockte Tauri-IPC inkl. Dialog-Plugin-2.7-Stubs für `window.confirm/alert/prompt`) | 92 bestanden — DE+EN × Dunkel+Hell bei 860×560 (Mindestgröße) |
| `cargo audit` | `rustls` 0.23.43 → 0.23.46 aktualisiert (4 Advisories); offen: `zip` 4.6.1 im Updater-Plugin (s. u.) |

**Behoben**

- **L2 Backend-Fehler übersetzt**: Rust liefert stabile Codes (`pdf.*`,
  `io.locked|denied|not_found|full|other`, `font.denied`, `update.*`),
  `src/errors.ts` macht daraus DE/EN-Text; OS-Text nur noch als Detail bei
  `io.other`/`update.*`. Auch Frontend-Fehler (`pages.empty`, `sign.no_key`)
  und der sichtbare Signaturstempel („Digital signiert“/„Digitally signed“,
  „Unbekannt“/„Unknown“) folgen der UI-Sprache.
- **Sicherheit (Runde-1-Rest)**: `read_pdf` liest nur noch Dateien, die im
  Dialog gewählt, gespeichert oder per Drag & Drop abgelegt wurden — die
  Drop-Pfade registriert Rust selbst im Fenster-Event, nicht das Frontend.
  Eine kompromittierte Webview kann damit keine beliebigen PDFs mehr lesen
  oder überschreiben.
- **Speichern-Dialog ohne `.pdf`**: hängt pdfedit die Endung an und gibt es
  die Datei schon, fragt ein nativer Dialog (Ersetzen/Abbrechen, UI-Sprache).
- **L5 Windows-Dateisystem**: atomares Umbenennen wiederholt bei
  Sharing-/Lock-Verletzung und kurzzeitigem Zugriff-verweigert (AV-Scanner,
  OneDrive) rund 2 s; Lesen ebenso bei Sperre. Temp-Name gekürzt (lange
  Dateinamen sprengten das 255-Zeichen-Limit) und mit Laufnummer (zwei
  gleichzeitige Saves teilten sich eine Temp-Datei). Reservierte
  Gerätenamen (`CON`, `NUL`, `COM1` …, Punkt/Leerzeichen am Ende) lehnt das
  Backend unter Windows ab (`pdf.bad_name`).
- **L7 Links in PDFs**: Ein Klick auf einen Web-/Mail-Link ersetzte bisher
  die App-Seite in der Webview (Tauri erlaubt Navigation standardmäßig) —
  Editor und ungespeicherte Tabs waren ohne Rückfrage weg. Jetzt: Klick
  kopiert die Adresse und zeigt einen Hinweis; zusätzlich blockiert ein
  Navigations-Wächter in Rust jede Navigation außerhalb der App-URL.
  Interne Links (Seitenziele) funktionieren weiter.
- **L8**: PDF lesen/schreiben (inkl. Base64-Dekodierung), Schriftliste und
  Schriftlesen laufen im Blocking-Pool statt auf den Async-Workern.
- **L9/L11 Beenden während einer Aufgabe**: Läuft ein Speichervorgang, OCR,
  Komprimieren, Schwärzen, Signieren o. Ä., fragt das Schließen des Fensters
  erst („Trotzdem beenden“/„Abbrechen“), dann wie bisher nach
  ungespeicherten Änderungen. Der Close-Listener wurde bei frühem Aufräumen
  (React StrictMode) doppelt registriert → Frage kam zweimal; behoben.
- **L11 Formularfeld löschen** (× im Objekte-Panel) fragt jetzt nativ nach —
  das Löschen schreibt das Dokument neu und ist nicht rückgängig zu machen.
- **L10 Datum**: Der sichtbare Signaturstempel und das Zertifikats-Ablaufdatum
  zeigen den lokalen Kalendertag (vorher UTC: kurz nach Mitternacht der
  Vortag). Das Veröffentlichungsdatum im Update-Dialog wurde nie angezeigt
  (`time`-Format aus Rust ist kein gültiges JS-Datum) → `src/updateDate.ts`.
- **L12**: Seitenkarten-Knöpfe (↑ ↓ ⟳ ×) und Zoom-Knöpfe hatten englische
  `aria-label`s ohne Tooltip → übersetzt, mit Tooltip. „Auswahl exportieren“
  meldet jetzt den gespeicherten Dateinamen. Hilfe startet in der UI-Sprache
  (gemeinsame Regel `uiLang`).
- **Seiten exportieren** baut den Auszug jetzt mit `organizePages` auf den
  gewählten Seiten: Formularfelder dieser Seiten bleiben ausfüllbar, Inhalte
  der anderen Seiten sind nicht in der Datei (Test).

**Geprüft ohne Befund**

- L1: kein `window.confirm/alert/prompt` im Tauri-Pfad (`askConfirm` →
  `confirm_dialog`); der UI-Lauf ersetzt sie wie das Plugin durch Stubs und
  prüft, dass sie nie aufgerufen werden.
- L3: UI-Sprache aus `navigator.language` (WKWebView/WebView2 liefern die
  Systemsprache auch ohne `LANG`). L4: kein CSV/JSON-Import/-Export.
  L6: keine Tastenkürzel-Beschriftungen in der UI.
- L13: Updater-Endpoint `releases/latest/download/latest.json`, Pubkey
  gesetzt, Versionsvergleich semver durch das Plugin (1.0.0), Fehler in
  UI-Sprache (UI-Lauf: Installationsfehler übersetzt).

**Offen**

- `zip` 4.6.1 (RUSTSEC-2026-0367/-0368/-0369) kommt über
  `tauri-plugin-updater` 2.10.1; Fix erst in `zip` 9. Betrifft das Entpacken
  von Archiven — der Updater entpackt nur signaturgeprüfte Update-Archive
  von GitHub. Ein Updater-Plugin-Update vor 1.0 ungetestet einzuspielen
  wäre riskanter; nach 1.0 angehen.
- `node-forge` GHSA-86w9-cpqp-85rv weiter ohne gepatchte Version (npm: 1.4.0);
  pdfedit prüft keine Signaturen mit forge.
- Komprimieren und Schwärzen laufen im Webview-Hauptthread (pdf-lib/Canvas);
  bei sehr großen PDFs kann das Fenster währenddessen kurz träge reagieren
  (nicht gemessen). Ein Umbau auf Worker ist nach 1.0 geplant.
- Kein ESLint im Repo (bräuchte neue Abhängigkeiten).

**Nur auf echter Hardware prüfbar (zusätzlich zu Abschnitt 7)**

- Link in einem PDF anklicken (macOS und Windows): App bleibt, Hinweis
  „Adresse kopiert“, Adresse liegt in der Zwischenablage (WKWebView/WebView2
  erlauben `clipboard.writeText` im Klick; headless Chromium lehnte ab →
  Hinweis ohne „kopiert“).
- Speichern-Dialog unter Windows: Name ohne `.pdf` eintippen, den es als
  `.pdf` schon gibt → Rückfrage „Ersetzen?“; Abbrechen speichert nicht.
- Windows: Datei in Acrobat geöffnet → speichern → Meldung „in einem anderen
  Programm geöffnet“ (nach ~2 s), Original unverändert, keine `.tmp`-Datei.
- Drag & Drop aus Finder/Explorer öffnet weiterhin (Rust-Registrierung im
  Drop-Event); „PDF anhängen“ im Seiten-Dialog.
- Fenster schließen während OCR/Komprimieren → Rückfrage „Trotzdem beenden“.
- Objekte-Panel: Formularfeld × → native Rückfrage, Abbrechen behält das Feld.
- Update-Dialog zeigt „Veröffentlicht am …“ mit Datum.


## 10. Runde 2 – Verifikation (unabhängige Prüfung, 2026-10-20)

Geprüft: `f487365..b3d8c11` (Runde 2) auf Regressionen, Plattform- und
Race-Probleme; alle Tests selbst wiederholt, L1–L13 an weiteren Stellen
stichprobenartig nachgeprüft.

**Wiederholte Testläufe**

| Befehl | Ergebnis |
|---|---|
| `cargo test --workspace` | 16 bestanden |
| `cargo check --target x86_64-pc-windows-msvc --workspace --tests` (vom Mac, ohne Linken) | fehlerfrei, keine Warnungen (auch nach den Änderungen unten) |
| `cargo clippy --all-targets` (macOS) | nur der alte Stil-Hinweis `chunks_exact` |
| `pnpm test` | 20 bestanden; `i18n`-Tests zusätzlich unter `TZ` = Kiritimati (+14), Los Angeles, Berlin, UTC |
| `pnpm build` | fehlerfrei |
| `scripts/e2e-browser.mjs` | 6 bestanden |
| `scripts/ui-flows.mjs` | 100 bestanden (92 + 8 neue), 0 Seitenfehler |
| `cargo audit` / `pnpm audit` | wie in Abschnitt 9 (nur `zip` 4.6.1 über den Updater, `node-forge`) |

**Bestätigt (Quelltext gelesen bzw. ausgeführt)**

- Drop-Registrierung: In Tauri 2.11.5 (`manager/window.rs`) wird das
  Drop-Event erst an die Webview gesendet und danach im selben Aufruf die
  globalen `on_window_event`-Handler ausgeführt — auf dem Hauptthread, über
  den auch die IPC-Anfrage der Webview laufen muss. `read_pdf` kann die
  Freigabe also nicht überholen.
- Neue Fenster (`target="_blank"`, Kontextmenü „In neuem Fenster öffnen“):
  ohne eigenen Handler lehnt wry sie unter WebView2 ab (`SetHandled(true)`),
  unter WKWebView liefert wrys UI-Delegate ohne Handler keine neue Webview (`None`). Der Navigations-Wächter
  deckt „Link öffnen“ im Kontextmenü ab.
- Link-Abfangen in WKWebView: Mit einem kleinen WKWebView-Programm und
  eigenem `tauri://`-Scheme geprüft, dass `location.origin` und
  `new URL(…).origin` dort beide `tauri://localhost` sind — leere `href`s,
  die pdf.js für Named/JS-Aktionen setzt, bleiben damit intern.
- macOS-Menü: Die Ersetzung (siehe unten) im Debug-Build ausgeführt; das
  App-Menü enthält danach „Quit pdfedit“ mit eigener ID statt des
  vordefinierten Eintrags.

**Behoben**

- **L11/L9 Fehlgeschlagenes Speichern machte den Tab „sauber“**: `doSave`
  löschte die Ungespeichert-Markierung vor dem Schreiben, `saveDoc`
  stellte sie bei einem Fehler nicht wieder her. Nach z. B. `io.locked`
  (Datei in Acrobat offen — genau der in Runde 2 eingebaute Fall) fragte
  das Schließen von Tab oder App nicht mehr nach; beim Tabwechsel gingen die
  Änderungen ebenfalls verloren (Checkpoint sah „nichts ungespeichert“).
  Jetzt: Fehler → Tab wieder ungespeichert, auch im Viewer.
- **L9 Zweites Speichern während des Schreibens**: „Speichern“ war wieder
  aktiv, sobald die Bytes erzeugt waren, nicht erst wenn sie auf der Platte
  lagen. Mit dem 2-s-Retry unter Windows konnten zwei Schreibvorgänge
  parallel laufen und ein älterer zuletzt landen. Jetzt bleibt der Knopf bis
  zum Ende gesperrt, und Schreibvorgänge eines Dokuments laufen strikt
  nacheinander (Kette in `saveDoc`). Wird während des Schreibens weiter
  bearbeitet, bleibt der Tab ungespeichert und der Viewer wird nicht mit
  dem älteren Stand neu geladen (vorher: neuere Änderungen verworfen).
  Signieren und Schutz melden „erledigt“ nur noch, wenn die Datei
  tatsächlich geschrieben wurde.
- **L9/L11 ⌘Q unter macOS umging alle Rückfragen**: Das vordefinierte
  „Quit“ des Tauri-Standardmenüs ruft `NSApp terminate:` direkt auf (muda
  0.19.3, tao 0.35.3 implementiert kein `applicationShouldTerminate`) — das
  Fenster bekam kein CloseRequested, ungespeicherte Änderungen und laufende
  Aufgaben gingen ohne Frage verloren. `app_menu` ersetzt den Eintrag durch
  einen eigenen mit ⌘Q, der das Fenster wie der rote Knopf schließt
  (`Window::close` → CloseRequested → Rückfragen). Nur macOS; Windows hat
  kein Standardmenü.
- Doku: README/Skript-Kopf nutzten `http://127.0.0.1:1437`; Vite lauscht
  standardmäßig auf `localhost` (auf diesem Mac nur `::1`) → `localhost`.

**Neue Prüfungen** (`scripts/ui-flows.mjs`, je DE/EN × Dunkel/Hell)

- Speichern mit `io.locked`-Fehler → übersetzte Meldung, Tab bleibt
  ungespeichert (schlug auf `b3d8c11` fehl).
- Langsames Speichern (1,5 s): Knopf während des Schreibens gesperrt, genau
  ein `write_pdf`, danach sauber (schlug auf `b3d8c11` fehl: zwei Writes).

**Weiter offen / bewusst nicht geändert**

- Beenden über das Dock („Beenden“), Abmelden oder ein Apple-Event `quit`
  ruft weiterhin `terminate:` direkt auf — ohne Rückfrage. Abfangen ginge nur
  über einen eigenen `applicationShouldTerminate`-Delegate (objc), nicht
  sinnvoll vor 1.0.
- Der neue Menüeintrag heißt wie die übrigen Standard-Menüpunkte englisch
  („Quit pdfedit“); das Tauri-Standardmenü ist insgesamt nicht übersetzt.
- „Auswahl exportieren“ im Seiten-Dialog zählt nicht zur Beenden-Rückfrage
  „pdfedit arbeitet noch“; das Schreiben ist atomar, ein Abbruch hinterlässt
  höchstens eine Temp-Datei neben dem Ziel.
- Datum im Update-Dialog nutzt das System-Locale (`toLocaleDateString()`),
  nicht zwingend die UI-Sprache (z. B. französisches System → englische UI
  mit französischem Datumsformat). Kosmetisch.
- `cargo fmt --check` meldet Abweichungen (schon vor Runde 2); die CI prüft
  das nicht.

**Nur auf echter Hardware prüfbar (zusätzlich zu Abschnitt 7 und 9)**

- macOS: Dokument ändern, ⌘Q → Rückfrage „ungespeicherte Änderungen“;
  Abbrechen lässt die App offen; während OCR → „Trotzdem beenden“.
  Ohne Änderungen beendet ⌘Q die App sofort.
- Windows: Datei in Acrobat sperren, speichern → Fehlermeldung nach ~2 s,
  Tab-Punkt bleibt, Schließen fragt nach; Acrobat schließen, erneut
  speichern → sauber.
- Großes PDF auf langsamem Laufwerk/Netzlaufwerk speichern: „Speichern“
  bleibt bis zum Ende gesperrt, Weiterarbeiten währenddessen lässt den Tab
  ungespeichert.

## 11. Runde 3 (2026-10-20, abschließend)

Basis: `4822c42`. Ziel: jede Aussage in Hilfe (DE/EN), README und
In-App-Texten gegen den Code prüfen, Nutzerwege inkl. Fehlerfällen
durchspielen, Reste aus Runde 2 schließen.

**Testläufe**

| Befehl | Ergebnis |
|---|---|
| `cargo test --workspace` | 18 bestanden (neu: schreibgeschützter Ordner auf echtem Dateisystem, Beenden-Entscheidung macOS) |
| `cargo clippy --all-targets` (macOS) und für `x86_64-pc-windows-msvc` | nur der alte Hinweis `chunks_exact` |
| `cargo check --target x86_64-pc-windows-msvc --workspace --tests` | fehlerfrei |
| `pnpm test` | 21 bestanden (neu: Hilfe zitiert nur echte UI-Texte); 8 Läufe — der allererste meldete 1 Fehlschlag, dessen Ausgabe nicht erfasst wurde und der sich danach nicht reproduzieren ließ |
| `pnpm build` | fehlerfrei |
| `scripts/e2e-browser.mjs` (Chromium) | 7 bestanden (neu: Bereich ersetzen entfernt Felder nur dieser Seite; vor dem Fix rot) |
| `scripts/ui-flows.mjs` (Chromium, gemockte IPC) | 132 bestanden (100 + 32 neue), 0 Seitenfehler — DE+EN × Dunkel+Hell |
| Debug-Build auf macOS, Beenden per Apple-Event (`NSRunningApplication.terminate`) | ohne Änderungen: App beendet sofort; mit `PDFEDIT_DEBUG_QUIT_GUARD=1`: Beenden abgebrochen → `CloseRequested` → Frontend → `Destroyed` (echte WKWebView) |

**Behoben (Code)**

- **Beenden über Dock / Abmelden / Apple-Event `quit` (macOS)** ging ohne
  Rückfrage an allen ungespeicherten Änderungen vorbei. Jetzt ergänzt
  `mac_quit` zur Laufzeit `applicationShouldTerminate:` am App-Delegate von
  tao (`objc2` 0.6.4, bereits im Lockfile über tao/wry, nur als direkte
  macOS-Abhängigkeit eingetragen). Das Frontend meldet per
  `set_quit_guard`, ob etwas verloren ginge (ungespeicherter Tab, laufendes
  Speichern, längere Aufgabe). Nichts zu verlieren → sofort beenden
  (Abmelden läuft weiter); sonst Beenden abbrechen und das Fenster wie mit
  dem roten Knopf schließen → bekannte Rückfragen. Tauri bietet dafür
  nichts: `RunEvent::ExitRequested` kommt bei `terminate:` nicht (tao ruft
  nur `applicationWillTerminate` → Exit).
- **„Auswahl exportieren“ und „Übernehmen“ im Seiten-Dialog** zählen jetzt
  zur Rückfrage „pdfedit arbeitet noch“ (UI-Lauf: Schließen während des
  Exports fragt, Abbrechen lässt die App offen).
- **Komprimieren**: Der Dialog ließ sich während des Laufs schließen; das
  Ergebnis ersetzte danach das Dokument und verwarf Änderungen, die
  inzwischen gemacht wurden. Schließen ist jetzt gesperrt, solange es läuft.
  Komprimieren und Schwärzen lassen den Busy-Zustand („Komprimiere …“,
  „Schwärze …“) erst zeichnen, bevor die Arbeit beginnt.
- **Bereich ersetzen** ließ Formularfelder der Seite ohne Widget im
  AcroForm zurück (Wert weiter in der Datei, Feld im Objekte-Panel, aber
  nirgends sichtbar). Felder, deren Widgets alle auf dieser Seite liegen,
  werden jetzt entfernt; ihr Aussehen steckt im Seitenbild.
- **Suche**: Die Hilfe versprach „Vor/Zurück durch die Treffer“, es gab nur
  „weiter“ (Enter). Jetzt Umschalt+Enter = vorheriger Treffer, Tooltip am
  Suchfeld (DE/EN).

**Falsche Aussagen korrigiert (Text, DE+EN)**

- Schwärzen-Bestätigung: „Andere Seiten bleiben unverändert“ — falsch, alle
  Formularfelder des Dokuments werden flachgerechnet. Text sagt das jetzt.
- Hilfe „Bereich bearbeiten“: „bestehende Anmerkungen im Bereich gehen
  verloren (pdfedit warnt vorher)“ — tatsächlich betrifft es alle
  Anmerkungen, Links und Formularfelder der Seite, und der Dialog warnte
  nicht. Hilfe und Dialog-Hinweis korrigiert.
- Hilfe „Stempel“: „per Klick platzieren“ — der Stempel erscheint mittig im
  sichtbaren Teil der aktuellen Seite und wird per Ziehen verschoben.
- Hilfe (DE) nannte Knöpfe, die es so nicht gibt: „Anwenden“ (Seiten-Dialog
  heißt „Übernehmen“), „Leeren“ (heißt „Löschen“), „Seitenbreite“/„Ganze
  Seite“ (heißen „Breite“/„Seite“), „Formular flachrechnen“ (heißt „Formular
  flach rechnen“). `test_help_quotes_only_real_labels` gleicht jetzt alle
  zitierten Begriffe der Hilfe gegen die UI-Texte der Sprache ab
  (Ausnahmen: Acrobat-Begriffe, Dock-Menü „Beenden“/„Quit“).
- Hilfe „Seiten“: Leerseite „an beliebiger Stelle“ — sie wird als A4 hinten
  angefügt und mit ↑/↓ verschoben; Drehen/Löschen ergänzt.
- Schwärzen: „Beides entfernt den Inhalt“ bei drei Stilen → „Alle drei“;
  Startseiten-Text nennt jetzt auch „weichgezeichnet“.
- README: „mit pdfedit inked … Text mit Umbruch, Bilder, Vektorobjekte“ —
  die App hat keine Tarif-Freischaltung, Fließtext mit Umbruch und
  Vektorbearbeitung gibt es nicht. README sagt jetzt „geplant“.

**Geprüft ohne Befund** (Code gelesen; * = zusätzlich ausgeführt)

Format-/Seitenzahl-Grenzen „Neues PDF“ (A3–Legal, 1–500), Formularfeld-Typen,
Signatur-Grund, Berechtigungen (Drucken/Kopieren/Ändern/Ausfüllen/
Kommentieren), OCR-Sprachen einzeln/kombiniert und lokale Sprachdaten
(`public/tessdata`, keine CDN-Pfade), Metadaten-Bereinigung (Titel, Autor,
Thema, Stichwörter, Ersteller, Producer, XMP), Komprimier-Grenzen,
Update-Intervalle (Start, 4 h, Fokus nach 30 min), Update-Endpoint
`LAN-SOLO/pdfedit`, Lese-/Schreib-Allow-Liste* (Runde 2 hat `read_pdf`
bereits auf Dialog-/Drop-/Speicher-Pfade beschränkt — der Rest aus der
Aufgabenliste war damit erledigt), atomares Speichern* inkl.
schreibgeschütztem Ordner, Hell/Dunkel-Knopf, Seitensprung per Enter,
Farbwähler, Laufweiten-Verdichtung (Tz ≥ 82 %). DE- und EN-Hilfe haben
dieselben 19 Abschnitte und 66 Aufzählungspunkte.

**Nutzerwege** (UI-Lauf je DE/EN × Dunkel/Hell, sofern nicht anders genannt)

1. Start → „PDF öffnen“ abgebrochen → kein Tab, keine Meldung.
2. Öffnen einer gesperrten Datei → übersetzte Meldung ohne OS-Text.
3. PDF mit Umlaut-/Leerzeichen-Pfad öffnen, externer Link (kopiert statt
   navigiert), interner Link (Seite 2).
4. Objekte-Panel: Feld löschen → native Rückfrage, Abbrechen behält es.
5. Ungespeicherten Tab bzw. Fenster schließen → Abbrechen behält alles.
6. Speichern scheitert (`io.locked`, `io.full`, `io.denied`) → übersetzt,
   Tab bleibt ungespeichert, Beenden-Schutz an; Rust-Test: schreib­geschützter
   Ordner auf echtem APFS, Original unverändert, keine Temp-Datei.
7. Langsames Speichern → kein zweiter Schreibvorgang, danach sauber,
   Beenden-Schutz aus.
8. Seiten-Dialog: Auswahl exportieren (langsam) → Schließen fragt „arbeitet
   noch“; Meldung mit Dateinamen; danach speichern → Schutz aus.
9. Schwärzen (3 Stile), Bereich ersetzen (Text, Felder), Komprimieren,
   OCR, JPEG 2000 (Browser-E2E, Chromium).
10. macOS-Beenden per Apple-Event am echten Debug-Build (siehe Tabelle).
11. „App-Neustart mitten in der Aufgabe“: nur auf Ebene des atomaren
    Schreibens geprüft (Rust-Tests: kein halbes PDF, Temp-Datei weg) — eine
    Sitzungs-Wiederherstellung gibt es nicht; ungespeicherte Arbeit schützt
    allein die Beenden-Rückfrage.

**Weiter offen / bewusst nicht geändert**

- **Worker für Komprimieren/Schwärzen**: nicht umgebaut. Schwärzen und
  Bereich ersetzen rendern mit pdf.js auf DOM-Canvas, Komprimieren nutzt
  `createImageBitmap`/`canvas.toBlob`; ein Worker bräuchte OffscreenCanvas
  und eine zweite pdf.js-Instanz im Worker — in WKWebView/WebView2 heute
  nicht prüfbar. Abgemildert: Busy-Zustand wird vorher gezeichnet, die
  Dialoge sind während des Laufs gesperrt, die Arbeit gibt zwischen Seiten
  bzw. Bildern den Thread frei (await auf Blob/Bitmap).
- **Windows Abmelden/Herunterfahren** (`WM_QUERYENDSESSION`): nicht
  abgefangen — tao 0.35.3 verarbeitet `WM_QUERYENDSESSION` laut eigenem
  Quelltext-Kommentar noch nicht (`event_loop.rs`), ein eigener Hook bräuchte
  Win32-Subclassing (nicht auf echter Hardware prüfbar).
- macOS: Hat pdfedit etwas zu verlieren, bricht es Abmelden/Ausschalten ab
  (System meldet „pdfedit hat das Abmelden abgebrochen“); nach den
  Rückfragen muss der Nutzer neu abmelden. Bewusst so — ein
  `NSTerminateLater` mit Antwort nach den Dialogen wäre eleganter, aber das
  Verhalten der Webview im modalen Run-Loop ist hier nicht prüfbar.
- Menüeintrag „Quit pdfedit“ weiter englisch; `zip` 4.6.1 im Updater,
  `node-forge`-Advisory, `cargo fmt` wie in Abschnitt 10.

**Nur auf echter Hardware prüfbar (zusätzlich zu 7, 9, 10)**

- macOS: Dokument ändern → im Dock „Beenden“ → Rückfrage „ungespeicherte
  Änderungen“; Abbrechen lässt die App offen; „Verwerfen und beenden“
  beendet. Dasselbe beim Abmelden (danach erneut abmelden). Ohne Änderungen
  beendet „Beenden“ im Dock sofort und hält das Abmelden nicht auf.
- macOS/Windows: Seiten-Dialog → „Auswahl exportieren“ → während des
  Schreibens Fenster schließen → „pdfedit arbeitet noch“.
- Komprimieren eines großen Scan-PDFs: „Komprimiere …“ erscheint sofort,
  Dialog lässt sich währenddessen nicht schließen.
- Suche: Umschalt+Enter springt rückwärts (WKWebView/WebView2).
- Windows: Abmelden mit ungespeichertem Tab — Verhalten beobachten
  (vermutlich Verlust ohne Rückfrage, siehe offen).
