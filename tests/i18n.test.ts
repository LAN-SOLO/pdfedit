import { assert } from './helpers';
import { dicts } from '../src/i18n';
import { errText } from '../src/errors';
import { parseUpdateDate } from '../src/updateDate';
import { localDateStamp } from '../src/sign';

// ---------------------------------------------------------------- i18n

/** Every key exists in both languages, with the same kind of value, and no
 *  string is empty — a missing English text would show `undefined`. */
export function test_i18n_de_en_parity() {
  const de = dicts.de as Record<string, unknown>;
  const en = dicts.en as Record<string, unknown>;
  for (const k of new Set([...Object.keys(de), ...Object.keys(en)])) {
    assert(k in de && k in en, `key ${k} missing in one language`);
    assert(typeof de[k] === typeof en[k], `key ${k} has different types`);
    if (typeof de[k] === 'string') assert((de[k] as string).trim() && (en[k] as string).trim(), `key ${k} empty`);
  }
  const deErr = dicts.de.errors;
  const enErr = dicts.en.errors;
  for (const k of new Set([...Object.keys(deErr), ...Object.keys(enErr)])) {
    assert(deErr[k] && enErr[k], `error code ${k} missing in one language`);
  }
}

/** Every error code the Rust side (src-tauri/src/main.rs) and the frontend
 *  modules can report has a translation. */
export function test_backend_error_codes_are_translated() {
  const codes = [
    'pdf.not_pdf',
    'pdf.not_found',
    'pdf.read_denied',
    'pdf.write_denied',
    'pdf.bad_data',
    'pdf.bad_name',
    'font.denied',
    'io.locked',
    'io.denied',
    'io.not_found',
    'io.full',
    'io.other',
    'update.check',
    'update.none',
    'update.install',
    'sign.no_key',
    'pages.empty',
  ];
  for (const c of codes) {
    for (const lang of ['de', 'en'] as const) {
      const out = errText(c, dicts[lang]);
      assert(out !== c && out.length > 3, `${lang}: ${c} not translated`);
    }
  }
}

export function test_err_text_maps_codes_and_keeps_details_where_useful() {
  // a German OS message never reaches the English UI for a specific code
  assert(
    errText('io.locked: Der Prozess kann nicht auf die Datei zugreifen', dicts.en) ===
      dicts.en.errors['io.locked'],
    'io.locked detail must be dropped'
  );
  assert(errText('io.locked: x', dicts.de) === dicts.de.errors['io.locked'], 'de io.locked');
  // the generic ones keep the detail
  assert(errText('io.other: boom', dicts.en) === `${dicts.en.errors['io.other']}: boom`, 'io.other detail');
  assert(
    errText('update.check: error sending request', dicts.de).startsWith('Update-Prüfung fehlgeschlagen: '),
    'update detail'
  );
  // Error objects (frontend throws) work the same
  assert(errText(new Error('pages.empty'), dicts.en) === dicts.en.errors['pages.empty'], 'Error object');
  // unknown text passes through unchanged
  assert(errText('Invalid PDF structure.', dicts.de) === 'Invalid PDF structure.', 'passthrough');
  assert(errText('foo.bar_baz', dicts.de) === 'foo.bar_baz', 'unknown code passthrough');
  assert(errText(42, dicts.de) === '42', 'non-error value');
}

// ---------------------------------------------------------------- dates

export function test_update_date_parsing() {
  // the `time` crate's Display form as Rust hands it over
  const a = parseUpdateDate('2026-10-19 12:00:00.0 +00:00:00');
  assert(a && a.toISOString() === '2026-10-19T12:00:00.000Z', `time Display: ${a?.toISOString()}`);
  const b = parseUpdateDate('2026-10-19 23:30:05.123456789 +02:00:00');
  assert(b && b.toISOString() === '2026-10-19T21:30:05.123Z', `offset: ${b?.toISOString()}`);
  const c = parseUpdateDate('2026-03-29T01:30:00Z');
  assert(c && c.toISOString() === '2026-03-29T01:30:00.000Z', 'RFC 3339');
  assert(parseUpdateDate(null) === null && parseUpdateDate('') === null, 'empty');
  assert(parseUpdateDate('soon') === null, 'garbage');
}

export function test_local_date_stamp_uses_local_calendar_day() {
  // 00:30 local time on 1 March — toISOString() would give 28/29 Feb in
  // any time zone east of UTC
  const d = new Date(2026, 2, 1, 0, 30, 0);
  assert(localDateStamp(d) === '2026-03-01', `got ${localDateStamp(d)}`);
  // DST switch day in Europe (last Sunday of March)
  assert(localDateStamp(new Date(2026, 2, 29, 3, 5)) === '2026-03-29', 'DST day');
  assert(localDateStamp(new Date(2026, 11, 31, 23, 59)) === '2026-12-31', 'year end');
}

/** Every UI label the manual quotes („…“ / “…”) is a real text of the app
 *  in that language — Round 3 found the German manual naming buttons that
 *  don't exist („Anwenden“ for „Übernehmen“, „Leeren“ for „Löschen“ …).
 *  Allowed: names from other programs and the macOS Dock menu. */
export async function test_help_quotes_only_real_labels() {
  const fs = await import('node:fs');
  const help = fs.readFileSync(new URL('../src/components/Help.tsx', import.meta.url), 'utf8');
  const foreign = new Set(['Formular vorbereiten', 'Prepare form', 'Beenden', 'Quit']);
  const parts = {
    de: help.slice(help.indexOf('const de: Content'), help.indexOf('const en: Content')),
    en: help.slice(help.indexOf('const en: Content'), help.indexOf('const SEEN_KEY')),
  };
  for (const lang of ['de', 'en'] as const) {
    const texts = JSON.stringify(dicts[lang], (_k, v) => (typeof v === 'function' ? String(v) : v));
    for (const m of parts[lang].matchAll(/[„“"]([^“”"„]{2,40})[“”"]/g)) {
      const q = m[1];
      if (foreign.has(q)) continue;
      assert(texts.includes(q), `${lang} manual quotes „${q}“, which is no UI text`);
    }
  }
}
