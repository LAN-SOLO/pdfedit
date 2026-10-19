import forge from 'node-forge';
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFRef,
  PDFString,
  StandardFonts,
} from 'pdf-lib';
import { assert, fileContains, makePdf, makePng, pageTexts, pageWidths } from './helpers';
import {
  allPermissions,
  decryptPdf,
  encryptPdf,
  isPasswordProtected,
  isWrongPasswordError,
  looksEncrypted,
} from '../src/protect';
import { applyWatermark, readWatermarks, verifyAgainstPng } from '../src/watermark';
import { movePage, organizePages } from '../src/pages';
import {
  addFormField,
  FieldNameTakenError,
  listFormFields,
  removeFormField,
  suggestFieldName,
  updateFormField,
} from '../src/formFields';
import { isWrongP12Password, readP12, signPdf } from '../src/sign';
import { dropStructureTree, pruneUnreachable, replacePageWithImage } from '../src/pdfScrub';
import { matchFont, parsePdfFontName, stdKeyFor } from '../src/fontMatch';
import { applyRunEdit } from '../src/textEdit';
import { bytesToBase64 } from '../src/bytes';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

// ---------------------------------------------------------------- protect

export async function test_protect_roundtrip() {
  const plain = await makePdf(['GEHEIMER-INHALT', 'zweite Seite']);
  assert.equal(await isPasswordProtected(plain), false);
  const enc = await encryptPdf(plain, {
    userPassword: 'öffne-mich',
    ownerPassword: '',
    permissions: { ...allPermissions, printing: false, copying: false },
  });
  assert.ok(looksEncrypted(enc));
  assert.equal(await isPasswordProtected(enc), true);
  assert.equal(fileContains(enc, 'GEHEIMER-INHALT'), false, 'plaintext visible in encrypted file');

  await assert.rejects(
    () => decryptPdf(enc, 'falsch'),
    (err: unknown) => isWrongPasswordError(err)
  );
  const dec = await decryptPdf(enc, 'öffne-mich');
  assert.equal(await isPasswordProtected(dec), false);
  assert.equal(looksEncrypted(dec), false, 'decrypted copy still carries /Encrypt');
  assert.deepEqual(await pageTexts(dec), ['GEHEIMER-INHALT', 'zweite Seite']);

  // pdf.js must open the encrypted file with the password, too
  const texts = await pageTextsWithPassword(enc, 'öffne-mich');
  assert.deepEqual(texts, ['GEHEIMER-INHALT', 'zweite Seite']);

  // re-protect (the app re-encrypts on every save of an opened protected file)
  const again = await encryptPdf(dec, { userPassword: 'neu', ownerPassword: 'owner', permissions: allPermissions });
  assert.deepEqual(await pageTexts(await decryptPdf(again, 'neu')), ['GEHEIMER-INHALT', 'zweite Seite']);
}

async function pageTextsWithPassword(bytes: Uint8Array, password: string) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({ data: bytes.slice(), password, verbosity: 0 });
  const doc = await task.promise;
  const out: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const tc = await (await doc.getPage(i)).getTextContent();
    out.push(tc.items.map((it) => ('str' in it ? it.str : '')).join(' ').trim());
  }
  await task.destroy();
  return out;
}

// -------------------------------------------------------------- watermark

