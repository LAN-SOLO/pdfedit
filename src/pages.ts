import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFPage, degrees } from 'pdf-lib';
import { pruneUnreachable } from './pdfScrub';

/** Moves one page to a new position (sidebar drag & drop).
 *
 *  Fast path: when the page tree is flat (a single /Pages node whose /Kids
 *  are all leaves — true for virtually every real-world file and for
 *  everything this app produces), the /Kids array is reordered in place.
 *  That touches nothing else: form fields, annotations, outlines and the
 *  catalog all survive untouched (verified: field value + pdf.js
 *  getFieldObjects intact after the move).
 *
 *  Fallback for nested page trees: organizePages (flattens the tree in
 *  place — forms and bookmarks survive there, too). */
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
  return organizePages(
    [bytes],
    order.map((i) => ({ kind: 'page', sourceIndex: 0, sourcePageIndex: i, rotation: 0, width: 0, height: 0 }))
  );
}

/** One entry of the Pages dialog's final layout. */
export interface OrganizeSlot {
  kind: 'page' | 'blank';
  /** index into `sources` (0 = the open document) — unused for 'blank' */
  sourceIndex: number;
  sourcePageIndex: number;
  /** additional rotation on top of the page's own, degrees */
  rotation: number;
  /** blank pages only */
  width: number;
  height: number;
}

const INHERITABLE = ['Resources', 'MediaBox', 'CropBox', 'Rotate'];

/** Applies the Pages dialog (reorder, rotate, delete, insert blank, merge
 *  other PDFs) ON the open document instead of rebuilding a fresh one —
 *  a rebuilt document loses the AcroForm (fields no longer fillable),
 *  bookmarks, metadata, named destinations and everything else hanging
 *  off the catalog. Steps:
 *  1. bake inherited attributes into every leaf (the tree gets flattened),
 *  2. append merged/blank pages, 3. rewrite the root /Kids in slot order,
 *  4. drop form fields whose widgets only lived on deleted pages,
 *  5. sweep unreachable objects so deleted pages are really gone. */
export async function organizePages(sources: Uint8Array[], slots: OrganizeSlot[]): Promise<Uint8Array> {
  const doc = await PDFDocument.load(sources[0]);
  const ctx = doc.context;
  const original = doc.getPages();
  for (const page of original) {
    for (const key of INHERITABLE) {
      const name = PDFName.of(key);
      if (page.node.get(name) !== undefined) continue;
      const inherited = page.node.getInheritableAttribute(name);
      if (inherited !== undefined) page.node.set(name, inherited);
    }
  }

  // every leaf carries its own values now — clear them on the root so
  // appended (blank/merged) pages don't inherit e.g. the original /Rotate
  const rootNode = doc.catalog.lookup(PDFName.of('Pages'), PDFDict);
  for (const key of INHERITABLE) rootNode.delete(PDFName.of(key));

  const others = new Map<number, PDFDocument>();
  const finalPages: PDFPage[] = [];
  const used = new Set<number>();
  for (const slot of slots) {
    let page: PDFPage;
    if (slot.kind === 'blank') {
      const [w, h] = slot.rotation % 180 === 0 ? [slot.width, slot.height] : [slot.height, slot.width];
      page = doc.addPage([w, h]);
    } else if (slot.sourceIndex === 0) {
      page = original[slot.sourcePageIndex];
      if (!page) throw new Error(`page ${slot.sourcePageIndex + 1} not found`);
      if (used.has(slot.sourcePageIndex)) {
        // the same page twice: second occurrence becomes a copy
        [page] = await doc.copyPages(doc, [slot.sourcePageIndex]);
        doc.addPage(page);
      }
      used.add(slot.sourcePageIndex);
    } else {
      let other = others.get(slot.sourceIndex);
      if (!other) {
        other = await PDFDocument.load(sources[slot.sourceIndex]);
        others.set(slot.sourceIndex, other);
      }
      [page] = await doc.copyPages(other, [slot.sourcePageIndex]);
      doc.addPage(page);
    }
    if (slot.kind === 'page' && slot.rotation) {
      page.setRotation(degrees((page.getRotation().angle + slot.rotation) % 360));
    }
    finalPages.push(page);
  }
  if (finalPages.length === 0) throw new Error('pages.empty');

  // widgets of deleted pages → their fields go too
  const keptRefs = new Set(finalPages.map((p) => p.ref.toString()));
  const deletedAnnots = new Set<unknown>();
  for (const page of original) {
    if (keptRefs.has(page.ref.toString())) continue;
    const annots = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray);
    for (let i = 0; i < (annots?.size() ?? 0); i++) deletedAnnots.add(ctx.lookup(annots!.get(i)));
  }
  if (deletedAnnots.size > 0) {
    const form = doc.getForm();
    for (const field of form.getFields()) {
      const widgets = field.acroField.getWidgets();
      if (widgets.length > 0 && widgets.every((w) => deletedAnnots.has(w.dict))) {
        form.removeField(field);
      }
    }
  }

  // Bookmarks, named destinations, links and widget /P entries can still
  // point at a deleted page object and keep it reachable — the sweep below
  // would then leave its content in the file. Hollow such pages out: only
  // an empty /Type /Page shell remains (links to it simply do nothing).
  for (const page of original) {
    if (keptRefs.has(page.ref.toString())) continue;
    for (const key of page.node.keys()) {
      if (key !== PDFName.of('Type')) page.node.delete(key);
    }
  }

  const root = rootNode;
  const rootRef = doc.catalog.get(PDFName.of('Pages'));
  const kids = ctx.obj(finalPages.map((p) => p.ref));
  root.set(PDFName.of('Kids'), kids);
  root.set(PDFName.of('Count'), PDFNumber.of(finalPages.length));
  for (const p of finalPages) p.node.set(PDFName.of('Parent'), rootRef!);

  await pruneUnreachable(doc);
  return doc.save();
}
