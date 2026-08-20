import { PDFDict, PDFDocument, PDFInvalidObject, PDFName } from 'pdf-lib';

/** Password protection applied to a document at save time. The in-memory
 *  working copy always stays unencrypted (every tool — pdf.js editing,
 *  pages, compress, redact, OCR, forms — operates on plain bytes); only the
 *  file written to disk gets encrypted. */
export interface Protection {
  userPassword: string;
  /** Falls back to the user password when left empty. */
  ownerPassword: string;
  permissions: ProtectPermissions;
}

export interface ProtectPermissions {
  printing: boolean;
  copying: boolean;
  modifying: boolean;
  annotating: boolean;
  fillingForms: boolean;
}

export const allPermissions: ProtectPermissions = {
  printing: true,
  copying: true,
  modifying: true,
  annotating: true,
  fillingForms: true,
};

/** Cheap pre-filter: encrypted PDFs must carry /Encrypt in a trailer. A hit
 *  only means "worth probing with a real parse" — the string can also appear
 *  in content. */
export function looksEncrypted(bytes: Uint8Array): boolean {
  const needle = [0x2f, 0x45, 0x6e, 0x63, 0x72, 0x79, 0x70, 0x74]; // "/Encrypt"
  outer: for (let i = bytes.length - needle.length; i >= 0; i--) {
    for (let j = 0; j < needle.length; j++) {
      if (bytes[i + j] !== needle[j]) continue outer;
    }
    return true;
  }
  return false;
}

/** True when the document cannot be parsed without a password. */
export async function isPasswordProtected(bytes: Uint8Array): Promise<boolean> {
  if (!looksEncrypted(bytes)) return false;
  try {
    await PDFDocument.load(bytes);
    return false;
  } catch (err) {
    return isEncryptionError(err);
  }
}

export function isEncryptionError(err: unknown): boolean {
  const msg = String((err as Error)?.message ?? err);
  return (err as Error)?.name === 'EncryptedPDFError' || /encrypted/i.test(msg);
}

export function isWrongPasswordError(err: unknown): boolean {
  return /password/i.test(String((err as Error)?.message ?? err));
}

/** Decrypts with the given password and returns a clean, unencrypted file.
 *  Throws the fork's "Password incorrect" error on a wrong password.
 *
 *  The @cantoo/pdf-lib password load re-parses every object through the
 *  cipher, but leaves three kinds of corpses enrolled in the context that
 *  would poison a resave (verified: the stale XRef stream still carries
 *  /Encrypt and gets merged back into the trailer on the next load): the
 *  old /Encrypt dict, old /ObjStm streams (already exploded into their
 *  member objects, but kept as raw ciphertext), and the old XRef stream
 *  (kept as PDFInvalidObject). Strip all three plus the trailer entry. */
export async function decryptPdf(bytes: Uint8Array, password: string): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes, { password });
  const ctx = doc.context;
  const encRef = ctx.trailerInfo.Encrypt;
  delete ctx.trailerInfo.Encrypt;
  const typeKey = PDFName.of('Type');
  const objStm = PDFName.of('ObjStm');
  const xref = PDFName.of('XRef');
  for (const [ref, obj] of ctx.enumerateIndirectObjects()) {
    const dict =
      obj instanceof PDFDict
        ? obj
        : (obj as { dict?: unknown }).dict instanceof PDFDict
          ? ((obj as { dict?: unknown }).dict as PDFDict)
          : null;
    const type = dict?.get(typeKey);
    if (obj instanceof PDFInvalidObject || ref === encRef || type === objStm || type === xref) {
      ctx.delete(ref);
    }
  }
  return doc.save();
}

/** Encrypts (AES-256) and returns the protected bytes. */
export async function encryptPdf(bytes: Uint8Array, protection: Protection): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes);
  const p = protection.permissions;
  doc.encrypt({
    userPassword: protection.userPassword,
    ownerPassword: protection.ownerPassword || protection.userPassword,
    algorithm: 'AES-256',
    permissions: {
      printing: p.printing ? 'highResolution' : false,
      copying: p.copying,
      contentAccessibility: p.copying,
      modifying: p.modifying,
      documentAssembly: p.modifying,
      annotating: p.annotating,
      fillingForms: p.fillingForms,
    },
  });
  return doc.save();
}