export async function test_watermark_detects_reorder_and_foreign_pages() {
  const pdf = await makePdf(['a', 'b', 'c']);
  const png = makePng(8, 8, [255, 0, 0, 255]);
  const marked = await applyWatermark(pdf, png, 'all');
  const rep = await readWatermarks(marked);
  assert.equal(rep.pageCount, 3);
  assert.ok(rep.pages.every((p) => p.present && p.indexMatches));
  assert.equal(rep.hashes.length, 1);
  assert.deepEqual(
    (await verifyAgainstPng(rep, png)).map((r) => r.matches),
    [true, true, true]
  );
  assert.deepEqual(
    (await verifyAgainstPng(rep, makePng(8, 8, [0, 0, 255, 255]))).map((r) => r.matches),
    [false, false, false]
  );

  // reorder → recorded positions no longer match
  const moved = await movePage(marked, 0, 2);
  const rep2 = await readWatermarks(moved);
  assert.deepEqual(rep2.pages.map((p) => p.indexMatches), [false, false, false]);
  assert.deepEqual(rep2.pages.map((p) => p.recordedIndex), [1, 2, 0]);

  // current-page-only mark → other pages report "not present"
  const one = await applyWatermark(pdf, png, [1]);
  assert.deepEqual((await readWatermarks(one)).pages.map((p) => p.present), [false, true, false]);
  // the watermark must stay invisible: no text change
  assert.deepEqual(await pageTexts(marked), ['a', 'b', 'c']);
}

// ------------------------------------------------------------------ pages

export async function test_move_page_keeps_fields() {
  const pdf = await makePdf(['eins', 'zwei', 'drei', 'vier']);
  const withField = await addFormField(
    pdf,
    { pageIndex: 3, xPct: 0.1, yPct: 0.1, wPct: 0.5, hPct: 0.1 },
    { kind: 'text', name: 'kunde', options: [], defaultValue: 'Muster GmbH' }
  );
  const moved = await movePage(withField, 3, 0);
  assert.deepEqual(await pageTexts(moved), ['vier', 'eins', 'zwei', 'drei']);
  assert.deepEqual(await pageWidths(moved), [203, 200, 201, 202]);
  const fields = await listFormFields(moved);
  assert.equal(fields.length, 1);
  assert.equal(fields[0].defaultValue, 'Muster GmbH');
  assert.equal(fields[0].pageIndex, 0, 'field follows its page');
  // out of range / no-op
  assert.equal(await movePage(moved, 1, 1), moved);
  assert.equal(await movePage(moved, -1, 2), moved);
  assert.equal(await movePage(moved, 0, 99), moved);
}

export async function test_organize_pages_keeps_forms_and_drops_deleted() {
  let base = await makePdf(['P1-TEXT', 'P2-DELETE-ME', 'P3-TEXT']);
  base = await addFormField(base, { pageIndex: 2, xPct: 0.1, yPct: 0.1, wPct: 0.5, hPct: 0.1 },
    { kind: 'text', name: 'auf_p3', options: [], defaultValue: 'bleibt' });
  base = await addFormField(base, { pageIndex: 1, xPct: 0.1, yPct: 0.1, wPct: 0.5, hPct: 0.1 },
    { kind: 'text', name: 'auf_p2', options: [], defaultValue: 'weg' });
  // inherited rotation on the tree root must survive the flattening
  const d = await PDFDocument.load(base);
  d.catalog.lookup(PDFName.of('Pages'), PDFDict).set(PDFName.of('Rotate'), d.context.obj(180));
  base = await d.save();
  const other = await makePdf(['MERGED-1', 'MERGED-2']);

  const out = await organizePages([base, other], [
    { kind: 'page', sourceIndex: 0, sourcePageIndex: 2, rotation: 90, width: 0, height: 0 },
    { kind: 'blank', sourceIndex: -1, sourcePageIndex: -1, rotation: 0, width: 100, height: 150 },
    { kind: 'page', sourceIndex: 1, sourcePageIndex: 1, rotation: 0, width: 0, height: 0 },
    { kind: 'page', sourceIndex: 0, sourcePageIndex: 0, rotation: 0, width: 0, height: 0 },
  ]);
  assert.deepEqual(await pageTexts(out), ['P3-TEXT', '', 'MERGED-2', 'P1-TEXT']);
  assert.equal(fileContains(out, 'P2-DELETE-ME'), false, 'deleted page still in file');
  assert.equal(fileContains(out, 'MERGED-1'), false, 'unused merge page copied');
  const re = await PDFDocument.load(out);
  assert.deepEqual(re.getPages().map((p) => p.getRotation().angle), [270, 0, 0, 180]);
  assert.deepEqual([re.getPage(1).getWidth(), re.getPage(1).getHeight()], [100, 150]);
  const fields = await listFormFields(out);
  assert.deepEqual(fields.map((f) => f.name), ['auf_p3'], 'field of deleted page must go, others stay');
  assert.equal(fields[0].pageIndex, 0);
  assert.equal(fields[0].defaultValue, 'bleibt');
}

