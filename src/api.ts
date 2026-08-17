import { invoke } from '@tauri-apps/api/core';

/** True when running inside the Tauri shell (false in plain-browser dev). */
export const isTauri = '__TAURI_INTERNALS__' in window;

/** Update found on GitHub Releases (latest.json), incl. the changelog notes. */
export interface UpdateInfo {
  version: string;
  notes: string | null;
  date: string | null;
}

export const api = {
  pickPdf: () => invoke<string | null>('pick_pdf'),
  readPdf: (path: string) => invoke<ArrayBuffer>('read_pdf', { path }),
  checkUpdate: () => invoke<UpdateInfo | null>('check_update'),
  installUpdate: () => invoke<void>('install_update'),
};
