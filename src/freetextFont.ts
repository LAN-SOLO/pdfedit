import fontkit from '@pdf-lib/fontkit';
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFFont,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFString,
  StandardFonts,
} from 'pdf-lib';

/** Custom fonts for the Text (FreeText) tool.
 *
 *  pdf.js's FreeText editor is hard-wired to Helvetica — it neither offers
 *  a font parameter nor serializes one. So pdfedit lets pdf.js write the
 *  annotation as usual and then, in the same save pass, regenerates the
 *  annotation's appearance stream with the chosen font (standard PDF font
 *  or a system TTF/OTF embedded via fontkit). The annotation stays a real,
 *  spec-compliant FreeText annot; only its /AP (what every viewer renders)
 *  carries the font. If another editor regenerates the appearance later
 *  (e.g. after editing the text in Acrobat), it falls back to the /DA font
 *  — documented in the manual. */

export type FreetextFontChoice =
  | { kind: 'default' }
  | { kind: 'standard'; font: 'times' | 'courier' }
  | { kind: 'system'; name: string; path: string };

/** One session-created FreeText annotation, as reported by pdf.js's
 *  annotationStorage right before saving. */
export interface FreetextEntry {
  pageIndex: number;
  rect: [number, number, number, number];
  value: string;
  fontSize: number;
  /** 0–255 each */
  color: [number, number, number];
}

export interface FontApplication {
  entry: FreetextEntry;
  choice: FreetextFontChoice;
  /** Raw TTF/OTF bytes for system fonts; null for standard fonts. */
  fontBytes: Uint8Array | null;
}

const STANDARD: Record<'times' | 'courier', StandardFonts> = {
  times: StandardFonts.TimesRoman,
  courier: StandardFonts.Courier,
};

const rectsMatch = (a: number[], b: [number, number, number, number]): boolean =>
  a.length === 4 && a.every((v, i) => Math.abs(v - b[i]) < 0.6);

/** Embeds the chosen font into `doc` — standard PDF fonts directly, system
 *  fonts via fontkit (subset when the subsetter can cope, full otherwise).
 *  Shared by the FreeText appearance pass and the line-edit tool. */
export async function embedChosenFont(
  doc: PDFDocument,
  choice: FreetextFontChoice,
  fontBytes: Uint8Array | null,
  sample: string
): Promise<PDFFont> {
  if (choice.kind === 'standard') return doc.embedFont(STANDARD[choice.font]);
  if (choice.kind === 'system' && fontBytes) {
    const subset = await subsetWorks(fontBytes, sample);
    return doc.embedFont(fontBytes, { subset });
  }
  return doc.embedFont(StandardFonts.Helvetica);
}

const subsetProbeCache = new Map<Uint8Array, boolean>();
async function subsetWorks(fontBytes: Uint8Array, sample: string): Promise<boolean> {
  const cached = subsetProbeCache.get(fontBytes);
  if (cached !== undefined) return cached;
  let ok = true;
  try {
    const probe = await PDFDocument.create();
    probe.registerFontkit(fontkit);
    const f = await probe.embedFont(fontBytes, { subset: true });
    probe.addPage([50, 50]).drawText(sample || 'Aa', { font: f, size: 6, x: 4, y: 20 });
    await probe.save();
  } catch {
    ok = false;
  }
  subsetProbeCache.set(fontBytes, ok);
  return ok;
}

export async function applyFreetextFonts(
  bytes: Uint8Array,
  applications: FontApplication[]
): Promise<Uint8Array> {
  const relevant = applications.filter((a) => a.choice.kind !== 'default');
  if (relevant.length === 0) return bytes;

  const doc = await PDFDocument.load(bytes);
  doc.registerFontkit(fontkit);
  const ctx = doc.context;
  const pages = doc.getPages();
  const fontCache = new Map<string, PDFFont>();

  const getFont = async (app: FontApplication): Promise<PDFFont> => {
    const key = app.choice.kind === 'standard' ? `std:${app.choice.font}` : `sys:${(app.choice as { name: string }).name}`;
    let font = fontCache.get(key);
    if (!font) {
      // fontkit's subsetter chokes on some system TTFs (seen with Apple's
      // Arial) and the failure only surfaces at save() — embedChosenFont
      // probes it first and falls back to full embedding when needed.
      font = await embedChosenFont(doc, app.choice, app.fontBytes, app.entry.value);
      fontCache.set(key, font);
    }
    return font;
  };

  for (const app of relevant) {
    const page = pages[app.entry.pageIndex];
    if (!page) continue;
    const annots = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray);
    if (!annots) continue;

    for (let i = 0; i < annots.size(); i++) {
      const annot = page.node.context.lookupMaybe(annots.get(i), PDFDict);
      if (!annot) continue;
      if (annot.lookupMaybe(PDFName.of('Subtype'), PDFName) !== PDFName.of('FreeText')) continue;
      const rect = annot
        .lookupMaybe(PDFName.of('Rect'), PDFArray)
        ?.asArray()
        .map((n) => (n instanceof PDFNumber ? n.asNumber() : NaN));
      if (!rect || !rectsMatch(rect, app.entry.rect)) continue;
      const contents = annot.lookupMaybe(PDFName.of('Contents'), PDFString, PDFHexString);
      if ((contents?.decodeText() ?? '') !== app.entry.value) continue;

      const font = await getFont(app);
      const [x1, y1, x2, y2] = app.entry.rect;
      const w = Math.abs(x2 - x1);
      const h = Math.abs(y2 - y1);
      const size = app.entry.fontSize;
      const [r, g, b] = app.entry.color.map((c) => (c / 255).toFixed(4));
      // pdf.js lays FreeText out with ~1.35 line height and a small inset
      const leading = size * 1.35;
      const inset = 2;
      const lines = app.entry.value.split('\n');
      const textOps = lines
        .map((ln) => `${font.encodeText(ln).toString()} Tj T*`)
        .join('\n');
      const ops = [
        `BT`,
        `/Fx ${size} Tf`,
        `${leading.toFixed(2)} TL`,
        `${r} ${g} ${b} rg`,
        `1 0 0 1 ${inset} ${(h - inset - size * 0.9).toFixed(2)} Tm`,
        textOps,
        `ET`,
      ].join('\n');
      const ap = ctx.stream(ops, {
        Type: 'XObject',
        Subtype: 'Form',
        BBox: ctx.obj([PDFNumber.of(0), PDFNumber.of(0), PDFNumber.of(w), PDFNumber.of(h)]),
        Resources: ctx.obj({ Font: ctx.obj({ Fx: font.ref }) }),
      });
      annot.set(PDFName.of('AP'), ctx.obj({ N: ctx.register(ap) }));
      // remember the font so a later inspection can tell it apart
      annot.set(PDFName.of('PdfeditFont'), PDFString.of(
        app.choice.kind === 'standard' ? app.choice.font : (app.choice as { name: string }).name
      ));
      break;
    }
  }

  // pdf.js only regenerates what it re-serializes — the flush here makes
  // sure the embedded/subset fonts land in the output
  return doc.save();
}