/** "Export selection" (PagesPanel) builds the excerpt with organizePages
 *  on the chosen slots only: the form field on the exported page keeps
 *  working, the other pages' text is not in the file. */
export async function test_export_selection_keeps_form_and_drops_other_pages() {
  let base = await makePdf(['EXP-P1-SECRET', 'EXP-P2-KEEP', 'EXP-P3-SECRET']);
  base = await addFormField(base, { pageIndex: 1, xPct: 0.1, yPct: 0.1, wPct: 0.5, hPct: 0.1 },
    { kind: 'text', name: 'kunde', options: [], defaultValue: 'Müller' });
  base = await addFormField(base, { pageIndex: 0, xPct: 0.1, yPct: 0.1, wPct: 0.5, hPct: 0.1 },
    { kind: 'text', name: 'intern', options: [], defaultValue: 'geheim' });
  const out = await organizePages([base], [
    { kind: 'page', sourceIndex: 0, sourcePageIndex: 1, rotation: 0, width: 0, height: 0 },
  ]);
  assert.deepEqual(await pageTexts(out), ['EXP-P2-KEEP']);
  assert.equal(fileContains(out, 'EXP-P1-SECRET'), false, 'page 1 content leaked into the excerpt');
  assert.equal(fileContains(out, 'EXP-P3-SECRET'), false, 'page 3 content leaked into the excerpt');
  const fields = await listFormFields(out);
  assert.deepEqual(fields.map((f) => f.name), ['kunde']);
  assert.equal(fields[0].defaultValue, 'Müller');
}

// ------------------------------------------------------------ form fields

export async function test_form_fields_lifecycle() {
  const pdf = await makePdf(['formular']);
  assert.equal(await suggestFieldName(pdf, 'feld'), 'feld_1');
  const region = { pageIndex: 0, xPct: 0.1, yPct: 0.2, wPct: 0.6, hPct: 0.08 };
  let doc = await addFormField(pdf, region, { kind: 'text', name: 'feld_1', options: [], defaultValue: 'x' });
  doc = await addFormField(doc, { ...region, yPct: 0.35, hPct: 0.2 }, { kind: 'multiline', name: 'notiz', options: [], defaultValue: '' });
  doc = await addFormField(doc, { ...region, yPct: 0.6, wPct: 0.1 }, { kind: 'checkbox', name: 'ok', options: [], defaultValue: 'on' });
  doc = await addFormField(doc, { ...region, yPct: 0.75 }, {
    kind: 'dropdown',
    name: 'land',
    options: ['DE', 'AT', ' ', 'CH'],
    defaultValue: 'AT',
  });
  assert.equal(await suggestFieldName(doc, 'feld'), 'feld_2');
  await assert.rejects(
    () => addFormField(doc, region, { kind: 'text', name: 'ok', options: [], defaultValue: '' }),
    FieldNameTakenError
  );

  const list = await listFormFields(doc);
  const byName = Object.fromEntries(list.map((f) => [f.name, f]));
  assert.deepEqual(Object.keys(byName).sort(), ['feld_1', 'land', 'notiz', 'ok']);
  assert.equal(byName.feld_1.kind, 'text');
  assert.equal(byName.feld_1.defaultValue, 'x');
  assert.equal(byName.notiz.kind, 'multiline');
  assert.equal(byName.ok.kind, 'checkbox');
  assert.equal(byName.ok.defaultValue, 'on');
  assert.equal(byName.land.kind, 'dropdown');
  assert.deepEqual(byName.land.options, ['DE', 'AT', 'CH'], 'blank options are dropped');
  assert.equal(byName.land.defaultValue, 'AT');
  assert.ok(byName.notiz.region && Math.abs(byName.notiz.region.xPct - 0.1) < 0.01);

  // edit = rename + new kind at the same spot
  const edited = await updateFormField(doc, 'feld_1', byName.feld_1.region!, {
    kind: 'text',
    name: 'vorname',
    options: [],
    defaultValue: 'Ada',
  });
  const names = (await listFormFields(edited)).map((f) => f.name).sort();
  assert.deepEqual(names, ['land', 'notiz', 'ok', 'vorname']);

  const removed = await removeFormField(edited, 'land');
  assert.deepEqual((await listFormFields(removed)).map((f) => f.name).sort(), ['notiz', 'ok', 'vorname']);

  // pdf.js sees the fields as real AcroForm widgets
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({ data: removed.slice(), verbosity: 0 });
  const fobj = await (await task.promise).getFieldObjects();
  assert.deepEqual(Object.keys(fobj ?? {}).sort(), ['notiz', 'ok', 'vorname']);
  await task.destroy();
}

