import { PDFDocument, rgb } from 'pdf-lib';

/** Creating real AcroForm fields (Acrobat "Prepare form"): the field is
 *  placed via a dragged page region, written with pdf-lib's form API and is
 *  immediately fillable in the viewer (ENABLE_FORMS) and in every other
 *  PDF reader. */

export type FieldKind = 'text' | 'multiline' | 'checkbox' | 'dropdown';

export interface FieldRegion {
  pageIndex: number;
  xPct: number;
  yPct: number;
  wPct: number;
  hPct: number;
}

export interface FieldSpec {
  kind: FieldKind;
  name: string;
  /** dropdown only */
  options: string[];
  defaultValue: string;
}

export class FieldNameTakenError extends Error {
  constructor(name: string) {
    super(`field name already taken: ${name}`);
    this.name = 'FieldNameTakenError';
  }
}

/** Suggests the next free field name (feld_1, feld_2, …). */
export async function suggestFieldName(bytes: Uint8Array, base: string): Promise<string> {
  try {
    const doc = await PDFDocument.load(bytes);
    const taken = new Set(doc.getForm().getFields().map((f) => f.getName()));
    for (let i = 1; ; i++) {
      const name = `${base}_${i}`;
      if (!taken.has(name)) return name;
    }
  } catch {
    return `${base}_1`;
  }
}

export async function addFormField(
  bytes: Uint8Array,
  region: FieldRegion,
  spec: FieldSpec
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes);
  const pages = doc.getPages();
  const page = pages[Math.min(region.pageIndex, pages.length - 1)];
  const { width: pw, height: ph } = page.getSize();
  const rect = {
    x: region.xPct * pw,
    y: ph - (region.yPct + region.hPct) * ph,
    width: Math.max(8, region.wPct * pw),
    height: Math.max(8, region.hPct * ph),
  };

  const form = doc.getForm();
  if (form.getFields().some((f) => f.getName() === spec.name)) {
    throw new FieldNameTakenError(spec.name);
  }

  const look = {
    backgroundColor: rgb(0.94, 0.97, 1),
    borderColor: rgb(0.23, 0.51, 0.96),
    borderWidth: 1,
  };

  switch (spec.kind) {
    case 'text':
    case 'multiline': {
      const field = form.createTextField(spec.name);
      if (spec.kind === 'multiline') field.enableMultiline();
      if (spec.defaultValue) field.setText(spec.defaultValue);
      field.addToPage(page, { ...rect, ...look });
      break;
    }
    case 'checkbox': {
      const field = form.createCheckBox(spec.name);
      // checkboxes look best square — center inside the dragged region
      const side = Math.min(rect.width, rect.height);
      field.addToPage(page, {
        x: rect.x + (rect.width - side) / 2,
        y: rect.y + (rect.height - side) / 2,
        width: side,
        height: side,
        ...look,
      });
      if (spec.defaultValue === 'on') field.check();
      break;
    }
    case 'dropdown': {
      const field = form.createDropdown(spec.name);
      const options = spec.options.filter((o) => o.trim().length > 0);
      if (options.length > 0) field.addOptions(options);
      if (spec.defaultValue && options.includes(spec.defaultValue)) field.select(spec.defaultValue);
      field.addToPage(page, { ...rect, ...look });
      break;
    }
  }

  return doc.save();
}
