import { useState } from 'react';
import { t } from '../i18n';

// Selbstständiges Hilfe-System: schwebender ?-Button, First-Run-Tutorial
// und durchsuchbares Handbuch. Sprache folgt wie i18n.ts der Systemsprache.

interface Step {
  title: string;
  body: string[];
}

interface Section {
  id: string;
  title: string;
  body: string[];
}

interface Content {
  labels: {
    fab: string;
    tutorial: string;
    manual: string;
    search: string;
    next: string;
    back: string;
    skip: string;
    done: string;
    stepOf: (n: number, total: number) => string;
    noResults: string;
  };
  tutorial: Step[];
  sections: Section[];
}

const de: Content = {
  labels: {
    fab: 'Hilfe & Handbuch',
    tutorial: 'Tutorial',
    manual: 'Handbuch',
    search: 'Handbuch durchsuchen …',
    next: 'Weiter',
    back: 'Zurück',
    skip: 'Überspringen',
    done: 'Los geht’s',
    stepOf: (n, total) => `Schritt ${n} von ${total}`,
    noResults: 'Keine Treffer',
  },
  tutorial: [
    {
      title: 'Willkommen bei pdfedit.',
      body: [
        'pdfedit liest, organisiert und bearbeitet PDFs — komplett lokal auf deinem Rechner.',
        'Öffne eine Datei über „PDF öffnen“ oder zieh sie einfach ins Fenster. Mehrere PDFs laufen nebeneinander in Tabs.',
        'Dieses Tutorial dauert eine Minute. Du findest es jederzeit wieder über den ?-Knopf unten rechts.',
      ],
    },
    {
      title: 'Lesen & Suchen',
      body: [
        '• Zoom: vergrößern, verkleinern, „Seitenbreite“ und „Ganze Seite“',
        '• Suche: Text im Dokument finden, Treffer für Treffer',
        '• Seitenleiste: Übersicht aller Seiten, per Knopf ein- und ausblendbar',
      ],
    },
    {
      title: 'Seiten organisieren',
      body: [
        'Im Seiten-Panel stellst du Dokumente um:',
        '• Seiten neu anordnen und leere Seiten einfügen',
        '• Ein zweites PDF anhängen (zusammenführen)',
        '• Ausgewählte Seiten als eigenes PDF exportieren',
        'Änderungen werden erst mit „Anwenden“ ins Dokument geschrieben.',
      ],
    },
    {
      title: 'Stempel & Signatur',
      body: [
        'Der Stempel-Dialog bringt drei Wege, etwas aufs PDF zu setzen:',
        '• Zeichnen — z. B. eine Unterschrift mit Maus oder Trackpad',
        '• Tippen — Text als Stempel',
        '• Bild — ein vorhandenes Bild (etwa eine gescannte Unterschrift) platzieren',
      ],
    },
    {
      title: 'Anmerken mit Eigenschaften',
      body: [
        'Bei Markieren, Text und Zeichnen erscheint eine Eigenschaften-Leiste unter den Werkzeugen:',
        '• Farbe — per Klick auf ein Farbfeld, gilt auch für die gerade ausgewählte Anmerkung',
        '• Größe (Text), Stärke und Deckkraft (Zeichnen), Stärke (freies Markieren)',
        '• Schrift (Text) — Helvetica, Times, Courier oder jede installierte Systemschrift',
        'Alles wird als ISO-32000-Anmerkung gespeichert und bleibt in Acrobat & Co. bearbeitbar.',
      ],
    },
    {
      title: 'Inhalte ändern',
      body: [
        '• Text ändern — bestehende Textzeile anklicken: Tippfehler korrigieren, Farbe/Größe/Schrift ändern',
        '• Seiten per Drag & Drop in der Seitenleiste umsortieren',
        '• Schwärzen — jetzt wahlweise schwarz oder verpixelt',
        '• Wasserzeichen — unsichtbares PNG einbetten und prüfen: ausgetauschte Seiten fallen auf',
      ],
    },
    {
      title: 'Formulare, Signatur & Schutz',
      body: [
        '• Formularfeld — Bereich aufziehen, Typ wählen (Textfeld, Kontrollkästchen, Auswahlliste) — sofort ausfüllbar',
        '• Signieren — kryptografische digitale Signatur mit Zertifikat (.p12/.pfx), sichtbar oder unsichtbar',
        '• Schutz — Passwort setzen, ändern oder entfernen (AES-256), plus Berechtigungen wie Drucken/Kopieren',
        'Passwortgeschützte PDFs öffnet pdfedit nach Passwort-Eingabe ganz normal.',
      ],
    },
    {
      title: 'Die Werkzeuge',
      body: [
        '• Komprimieren — Dokument verkleinern, Preset wählen, Ergebnis sehen',
        '• Schwärzen — Bereiche markieren und wirklich aus der Datei entfernen (nicht nur überdecken)',
        '• OCR — gescannte Seiten lokal in durchsuchbaren Text verwandeln (Deutsch/Englisch)',
        '• Bereich bearbeiten — Text oder Bild in einem markierten Bereich ersetzen',
        '• Formulare flachrechnen — Formularfelder fest ins Dokument einbrennen',
      ],
    },
    {
      title: 'Speichern & Updates',
      body: [
        'Ungespeicherte Änderungen erkennst du am Tab — beim Schließen fragt pdfedit sicherheitshalber nach.',
        'pdfedit prüft beim Start automatisch auf Updates: Changelog ansehen, dann installieren — nie ungefragt.',
        'Version und Update-Prüfung findest du jederzeit unten in diesem Hilfe-Fenster.',
      ],
    },
  ],
  sections: [
    {
      id: 'open',
      title: 'Öffnen, Tabs & Neu',
      body: [
        'PDFs öffnest du über den „PDF öffnen“-Dialog oder per Drag & Drop ins Fenster. Jedes Dokument bekommt einen eigenen Tab — beliebig viele parallel.',
        '„Neues PDF“ erstellt ein leeres Dokument: Format (z. B. A4), Hoch- oder Querformat und Seitenzahl wählen.',
        'Tabs mit ungespeicherten Änderungen sind markiert; beim Schließen (Tab oder App) fragt pdfedit nach, bevor etwas verloren geht.',
      ],
    },
    {
      id: 'view',
      title: 'Anzeigen & Suchen',
      body: [
        '• Zoom — vergrößern/verkleinern per Knopf; „Seitenbreite“ füllt die Breite, „Ganze Seite“ zeigt die komplette Seite',
        '• Seitenleiste — Miniaturen aller Seiten zum schnellen Springen, ein-/ausblendbar',
        '• Suche — Volltextsuche im Dokument mit Vor/Zurück durch die Treffer',
      ],
    },
    {
      id: 'annotate',
      title: 'Anmerken & Eigenschaften',
      body: [
        'Markieren, Text und Zeichnen legen echte ISO-32000-Anmerkungen an — sie bleiben in Acrobat & Co. sichtbar und dort weiter bearbeitbar.',
        'Sobald eines dieser Werkzeuge aktiv ist, erscheint die Eigenschaften-Leiste:',
        '• Farbe — Farbfelder anklicken; wirkt auf neue und auf gerade ausgewählte Anmerkungen',
        '• Größe — Schriftgröße des Text-Werkzeugs',
        '• Stärke & Deckkraft — Strichbreite und Transparenz beim Zeichnen',
        '• Stärke beim Markieren — gilt für freies Markieren neben Text',
        '• Schrift beim Text-Werkzeug — Helvetica (Standard), Times, Courier oder jede installierte Systemschrift; die gewählte Schrift wird beim Speichern in die Datei eingebettet',
        'Grenze, ehrlich benannt: Bearbeitet ein anderes Programm die Textbox später, kann deren Darstellung auf die Standardschrift zurückfallen. Ausrichtung ist (noch) fest.',
      ],
    },
    {
      id: 'textedit',
      title: 'Text ändern',
      body: [
        '„Text ändern" korrigiert bestehenden Text direkt auf der Seite (bei digital erzeugten PDFs, nicht bei Scans — dafür erst OCR):',
        '• Werkzeug aktivieren und die Textzeile anklicken',
        '• Text korrigieren, Farbe (auch frei wählbar), Größe und Schrift festlegen',
        'Der neue Text wird als echter, durchsuchbarer Text geschrieben; die Originalzeile wird mit der Hintergrundfarbe der Seite überdeckt.',
        'Ehrlich benannt: Das Original bleibt unsichtbar in der Datei zurück (endgültig entfernen: Schwärzen), und die exakte Schrift/Laufweite des Originals wird nicht immer getroffen. Echte Fließtext-Bearbeitung mit Umbruch ist der nächste große Meilenstein.',
      ],
    },
    {
      id: 'watermark',
      title: 'Unsichtbares Wasserzeichen',
      body: [
        'Der Wasserzeichen-Dialog bettet ein PNG (Transparenz bleibt erhalten) unsichtbar in gewählte oder alle Seiten ein und vermerkt es pro Seite.',
        'Der Prüfen-Tab liest die Markierungen wieder aus:',
        '• Seiten ohne Wasserzeichen → möglicherweise ausgetauscht',
        '• Position stimmt nicht mehr → Seiten wurden umsortiert',
        '• Unterschiedliche Wasserzeichen → vermischte Herkunft',
        '• Optional gegen das Original-PNG prüfen (Hash-Vergleich)',
        'Einordnung: Manipulations-Erkennung für den Alltag, kein kryptografischer Beweis — für belastbare Integrität zusätzlich digital signieren.',
      ],
    },
    {
      id: 'formfields',
      title: 'Formularfelder erstellen',
      body: [
        '„Formularfeld“ macht aus jedem PDF ein ausfüllbares Formular (wie Acrobats „Formular vorbereiten“):',
        '• Bereich auf der Seite aufziehen — dort entsteht das Feld',
        '• Typ wählen: Textfeld, mehrzeiliges Textfeld, Kontrollkästchen oder Auswahlliste',
        '• Feldname und Vorbelegung festlegen, bei Auswahllisten die Optionen',
        'Die Felder sind echte AcroForm-Felder: sofort in pdfedit ausfüllbar und in jedem anderen PDF-Programm ebenso.',
        'Mit „Formular flachrechnen“ lassen sich ausgefüllte Werte später dauerhaft einbrennen.',
      ],
    },
    {
      id: 'sign',
      title: 'Digital signieren',
      body: [
        '„Signieren“ erstellt eine kryptografische Signatur mit einem Zertifikat (PKCS#12: .p12/.pfx) — das Gegenstück zu Acrobats „Mit Zertifikat signieren“.',
        '• Zertifikat wählen und Passwort eingeben — pdfedit zeigt sofort, auf wen es ausgestellt ist',
        '• Sichtbar (Feld auf der Seite aufziehen) oder unsichtbar signieren',
        '• Optional einen Grund angeben (z. B. „Freigabe“)',
        'Prüfprogramme wie Acrobat verifizieren die Signatur; jede spätere Änderung am Dokument wird dort sichtbar.',
        'Hinweis: Selbst erstellte Zertifikate erscheinen als „Aussteller unbekannt“ — volle Vertrauensketten brauchen ein Zertifikat einer Zertifizierungsstelle. Qualifizierte Signaturen (QES) sind bewusst nicht versprochen.',
      ],
    },
    {
      id: 'protect',
      title: 'Passwort & Berechtigungen',
      body: [
        'Der Schutz-Dialog ist die Passwort-Zentrale des Dokuments:',
        '• Passwort setzen oder ändern — das Dokument wird beim Speichern mit AES-256 verschlüsselt',
        '• Besitzer-Passwort & Berechtigungen — Drucken, Kopieren, Ändern, Ausfüllen, Kommentieren gezielt erlauben oder sperren',
        '• Passwort entfernen — speichert das Dokument unverschlüsselt',
        'Passwortgeschützte PDFs öffnet pdfedit nach der Passwort-Abfrage ganz normal; beim Speichern bleibt der Schutz mit dem bekannten Passwort erhalten, bis du ihn hier änderst.',
        'Zur Einordnung: Berechtigungen ohne Öffnen-Passwort sind eine Konventionsgrenze, die PDF-Programme respektieren — gegen das Öffnen schützt nur das Öffnen-Passwort selbst.',
      ],
    },
    {
      id: 'pages',
      title: 'Seiten organisieren',
      body: [
        'Schnellster Weg: Seiten direkt in der Seitenleiste per Drag & Drop umsortieren. Das Seiten-Panel ist die Werkbank für alles Weitere:',
        '• Umsortieren — Seiten in neue Reihenfolge bringen',
        '• Leere Seite einfügen — an beliebiger Stelle',
        '• Zusammenführen — ein weiteres PDF ans Dokument anhängen',
        '• Ausgewählte Seiten exportieren — als neues, eigenes PDF speichern',
        'Wichtig: Erst „Anwenden“ schreibt die Änderungen ins Dokument; bis dahin ist alles unverbindlich.',
      ],
    },
    {
      id: 'stamp',
      title: 'Stempel & Signaturen',
      body: [
        'Der Stempel-Dialog setzt Inhalte aufs PDF — in drei Varianten:',
        '• Zeichnen — Freihand, ideal für Unterschriften per Maus oder Trackpad',
        '• Tippen — Text, der als Stempel platziert wird',
        '• Bild — eine Bilddatei (z. B. gescannte Unterschrift) einfügen',
        'Nach der Wahl platzierst du den Stempel per Klick an der gewünschten Stelle. „Leeren“ setzt die Zeichenfläche zurück.',
        'Hinweis: Der Stempel ist eine sichtbare Grafik im Dokument — keine kryptografische Signatur.',
      ],
    },
    {
      id: 'compress',
      title: 'Komprimieren',
      body: [
        'Der Komprimieren-Dialog verkleinert das Dokument — vor allem durch Neukodierung eingebetteter Bilder.',
        'Preset wählen (stärker = kleinere Datei, sichtbarere Verluste), starten, Ergebnis prüfen: pdfedit zeigt die alte und neue Größe.',
        'Bringt ein Preset nichts (etwa bei reinen Text-PDFs), sagt pdfedit das ehrlich, statt eine kaum kleinere Datei zu feiern.',
      ],
    },
    {
      id: 'redact',
      title: 'Schwärzen',
      body: [
        'Schwärzen in pdfedit ist echtes Entfernen: Markierte Bereiche werden aus dem Dokumentinhalt gelöscht — nicht nur mit einem schwarzen Kasten überdeckt.',
        'Ablauf: Schwärzen aktivieren → Bereiche auf den Seiten markieren → „Anwenden“ → Sicherheitsabfrage bestätigen.',
        'Darstellung wählbar: schwarz übermalen oder verpixeln (Mosaik). Beides entfernt den Inhalt — verpixelter Text kann aber manchmal rekonstruiert werden, für wirklich Sensibles bleibt Schwarz die sichere Wahl.',
        'Optional werden dabei auch die Metadaten des Dokuments bereinigt (Autor, Titel, Erstellungsprogramm …).',
        'Achtung: Der Vorgang ist unwiderruflich. Formularfelder und Anmerkungen auf betroffenen Seiten werden mit entfernt. Im Zweifel vorher eine Kopie speichern.',
      ],
    },
    {
      id: 'ocr',
      title: 'OCR für Scans',
      body: [
        'OCR verwandelt gescannte Seiten in durchsuchbaren, kopierbaren Text — die Erkennung läuft komplett lokal, die Datei verlässt deinen Rechner nicht.',
        '• Umfang — ganzes Dokument oder nur die aktuelle Seite',
        '• Sprachen — Deutsch und Englisch, einzeln oder kombiniert',
        'Der erkannte Text wird unsichtbar hinter das Scan-Bild gelegt: Das Dokument sieht aus wie zuvor, lässt sich aber durchsuchen und markieren.',
      ],
    },
    {
      id: 'editregion',
      title: 'Bereich bearbeiten',
      body: [
        '„Bereich bearbeiten“ ersetzt Inhalte in einem markierten Rechteck:',
        '• Text — den Bereich mit neuem Text überschreiben',
        '• Bild — den Bereich durch eine Bilddatei ersetzen',
        'Der Bereich wird dabei geleert und neu gefüllt — bestehende Anmerkungen im Bereich gehen verloren (pdfedit warnt vorher).',
      ],
    },
    {
      id: 'flatten',
      title: 'Formulare flachrechnen',
      body: [
        '„Flachrechnen“ brennt ausgefüllte Formularfelder fest ins Dokument: Aus interaktiven Feldern wird normaler Seiteninhalt.',
        'Sinnvoll vor dem Versenden, wenn der Empfänger die Felder nicht mehr ändern soll — oder wenn ein Viewer Probleme mit Formularen hat.',
      ],
    },
    {
      id: 'save',
      title: 'Speichern',
      body: [
        '„Speichern“ schreibt das Dokument mit allen angewandten Änderungen.',
        'Tabs mit ungespeicherten Änderungen sind markiert; beim Schließen eines Tabs oder der App fragt pdfedit nach.',
      ],
    },
    {
      id: 'updates',
      title: 'Updates',
      body: [
        'pdfedit prüft beim Start und danach laufend (alle paar Stunden sowie beim Fenster-Fokus) auf neue Versionen — trifft ein Update auf GitHub ein, meldet sich die App von selbst. Liegt eine bereit, öffnet sich der Update-Dialog mit dem Changelog — installiert wird erst nach deinem Klick.',
        'Manuell prüfen: „Nach Updates suchen“.',
        'Updates kommen signiert von GitHub (LAN-SOLO/pdfedit): Die App prüft die Signatur, bevor irgendetwas installiert wird.',
      ],
    },
    {
      id: 'privacy',
      title: 'Privatsphäre',
      body: [
        'Alles läuft lokal: Rendering, OCR, Komprimierung, Schwärzung — deine Dokumente verlassen den Rechner nicht.',
        'Kein Konto, keine Telemetrie. Die einzige Netzwerkverbindung ist der Update-Check gegen GitHub.',
      ],
    },
  ],
};