// --------------------------------------------------------------- signature

function makeP12(password: string, aes: boolean): Uint8Array {
  const keys = forge.pki.rsa.generateKeyPair({ bits: 2048, e: 0x10001 });
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date(Date.now() - 86400000);
  cert.validity.notAfter = new Date(Date.now() + 365 * 86400000);
  const attrs = [
    { shortName: 'CN', value: 'Erika Mustermann' },
    { shortName: 'O', value: 'Beispiel GmbH' },
  ];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  const asn1 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], password, {
    algorithm: aes ? 'aes256' : '3des',
  });
  const der = forge.asn1.toDer(asn1).getBytes();
  return Uint8Array.from(der, (c) => c.charCodeAt(0));
}

/** Independent check of an adbe.pkcs7.detached signature: ByteRange spans
 *  the whole file except /Contents, messageDigest matches, RSA verifies. */
function verifySignature(pdf: Uint8Array) {
  const s = Buffer.from(pdf).toString('latin1');
  const m = /\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/.exec(s);
  assert.ok(m, 'ByteRange missing');
  const [a, b, c, d] = m!.slice(1).map(Number);
  assert.equal(a, 0);
  assert.equal(c + d, pdf.length, 'ByteRange must reach the end of file');
  assert.equal(s[b], '<');
  assert.equal(s[c - 1], '>');
  const hex = s.slice(b + 1, c - 1).replace(/(00)+$/, '');
  const signed = Buffer.concat([Buffer.from(pdf.subarray(a, b)), Buffer.from(pdf.subarray(c, c + d))]);

  const p7 = forge.pkcs7.messageFromAsn1(
    forge.asn1.fromDer(forge.util.hexToBytes(hex.length % 2 ? hex + '0' : hex))
  ) as forge.pkcs7.PkcsSignedData & { rawCapture: Record<string, unknown> };
  const raw = p7.rawCapture as {
    authenticatedAttributes: forge.asn1.Asn1[];
    signature: string;
  };
  const md = forge.md.sha256.create();
  md.update(signed.toString('latin1'));
  const digest = md.digest().getBytes();
  const mdAttr = raw.authenticatedAttributes.find(
    (attr) => forge.asn1.derToOid((attr.value as forge.asn1.Asn1[])[0].value as string) === forge.pki.oids.messageDigest
  )!;
  const mdValue = ((mdAttr.value as forge.asn1.Asn1[])[1].value as forge.asn1.Asn1[])[0].value as string;
  assert.equal(forge.util.bytesToHex(mdValue), forge.util.bytesToHex(digest), 'messageDigest mismatch');

  const set = forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SET, true, raw.authenticatedAttributes);
  const attrMd = forge.md.sha256.create();
  attrMd.update(forge.asn1.toDer(set).getBytes());
  const cert = p7.certificates[0];
  assert.ok(
    (cert.publicKey as forge.pki.rsa.PublicKey).verify(attrMd.digest().getBytes(), raw.signature),
    'RSA signature does not verify'
  );
}

