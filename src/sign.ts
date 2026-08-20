import forge from 'node-forge';
import {
  PDFArray,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFString,
  StandardFonts,
} from 'pdf-lib';

/** Cryptographic digital signature (CMS/PKCS#7, /SubFilter adbe.pkcs7.detached,
 *  SHA-256 with signed attributes) from a PKCS#12 certificate file — the
 *  classic Acrobat "certificate signature". Validated end-to-end in Node
 *  before shipping: messageDigest attribute matches the ByteRange digest and
 *  the RSA signature over the signed attributes verifies against the signer
 *  certificate, for both legacy-3DES and modern AES/PBES2 .p12 files. */

/** Hex chars reserved for the CMS container — fits typical cert chains. */
const CONTENTS_HEX_LEN = 16384;

export interface SignRegion {
  pageIndex: number;
  xPct: number;
  yPct: number;
  wPct: number;
  hPct: number;
}

export interface CertInfo {
  commonName: string;
  organization: string | null;
  issuerCommonName: string | null;
  validTo: Date | null;
}

interface ParsedP12 {
  key: forge.pki.rsa.PrivateKey;
  certs: forge.pki.Certificate[];
  signerCert: forge.pki.Certificate;
}

const bytesToLatin1 = (bytes: Uint8Array): string => {
  let out = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    out += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return out;
};

function parseP12(p12Bytes: Uint8Array, password: string): ParsedP12 {
  const asn1 = forge.asn1.fromDer(forge.util.createBuffer(bytesToLatin1(p12Bytes)));
  const p12 = forge.pkcs12.pkcs12FromAsn1(asn1, password);
  let key: forge.pki.rsa.PrivateKey | null = null;
  for (const bagType of [forge.pki.oids.pkcs8ShroudedKeyBag, forge.pki.oids.keyBag]) {
    const bags = p12.getBags({ bagType })[bagType];
    const bagKey = bags?.find((b) => b.key)?.key;
    if (bagKey) {
      key = bagKey as forge.pki.rsa.PrivateKey;
      break;
    }
  }
  const certBags = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] ?? [];
  const certs = certBags.map((b) => b.cert).filter((c): c is forge.pki.Certificate => !!c);
  if (!key || certs.length === 0) throw new Error('no key or certificate in PKCS#12 file');
  // the signer certificate is the one matching the private key's modulus
  let signerCert = certs[0];
  for (const c of certs) {
    const pub = c.publicKey as forge.pki.rsa.PublicKey;
    if (pub?.n && key.n && pub.n.compareTo(key.n) === 0) {
      signerCert = c;
      break;
    }
  }
  return { key, certs, signerCert };
}

const certAttr = (cert: forge.pki.Certificate, shortName: string): string | null => {
  const attr = cert.subject.attributes.find((a) => a.shortName === shortName);
  return typeof attr?.value === 'string' ? attr.value : null;
};

/** Parses the certificate for a pre-sign preview (name, issuer, validity). */
export function readP12(p12Bytes: Uint8Array, password: string): CertInfo {
  const { signerCert } = parseP12(p12Bytes, password);
  const issuerCn = signerCert.issuer.attributes.find((a) => a.shortName === 'CN');
  return {
    commonName: certAttr(signerCert, 'CN') ?? certAttr(signerCert, 'E') ?? 'Unbekannt',
    organization: certAttr(signerCert, 'O'),
    issuerCommonName: typeof issuerCn?.value === 'string' ? issuerCn.value : null,
    validTo: signerCert.validity?.notAfter ?? null,
  };
}

export function isWrongP12Password(err: unknown): boolean {
  return /invalid password|mac could not be verified/i.test(String((err as Error)?.message ?? err));
}

/** Latin-1-safe PDF string escaping for the appearance stream. */
const apEscape = (s: string): string =>
  s
    .split('')
    .map((ch) => {
      const code = ch.charCodeAt(0);
      if (ch === '(' || ch === ')' || ch === '\\') return `\\${ch}`;
      return code > 255 ? '?' : ch;
    })
    .join('');

