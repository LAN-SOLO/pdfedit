import * as pdfjsLib from 'pdfjs-dist';
import { PDFDocument as PdfLibDocument, StandardFonts, rgb } from 'pdf-lib';

export interface EditRegion {
  pageIndex: number;
  xPct: number;
  yPct: number;
  wPct: number;
  hPct: number;
}

export type EditContent = { kind: 'text'; text: string } | { kind: 'image'; file: File };

const RASTER_SCALE = 3;

/** Pragmatic "edit" for a marked region: like redact.ts, the whole page is
 *  rasterized first (the only way we can be confident the ORIGINAL content
 *  under the region is genuinely gone, not just covered — a real
 *  content-stream editor that reflows existing text in place is a
 *  multi-month project on its own, explicitly out of scope). The marked
 *  spot is painted over white on that raster, then the new content (real,
 *  extractable text or an image) is drawn on top, in place. Everything
 *  else on the page keeps looking the same, but — same disclosed tradeoff
 *  as Schwärzen — the page itself is now an image: no reflow, no vector
 *  object editing, nothing else on it stays independently editable. */
export const applyRegionEdit = async (
  bytes: Uint8Array,
  region: EditRegion,
  content: EditContent
): Promise<Uint8Array> => {
  const pdfDoc = await PdfLibDocument.load(bytes);
  const pdfjsDoc = await pdfjsLib.getDocument({ data: bytes.slice() }).promise;
  const page = await pdfjsDoc.getPage(region.pageIndex + 1);
  const pointsViewport = page.getViewport({ scale: 1 });
  const rasterViewport = page.getViewport({ scale: RASTER_SCALE });

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(rasterViewport.width);
  canvas.height = Math.round(rasterViewport.height);
  await page.render({ canvas, viewport: rasterViewport }).promise;

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas context unavailable');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(
    region.xPct * canvas.width,
    region.yPct * canvas.height,
    region.wPct * canvas.width,
    region.hPct * canvas.height
  );

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('canvas produced no image');
  const rasterBytes = new Uint8Array(await blob.arrayBuffer());

  const width = pointsViewport.width;
  const height = pointsViewport.height;
  pdfDoc.removePage(region.pageIndex);
  const newPage = pdfDoc.insertPage(region.pageIndex, [width, height]);
  const bgImg = await pdfDoc.embedPng(rasterBytes);
  newPage.drawImage(bgImg, { x: 0, y: 0, width, height });

  // Region in PDF point space (bottom-left origin — the raster/percentage
  // space is top-left origin, same Y-flip as redact.ts/ocr.ts).
  const rx = region.xPct * width;
  const rw = region.wPct * width;
  const rh = region.hPct * height;
  const ry = height - (region.yPct + region.hPct) * height;

  if (content.kind === 'text') {
    const text = content.text.trim();
    if (text) {
      const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
      const fontSize = Math.max(6, rh * 0.75);
      const naturalWidth = font.widthOfTextAtSize(text, fontSize) || rw;
      const size = naturalWidth > rw ? Math.max(6, fontSize * (rw / naturalWidth)) : fontSize;
      newPage.drawText(text, {
        x: rx,
        y: ry + (rh - size) / 2,
        size,
        font,
        color: rgb(0, 0, 0),
        maxWidth: rw,
      });
    }
  } else {
    const imgBytes = new Uint8Array(await content.file.arrayBuffer());
    const embedded = content.file.type.includes('png')
      ? await pdfDoc.embedPng(imgBytes)
      : await pdfDoc.embedJpg(imgBytes);
    const scale = Math.min(rw / embedded.width, rh / embedded.height);
    const w = embedded.width * scale;
    const h = embedded.height * scale;
    newPage.drawImage(embedded, { x: rx + (rw - w) / 2, y: ry + (rh - h) / 2, width: w, height: h });
  }

  return pdfDoc.save();
};
