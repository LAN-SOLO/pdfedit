import type { SystemFont } from './api';
import type { FreetextFontChoice, StdFontKey } from './freetextFont';

/** Detecting a PDF text run's original font and finding the best available
 *  replacement — the heart of format-preserving text editing.
 *
 *  The PostScript name from pdf.js (e.g. "BAAAAA+TimesNewRomanPS-BoldMT")
 *  is parsed into family + bold/italic; matching then walks three rungs:
 *  1. exact — same family, same style, installed on this system
 *  2. family — fuzzy family match with the right style
 *  3. fallback — the metric-classic standard font of the same class
 *     (Helvetica/Times/Courier in the right cut)
 *  The dialog tells the user which rung was hit. */

export interface DetectedFont {
  /** PostScript name without the subset prefix. */
  psName: string;
  /** Human-readable family guess ("Times New Roman"). */
  family: string;
  bold: boolean;
  italic: boolean;
  serif: boolean;
  mono: boolean;
}

export interface FontMatch {
  quality: 'exact' | 'family' | 'fallback';
  choice: FreetextFontChoice;
  /** Display name of what was picked ("Arial Bold", "Helvetica Fett"). */
  label: string;
}

export function parsePdfFontName(psNameRaw: string, cssFamily: string): DetectedFont {
  const psName = (psNameRaw || '').replace(/^[A-Z]{6}\+/, '');
  const lower = psName.toLowerCase();
  const bold = /bold|black|heavy|semibold|demibold|ultra/.test(lower);
  const italic = /italic|oblique/.test(lower);
  let family = psName.split(/[-,]/)[0] || psName;
  family = family.replace(/(MT|PS|PSMT|Std|Pro|LT)$/i, '');
  // strip style words that live inside the family part ("ArialBold")
  // ("Roman" deliberately not stripped — it is part of "Times New Roman";
  // as a style suffix it virtually always comes after a hyphen, which the
  // split above already removed)
  family = family.replace(/(Bold|Italic|Oblique|Black|Heavy|Light|Medium|Regular)+$/i, '');
  const spaced = family.replace(/([a-z])([A-Z])/g, '$1 $2').trim();
  return {
    psName,
    family: spaced || psName,
    bold,
    italic,
    serif: cssFamily === 'serif',
    mono: cssFamily === 'monospace',
  };
}

const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '');

const styleFlags = (styleOrName: string): { b: boolean; i: boolean } => {
  const st = styleOrName.toLowerCase();
  return {
    b: /bold|black|heavy|semibold|demibold/.test(st),
    i: /italic|oblique/.test(st),
  };
};

/** Families whose metrics the base-14 standard fonts were built to match —
 *  for these, the standard fallback is a genuinely good substitute. */
const METRIC_TWINS: Record<string, 'helv' | 'times' | 'courier'> = {
  arial: 'helv',
  helvetica: 'helv',
  liberationsans: 'helv',
  nimbussans: 'helv',
  timesnewroman: 'times',
  timesnew: 'times',
  times: 'times',
  liberationserif: 'times',
  nimbusroman: 'times',
  couriernew: 'courier',
  courier: 'courier',
  liberationmono: 'courier',
  nimbusmono: 'courier',
};

export const stdKeyFor = (
  base: 'helv' | 'times' | 'courier',
  bold: boolean,
  italic: boolean
): StdFontKey => {
  const it = base === 'times' ? 'i' : 'o';
  if (bold && italic) return `${base}-b${it}` as StdFontKey;
  if (bold) return `${base}-b` as StdFontKey;
  if (italic) return `${base}-${it}` as StdFontKey;
  return base;
};

export function matchFont(det: DetectedFont, systemFonts: SystemFont[]): FontMatch {
  const wantFam = norm(det.family);

  const fits = (f: SystemFont): boolean => {
    const fl = styleFlags(f.style || f.name);
    return fl.b === det.bold && fl.i === det.italic;
  };

  if (wantFam.length >= 3) {
    const exact = systemFonts.find((f) => norm(f.family) === wantFam && fits(f));
    if (exact) {
      return {
        quality: 'exact',
        choice: { kind: 'system', name: exact.name, path: exact.path },
        label: exact.name,
      };
    }
    const fuzzy = systemFonts.find(
      (f) =>
        (norm(f.family).includes(wantFam) || wantFam.includes(norm(f.family))) &&
        norm(f.family).length >= 3 &&
        fits(f)
    );
    if (fuzzy) {
      return {
        quality: 'family',
        choice: { kind: 'system', name: fuzzy.name, path: fuzzy.path },
        label: fuzzy.name,
      };
    }
  }

  const base = METRIC_TWINS[wantFam] ?? (det.mono ? 'courier' : det.serif ? 'times' : 'helv');
  const key = stdKeyFor(base, det.bold, det.italic);
  // a metric twin is as good as a family match — say so
  const quality = METRIC_TWINS[wantFam] ? 'family' : 'fallback';
  return { quality, choice: { kind: 'standard', font: key }, label: '' };
}