async function addPlaceholder(
  bytes: Uint8Array,
  signerName: string,
  reason: string,
  region: SignRegion | null
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes);
  const ctx = doc.context;
  const pages = doc.getPages();
  const page = pages[Math.min(region?.pageIndex ?? 0, pages.length - 1)];

  const sigDict = ctx.obj({
    Type: 'Sig',
    Filter: 'Adobe.PPKLite',
    SubFilter: 'adbe.pkcs7.detached',
    ByteRange: ctx.obj([
      PDFNumber.of(0),
      PDFNumber.of(999999999999),
      PDFNumber.of(999999999999),
      PDFNumber.of(999999999999),
    ]),
    Contents: PDFHexString.of('0'.repeat(CONTENTS_HEX_LEN)),
    M: PDFString.fromDate(new Date()),
    Name: PDFString.of(signerName),
    ...(reason ? { Reason: PDFString.of(reason) } : {}),
  });
  const sigRef = ctx.register(sigDict);

  // page-space rect (viewer percentages are top-left based, PDF is bottom-left)
  const { width: pw, height: ph } = page.getSize();
  const rect = region
    ? {
        x: region.xPct * pw,
        y: ph - (region.yPct + region.hPct) * ph,
        width: region.wPct * pw,
        height: region.hPct * ph,
      }
    : null;
  const visible = !!rect && rect.width > 4 && rect.height > 4;

  let apRef = null;
  if (visible && rect) {
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const fontSize = Math.max(6, Math.min(11, rect.height / 4.2));
    const lines = [signerName, 'Digital signiert', new Date().toISOString().slice(0, 10)];
    const ops = [
      `q 0.92 0.95 1 rg 0 0 ${rect.width.toFixed(2)} ${rect.height.toFixed(2)} re f Q`,
      `q 0.23 0.51 0.96 RG 0.75 w 0.4 0.4 ${(rect.width - 0.8).toFixed(2)} ${(rect.height - 0.8).toFixed(2)} re S Q`,
      `BT /Hf ${fontSize.toFixed(2)} Tf 0.06 0.09 0.16 rg`,
      ...lines.map(
        (ln, i) =>
          `1 0 0 1 4 ${(rect.height - (i + 1) * (fontSize + 2)).toFixed(2)} Tm (${apEscape(ln)}) Tj`
      ),
      'ET',
    ].join('\n');
    const ap = ctx.stream(ops, {
      Type: 'XObject',
      Subtype: 'Form',
      BBox: ctx.obj([
        PDFNumber.of(0),
        PDFNumber.of(0),
        PDFNumber.of(rect.width),
        PDFNumber.of(rect.height),
      ]),
      Resources: ctx.obj({ Font: ctx.obj({ Hf: font.ref }) }),
    });
    apRef = ctx.register(ap);
  }

  const widget = ctx.obj({
    Type: 'Annot',
    Subtype: 'Widget',
    FT: 'Sig',
    T: PDFString.of(`pdfedit-Signatur-${Date.now()}`),
    V: sigRef,
    F: 132, // Print | Locked
    P: page.ref,
    Rect:
      visible && rect
        ? ctx.obj([
            PDFNumber.of(rect.x),
            PDFNumber.of(rect.y),
            PDFNumber.of(rect.x + rect.width),
            PDFNumber.of(rect.y + rect.height),
          ])
        : ctx.obj([PDFNumber.of(0), PDFNumber.of(0), PDFNumber.of(0), PDFNumber.of(0)]),
    ...(apRef ? { AP: ctx.obj({ N: apRef }) } : {}),
  });
  const widgetRef = ctx.register(widget);

  const annots = page.node.lookup(PDFName.of('Annots'), PDFArray) ?? null;
  if (annots) annots.push(widgetRef);
  else page.node.set(PDFName.of('Annots'), ctx.obj([widgetRef]));

  const acro = doc.catalog.lookup(PDFName.of('AcroForm'));
  if (!acro) {
    doc.catalog.set(
      PDFName.of('AcroForm'),
      ctx.register(ctx.obj({ Fields: ctx.obj([widgetRef]), SigFlags: 3 }))
    );
  } else {
    const acroDict = doc.catalog.lookup(PDFName.of('AcroForm')) as import('pdf-lib').PDFDict;
    const fields = acroDict.lookup(PDFName.of('Fields'), PDFArray);
    fields.push(widgetRef);
    acroDict.set(PDFName.of('SigFlags'), PDFNumber.of(3));
  }

  // classic xref keeps byte offsets literal — required for ByteRange fixing
  return doc.save({ useObjectStreams: false });
}

