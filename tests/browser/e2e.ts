/* Browser E2E (runs inside the dev-server page, see scripts/e2e-browser.mjs).
 * Covers what needs a real canvas/DOM: redact, region edit, compress, OCR,
 * pdf.js resource loading (JPEG 2000) and a UI smoke test of the viewer. */
import * as pdfjsLib from 'pdfjs-dist';
import { PDFDocument, PDFName, PDFDict, PDFRawStream, StandardFonts } from 'pdf-lib';
import { PDFJS_DOC_OPTIONS } from '../../src/pdfjsConfig';
import { redactPdf } from '../../src/redact';
import { applyRegionEdit } from '../../src/regionEdit';
import { compressPdf } from '../../src/compress';
import { ocrPdf } from '../../src/ocr';
import { dicts } from '../../src/i18n';

const log = (...a: unknown[]) => console.log('[e2e]', ...a);
function ok(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function textPdf(lines: string[][]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const pageLines of lines) {
    const p = doc.addPage([400, 400]);
    pageLines.forEach((l, i) => p.drawText(l, { x: 30, y: 340 - i * 40, size: 22, font }));
  }
  return doc.save();
}

async function texts(bytes: Uint8Array): Promise<string[]> {
  const task = pdfjsLib.getDocument({ ...PDFJS_DOC_OPTIONS, data: bytes.slice() });
  const doc = await task.promise;
  const out: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const tc = await (await doc.getPage(i)).getTextContent();
    out.push(tc.items.map((it) => ('str' in it ? it.str : '')).join(' ').trim());
  }
  await task.destroy();
  return out;
}

async function inflateAll(bytes: Uint8Array): Promise<string> {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  let all = s;
  const re = /stream\r?\n/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    const start = m.index + m[0].length;
    const end = s.indexOf('endstream', start);
    if (end < 0) break;
    const chunk = Uint8Array.from(s.slice(start, end), (c) => c.charCodeAt(0));
    try {
      const ds = new Blob([chunk]).stream().pipeThrough(new DecompressionStream('deflate'));
      const buf = new Uint8Array(await new Response(ds).arrayBuffer());
      let t = '';
      for (let i = 0; i < buf.length; i++) t += String.fromCharCode(buf[i]);
      all += '\n' + t;
    } catch {
      /* not flate */
    }
  }
  return all;
}

async function fileHas(bytes: Uint8Array, needle: string): Promise<boolean> {
  const all = await inflateAll(bytes);
  const hex = [...needle].map((c) => c.charCodeAt(0).toString(16).padStart(2, '0')).join('').toUpperCase();
  return all.includes(needle) || all.toUpperCase().includes(hex);
}

/** Average darkness of a rendered page region (0 = white, 255 = black). */
async function renderDarkness(bytes: Uint8Array, pageNo: number, box?: [number, number, number, number]) {
  const task = pdfjsLib.getDocument({ ...PDFJS_DOC_OPTIONS, data: bytes.slice() });
  const doc = await task.promise;
  const page = await doc.getPage(pageNo);
  const vp = page.getViewport({ scale: 1 });
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(vp.width);
  canvas.height = Math.round(vp.height);
  await page.render({ canvas, viewport: vp }).promise;
  const [x, y, w, h] = box ?? [0, 0, canvas.width, canvas.height];
  const d = canvas.getContext('2d')!.getImageData(x, y, w, h).data;
  let sum = 0;
  for (let i = 0; i < d.length; i += 4) sum += 255 - (d[i] + d[i + 1] + d[i + 2]) / 3;
  await task.destroy();
  return sum / (d.length / 4);
}

