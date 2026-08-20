import { PDFArray, PDFDict, PDFDocument, PDFName, rgb } from 'pdf-lib';

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

  // Single-line fields get a standard control height (top-aligned inside
  // the dragged box) and a fixed font size — otherwise a generously drawn
  // box produces a giant field with auto-scaled giant text.
  const singleLine = spec.kind === 'text' || spec.kind === 'dropdown';
  const fieldH = singleLine ? Math.min(Math.max(rect.height, 18), 32) : rect.height;
  const fieldRect = singleLine
    ? { ...rect, y: rect.y + rect.height - fieldH, height: fieldH }
    : rect;

  switch (spec.kind) {
    case 'text':
    case 'multiline': {
      const field = form.createTextField(spec.name);
      if (spec.kind === 'multiline') field.enableMultiline();
      if (spec.defaultValue) field.setText(spec.defaultValue);
      try {
        field.setFontSize(11);
      } catch {
        // font size is cosmetic — never fail the field over it
      }
      field.addToPage(page, { ...fieldRect, ...look });
      break;
    }
    case 'checkbox': {
      const field = form.createCheckBox(spec.name);
      // checkboxes look best square — center inside the dragged region,
      // capped at a sane control size
      const side = Math.min(rect.width, rect.height, 26);
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
      try {
        field.setFontSize(11);
      } catch {
        // cosmetic only
      }
      field.addToPage(page, { ...fieldRect, ...look });
      break;
    }
  }

  return doc.save();
}

/** Summary of an existing AcroForm field, for the objects panel. */
export interface FieldSummary {
  name: string;
  kind: FieldKind;
  pageIndex: number;
  /** Widget rect in page percentages (top-left origin) — reusable as the
   *  region when re-creating the field after an edit. */
  region: FieldRegion | null;
  options: string[];
  defaultValue: string;
}

const widgetRegion = (doc: PDFDocument, fieldName: string): FieldRegion | null => {
  try {
    const field = doc.getForm().getField(fieldName);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const widget = (field as any).acroField.getWidgets()[0];
    if (!widget) return null;
    const rect = widget.getRectangle();
    const widgetRef = (field as { acroField: { getWidgets: () => unknown[] } }).acroField;
    // find the page whose /Annots carries this field's widget
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const widgetDict = (widget as any).dict as PDFDict;
    const pages = doc.getPages();
    for (let p = 0; p < pages.length; p++) {
      const annots = pages[p].node.lookupMaybe(PDFName.of('Annots'), PDFArray);
      if (!annots) continue;
      for (let i = 0; i < annots.size(); i++) {
        if (pages[p].node.context.lookup(annots.get(i)) === widgetDict) {
          const { width: pw, height: ph } = pages[p].getSize();
          void widgetRef;
          return {
            pageIndex: p,
            xPct: rect.x / pw,
            yPct: (ph - rect.y - rect.height) / ph,
            wPct: rect.width / pw,
            hPct: rect.height / ph,
          };
        }
      }
    }
  } catch {
    // orphaned widget — panel simply can't jump to it
  }
  return null;
};

export async function listFormFields(bytes: Uint8Array): Promise<FieldSummary[]> {
  try {
    const doc = await PDFDocument.load(bytes);
    const out: FieldSummary[] = [];
    for (const field of doc.getForm().getFields()) {
      const ctor = field.constructor.name;
      let kind: FieldKind | null = null;
      let options: string[] = [];
      let defaultValue = '';
      if (ctor === 'PDFTextField') {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        kind = (field as any).isMultiline?.() ? 'multiline' : 'text';
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        defaultValue = (field as any).getText?.() ?? '';
      } else if (ctor === 'PDFCheckBox') {
        kind = 'checkbox';
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        defaultValue = (field as any).isChecked?.() ? 'on' : '';
      } else if (ctor === 'PDFDropdown') {
        kind = 'dropdown';
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        options = (field as any).getOptions?.() ?? [];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        defaultValue = ((field as any).getSelected?.() ?? [])[0] ?? '';
      }
      if (!kind) continue; // signatures & radio groups aren't panel-managed
      out.push({
        name: field.getName(),
        kind,
        pageIndex: widgetRegion(doc, field.getName())?.pageIndex ?? 0,
        region: widgetRegion(doc, field.getName()),
        options,
        defaultValue,
      });
    }
    return out;
  } catch {
    return [];
  }
}

export async function removeFormField(bytes: Uint8Array, name: string): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes);
  const form = doc.getForm();
  form.removeField(form.getField(name));
  return doc.save();
}

/** Edit = remove + recreate at the same spot with the new spec. */
export async function updateFormField(
  bytes: Uint8Array,
  oldName: string,
  region: FieldRegion,
  spec: FieldSpec
): Promise<Uint8Array> {
  const without = await removeFormField(bytes, oldName);
  return addFormField(without, region, spec);
}