export interface SignOptions {
  p12Bytes: Uint8Array;
  p12Password: string;
  reason: string;
  /** null = invisible signature */
  region: SignRegion | null;
}

export async function signPdf(bytes: Uint8Array, opts: SignOptions): Promise<Uint8Array> {
  const { key, certs, signerCert } = parseP12(opts.p12Bytes, opts.p12Password);
  const signerName = certAttr(signerCert, 'CN') ?? certAttr(signerCert, 'E') ?? 'Unbekannt';

  const prepared = await addPlaceholder(bytes, signerName, opts.reason, opts.region);
  const s = bytesToLatin1(prepared);

  const placeholder = '<' + '0'.repeat(CONTENTS_HEX_LEN) + '>';
  const contentsStart = s.indexOf(placeholder);
  if (contentsStart < 0) throw new Error('signature placeholder not found');
  const contentsEnd = contentsStart + placeholder.length;

  const brStart = s.lastIndexOf('/ByteRange', contentsStart);
  const brOpen = s.indexOf('[', brStart);
  const brClose = s.indexOf(']', brOpen);
  if (brStart < 0 || brOpen < 0 || brClose < 0) throw new Error('ByteRange not found');
  const byteRange = [0, contentsStart, contentsEnd, prepared.length - contentsEnd];
  let brText = `[ ${byteRange.join(' ')} ]`;
  const room = brClose + 1 - brOpen;
  if (brText.length > room) throw new Error('ByteRange placeholder too small');
  brText += ' '.repeat(room - brText.length);
  for (let i = 0; i < brText.length; i++) prepared[brOpen + i] = brText.charCodeAt(i);

  // digest input: everything outside the /Contents hex string
  const dataLatin1 =
    bytesToLatin1(prepared.subarray(0, contentsStart)) +
    bytesToLatin1(prepared.subarray(contentsEnd));

  const p7 = forge.pkcs7.createSignedData();
  p7.content = forge.util.createBuffer(dataLatin1);
  for (const c of certs) p7.addCertificate(c);
  p7.addSigner({
    key,
    certificate: signerCert,
    digestAlgorithm: forge.pki.oids.sha256,
    authenticatedAttributes: [
      { type: forge.pki.oids.contentType, value: forge.pki.oids.data },
      { type: forge.pki.oids.messageDigest },
      { type: forge.pki.oids.signingTime, value: new Date() as unknown as string },
    ],
  });
  p7.sign({ detached: true });
  const der = forge.asn1.toDer(p7.toAsn1()).getBytes();

  let hex = '';
  for (let i = 0; i < der.length; i++) hex += der.charCodeAt(i).toString(16).padStart(2, '0');
  if (hex.length > CONTENTS_HEX_LEN) throw new Error(`signature too large (${hex.length} hex chars)`);
  hex += '0'.repeat(CONTENTS_HEX_LEN - hex.length);
  for (let i = 0; i < hex.length; i++) prepared[contentsStart + 1 + i] = hex.charCodeAt(i);

  return prepared;
}
