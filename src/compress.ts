import {
  PDFDocument as PdfLibDocument,
  PDFArray,
  PDFName,
  PDFDict,
  PDFNumber,
  PDFRawStream,
  PDFRef,
} from 'pdf-lib';

export type CompressPreset = 'fast' | 'balanced' | 'small';

/** Downsample scale + re-encode quality per preset. Deliberately scoped to
 *  embedded JPEGs (Filter = plain /DCTDecode) — by far the most common
 *  space hog in real-world PDFs (scans, photos). Raw/Flate-sampled bitmaps,
 *  JPEG2000, CCITT fax, multi-filter chains and non-RGB/gray JPEGs (CMYK,
 *  Indexed, /Decode) are left untouched rather
 *  than risking a lossy, hard-to-verify pixel reconstruction for a first
 *  release. */
const PRESETS: Record<CompressPreset, { scale: number; quality: number }> = {
  fast: { scale: 0.85, quality: 0.82 },
  balanced: { scale: 0.65, quality: 0.72 },
  small: { scale: 0.45, quality: 0.55 },
};

/** Color spaces a browser canvas re-encodes faithfully as an RGB JPEG.
 *  CMYK (inverted Adobe JPEGs, /Decode arrays), Indexed, Separation,
 *  Lab etc. would come back with wrong colors — those images are skipped. */
const isRgbOrGray = (dict: PDFDict): boolean => {
  const cs = dict.lookup(PDFName.of('ColorSpace'));
  if (cs instanceof PDFName) return cs.decodeText() === 'DeviceRGB' || cs.decodeText() === 'DeviceGray';
  if (cs instanceof PDFArray && cs.size() >= 2) {
    const kind = cs.lookup(0);
    if (!(kind instanceof PDFName) || kind.decodeText() !== 'ICCBased') return false;
    const profile = cs.lookup(1);
    const n = profile instanceof PDFRawStream ? profile.dict.lookup(PDFName.of('N')) : undefined;
    return n instanceof PDFNumber && (n.asNumber() === 3 || n.asNumber() === 1);
  }
  return false;
};

const isPlainJpeg = (dict: PDFDict): boolean => {
  const subtype = dict.lookupMaybe(PDFName.of('Subtype'), PDFName);
  if (!subtype || subtype.decodeText() !== 'Image') return false;
  const filter = dict.get(PDFName.of('Filter'));
  if (!(filter instanceof PDFName) || filter.decodeText() !== 'DCTDecode') return false;
  if (dict.get(PDFName.of('ImageMask')) || dict.get(PDFName.of('Decode'))) return false;
  // color-key masking (/Mask [ranges]) matches exact sample values per
  // component — a lossy, gray→RGB re-encode would break or invalidate it
  if (dict.lookup(PDFName.of('Mask')) instanceof PDFArray) return false;
  return isRgbOrGray(dict);
};

/** Entries that must survive the re-encode — above all the soft mask,
 *  without which transparent images turn into opaque boxes. */
const KEEP_KEYS = ['SMask', 'Mask', 'Interpolate', 'Intent', 'OC', 'Metadata', 'StructParent'];

interface Recompressed {
  bytes: Uint8Array;
  width: number;
  height: number;
}

const recompressJpeg = async (
  bytes: Uint8Array,
  scale: number,
  quality: number
): Promise<Recompressed | null> => {
  // `bytes` may come typed as Uint8Array<ArrayBufferLike> (e.g. from
  // pdf-lib), which TS's DOM lib doesn't accept as a BlobPart — copy into a
  // freshly allocated, plain-ArrayBuffer-backed Uint8Array first.
  const owned = new Uint8Array(bytes.length);
  owned.set(bytes);
  const blob = new Blob([owned], { type: 'image/jpeg' });
  const bitmap = await createImageBitmap(blob);
  try {
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    if (width < 20 || height < 20) return null;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0, width, height);
    const out = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', quality)
    );
    if (!out) return null;
    const newBytes = new Uint8Array(await out.arrayBuffer());
    return newBytes.length < bytes.length ? { bytes: newBytes, width, height } : null;
  } finally {
    bitmap.close();
  }
};

/** Re-encodes every plain-JPEG image XObject in the document at a reduced
 *  size/quality, in place (same object refs, so nothing else in the PDF
 *  needs updating). Shared images (same ref used on multiple pages) are
 *  only processed once. Returns the new document bytes and how many images
 *  were actually touched, so the caller can tell "nothing to do" apart from
 *  a real result. */
export const compressPdf = async (
  bytes: Uint8Array,
  preset: CompressPreset
): Promise<{ bytes: Uint8Array; imagesTouched: number }> => {
  const { scale, quality } = PRESETS[preset];
  const pdfDoc = await PdfLibDocument.load(bytes);
  const context = pdfDoc.context;
  const seen = new Set<string>();
  let imagesTouched = 0;

  for (const page of pdfDoc.getPages()) {
    const resources = page.node.Resources();
    const xobjects = resources?.lookupMaybe(PDFName.of('XObject'), PDFDict);
    if (!xobjects) continue;

    for (const [name, value] of xobjects.entries()) {
      const ref = value instanceof PDFRef ? value : undefined;
      const key = ref ? ref.toString() : `inline:${name.asString()}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const stream = ref ? context.lookup(ref) : value;
      if (!(stream instanceof PDFRawStream)) continue;
      if (!isPlainJpeg(stream.dict)) continue;

      const recompressed = await recompressJpeg(stream.getContents(), scale, quality);
      if (!recompressed) continue;

      const newStream = context.stream(recompressed.bytes, {
        Type: 'XObject',
        Subtype: 'Image',
        Width: recompressed.width,
        Height: recompressed.height,
        BitsPerComponent: 8,
        ColorSpace: 'DeviceRGB',
        Filter: 'DCTDecode',
      });
      for (const k of KEEP_KEYS) {
        const v = stream.dict.get(PDFName.of(k));
        if (v !== undefined) newStream.dict.set(PDFName.of(k), v);
      }

      if (ref) context.assign(ref, newStream);
      else xobjects.set(name, newStream);
      imagesTouched += 1;
    }
  }

  const outBytes = await pdfDoc.save();
  return { bytes: outBytes, imagesTouched };
};
