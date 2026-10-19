import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFRef,
  PDFStream,
  type PDFObject,
} from 'pdf-lib';

/** Helpers for the "content must really be gone" features (redact, region
 *  edit). Two pitfalls they exist for — both verified against pdf-lib:
 *
 *  1. pdf-lib serializes EVERY registered object on save, reachable or
 *     not. Removing a page (or replacing its /Contents) therefore leaves
 *     the old content stream — the original text — sitting in the saved
 *     file. The same goes for orphans the input already carried (old
 *     incremental revisions, exploded /ObjStm containers).
 *  2. Removing a page and inserting a fresh one breaks everything that
 *     points at the old page object (bookmarks, links, structure tree),
 *     and inherits /Rotate, /MediaBox, /Resources from the parent node.
 *
 *  So pages are rewritten IN PLACE (same object, new content) and a
 *  reachability sweep drops every object nothing points to any more. */

/** Page keys that may carry or reference original page content. */
const PAGE_CONTENT_KEYS = [
  'Contents',
  'Resources',
  'Annots',
  'Thumb',
  'PieceInfo',
  'Metadata',
  'B',
  'AA',
  'StructParents',
  'CropBox',
  'BleedBox',
  'TrimBox',
  'ArtBox',
  'UserUnit',
  'VP',
  'SeparationInfo',
  'Group',
  'Tabs',
  'ID',
  'PZ',
  'PresSteps',
  'Trans',
  'Dur',
];

/** Replaces page `pageIndex` with a single full-page PNG raster of size
 *  `width` × `height` points (unrotated — the raster already shows the
 *  page as displayed). The page object itself is kept, so bookmarks and
 *  links to it stay valid; everything that held its old content is
 *  dropped from it. Call `pruneUnreachable` before saving. */
export async function replacePageWithImage(
  doc: PDFDocument,
  pageIndex: number,
  png: Uint8Array,
  width: number,
  height: number
): Promise<void> {
  const page = doc.getPage(pageIndex);
  const node = page.node;
  const ctx = doc.context;
  for (const key of PAGE_CONTENT_KEYS) node.delete(PDFName.of(key));

  const img = await doc.embedPng(png);
  const content = ctx.flateStream(
    `q ${width.toFixed(4)} 0 0 ${height.toFixed(4)} 0 0 cm /RedactIm Do Q`
  );
  node.set(
    PDFName.of('MediaBox'),
    ctx.obj([PDFNumber.of(0), PDFNumber.of(0), PDFNumber.of(width), PDFNumber.of(height)])
  );
  // explicit values — otherwise the parent /Pages node's ones would apply
  node.set(PDFName.of('Rotate'), PDFNumber.of(0));
  // shapes pdf-lib's own normalized page form expects (Contents array,
  // Annots array, Font/XObject/ExtGState dicts) — later drawText/
  // drawImage calls on this page (region edit) then just work
  node.set(
    PDFName.of('Resources'),
    ctx.obj({
      Font: ctx.obj({}),
      XObject: ctx.obj({ RedactIm: img.ref }),
      ExtGState: ctx.obj({}),
    })
  );
  node.set(PDFName.of('Contents'), ctx.obj([ctx.register(content)]));
  node.set(PDFName.of('Annots'), ctx.obj([]));
}

/** Deletes every indirect object that is not reachable from the trailer
 *  (/Root, /Info). Returns how many objects were removed. */
export async function pruneUnreachable(doc: PDFDocument): Promise<number> {
  // lazily embedded fonts/images only become real objects on flush
  await doc.flush();
  const ctx = doc.context;
  const reached = new Set<string>();
  const stack: PDFObject[] = [];
  const roots = [ctx.trailerInfo.Root, ctx.trailerInfo.Info];
  for (const r of roots) if (r) stack.push(r as PDFObject);

  while (stack.length > 0) {
    const obj = stack.pop()!;
    if (obj instanceof PDFRef) {
      const key = obj.toString();
      if (reached.has(key)) continue;
      reached.add(key);
      const target = ctx.lookup(obj);
      if (target) stack.push(target);
    } else if (obj instanceof PDFDict) {
      for (const [, v] of obj.entries()) stack.push(v);
    } else if (obj instanceof PDFArray) {
      for (let i = 0; i < obj.size(); i++) stack.push(obj.get(i));
    } else if (obj instanceof PDFStream) {
      stack.push(obj.dict);
    }
  }

  let removed = 0;
  for (const [ref] of ctx.enumerateIndirectObjects()) {
    if (!reached.has(ref.toString())) {
      ctx.delete(ref);
      removed += 1;
    }
  }
  return removed;
}

/** Drops the tagged-PDF structure tree: its /ActualText, /Alt and /E
 *  entries can hold verbatim copies of redacted text, and after
 *  rasterizing it no longer matches the page anyway. */
export function dropStructureTree(doc: PDFDocument): void {
  doc.catalog.delete(PDFName.of('StructTreeRoot'));
  doc.catalog.delete(PDFName.of('MarkInfo'));
}
