import * as pdfjsLib from 'pdfjs-dist';
import {
  PDFDocument as PdfLibDocument,
  StandardFonts,
  TextRenderingMode,
  setTextRenderingMode,
  setCharacterSqueeze,
} from 'pdf-lib';
import { createWorker } from 'tesseract.js';

export type OcrLang = 'eng' | 'deu';

export interface OcrProgress {
  pageDone: number;
  totalPages: number;
  status: 'rendering' | 'recognizing';
}

// 3x (~216 DPI off a 72pt page) — tesseract's own docs put its practical
// sweet spot around 300 DPI; higher costs memory/time for little accuracy
// gain on typical scanned documents. Same raster technique as redact.ts.
const OCR_SCALE = 3;

/** Lays an invisible, searchable/selectable text layer over each requested
 *  page — the page's own pixels (the scan) are never touched, only new text
 *  objects are added in PDF text-rendering-mode 3 ("invisible"): genuinely
 *  unrendered by any compliant viewer, not just alpha=0, which is the
 *  standard convention real OCR tools use for exactly this purpose.
 *
 *  Word positions come from tesseract in raster-pixel space (top-left
 *  origin); converting to PDF point space needs both a unit change (÷scale)
 *  and a Y-flip (PDF origin is bottom-left). Horizontal scaling (Tz) then
 *  stretches each word to its true measured width — font size alone only
 *  fixes height, and a width mismatch is what makes OCR selection boxes
 *  feel "off" even when the words themselves are correct. */
export const ocrPdf = async (
  bytes: Uint8Array,
  pageIndices: number[],
  langs: OcrLang[],
  onProgress?: (p: OcrProgress) => void
): Promise<{ bytes: Uint8Array; pagesOcred: number; wordsFound: number }> => {
  const pdfDoc = await PdfLibDocument.load(bytes);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const pdfjsDoc = await pdfjsLib.getDocument({ data: bytes.slice() }).promise;

  const worker = await createWorker(langs, undefined, {
    workerPath: '/tessdata/worker.min.js',
    corePath: '/tessdata/core/',
    langPath: '/tessdata/lang',
    gzip: false,
  });

  let pagesOcred = 0;
  let wordsFound = 0;

  try {
    for (let i = 0; i < pageIndices.length; i++) {
      const pageIndex = pageIndices[i];

      onProgress?.({ pageDone: i, totalPages: pageIndices.length, status: 'rendering' });
      const page = await pdfjsDoc.getPage(pageIndex + 1);
      const pointsViewport = page.getViewport({ scale: 1 });
      const rasterViewport = page.getViewport({ scale: OCR_SCALE });

      const canvas = document.createElement('canvas');
      canvas.width = Math.round(rasterViewport.width);
      canvas.height = Math.round(rasterViewport.height);
      await page.render({ canvas, viewport: rasterViewport }).promise;

      onProgress?.({ pageDone: i, totalPages: pageIndices.length, status: 'recognizing' });
      const { data } = await worker.recognize(canvas, {}, { blocks: true });

      const pdfPage = pdfDoc.getPage(pageIndex);
      const pageHeightPts = pointsViewport.height;
      pdfPage.pushOperators(setTextRenderingMode(TextRenderingMode.Invisible));

      for (const block of data.blocks ?? []) {
        for (const paragraph of block.paragraphs) {
          for (const line of paragraph.lines) {
            for (const word of line.words) {
              const text = word.text?.trim();
              if (!text) continue;

              const { x0, y0, x1, y1 } = word.bbox;
              const widthPts = (x1 - x0) / OCR_SCALE;
              const heightPts = (y1 - y0) / OCR_SCALE;
              if (widthPts <= 0 || heightPts <= 0) continue;

              const xPts = x0 / OCR_SCALE;
              const yPts = pageHeightPts - y1 / OCR_SCALE;
              const fontSize = Math.max(1, heightPts);

              const naturalWidth = font.widthOfTextAtSize(text, fontSize) || widthPts || 1;
              const squeezePct = Math.min(500, Math.max(1, (widthPts / naturalWidth) * 100));

              pdfPage.pushOperators(setCharacterSqueeze(squeezePct));
              pdfPage.drawText(text, { x: xPts, y: yPts, size: fontSize, font });
              wordsFound += 1;
            }
          }
        }
      }

      pdfPage.pushOperators(setTextRenderingMode(TextRenderingMode.Fill));
      pagesOcred += 1;
    }
  } finally {
    await worker.terminate();
  }

  const outBytes = await pdfDoc.save();
  return { bytes: outBytes, pagesOcred, wordsFound };
};
