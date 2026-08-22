import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, rgb, setCharacterSqueeze } from 'pdf-lib';
import { embedChosenFont, type FreetextFontChoice } from './freetextFont';

/** In-place text editing (Acrobat's "Edit text", format-preserving).
 *
 *  The clicked text RUN (a stretch of uniform formatting, located via
 *  pdf.js's getTextContent, which reports exact baseline, width, size and
 *  the original font) is covered with the sampled page background and the
 *  replacement is written as REAL page text at the exact same baseline
 *  origin, in the matched font and cut (bold/italic detected from the
 *  original). Neighboring runs and lines are untouched, so spacing and
 *  layout survive.
 *
 *  Honest limits (also stated in the dialog): the original run stays
 *  invisibly in the file underneath (use redaction to truly remove it),
 *  and when the original font isn't installed, the closest match is used
 *  — the dialog says which. */

export interface RunEdit {
  pageIndex: number;
  /** Baseline origin of the run in PDF points. */
  x: number;
  baseline: number;
  /** Original run width in PDF points (cover box). */
  width: number;
  sizePt: number;
  /** Font ascent/descent as fractions of the size (descent negative). */
  ascent: number;
  descent: number;
  newText: string;
  /** Text color, 0–255 each. */
  color: [number, number, number];
  /** Sampled page background around the run, 0–255 each. */
  bg: [number, number, number];
  choice: FreetextFontChoice;
  fontBytes: Uint8Array | null;
  /** Space handling for the embedded original font (see embeddedFont.ts):
   *  pdf.js's sanitizer often drops U+0020 from the cmap, so encoding a
   *  space would draw a .notdef box — words are then drawn as segments and
   *  the pen advances by the font's true space advance instead. */
  embeddedSpaceMapped?: boolean;
  embeddedSpaceAdvanceEm?: number | null;
}

export async function applyRunEdit(bytes: Uint8Array, edit: RunEdit): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes);
  doc.registerFontkit(fontkit);
  const pages = doc.getPages();
  const page = pages[Math.min(edit.pageIndex, pages.length - 1)];

  const font = await embedChosenFont(doc, edit.choice, edit.fontBytes, edit.newText);

  const ascent = edit.ascent > 0 ? edit.ascent : 0.9;
  const descent = edit.descent < 0 ? edit.descent : -0.22;
  const top = edit.baseline + ascent * edit.sizePt;
  const bottom = edit.baseline + descent * edit.sizePt;

  // Cover exactly the run's box (small pad for antialiased edges) — tight
  // enough to leave neighboring lines and runs alone.
  const [br, bgG, bb] = edit.bg.map((c) => c / 255);
  page.drawRectangle({
    x: edit.x - 1,
    y: bottom - 0.5,
    width: edit.width + 2,
    height: top - bottom + 1,
    color: rgb(br, bgG, bb),
  });

  // Embedded fonts whose sanitized cmap lost the space can't encode " " —
  // split into word/whitespace tokens and advance the pen manually.
  const manualSpaces =
    edit.choice.kind === 'embedded' && !edit.embeddedSpaceMapped && /\s/.test(edit.newText);
  const spaceW = (edit.embeddedSpaceAdvanceEm ?? 0.28) * edit.sizePt;
  const tokens: { text: string | null; width: number }[] = [];
  if (manualSpaces) {
    for (const tok of edit.newText.split(/(\s+)/)) {
      if (!tok) continue;
      if (/^\s+$/.test(tok)) tokens.push({ text: null, width: [...tok].length * spaceW });
      else tokens.push({ text: tok, width: font.widthOfTextAtSize(tok, edit.sizePt) });
    }
  } else {
    tokens.push({ text: edit.newText, width: font.widthOfTextAtSize(edit.newText, edit.sizePt) });
  }

  // When the replacement is wider than the original run, condense the
  // letter spacing (Tz) just enough to fit instead of running into the
  // neighboring run — down to 82%, beyond which condensed text looks
  // broken and a visible overflow is the lesser evil. Tz is part of the
  // persistent text state, so setting it before drawText applies inside
  // drawText's own BT/ET block (same trick the OCR layer uses).
  const natural = tokens.reduce((sum, tk) => sum + tk.width, 0);
  let squeeze = 100;
  if (edit.width > 4 && natural > edit.width) {
    squeeze = Math.max(82, (edit.width / natural) * 100);
  }
  if (squeeze < 100) page.pushOperators(setCharacterSqueeze(squeeze));

  const [r, g, b] = edit.color.map((c) => c / 255);
  let penX = edit.x;
  for (const tk of tokens) {
    if (tk.text !== null) {
      page.drawText(tk.text, {
        x: penX,
        y: edit.baseline,
        size: edit.sizePt,
        font,
        color: rgb(r, g, b),
      });
    }
    penX += tk.width * (squeeze / 100);
  }

  if (squeeze < 100) page.pushOperators(setCharacterSqueeze(100));

  return doc.save();
}
