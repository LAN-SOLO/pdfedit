import { t } from './i18n';

/** Turns any error (an IPC error string from Rust, an Error thrown in the
 *  frontend, anything else) into text in the UI language.
 *
 *  Rust and some frontend modules report stable codes — `area.what`,
 *  optionally followed by `: detail` (e.g. `io.locked: Der Prozess kann …`).
 *  Known codes become the translated sentence; the detail (OS/updater text)
 *  is appended in brackets only where it adds information. Unknown text is
 *  passed through unchanged. */
export function errText(err: unknown, dict: { errors: Record<string, string> } = t): string {
  const raw =
    err instanceof Error ? err.message : typeof err === 'string' ? err : String((err as Error)?.message ?? err);
  const m = /^([a-z]+\.[a-z_]+)(?::\s*([\s\S]*))?$/.exec(raw.trim());
  if (!m) return raw;
  const text = dict.errors[m[1]];
  if (!text) return raw;
  const detail = (m[2] ?? '').trim();
  // the generic codes need the detail; for the specific ones it's noise
  const showDetail = detail && (m[1] === 'io.other' || m[1].startsWith('update.'));
  return showDetail ? `${text}: ${detail}` : text;
}
