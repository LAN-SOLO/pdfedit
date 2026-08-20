import { PDFDict, PDFDocument, PDFName, PDFNumber, PDFString } from 'pdf-lib';

/** Invisible watermark for tamper evidence.
 *
 *  The uploaded PNG (transparency preserved) is drawn over the page with
 *  opacity 0 — invisible in every viewer, but present in the content
 *  stream. Alongside, each marked page gets a private page-dict entry
 *  (/LSWM) recording the PNG's SHA-256, the page's position at marking
 *  time and a timestamp. Verification reads those entries back:
 *  - a page without the entry in an otherwise marked document → likely
 *    swapped in,
 *  - a recorded position that no longer matches → pages were reordered,
 *  - differing PNG hashes across pages → mixed/replaced marks.
 *
 *  Honest scope (also stated in the dialog): this is tamper *evidence*
 *  against casual page swaps, not cryptographic proof — an informed
 *  attacker can copy the marks. For real integrity, combine with the
 *  digital signature. */

const WM_KEY = 'LSWM';

export interface WatermarkReport {
  pageCount: number;
  pages: {
    pageIndex: number;
    present: boolean;
    recordedIndex: number | null;
    indexMatches: boolean;
    hash: string | null;
    date: string | null;
  }[];
  /** Distinct hashes found across all marked pages. */
  hashes: string[];
}

const sha256Hex = async (bytes: Uint8Array): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', bytes.slice().buffer as ArrayBuffer);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
};

export async function applyWatermark(
  bytes: Uint8Array,
  pngBytes: Uint8Array,
  pageIndices: number[] | 'all'
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes);
  const img = await doc.embedPng(pngBytes);
  const hash = await sha256Hex(pngBytes);
  const date = new Date().toISOString();
  const pages = doc.getPages();
  const indices = pageIndices === 'all' ? pages.map((_, i) => i) : pageIndices;

  for (const idx of indices) {
    const page = pages[idx];
    if (!page) continue;
    const { width, height } = page.getSize();
    // fit the image inside the page, centered — position is irrelevant for
    // detection, but a sane box keeps the content stream unremarkable
    const scale = Math.min(width / img.width, height / img.height, 1);
    const w = img.width * scale;
    const h = img.height * scale;
    page.drawImage(img, {
      x: (width - w) / 2,
      y: (height - h) / 2,
      width: w,
      height: h,
      opacity: 0,
    });
    page.node.set(
      PDFName.of(WM_KEY),
      doc.context.obj({
        H: PDFString.of(hash),
        I: PDFNumber.of(idx),
        D: PDFString.of(date),
      })
    );
  }
  return doc.save();
}

export async function readWatermarks(bytes: Uint8Array): Promise<WatermarkReport> {
  const doc = await PDFDocument.load(bytes);
  const pages = doc.getPages();
  const hashes = new Set<string>();
  const report: WatermarkReport['pages'] = pages.map((page, pageIndex) => {
    const entry = page.node.lookupMaybe(PDFName.of(WM_KEY), PDFDict);
    if (!entry) {
      return { pageIndex, present: false, recordedIndex: null, indexMatches: false, hash: null, date: null };
    }
    const hash = entry.lookupMaybe(PDFName.of('H'), PDFString)?.decodeText() ?? null;
    const recorded = entry.lookupMaybe(PDFName.of('I'), PDFNumber)?.asNumber() ?? null;
    const date = entry.lookupMaybe(PDFName.of('D'), PDFString)?.decodeText() ?? null;
    if (hash) hashes.add(hash);
    return {
      pageIndex,
      present: true,
      recordedIndex: recorded,
      indexMatches: recorded === pageIndex,
      hash,
      date,
    };
  });
  return { pageCount: pages.length, pages: report, hashes: [...hashes] };
}

/** Compares a reference PNG against the recorded hashes. */
export async function verifyAgainstPng(
  report: WatermarkReport,
  pngBytes: Uint8Array
): Promise<{ pageIndex: number; matches: boolean }[]> {
  const hash = await sha256Hex(pngBytes);
  return report.pages
    .filter((p) => p.present)
    .map((p) => ({ pageIndex: p.pageIndex, matches: p.hash === hash }));
}