const en: Content = {
  labels: {
    fab: 'Help & manual',
    tutorial: 'Tutorial',
    manual: 'Manual',
    search: 'Search the manual …',
    next: 'Next',
    back: 'Back',
    skip: 'Skip',
    done: 'Let’s go',
    stepOf: (n, total) => `Step ${n} of ${total}`,
    noResults: 'No matches',
  },
  tutorial: [
    {
      title: 'Welcome to pdfedit.',
      body: [
        'pdfedit reads, organizes and edits PDFs — entirely locally on your machine.',
        'Open a file via “Open PDF” or just drag it into the window. Multiple PDFs run side by side in tabs.',
        'This tutorial takes a minute. Reopen it anytime via the ? button in the bottom right.',
      ],
    },
    {
      title: 'Reading & searching',
      body: [
        '• Zoom: in, out, “fit width” and “fit page”',
        '• Search: find text in the document, hit by hit',
        '• Sidebar: overview of all pages, toggleable',
      ],
    },
    {
      title: 'Organizing pages',
      body: [
        'The pages panel restructures documents:',
        '• Reorder pages and insert blank ones',
        '• Append another PDF (merge)',
        '• Export selected pages as their own PDF',
        'Changes are only written with “Apply”.',
      ],
    },
    {
      title: 'Stamps & signature',
      body: [
        'The stamp dialog offers three ways to put something on the PDF:',
        '• Draw — e.g. a signature with mouse or trackpad',
        '• Type — text as a stamp',
        '• Image — place an existing image (like a scanned signature)',
      ],
    },
    {
      title: 'Annotating with properties',
      body: [
        'With Highlight, Text and Draw active, a properties bar appears below the tools:',
        '• Color — click a swatch; also applies to the currently selected annotation',
        '• Size (text), thickness and opacity (drawing), thickness (free highlighting)',
        '• Font (text) — Helvetica, Times, Courier or any installed system font',
        'Everything is stored as ISO 32000 annotations and stays editable in Acrobat & co.',
      ],
    },
    {
      title: 'Changing content',
      body: [
        '• Edit text — click an existing text line: fix typos, change color/size/font',
        '• Reorder pages by drag & drop in the sidebar',
        '• Redact — now solid black or pixelated',
        '• Watermark — embed and verify an invisible PNG: swapped pages stand out',
      ],
    },
    {
      title: 'Forms, signature & protection',
      body: [
        '• Form field — drag an area, pick a type (text field, checkbox, dropdown) — instantly fillable',
        '• Sign — cryptographic digital signature with a certificate (.p12/.pfx), visible or invisible',
        '• Protect — set, change or remove a password (AES-256), plus permissions like printing/copying',
        'Password-protected PDFs open normally after entering the password.',
      ],
    },
    {
      title: 'The tools',
      body: [
        '• Compress — shrink the document, pick a preset, see the result',
        '• Redact — mark areas and truly remove them from the file (not just cover them)',
        '• OCR — turn scanned pages into searchable text, locally (German/English)',
        '• Edit region — replace text or an image inside a marked area',
        '• Flatten forms — bake form fields into the document',
      ],
    },
    {
      title: 'Saving & updates',
      body: [
        'Tabs with unsaved changes are marked — pdfedit asks before anything is lost on close.',
        'pdfedit checks for updates on launch: view the changelog, then install — never unasked.',
        'Version and update check are always available at the bottom of this help window.',
      ],
    },
  ],
  sections: [
    {
      id: 'open',
      title: 'Opening, tabs & new',
      body: [
        'Open PDFs via the “Open PDF” dialog or by dragging them into the window. Every document gets its own tab — as many as you like.',
        '“New PDF” creates an empty document: choose format (e.g. A4), portrait or landscape, and page count.',
        'Tabs with unsaved changes are marked; when closing (tab or app) pdfedit asks before anything is lost.',
      ],
    },
    {
      id: 'view',
      title: 'Viewing & search',
      body: [
        '• Zoom — in/out via buttons; “fit width” fills the width, “fit page” shows the whole page',
        '• Sidebar — thumbnails of all pages for quick jumps, toggleable',
        '• Search — full-text search with next/previous through the hits',
      ],
    },
    {
      id: 'annotate',
      title: 'Annotating & properties',
      body: [
        'Highlight, Text and Draw create real ISO 32000 annotations — they stay visible and editable in Acrobat & co.',
        'As soon as one of these tools is active, the properties bar appears:',
        '• Color — click a swatch; applies to new and to currently selected annotations',
        '• Size — font size of the Text tool',
        '• Thickness & opacity — stroke width and transparency when drawing',
        '• Highlight thickness — applies to free highlighting next to text',
        '• Text-tool font — Helvetica (default), Times, Courier or any installed system font; the chosen font is embedded into the file on save',
        'One honest limit: if another app later edits the text box, its rendering may fall back to the default font. Alignment is fixed (for now).',
      ],
    },
    {
      id: 'textedit',
      title: 'Edit text',
      body: [
        '"Edit text" corrects existing text right on the page (for born-digital PDFs, not scans — run OCR first for those):',
        '• Activate the tool and click the text line',
        '• Fix the text, pick a color (fully custom too), size and font',
        'The new text is written as real, searchable text; the original line is covered with the page background color.',
        'Honestly: the original remains invisibly in the file (remove for good: redaction), and the exact original typeface/spacing is not always matched. True reflow editing is the next big milestone.',
      ],
    },
    {
      id: 'watermark',
      title: 'Invisible watermark',
      body: [
        'The watermark dialog embeds a PNG (transparency preserved) invisibly into selected or all pages and records it per page.',
        'The verify tab reads the marks back:',
        '• Pages without the watermark → possibly swapped in',
        '• Recorded position no longer matches → pages were reordered',
        '• Different watermarks → mixed origin',
        '• Optionally check against the original PNG (hash comparison)',
        'For context: everyday tamper evidence, not cryptographic proof — for hard integrity, additionally sign digitally.',
      ],
    },
    {
      id: 'formfields',
      title: 'Creating form fields',
      body: [
        '“Form field” turns any PDF into a fillable form (like Acrobat’s “Prepare form”):',
        '• Drag an area on the page — the field is created there',
        '• Pick a type: text field, multiline text field, checkbox or dropdown',
        '• Set field name and default value, plus the options for dropdowns',
        'The fields are real AcroForm fields: instantly fillable in pdfedit and in every other PDF app.',
        '“Flatten form” can later bake filled-in values permanently into the pages.',
      ],
    },
    {
      id: 'sign',
      title: 'Signing digitally',
      body: [
        '“Sign” creates a cryptographic signature with a certificate (PKCS#12: .p12/.pfx) — the counterpart of Acrobat’s “Sign with certificate”.',
        '• Choose the certificate and enter its password — pdfedit immediately shows who it is issued to',
        '• Sign visibly (drag a field onto the page) or invisibly',
        '• Optionally state a reason (e.g. “Approval”)',
        'Validators like Acrobat verify the signature; any later change to the document becomes visible there.',
        'Note: self-created certificates show as “issuer unknown” — full trust chains need a CA-issued certificate. Qualified signatures (QES) are deliberately not promised.',
      ],
    },
    {
      id: 'protect',
      title: 'Password & permissions',
      body: [
        'The Protect dialog is the document’s password hub:',
        '• Set or change a password — the document is encrypted with AES-256 on save',
        '• Owner password & permissions — allow or block printing, copying, modifying, form filling, commenting',
        '• Remove password — saves the document unencrypted',
        'Password-protected PDFs open normally after the password prompt; saving keeps the protection with the known password until you change it here.',
        'For context: permissions without the open password are a convention that PDF apps respect — only the open password itself prevents opening.',
      ],
    },
    {
      id: 'pages',
      title: 'Organizing pages',
      body: [
        'Fastest route: reorder pages directly in the sidebar via drag & drop. The pages panel is the workbench for everything else:',
        '• Reorder — bring pages into a new order',
        '• Insert blank page — anywhere',
        '• Merge — append another PDF to the document',
        '• Export selected pages — save them as a new, separate PDF',
        'Important: only “Apply” writes the changes into the document; until then everything is tentative.',
      ],
    },
    {
      id: 'stamp',
      title: 'Stamps & signatures',
      body: [
        'The stamp dialog puts content onto the PDF — three ways:',
        '• Draw — freehand, ideal for signatures via mouse or trackpad',
        '• Type — text placed as a stamp',
        '• Image — insert an image file (e.g. a scanned signature)',
        'After choosing, click to place the stamp where you want it. “Clear” resets the drawing area.',
        'Note: the stamp is a visible graphic in the document — not a cryptographic signature.',
      ],
    },
    {
      id: 'compress',
      title: 'Compressing',
      body: [
        'The compress dialog shrinks the document — mainly by re-encoding embedded images.',
        'Pick a preset (stronger = smaller file, more visible loss), run it, check the result: pdfedit shows old and new size.',
        'If a preset achieves nothing (e.g. text-only PDFs), pdfedit says so honestly instead of celebrating a barely smaller file.',
      ],
    },
    {
      id: 'redact',
      title: 'Redacting',
      body: [
        'Redaction in pdfedit is real removal: marked areas are deleted from the document content — not just covered with a black box.',
        'Flow: enable redaction → mark areas on the pages → “Apply” → confirm the safety prompt.',
        'Choose the style: solid black or pixelate (mosaic). Both remove the content — but pixelated text can sometimes be reconstructed; for truly sensitive content black remains the safe choice.',
        'Optionally the document’s metadata is cleaned as well (author, title, creating application …).',
        'Caution: this cannot be undone. Form fields and annotations on affected pages are removed too. When in doubt, save a copy first.',
      ],
    },
    {
      id: 'ocr',
      title: 'OCR for scans',
      body: [
        'OCR turns scanned pages into searchable, copyable text — recognition runs entirely locally, the file never leaves your machine.',
        '• Scope — the whole document or just the current page',
        '• Languages — German and English, single or combined',
        'The recognized text is placed invisibly behind the scan image: the document looks unchanged but becomes searchable and selectable.',
      ],
    },
    {
      id: 'editregion',
      title: 'Edit region',
      body: [
        '“Edit region” replaces content inside a marked rectangle:',
        '• Text — overwrite the area with new text',
        '• Image — replace the area with an image file',
        'The area is cleared and refilled — existing annotations inside it are lost (pdfedit warns you first).',
      ],
    },
    {
      id: 'flatten',
      title: 'Flattening forms',
      body: [
        '“Flatten” bakes filled form fields into the document: interactive fields become ordinary page content.',
        'Useful before sending, when the recipient shouldn’t change the fields anymore — or when a viewer struggles with forms.',
      ],
    },
    {
      id: 'save',
      title: 'Saving',
      body: [
        '“Save” writes the document with all applied changes.',
        'Tabs with unsaved changes are marked; pdfedit asks before closing a tab or the app.',
      ],
    },
    {
      id: 'updates',
      title: 'Updates',
      body: [
        'pdfedit checks for new versions at launch and continuously afterwards (every few hours and on window focus) — when an update lands on GitHub, the app speaks up by itself. When one is available, the update dialog opens with the changelog — installing needs your click.',
        'Check manually: “Check for updates”.',
        'Updates come signed from GitHub (LAN-SOLO/pdfedit): the app verifies the signature before installing anything.',
      ],
    },
    {
      id: 'privacy',
      title: 'Privacy',
      body: [
        'Everything runs locally: rendering, OCR, compression, redaction — your documents never leave the machine.',
        'No account, no telemetry. The only network connection is the update check against GitHub.',
      ],
    },
  ],
};

