import { invoke } from '@tauri-apps/api/core';

/** True when running inside the Tauri shell (false in plain-browser dev). */
export const isTauri = '__TAURI_INTERNALS__' in window;

/** Update found on GitHub Releases (latest.json), incl. the changelog notes. */
export interface UpdateInfo {
  version: string;
  notes: string | null;
  date: string | null;
}

/** An installed system font (TTF/OTF), as enumerated by the Rust side. */
export interface SystemFont {
  /** Display name (full name from the font's name table). */
  name: string;
  /** Family ("Arial") — empty when the name table couldn't be read. */
  family: string;
  /** Style/subfamily ("Bold", "Italic", "Regular", …). */
  style: string;
  path: string;
}

export const api = {
  pickPdf: () => invoke<string | null>('pick_pdf'),
  readPdf: (path: string) => invoke<ArrayBuffer>('read_pdf', { path }),
  pickSavePdf: (suggested: string) => invoke<string | null>('pick_save_pdf', { suggested }),
  writePdf: (path: string, dataB64: string) => invoke<void>('write_pdf', { path, dataB64 }),
  listSystemFonts: () => invoke<SystemFont[]>('list_system_fonts'),
  readFont: (path: string) => invoke<ArrayBuffer>('read_font', { path }),
  checkUpdate: () => invoke<UpdateInfo | null>('check_update'),
  installUpdate: () => invoke<void>('install_update'),
};
