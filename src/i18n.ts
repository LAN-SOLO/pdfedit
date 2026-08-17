/** Minimal UI strings (de/en) for the app shell — grows with the real UI. */
const de = {
  subtitle: 'PDFs bearbeiten, bis ins kleinste Detail',
  statusTitle: 'Beta',
  statusText:
    'pdfedit öffnet mehrere PDFs in Tabs, zeigt sie mit Zoom und flüssigem ' +
    'Blättern an — und erstellt neue PDFs in den klassischen Formaten. ' +
    'Anmerkungen, Formulare und Bearbeitung ziehen als nächste Updates ein, ' +
    'jeweils mit Changelog vor der Installation.',
  openPdf: 'PDF öffnen',
  newPdf: 'Neues PDF',
  dropHint: 'Oder eine PDF-Datei einfach ins Fenster ziehen.',
  loading: 'Lade PDF …',
  loadError: 'PDF konnte nicht geladen werden',
  pageCount: (n: number) => (n === 1 ? '1 Seite' : `${n} Seiten`),
  fitWidth: 'Breite',
  close: 'Schließen',
  closeTab: 'Tab schließen',
  newPdfTitle: 'Neues PDF erstellen',
  formatLabel: 'Format',
  orientationLabel: 'Ausrichtung',
  portrait: 'Hochformat',
  landscape: 'Querformat',
  pagesLabel: 'Seiten',
  create: 'Erstellen',
  cancel: 'Abbrechen',
  untitled: 'Unbenannt.pdf',
  createError: 'PDF konnte nicht erstellt werden',
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
    'pdfedit opens multiple PDFs in tabs, displays them with zoom and ' +
    'smooth scrolling — and creates new PDFs in the classic page formats. ' +
    'Annotations, forms and editing arrive as the next updates, each with ' +
    'the changelog shown before installing.',
  openPdf: 'Open PDF',
  newPdf: 'New PDF',
  dropHint: 'Or just drop a PDF file into the window.',
  loading: 'Loading PDF …',
  loadError: 'Could not load the PDF',
  pageCount: (n: number) => (n === 1 ? '1 page' : `${n} pages`),
  fitWidth: 'Fit width',
  close: 'Close',
  closeTab: 'Close tab',
  newPdfTitle: 'Create a new PDF',
  formatLabel: 'Format',
  orientationLabel: 'Orientation',
  portrait: 'Portrait',
  landscape: 'Landscape',
  pagesLabel: 'Pages',
  create: 'Create',
  cancel: 'Cancel',
  untitled: 'Untitled.pdf',
  createError: 'Could not create the PDF',
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