export async function test_sign_invisible_and_visible() {
  for (const aes of [false, true]) {
    const p12 = makeP12('pw', aes);
    const info = readP12(p12, 'pw');
    assert.equal(info.commonName, 'Erika Mustermann');
    assert.equal(info.organization, 'Beispiel GmbH');
    assert.ok(info.validTo instanceof Date);
    assert.throws(() => readP12(p12, 'falsch'), (e: unknown) => isWrongP12Password(e));

    const pdf = await makePdf(['Vertrag', 'Seite 2']);
    const invisible = await signPdf(pdf, { p12Bytes: p12, p12Password: 'pw', reason: 'Freigabe', region: null });
    verifySignature(invisible);
    assert.deepEqual(await pageTexts(invisible), ['Vertrag', 'Seite 2']);

    const visible = await signPdf(pdf, {
      p12Bytes: p12,
      p12Password: 'pw',
      reason: '',
      region: { pageIndex: 1, xPct: 0.1, yPct: 0.7, wPct: 0.5, hPct: 0.15 },
    });
    verifySignature(visible);
    const doc = await PDFDocument.load(visible);
    const annots = doc.getPage(1).node.lookup(PDFName.of('Annots'), PDFArray);
    assert.equal(annots.size(), 1);
    const widget = doc.context.lookup(annots.get(0), PDFDict);
    assert.ok(widget.get(PDFName.of('AP')), 'visible signature needs an appearance');
  }
}

export async function test_sign_document_with_existing_form() {
  const p12 = makeP12('pw', true);
  const pdf = await addFormField(
    await makePdf(['mit Formular']),
    { pageIndex: 0, xPct: 0.1, yPct: 0.1, wPct: 0.4, hPct: 0.05 },
    { kind: 'text', name: 'name', options: [], defaultValue: 'A' }
  );
  const signed = await signPdf(pdf, { p12Bytes: p12, p12Password: 'pw', reason: '', region: null });
  verifySignature(signed);
  const doc = await PDFDocument.load(signed);
  const names = doc.getForm().getFields().map((f) => f.getName());
  assert.equal(names.length, 2);
  assert.ok(names.includes('name'));
}

// ------------------------------------------------------- redaction scrub

export async function test_scrub_removes_original_content_from_file() {
  const doc0 = await PDFDocument.create();
  const font = await doc0.embedFont(StandardFonts.Helvetica);
  const p1 = doc0.addPage([300, 400]);
  p1.drawText('GEHEIM-4711', { x: 20, y: 300, font, size: 12 });
  const p2 = doc0.addPage([300, 400]);
  p2.drawText('OEFFENTLICH', { x: 20, y: 300, font, size: 12 });
  // tagged-PDF structure with an ActualText copy of the secret
  doc0.catalog.set(
    PDFName.of('StructTreeRoot'),
    doc0.context.register(
      doc0.context.obj({ Type: 'StructTreeRoot', K: doc0.context.obj({ S: 'P', ActualText: PDFString.of('GEHEIM-4711') }) })
    )
  );
  // page 2 links to page 1 (must stay valid: page object is kept)
  const link = doc0.context.register(
    doc0.context.obj({ Type: 'Annot', Subtype: 'Link', Rect: [0, 0, 50, 50], Dest: [p1.ref, 'Fit'] })
  );
  p2.node.set(PDFName.of('Annots'), doc0.context.obj([link]));
  // a stray orphan the input already carries
  doc0.context.register(doc0.context.obj({ Leak: PDFHexString.fromText('GEHEIM-4711') }));
  const src = await doc0.save();
  assert.ok(fileContains(src, 'GEHEIM-4711'));

  const doc = await PDFDocument.load(src);
  const pageRef = doc.getPage(0).ref;
  await replacePageWithImage(doc, 0, makePng(30, 40, [0, 0, 0, 255]), 300, 400);
  dropStructureTree(doc);
  const removed = await pruneUnreachable(doc);
  assert.ok(removed > 0);
  const out = await doc.save();

  assert.equal(fileContains(out, 'GEHEIM-4711'), false, 'redacted text still in file');
  assert.ok(fileContains(out, 'OEFFENTLICH'), 'other page lost its text');
  assert.deepEqual(await pageTexts(out), ['', 'OEFFENTLICH']);

  const re = await PDFDocument.load(out);
  assert.equal(re.getPageCount(), 2);
  assert.equal(re.getPage(0).ref.toString(), pageRef.toString(), 'page object identity kept');
  const linkDict = re.context.lookup(
    re.getPage(1).node.lookup(PDFName.of('Annots'), PDFArray).get(0),
    PDFDict
  );
  const dest = linkDict.lookup(PDFName.of('Dest'), PDFArray);
  assert.equal((dest.get(0) as PDFRef).toString(), pageRef.toString(), 'link to redacted page broken');
  assert.equal(re.getPage(0).getRotation().angle, 0);

  // the scrubbed page is still drawable afterwards (region edit draws text on it)
  const p = re.getPage(0);
  p.drawText('NEU', { x: 10, y: 10, size: 10, font: await re.embedFont(StandardFonts.Helvetica) });
  assert.deepEqual(await pageTexts(await re.save()), ['NEU', 'OEFFENTLICH']);
}

