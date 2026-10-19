/** Shared getDocument() options: where pdf.js finds its runtime resources
 *  (copied to /pdfjs/ by the vite plugin in vite.config.ts). Every
 *  getDocument() call in the app spreads these — without wasmUrl pdf.js
 *  cannot decode JPEG 2000, JBIG2 or CCITT-fax images (typical for scans:
 *  they render blank, and OCR/redaction would work on blank pages), and
 *  without cMapUrl CID-keyed text (CJK and others) goes missing. */
const base = (dir: string) => new URL(`/pdfjs/${dir}/`, window.location.href).href;

export const PDFJS_DOC_OPTIONS = {
  cMapUrl: base('cmaps'),
  cMapPacked: true,
  wasmUrl: base('wasm'),
  iccUrl: base('iccs'),
} as const;
