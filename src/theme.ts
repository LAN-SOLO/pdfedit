/** Dark/Light-Modus. pdfedit hat keine Settings-Datei — die Wahl liegt im
 *  localStorage und wird in main.tsx VOR dem ersten Render auf <html
 *  data-theme> gesetzt, damit nichts flackert. 'dark' ist der Default. */
export type Theme = 'dark' | 'light';

const KEY = 'theme';

export function loadTheme(): Theme {
  try {
    return localStorage.getItem(KEY) === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    /* privater Modus o. ä. — dann gilt die Wahl nur für diese Sitzung */
  }
}
