import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

export { assert };

/** Minimal RGBA PNG encoder (solid color) — test fixtures without a canvas. */
export function makePng(w: number, h: number, rgba: [number, number, number, number]): Uint8Array {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    for (let x = 0; x < w; x++) raw.set(rgba, y * (w * 4 + 1) + 1 + x * 4);
  }
  return new Uint8Array(
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', ihdr),
      chunk('IDAT', zlib.deflateSync(raw)),
      chunk('IEND', Buffer.alloc(0)),
    ])
  );
}

/** A PDF whose page i carries the text "PAGE-<i+1> <extra>" and is
 *  (200 + i) points wide, so order/identity are checkable after edits. */
export async function makePdf(pageTexts: string[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  pageTexts.forEach((txt, i) => {
    const p = doc.addPage([200 + i, 300]);
    p.drawText(txt, { x: 20, y: 200, font, size: 12 });
  });
  return doc.save();
}

/** Text of each page via pdf.js (what a viewer/extractor would see). */
export async function pageTexts(bytes: Uint8Array): Promise<string[]> {
  const task = pdfjs.getDocument({ data: bytes.slice(), verbosity: 0 });
  const doc = await task.promise;
  const out: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const tc = await page.getTextContent();
    out.push(
      tc.items
        .map((it) => ('str' in it ? it.str : ''))
        .join(' ')
        .trim()
    );
  }
  await task.destroy();
  return out;
}

/** Every stream in the file, inflated where possible, plus the raw bytes
 *  — to prove a string is (not) anywhere in the saved file. */
export function fileContains(bytes: Uint8Array, needle: string): boolean {
  const s = Buffer.from(bytes).toString('latin1');
  const hex = Buffer.from(needle, 'latin1').toString('hex').toUpperCase();
  const hit = (t: string) => t.includes(needle) || t.toUpperCase().includes(hex);
  if (hit(s)) return true;
  const re = /stream\r?\n/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    const start = m.index + m[0].length;
    const end = s.indexOf('endstream', start);
    if (end < 0) break;
    try {
      const inflated = zlib.inflateSync(Buffer.from(s.slice(start, end), 'latin1')).toString('latin1');
      if (hit(inflated)) return true;
    } catch {
      // not flate — raw already checked
    }
  }
  return false;
}

export const pageWidths = async (bytes: Uint8Array): Promise<number[]> => {
  const doc = await PDFDocument.load(bytes);
  return doc.getPages().map((p) => Math.round(p.getWidth()));
};