const tests: Record<string, () => Promise<void>> = {
  async redact_all_styles_remove_text_from_file() {
    const src = await textPdf([['SECRET-ALPHA', 'PUBLIC-LINE'], ['SEITE-ZWEI']]);
    for (const style of ['black', 'pixelate', 'blur'] as const) {
      // mark only the first line (top-left origin percentages)
      const marks = new Map([[0, [{ xPct: 0.05, yPct: 0.1, wPct: 0.9, hPct: 0.1 }]]]);
      const { bytes, pagesRedacted } = await redactPdf(src, marks, { cleanMetadata: true, style });
      ok(pagesRedacted === 1, `${style}: pagesRedacted=${pagesRedacted}`);
      ok(!(await fileHas(bytes, 'SECRET-ALPHA')), `${style}: secret still in file`);
      ok(!(await fileHas(bytes, 'PUBLIC-LINE')), `${style}: page text layer should be gone (page is image)`);
      const t = await texts(bytes);
      ok(t[0] === '' && t[1] === 'SEITE-ZWEI', `${style}: texts ${JSON.stringify(t)}`);
      const dark = await renderDarkness(bytes, 1, [20, 40, 360, 40]);
      if (style === 'black') ok(dark > 200, `black box not black (${dark})`);
      const untouched = await renderDarkness(bytes, 1, [20, 90, 300, 30]);
      ok(untouched > 5, `unmarked line should still be visible as pixels (${untouched})`);
    }
  },

  async region_edit_text_and_old_content_gone() {
    const src = await textPdf([['OLD-CONTENT-XY']]);
    const out = await applyRegionEdit(
      src,
      { pageIndex: 0, xPct: 0.05, yPct: 0.1, wPct: 0.9, hPct: 0.12 },
      { kind: 'text', text: 'NEUER TEXT' }
    );
    ok(!(await fileHas(out, 'OLD-CONTENT-XY')), 'original text still in file');
    const t = await texts(out);
    ok(t[0].includes('NEUER TEXT'), `replacement text missing: ${t[0]}`);
  },

  async region_edit_drops_fields_of_that_page_only() {
    const doc = await PDFDocument.create();
    const p1 = doc.addPage([400, 400]);
    const p2 = doc.addPage([400, 400]);
    const form = doc.getForm();
    const a = form.createTextField('feld.seite1');
    a.setText('WERT-SEITE-EINS');
    a.addToPage(p1, { x: 40, y: 300, width: 200, height: 24 });
    const b = form.createTextField('feld.seite2');
    b.setText('WERT-SEITE-ZWEI');
    b.addToPage(p2, { x: 40, y: 300, width: 200, height: 24 });
    const src = await doc.save();
    const out = await applyRegionEdit(
      src,
      { pageIndex: 0, xPct: 0.05, yPct: 0.6, wPct: 0.5, hPct: 0.1 },
      { kind: 'text', text: 'NEU' }
    );
    const outDoc = await PDFDocument.load(out);
    const outForm = outDoc.getForm();
    const names = outForm.getFields().map((f) => f.getName());
    ok(JSON.stringify(names) === '["feld.seite2"]', `fields after region edit: ${JSON.stringify(names)}`);
    ok(outForm.getTextField('feld.seite2').getText() === 'WERT-SEITE-ZWEI', 'field on the other page must stay');
    // pdf-lib stores field values as UTF-16BE hex strings
    const utf16 = (s: string) =>
      'FEFF' + [...s].map((c) => c.charCodeAt(0).toString(16).padStart(4, '0')).join('').toUpperCase();
    // re-save without object streams (load keeps every object, reachable
    // or not) so the dict entries are plain text to search
    const plain = await outDoc.save({ useObjectStreams: false });
    let all = '';
    for (let i = 0; i < plain.length; i++) all += String.fromCharCode(plain[i]);
    ok(all.includes(utf16('WERT-SEITE-ZWEI')), 'probe: UTF-16 value of the kept field not found');
    ok(!all.includes(utf16('WERT-SEITE-EINS')), 'value of the removed field still in file');
  },

  async compress_reencodes_jpeg_and_keeps_smask() {
    const c = document.createElement('canvas');
    c.width = 1200;
    c.height = 900;
    const ctx = c.getContext('2d')!;
    const img = ctx.createImageData(c.width, c.height);
    for (let i = 0; i < img.data.length; i += 4) {
      img.data[i] = (i * 7) & 255;
      img.data[i + 1] = Math.random() * 255;
      img.data[i + 2] = (i >> 9) & 255;
      img.data[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    const jpg = new Uint8Array(await (await new Promise<Blob>((r) => c.toBlob((b) => r(b!), 'image/jpeg', 0.95))).arrayBuffer());
    const doc = await PDFDocument.create();
    const page = doc.addPage([600, 450]);
    const embedded = await doc.embedJpg(jpg);
    page.drawImage(embedded, { x: 0, y: 0, width: 600, height: 450 });
    // give it a soft mask, like a transparent photo
    const smask = doc.context.register(
      doc.context.stream(new Uint8Array(4).fill(255), {
        Type: 'XObject', Subtype: 'Image', Width: 2, Height: 2, ColorSpace: 'DeviceGray', BitsPerComponent: 8,
      })
    );
    await doc.flush();
    (doc.context.lookup(embedded.ref) as PDFRawStream).dict.set(PDFName.of('SMask'), smask);
    const src = await doc.save();
    const { bytes, imagesTouched } = await compressPdf(src, 'small');
    ok(imagesTouched === 1, `imagesTouched=${imagesTouched}`);
    ok(bytes.length < src.length * 0.7, `not smaller: ${src.length} -> ${bytes.length}`);
    const re = await PDFDocument.load(bytes);
    const xo = re.getPage(0).node.Resources()!.lookup(PDFName.of('XObject'), PDFDict);
    const imgStream = re.context.lookup(xo.values()[0]) as PDFRawStream;
    ok(imgStream.dict.get(PDFName.of('SMask')), 'SMask lost');
    ok((await renderDarkness(bytes, 1)) > 10, 'compressed image renders blank');
  },

  async jpeg2000_renders_with_wasm_decoder() {
    const jp2 = new Uint8Array(await (await fetch('/tests/fixtures/icon.jp2')).arrayBuffer());
    const doc = await PDFDocument.create();
    const page = doc.addPage([200, 200]);
    const ref = doc.context.register(
      doc.context.stream(jp2, { Type: 'XObject', Subtype: 'Image', Width: 64, Height: 64, Filter: 'JPXDecode' })
    );
    page.node.setXObject(PDFName.of('Im0'), ref);
    const { pushGraphicsState, popGraphicsState, concatTransformationMatrix, drawObject } = await import('pdf-lib');
    page.pushOperators(pushGraphicsState(), concatTransformationMatrix(200, 0, 0, 200, 0, 0), drawObject('Im0'), popGraphicsState());
    const dark = await renderDarkness(await doc.save(), 1);
    ok(dark > 20, `JPX image rendered blank (darkness ${dark.toFixed(1)})`);
  },

  async ocr_recognizes_rendered_text() {
    // render text as an image-only page (a "scan"), then OCR it
    const c = document.createElement('canvas');
    c.width = 1200;
    c.height = 600;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.fillStyle = '#000';
    ctx.font = 'bold 72px Arial, Helvetica, sans-serif';
    ctx.fillText('Hello Invoice 2026', 60, 200);
    ctx.fillText('Rechnung Nummer', 60, 380);
    const png = new Uint8Array(await (await new Promise<Blob>((r) => c.toBlob((b) => r(b!), 'image/png'))).arrayBuffer());
    const doc = await PDFDocument.create();
    const page = doc.addPage([600, 300]);
    page.drawImage(await doc.embedPng(png), { x: 0, y: 0, width: 600, height: 300 });
    const src = await doc.save();
    ok((await texts(src))[0] === '', 'scan should have no text yet');
    const { bytes, wordsFound } = await ocrPdf(src, [0], ['eng', 'deu']);
    ok(wordsFound >= 4, `wordsFound=${wordsFound}`);
    const t = (await texts(bytes))[0];
    ok(/Invoice/i.test(t) && /Rechnung/i.test(t), `OCR text: ${t}`);
    // invisible: the page must look the same
    const before = await renderDarkness(src, 1);
    const after = await renderDarkness(bytes, 1);
    ok(Math.abs(before - after) < 1, `OCR layer is visible (${before} vs ${after})`);
  },

  async ui_viewer_smoke() {
    const t = navigator.language.toLowerCase().startsWith('de') ? dicts.de : dicts.en;
    // close the first-run tutorial if it is open
    for (const b of document.querySelectorAll<HTMLButtonElement>('.hlp-overlay button')) {
      if (/✕|×|skip|überspringen|schließen|close/i.test(b.textContent ?? '')) b.click();
    }
    await sleep(200);
    document.querySelector<HTMLElement>('.hlp-overlay')?.click();
    await sleep(200);
    const input = document.querySelector<HTMLInputElement>('input[type=file][accept="application/pdf"]');
    ok(input, 'browser file input missing');
    const pdf = await textPdf([['Smoke Page One'], ['Smoke Page Two']]);
    const dt = new DataTransfer();
    dt.items.add(new File([pdf], 'smoke.pdf', { type: 'application/pdf' }));
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    for (let i = 0; i < 50 && !document.querySelector('.page canvas'); i++) await sleep(100);
    ok(document.querySelector('.page canvas'), 'page canvas not rendered');
    ok(document.querySelector('.tab.active')?.textContent?.includes('smoke.pdf'), 'tab missing');
    await sleep(800);
    const textLayer = document.querySelector('.textLayer')?.textContent ?? '';
    ok(textLayer.includes('Smoke Page One'), `text layer: "${textLayer}"`);

    const button = (label: string) =>
      [...document.querySelectorAll<HTMLButtonElement>('button')].find((b) => (b.textContent ?? '').trim() === label);
    const dialogs: [string, string][] = [
      [t.stampButton, 'stamp'],
      [t.compressButton, 'compress'],
      [t.ocrButton, 'ocr'],
      [t.signButton, 'sign'],
      [t.protectButton, 'protect'],
      [t.wmButton, 'watermark'],
      [t.pagesButton, 'pages'],
    ];
    for (const [label, name] of dialogs) {
      const b = button(label);
      ok(b, `toolbar button "${label}" missing`);
      b.click();
      await sleep(400);
      const modal = document.querySelector('.overlay .modal, .overlay .pages-modal, .overlay');
      ok(modal, `${name} dialog did not open`);
      (document.querySelector('.overlay') as HTMLElement).click(); // backdrop closes
      await sleep(200);
      ok(!document.querySelector('.overlay'), `${name} dialog did not close`);
    }
    // drawing tools switch + properties bar
    for (const tool of ['highlight', 'freetext', 'ink'] as const) {
      button(t.tools[tool])!.click();
      await sleep(150);
      ok(document.querySelector('.propsbar'), `${tool}: properties bar missing`);
    }
    button(t.tools.select)!.click();
    // search
    (document.querySelector(`button[title="${t.find}"]`) as HTMLButtonElement).click();
    await sleep(100);
    const find = document.querySelector<HTMLInputElement>('.findinput')!;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    setter.call(find, 'Page Two');
    find.dispatchEvent(new Event('input', { bubbles: true }));
    await sleep(1200);
    const findInfo = document.querySelector('.findbar .faint')?.textContent ?? '';
    ok(/1\/1/.test(findInfo), `search result: "${findInfo}"`);
    // help + theme toggle
    (document.querySelector('.hlp-fab:not(.theme-fab)') as HTMLButtonElement).click();
    await sleep(200);
    ok(document.querySelector('.hlp-modal'), 'help did not open');
    (document.querySelector('.hlp-overlay') as HTMLElement).click();
    const before = document.documentElement.dataset.theme ?? '';
    (document.querySelector('.theme-fab') as HTMLButtonElement).click();
    await sleep(100);
    ok((document.documentElement.dataset.theme ?? '') !== before, 'theme did not toggle');
  },
};

export async function runAll() {
  let passed = 0;
  let failed = 0;
  for (const [name, fn] of Object.entries(tests)) {
    const t0 = performance.now();
    try {
      await fn();
      passed++;
      log(`ok   ${name} (${Math.round(performance.now() - t0)} ms)`);
    } catch (err) {
      failed++;
      log(`FAIL ${name}: ${String(err)} ${(err as Error)?.stack?.split('\n')[1] ?? ''}`);
    }
  }
  return { passed, failed };
}
