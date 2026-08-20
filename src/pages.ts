import { PDFArray, PDFDict, PDFDocument, PDFName } from 'pdf-lib';

/** Moves one page to a new position (sidebar drag & drop).
 *
 *  Fast path: when the page tree is flat (a single /Pages node whose /Kids
 *  are all leaves — true for virtually every real-world file and for
 *  everything this app produces), the /Kids array is reordered in place.
 *  That touches nothing else: form fields, annotations, outlines and the
 *  catalog all survive untouched (verified: field value + pdf.js
 *  getFieldObjects intact after the move).
 *
 *  Fallback for nested page trees: rebuild via copyPages in the new order —
 *  same behavior as the Pages dialog. */
export async function movePage(bytes: Uint8Array, from: number, to: number): Promise<Uint8Array> {
  if (from === to) return bytes;
  const doc = await PDFDocument.load(bytes);
  const pageCount = doc.getPageCount();
  if (from < 0 || from >= pageCount || to < 0 || to >= pageCount) return bytes;

  const pagesRoot = doc.catalog.lookup(PDFName.of('Pages'), PDFDict);
  const kids = pagesRoot.lookup(PDFName.of('Kids'), PDFArray);
  if (kids.size() === pageCount) {
    const arr = [];
    for (let i = 0; i < kids.size(); i++) arr.push(kids.get(i));
    const [moved] = arr.splice(from, 1);
    arr.splice(to, 0, moved);
    while (kids.size() > 0) kids.remove(0);
    for (const ref of arr) kids.push(ref);
    return doc.save();
  }

  const order = Array.from({ length: pageCount }, (_, i) => i);
  const [moved] = order.splice(from, 1);
  order.splice(to, 0, moved);
  const rebuilt = await PDFDocument.create();
  const copied = await rebuilt.copyPages(doc, order);
  for (const page of copied) rebuilt.addPage(page);
  return rebuilt.save();
}
