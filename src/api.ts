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
  confirmDialog: (message: string, okLabel: string, cancelLabel: string) =>
    invoke<boolean>('confirm_dialog', { message, okLabel, cancelLabel }),
  listSystemFonts: () => invoke<SystemFont[]>('list_system_fonts'),
  readFont: (path: string) => invoke<ArrayBuffer>('read_font', { path }),
  checkUpdate: () => invoke<UpdateInfo | null>('check_update'),
  installUpdate: () => invoke<void>('install_update'),
};

/** OK/Cancel question. Inside Tauri a native dialog — `window.confirm` is
 *  replaced there by the dialog plugin's async stub (returns a Promise,
 *  i.e. always truthy) and must never be used. If the dialog itself fails,
 *  the answer is "cancel": losing unsaved work is the worse error. */
export async function askConfirm(message: string, okLabel: string, cancelLabel: string): Promise<boolean> {
  if (!isTauri) return window.confirm(message);
  try {
    return await api.confirmDialog(message, okLabel, cancelLabel);
  } catch {
    return false;
  }
}
