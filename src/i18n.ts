/** Minimal UI strings (de/en) for the app shell — grows with the real UI. */
const de = {
  subtitle: 'PDFs bearbeiten, bis ins kleinste Detail',
  statusTitle: 'Beta',
  statusText:
    'pdfedit kann jetzt PDFs öffnen und anzeigen — mit Zoom und flüssigem ' +
    'Blättern. Anmerkungen, Formulare und Bearbeitung ziehen als nächste ' +
    'Updates ein, jeweils mit Changelog vor der Installation.',
  openPdf: 'PDF öffnen',
  dropHint: 'Oder eine PDF-Datei einfach ins Fenster ziehen.',
  loading: 'Lade PDF …',
  loadError: 'PDF konnte nicht geladen werden',
  pageCount: (n: number) => (n === 1 ? '1 Seite' : `${n} Seiten`),
  fitWidth: 'Breite',
  close: 'Schließen',
  checkForUpdates: 'Nach Updates suchen',
  updateChecking: 'Prüfe …',
  upToDate: 'pdfedit ist aktuell.',
  updateAvailable: (v: string) => `Update auf ${v} verfügbar`,
  updateNow: 'Jetzt aktualisieren',
  updateLater: 'Später',
  updateModalTitle: (v: string) => `Update auf Version ${v}`,
  publishedOn: (d: string) => `Veröffentlicht am ${d}`,
  changelogTitle: 'Was ist neu',
  noChangelog: 'Für dieses Update liegen keine Änderungsnotizen vor.',
  updateSafeNote:
    'Das Update ersetzt nur die App selbst (signiert & verifiziert) — Ihre Dokumente und Einstellungen bleiben unangetastet.',
  updateInstalling: 'Update wird installiert — die App startet gleich neu …',
  updateFailed: 'Update fehlgeschlagen',
};

const en: typeof de = {
  subtitle: 'Edit PDFs, down to the smallest detail',
  statusTitle: 'Beta',
  statusText:
    'pdfedit can now open and display PDFs — with zoom and smooth ' +
    'scrolling. Annotations, forms and editing arrive as the next updates, ' +
    'each with the changelog shown before installing.',
  openPdf: 'Open PDF',
  dropHint: 'Or just drop a PDF file into the window.',
  loading: 'Loading PDF …',
  loadError: 'Could not load the PDF',
  pageCount: (n: number) => (n === 1 ? '1 page' : `${n} pages`),
  fitWidth: 'Fit width',
  close: 'Close',
  checkForUpdates: 'Check for updates',
  updateChecking: 'Checking …',
  upToDate: 'pdfedit is up to date.',
  updateAvailable: (v: string) => `Update to ${v} available`,
  updateNow: 'Update now',
  updateLater: 'Later',
  updateModalTitle: (v: string) => `Update to version ${v}`,
  publishedOn: (d: string) => `Published on ${d}`,
  changelogTitle: "What's new",
  noChangelog: 'No release notes are available for this update.',
  updateSafeNote:
    'The update replaces only the app itself (signed & verified) — your documents and settings stay untouched.',
  updateInstalling: 'Installing update — the app will restart shortly …',
  updateFailed: 'Update failed',
};

export const t = navigator.language.toLowerCase().startsWith('de') ? de : en;
