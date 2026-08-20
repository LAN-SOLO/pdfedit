import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, rgb } from 'pdf-lib';
import { embedChosenFont, type FreetextFontChoice } from './freetextFont';

/** In-place text editing (Acrobat's "Edit text", pragmatic edition).
 *
 *  The clicked text line (located via pdf.js's text layer, so it works on
 *  any born-digital PDF) is covered with the page's sampled background
 *  color and the replacement is written as REAL page text — searchable,
 *  selectable, in any color/size and any standard or system font.
 *
 *  Honest limits (also stated in the dialog): the original line stays
 *  invisibly in the file underneath (use redaction to truly remove it),
 *  and the replacement won't always match the original's exact typeface
 *  and letter spacing. Full reflow editing is the v0.12 roadmap item. */

export interface LineEdit {
  pageIndex: number;
  /** Line bounding box in page percentages, top-left origin. */
  xPct: number;
  yPct: number;
  wPct: number;
  hPct: number;
  newText: string;
  sizePt: number;
  /** Text color, 0–255 each. */
  color: [number, number, number];
  /** Sampled page background under/around the line, 0–255 each. */
  bg: [number, number, number];
  choice: FreetextFontChoice;
  fontBytes: Uint8Array | null;
}

export async function applyLineEdit(bytes: Uint8Array, edit: LineEdit): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes);
  doc.registerFontkit(fontkit);
  const pages = doc.getPages();
  const page = pages[Math.min(edit.pageIndex, pages.length - 1)];
  const { width: pw, height: ph } = page.getSize();

  const x = edit.xPct * pw;
  const y = ph - (edit.yPct + edit.hPct) * ph;
  const w = edit.wPct * pw;
  const h = edit.hPct * ph;

  const font = await embedChosenFont(doc, edit.choice, edit.fontBytes, edit.newText);

  // Cover the original line. The text-layer bbox sits a touch below the
  // painted glyphs (substituted-font metrics), so pad generously above —
  // verified visually: without the extra headroom the original's cap
  // height peeks out over the replacement.
  const [br, bgG, bb] = edit.bg.map((c) => c / 255);
  const headroom = edit.sizePt * 0.55;
  page.drawRectangle({
    x: x - 2,
    y: y - 2,
    width: w + 4,
    height: h + 2 + headroom,
    color: rgb(br, bgG, bb),
  });

  const [r, g, b] = edit.color.map((c) => c / 255);
  page.drawText(edit.newText, {
    x,
    // the line bbox includes ascenders/descenders — put the baseline where
    // the original's roughly was
    y: y + h * 0.26,
    size: edit.sizePt,
    font,
    color: rgb(r, g, b),
  });

  return doc.save();
}