export async function test_scrub_handles_rotated_inherited_page() {
  const doc0 = await PDFDocument.create();
  const font = await doc0.embedFont(StandardFonts.Helvetica);
  const p = doc0.addPage([300, 400]);
  p.drawText('X-SECRET', { x: 20, y: 300, font, size: 12 });
  // rotation inherited from the page tree root
  doc0.catalog.lookup(PDFName.of('Pages'), PDFDict).set(PDFName.of('Rotate'), doc0.context.obj(90));
  const doc = await PDFDocument.load(await doc0.save());
  await replacePageWithImage(doc, 0, makePng(4, 3, [0, 0, 0, 255]), 400, 300);
  await pruneUnreachable(doc);
  const out = await PDFDocument.load(await doc.save());
  const pg = out.getPage(0);
  assert.equal(pg.getRotation().angle, 0, 'inherited rotation must not apply to the raster');
  assert.deepEqual([pg.getWidth(), pg.getHeight()], [400, 300]);
}

// ------------------------------------------------------------ text editing

export async function test_font_name_parsing_and_matching() {
  const d = parsePdfFontName('BAAAAA+TimesNewRomanPS-BoldItalicMT', 'serif');
  assert.equal(d.psName, 'TimesNewRomanPS-BoldItalicMT');
  assert.equal(d.family, 'Times New Roman');
  assert.ok(d.bold && d.italic && d.serif);

  const fonts = [
    { name: 'Arial', family: 'Arial', style: 'Regular', path: 'C:\\Windows\\Fonts\\arial.ttf' },
    { name: 'Arial Bold', family: 'Arial', style: 'Bold', path: 'C:\\Windows\\Fonts\\arialbd.ttf' },
  ];
  const exact = matchFont(parsePdfFontName('ABCDEF+Arial-BoldMT', 'sans-serif'), fonts);
  assert.equal(exact.quality, 'exact');
  assert.equal(exact.label, 'Arial Bold');

  const twin = matchFont(parsePdfFontName('Helvetica-Oblique', 'sans-serif'), []);
  assert.deepEqual(twin.choice, { kind: 'standard', font: 'helv-o' });
  const fallback = matchFont(parsePdfFontName('SomeUnknownSerif', 'serif'), []);
  assert.equal(fallback.quality, 'fallback');
  assert.deepEqual(fallback.choice, { kind: 'standard', font: 'times' });
  assert.equal(stdKeyFor('courier', true, true), 'courier-bo');
  assert.equal(stdKeyFor('times', false, true), 'times-i');
}

