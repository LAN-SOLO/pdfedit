import fontkit from '@pdf-lib/fontkit';

/** Reusing the PDF's own embedded font for text editing.
 *
 *  pdf.js hands out the sanitized font program of every rendered font via
 *  `commonObjs` (with `fontExtraProperties: true`). If that program parses
 *  and its cmap still maps the run's characters, it is re-embedded for the
 *  replacement text — the one substitute-free path, so the edit is pixel-
 *  faithful to the original typeface.
 *
 *  When it can't be used (Type3 fonts, non-embedded fonts, subsets whose
 *  sanitized cmap was remapped away from Unicode), `probeEmbeddedFont`
 *  returns null and the caller falls back to the installed-font match.
 *
 *  Space caveat: pdf.js's sanitizer routinely drops U+0020 from the cmap
 *  even though the space glyph itself survives — encoding a space would
 *  draw a .notdef box. `spaceMapped`/`spaceAdvanceEm` let the drawing side
 *  place word segments manually with the font's true space advance. */

export interface EmbeddedFontInfo {
  bytes: Uint8Array;
  /** True when every non-whitespace character has a real glyph mapping. */
  covers: (text: string) => boolean;
  /** Whether U+0020 maps to a real glyph (safe to encode directly). */
  spaceMapped: boolean;
  /** Space advance in em units; null when it couldn't be determined. */
  spaceAdvanceEm: number | null;
}

export function probeEmbeddedFont(
  data: unknown,
  sampleText: string,
  /** Rendered width of sampleText in points + its size — lets the probe
   *  measure the true space advance out of the original run when the font
   *  itself no longer tells (cmap and post names both stripped). */
  sampleWidthPt?: number,
  sizePt?: number
): EmbeddedFontInfo | null {
  if (!(data instanceof Uint8Array) || data.length < 12) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const font = (fontkit as any).create(data);
    if (typeof font?.hasGlyphForCodePoint !== 'function') return null;
    const covers = (text: string): boolean => {
      for (const ch of text) {
        if (/\s/.test(ch)) continue;
        if (!font.hasGlyphForCodePoint(ch.codePointAt(0)!)) return false;
      }
      return true;
    };
    // subset fonts whose cmap no longer speaks Unicode fail this for their
    // own text — exactly the case where re-embedding would draw .notdef
    if (!covers(sampleText)) return null;

    const upem: number = font.unitsPerEm || 1000;
    let spaceMapped = false;
    let spaceAdvanceEm: number | null = null;
    if (font.hasGlyphForCodePoint(32)) {
      const g = font.glyphForCodePoint(32);
      if (g && g.id !== 0) {
        spaceMapped = true;
        spaceAdvanceEm = (g.advanceWidth || 0) / upem || null;
      }
    }
    if (spaceAdvanceEm === null) {
      // cmap lost the space — the glyph usually survives under its post-
      // table name, which still carries the correct advance
      const numGlyphs: number = Math.min(font.numGlyphs || 0, 4096);
      for (let id = 1; id < numGlyphs; id++) {
        const g = font.getGlyph(id);
        if (g?.name === 'space') {
          spaceAdvanceEm = (g.advanceWidth || 0) / upem || null;
          break;
        }
      }
    }
    if (spaceAdvanceEm === null && sampleWidthPt && sizePt && /\s/.test(sampleText)) {
      // last resort: back the space advance out of the original run —
      // total rendered width minus the letters' own advances
      let lettersEm = 0;
      let nSpaces = 0;
      for (const ch of sampleText) {
        if (/\s/.test(ch)) nSpaces++;
        else lettersEm += (font.glyphForCodePoint(ch.codePointAt(0)!)?.advanceWidth || 0) / upem;
      }
      const remEm = sampleWidthPt / sizePt - lettersEm;
      if (nSpaces > 0 && remEm > 0) {
        const perSpace = remEm / nSpaces;
        if (perSpace > 0.05 && perSpace < 1.5) spaceAdvanceEm = perSpace;
      }
    }
    return { bytes: data, covers, spaceMapped, spaceAdvanceEm };
  } catch {
    return null;
  }
}
