/** Minimal UI strings (de/en) for the app shell — grows with the real UI. */
const de = {
  subtitle: 'PDFs bearbeiten, bis ins kleinste Detail',
  statusTitle: 'Beta-Grundgerüst',
  statusText:
    'Das ist das App-Grundgerüst von pdfedit: Renderer und PDF-Engine ' +
    'entstehen gerade — Ansicht, Anmerkungen und Bearbeitung ziehen als ' +
    'Updates ein. Updates kommen ab jetzt signiert direkt in die App.',
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
  statusTitle: 'Beta shell',
  statusText:
    'This is the pdfedit app shell: the renderer and PDF engine are being ' +
    'built — viewing, annotations and editing arrive as updates. From now ' +
    'on, updates arrive signed, directly in the app.',
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
