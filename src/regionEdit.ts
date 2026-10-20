import * as pdfjsLib from 'pdfjs-dist';
import { PDFJS_DOC_OPTIONS } from './pdfjsConfig';
import { PDFArray, PDFDocument as PdfLibDocument, PDFName, StandardFonts, rgb } from 'pdf-lib';
import { pruneUnreachable, replacePageWithImage } from './pdfScrub';

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
  const pdfjsTask = pdfjsLib.getDocument({ ...PDFJS_DOC_OPTIONS, data: bytes.slice() });
  const pdfjsDoc = await pdfjsTask.promise;
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
  await pdfjsTask.destroy();

  // The raster replaces the page's /Annots — form fields whose widgets all
  // sit on this page would stay in the AcroForm without any widget left
  // (listed in the Objects panel, value still in the file, invisible).
  // Their look is in the raster now; the fields themselves go.
  const pageNode = pdfDoc.getPage(region.pageIndex).node;
  const annots = pageNode.lookupMaybe(PDFName.of('Annots'), PDFArray);
  if (annots && annots.size() > 0) {
    const onPage = new Set<unknown>();
    for (let i = 0; i < annots.size(); i++) onPage.add(pdfDoc.context.lookup(annots.get(i)));
    const form = pdfDoc.getForm();
    for (const field of form.getFields()) {
      const widgets = field.acroField.getWidgets();
      if (widgets.length > 0 && widgets.every((w) => onPage.has(w.dict))) form.removeField(field);
    }
  }

  await replacePageWithImage(pdfDoc, region.pageIndex, rasterBytes, width, height);
  const newPage = pdfDoc.getPage(region.pageIndex);

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
      // Sensible size instead of "as tall as the box": cap at 18pt (a tall
      // box means a text block, not banner letters), shrink further when a
      // single line would overflow the width, and let long text wrap.
      const fontSize = Math.min(Math.max(6, rh * 0.75), 18);
      const naturalWidth = font.widthOfTextAtSize(text, fontSize) || rw;
      const size =
        naturalWidth > rw && !text.includes(' ')
          ? Math.max(6, fontSize * (rw / naturalWidth))
          : fontSize;
      newPage.drawText(text, {
        x: rx + 2,
        y: ry + rh - size * 1.05,
        size,
        font,
        color: rgb(0, 0, 0),
        maxWidth: Math.max(10, rw - 4),
        lineHeight: size * 1.3,
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

  await pruneUnreachable(pdfDoc);
  return pdfDoc.save();
};