export async function test_run_edit_writes_real_text() {
  const pdf = await makePdf(['Rechnung 2025']);
  const edited = await applyRunEdit(pdf, {
    pageIndex: 0,
    x: 20,
    baseline: 200,
    width: 80,
    sizePt: 12,
    ascent: 0.72,
    descent: -0.21,
    newText: 'Rechnung 2026 — überarbeitet',
    color: [10, 20, 30],
    bg: [255, 255, 255],
    choice: { kind: 'standard', font: 'helv-b' },
    fontBytes: null,
  });
  const text = (await pageTexts(edited))[0];
  assert.ok(text.includes('Rechnung 2026'), text);
  assert.ok(text.includes('überarbeitet'), text);
}

// ------------------------------------------------------------------- bytes

export async function test_base64_large_buffer() {
  const big = new Uint8Array(3 * 1024 * 1024 + 7);
  for (let i = 0; i < big.length; i++) big[i] = (i * 31) & 0xff;
  const b64 = bytesToBase64(big);
  assert.equal(Buffer.from(big).toString('base64'), b64);
}

export async function test_owner_only_protection_opens_with_empty_password() {
  const enc = await encryptPdf(await makePdf(['OWNERONLY']), {
    userPassword: '',
    ownerPassword: 'owner-secret',
    permissions: { ...allPermissions, printing: false },
  });
  assert.equal(await isPasswordProtected(enc), true);
  // App.openBytes tries the empty open password first
  assert.deepEqual(await pageTexts(await decryptPdf(enc, '')), ['OWNERONLY']);
  const real = await encryptPdf(await makePdf(['X']), { userPassword: 'u', ownerPassword: 'o', permissions: allPermissions });
  await assert.rejects(() => decryptPdf(real, ''), (e: unknown) => isWrongPasswordError(e));
}

export async function test_organize_pages_deleted_page_gone_despite_bookmark_and_link() {
  // bookmarks, named destinations and links that point at a deleted page
  // keep the page object reachable — its content must still be gone
  const base = await makePdf(['KEEP-1', 'SECRET-PAGE-2']);
  const d = await PDFDocument.load(base);
  const ctx = d.context;
  const p1 = d.getPage(0);
  const p2 = d.getPage(1);
  const outlines = ctx.register(ctx.obj({ Type: 'Outlines', Count: 1 }));
  const item = ctx.register(
    ctx.obj({ Title: PDFString.of('Kapitel'), Parent: outlines, Dest: [p2.ref, PDFName.of('Fit')] })
  );
  const ol = ctx.lookup(outlines, PDFDict);
  ol.set(PDFName.of('First'), item);
  ol.set(PDFName.of('Last'), item);
  d.catalog.set(PDFName.of('Outlines'), outlines);
  const link = ctx.register(
    ctx.obj({ Type: 'Annot', Subtype: 'Link', Rect: [0, 0, 50, 50], Dest: [p2.ref, PDFName.of('Fit')] })
  );
  p1.node.set(PDFName.of('Annots'), ctx.obj([link]));
  const withRefs = await d.save();

  const out = await organizePages([withRefs], [
    { kind: 'page', sourceIndex: 0, sourcePageIndex: 0, rotation: 0, width: 0, height: 0 },
  ]);
  assert.deepEqual(await pageTexts(out), ['KEEP-1']);
  assert.equal(fileContains(out, 'SECRET-PAGE-2'), false, 'deleted page content still in file');
  // the bookmark itself survives (it just has no target page any more)
  const re = await PDFDocument.load(out);
  assert.ok(re.catalog.get(PDFName.of('Outlines')), 'bookmarks dropped');
  // pdf.js still reads the outline and the link (targets just don't resolve)
  const task = pdfjs.getDocument({ data: out.slice() });
  const pdf = await task.promise;
  const outline = await pdf.getOutline();
  assert.equal(outline?.[0]?.title, 'Kapitel');
  const annots = await (await pdf.getPage(1)).getAnnotations();
  assert.equal(annots.length, 1);
  await task.destroy();
}
