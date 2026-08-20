import * as pdfjsLib from 'pdfjs-dist';
import { PDFDocument as PdfLibDocument, PDFName, PDFRef } from 'pdf-lib';

/** A marked rectangle, normalized to the page's own displayed size (0..1)
 *  so it stays correct regardless of what zoom level it was drawn at. */
export interface RedactMark {
  xPct: number;
  yPct: number;
  wPct: number;
  hPct: number;
}

export type RedactStyle = 'black' | 'pixelate';

export interface RedactOptions {
  cleanMetadata: boolean;
  /** 'black' paints solid boxes; 'pixelate' mosaics the region instead.
   *  Both destroy the original content (the page becomes an image) — but
   *  pixelation of text can sometimes be reconstructed, which the confirm
   *  dialog says out loud; black stays the safe default. */
  style: RedactStyle;
}

// Rendered at 3x (~216 DPI off a 72pt page) — sharp enough that the
// redacted page still looks like a normal document, not a blurry scan.
const RASTER_SCALE = 3;

/** For every marked page: rasterizes it (via pdf.js, same technique as
 *  PagesPanel's thumbnails) with the marked rectangles painted solid black
 *  directly into the pixels *before* capture, then replaces that page in
 *  the pdf-lib document with a brand-new page holding only that image.
 *  Building a fresh page (not mutating the old one) is what guarantees the
 *  original text/vectors/annotations are actually gone, not just covered —
 *  there is no leftover content stream, resources or /Annots to accidentally
 *  leak through. Shared object dedup doesn't apply here (each page's
 *  content is page-specific), so no cross-page cache is needed. */
export const redactPdf = async (
  bytes: Uint8Array,
  marksByPage: Map<number, RedactMark[]>,
  opts: RedactOptions
): Promise<{ bytes: Uint8Array; pagesRedacted: number }> => {
  const pdfDoc = await PdfLibDocument.load(bytes);

  // Any AcroForm field value on a redacted page could still be extracted
  // from the field dict even after its visual widget is gone — flatten
  // bakes values into static content (which then gets rasterized away
  // below) and drops the interactive field objects entirely.
  if (marksByPage.size > 0 && pdfDoc.getForm().getFields().length > 0) {
    pdfDoc.getForm().flatten();
  }

  const pdfjsDoc = await pdfjsLib.getDocument({ data: bytes.slice() }).promise;
  let pagesRedacted = 0;

  // Descending page index: removePage/insertPage at a given index doesn't
  // disturb indices we haven't processed yet.
  const pageIndices = [...marksByPage.keys()].sort((a, b) => b - a);

  for (const pageIndex of pageIndices) {
    const marks = marksByPage.get(pageIndex);
    if (!marks || marks.length === 0) continue;

    const page = await pdfjsDoc.getPage(pageIndex + 1);
    const pointsViewport = page.getViewport({ scale: 1 });
    const rasterViewport = page.getViewport({ scale: RASTER_SCALE });

    const canvas = document.createElement('canvas');
    canvas.width = Math.round(rasterViewport.width);
    canvas.height = Math.round(rasterViewport.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) continue;

    await page.render({ canvas, viewport: rasterViewport }).promise;

    for (const mark of marks) {
      const x = Math.floor(mark.xPct * canvas.width);
      const y = Math.floor(mark.yPct * canvas.height);
      const w = Math.max(1, Math.ceil(mark.wPct * canvas.width));
      const h = Math.max(1, Math.ceil(mark.hPct * canvas.height));
      if (opts.style === 'pixelate') {
        // mosaic: shrink the region hard, blow it back up without
        // smoothing — big blocks (≥ ~16 source pixels each) so glyph
        // shapes are destroyed, not just softened
        const block = Math.max(16, Math.round(Math.min(w, h) / 6));
        const tw = Math.max(1, Math.round(w / block));
        const th = Math.max(1, Math.round(h / block));
        const tiny = document.createElement('canvas');
        tiny.width = tw;
        tiny.height = th;
        const tctx = tiny.getContext('2d');
        if (!tctx) continue;
        tctx.imageSmoothingEnabled = true;
        tctx.drawImage(canvas, x, y, w, h, 0, 0, tw, th);
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(tiny, 0, 0, tw, th, x, y, w, h);
        ctx.imageSmoothingEnabled = true;
      } else {
        ctx.fillStyle = '#000000';
        ctx.fillRect(x, y, w, h);
      }
    }

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) continue;
    const rasterBytes = new Uint8Array(await blob.arrayBuffer());

    const width = pointsViewport.width;
    const height = pointsViewport.height;
    pdfDoc.removePage(pageIndex);
    const newPage = pdfDoc.insertPage(pageIndex, [width, height]);
    const img = await pdfDoc.embedPng(rasterBytes);
    newPage.drawImage(img, { x: 0, y: 0, width, height });
    pagesRedacted += 1;
  }

  if (opts.cleanMetadata) {
    pdfDoc.setTitle('');
    pdfDoc.setAuthor('');
    pdfDoc.setSubject('');
    pdfDoc.setKeywords([]);
    pdfDoc.setCreator('');
    pdfDoc.setProducer('');

    // Deleting the catalog's reference alone leaves the orphaned XMP stream
    // bytes sitting in the file (pdf-lib serializes every registered
    // object, not just reachable ones) — it has to be dropped from the
    // context too to actually remove the bytes.
    const metadataKey = PDFName.of('Metadata');
    const metadataRef = pdfDoc.catalog.get(metadataKey);
    if (metadataRef) {
      pdfDoc.catalog.delete(metadataKey);
      if (metadataRef instanceof PDFRef) pdfDoc.context.delete(metadataRef);
    }
  }

  const outBytes = await pdfDoc.save();
  return { bytes: outBytes, pagesRedacted };
};