// v3: bumped with 0.11.2 so the tutorial (now also covering text editing,
// fonts, watermarks and sidebar reordering) shows once more for existing users.
const SEEN_KEY = 'pdfedit.tutorialSeen.v3';

interface HelpProps {
  version: string;
  updateState: 'unknown' | 'none' | 'available';
  updateVersion: string | null;
  checking: boolean;
  onCheckUpdate: () => void;
  onOpenUpdate: () => void;
}

export default function Help({
  version,
  updateState,
  updateVersion,
  checking,
  onCheckUpdate,
  onOpenUpdate,
}: HelpProps) {
  const c = navigator.language.toLowerCase().startsWith('de') ? de : en;
  const [mode, setMode] = useState<'closed' | 'tutorial' | 'manual'>(() =>
    localStorage.getItem(SEEN_KEY) ? 'closed' : 'tutorial'
  );
  const [step, setStep] = useState(0);
  const [sel, setSel] = useState(c.sections[0].id);
  const [q, setQ] = useState('');

  const close = () => {
    localStorage.setItem(SEEN_KEY, '1');
    setMode('closed');
    setStep(0);
  };

  const query = q.trim().toLowerCase();
  const filtered = query
    ? c.sections.filter(
        (s) =>
          s.title.toLowerCase().includes(query) ||
          s.body.some((p) => p.toLowerCase().includes(query))
      )
    : c.sections;
  const current = filtered.find((s) => s.id === sel) ?? filtered[0] ?? null;

  return (
    <>
      <button className="hlp-fab" title={c.labels.fab} onClick={() => setMode('manual')}>
        ?
        {updateState === 'available' && <span className="hlp-badge" aria-hidden="true" />}
      </button>
      {mode !== 'closed' && (
        <div className="hlp-overlay" onClick={close}>
          <div className="hlp-modal" onClick={(e) => e.stopPropagation()}>
            <div className="hlp-head">
              <span className="hlp-brand">
                <span className="hlp-name">pdfedit</span>
                <span className="hlp-dot">.</span>
              </span>
              <button
                className={`hlp-tab ${mode === 'tutorial' ? 'active' : ''}`}
                onClick={() => {
                  setMode('tutorial');
                  setStep(0);
                }}
              >
                {c.labels.tutorial}
              </button>
              <button
                className={`hlp-tab ${mode === 'manual' ? 'active' : ''}`}
                onClick={() => setMode('manual')}
              >
                {c.labels.manual}
              </button>
              <span className="hlp-spacer" />
              <button className="hlp-close" onClick={close}>
                ✕
              </button>
            </div>

            {mode === 'tutorial' && (
              <div className="hlp-tut">
                <div className="hlp-step-count">
                  {c.labels.stepOf(step + 1, c.tutorial.length)}
                </div>
                <h2>{c.tutorial[step].title}</h2>
                {c.tutorial[step].body.map((p, i) =>
                  p.startsWith('• ') ? (
                    <div key={i} className="hlp-li">
                      {p.slice(2)}
                    </div>
                  ) : (
                    <p key={i}>{p}</p>
                  )
                )}
                <div className="hlp-tut-nav">
                  <button className="hlp-ghost" onClick={close}>
                    {c.labels.skip}
                  </button>
                  <span className="hlp-dots">
                    {c.tutorial.map((_, i) => (
                      <span key={i} className={i === step ? 'on' : ''} />
                    ))}
                  </span>
                  {step > 0 && (
                    <button onClick={() => setStep(step - 1)}>{c.labels.back}</button>
                  )}
                  {step < c.tutorial.length - 1 ? (
                    <button className="hlp-primary" onClick={() => setStep(step + 1)}>
                      {c.labels.next}
                    </button>
                  ) : (
                    <button className="hlp-primary" onClick={close}>
                      {c.labels.done}
                    </button>
                  )}
                </div>
              </div>
            )}

            {mode === 'manual' && (
              <div className="hlp-body">
                <div className="hlp-toc">
                  <input
                    type="text"
                    placeholder={c.labels.search}
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                  />
                  {filtered.length === 0 && (
                    <div className="hlp-empty">{c.labels.noResults}</div>
                  )}
                  {filtered.map((s) => (
                    <button
                      key={s.id}
                      className={`hlp-toc-item ${current?.id === s.id ? 'active' : ''}`}
                      onClick={() => setSel(s.id)}
                    >
                      {s.title}
                    </button>
                  ))}
                </div>
                <div className="hlp-content">
                  {current && (
                    <>
                      <h2>{current.title}</h2>
                      {current.body.map((p, i) =>
                        p.startsWith('• ') ? (
                          <div key={i} className="hlp-li">
                            {p.slice(2)}
                          </div>
                        ) : (
                          <p key={i}>{p}</p>
                        )
                      )}
                    </>
                  )}
                </div>
              </div>
            )}

            <div className="hlp-foot">
              {version && <span className="hlp-version">{t.helpVersion(version)}</span>}
              <span className="hlp-spacer" />
              {updateState === 'available' ? (
                <button
                  className="hlp-primary"
                  onClick={() => {
                    close();
                    onOpenUpdate();
                  }}
                >
                  {t.updateAvailable(updateVersion ?? '')} — {t.updateNow}
                </button>
              ) : (
                <>
                  {updateState === 'none' && <span className="hlp-uptodate">{t.upToDate}</span>}
                  <button onClick={onCheckUpdate} disabled={checking}>
                    {checking ? t.updateChecking : t.checkForUpdates}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
