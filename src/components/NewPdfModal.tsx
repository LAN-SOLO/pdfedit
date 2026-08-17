import { useState } from 'react';
import { PDFDocument } from 'pdf-lib';
import { api, isTauri } from '../api';
import { t } from '../i18n';

/** Classic page formats in PDF points (1 pt = 1/72 inch), portrait. */
const FORMATS: Record<string, [number, number]> = {
  A3: [841.89, 1190.55],
  A4: [595.28, 841.89],
  A5: [419.53, 595.28],
  Letter: [612, 792],
  Legal: [612, 1008],
};

export interface CreatedPdf {
  name: string;
  data: Uint8Array;
  path: string | null;
}

interface Props {
  onCreated: (pdf: CreatedPdf) => void;
  onError: (msg: string) => void;
  onClose: () => void;
}

/** Create a fresh, empty PDF: format, orientation and page count — saved
 *  via the native dialog (Tauri) and opened in a new tab right away. */
export default function NewPdfModal({ onCreated, onError, onClose }: Props) {
  const [format, setFormat] = useState('A4');
  const [landscape, setLandscape] = useState(false);
  const [pages, setPages] = useState(1);
  const [busy, setBusy] = useState(false);

  const create = async () => {
    setBusy(true);
    try {
      const [w, h] = FORMATS[format];
      const size: [number, number] = landscape ? [h, w] : [w, h];
      const doc = await PDFDocument.create();
      for (let i = 0; i < Math.max(1, pages); i++) doc.addPage(size);

      let path: string | null = null;
      let name = t.untitled;
      if (isTauri) {
        path = await api.pickSavePdf(t.untitled);
        if (!path) {
          setBusy(false);
          return; // user cancelled the save dialog
        }
        await api.writePdf(path, await doc.saveAsBase64());
        name = path.split('/').pop()?.split('\\').pop() ?? t.untitled;
      }
      onCreated({ name, data: await doc.save(), path });
    } catch (err) {
      onError(`${t.createError}: ${String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="overlay" onClick={busy ? undefined : onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="mhead">
          <h3>{t.newPdfTitle}</h3>
          <button className="ghost" onClick={onClose} disabled={busy}>
            ×
          </button>
        </div>
        <div className="mbody">
          <div className="fieldlabel">{t.formatLabel}</div>
          <div className="choices">
            {Object.keys(FORMATS).map((f) => (
              <button
                key={f}
                className={f === format ? 'primary' : ''}
                onClick={() => setFormat(f)}
              >
                {f}
              </button>
            ))}
          </div>
          <div className="fieldlabel">{t.orientationLabel}</div>
          <div className="choices">
            <button className={landscape ? '' : 'primary'} onClick={() => setLandscape(false)}>
              {t.portrait}
            </button>
            <button className={landscape ? 'primary' : ''} onClick={() => setLandscape(true)}>
              {t.landscape}
            </button>
          </div>
          <div className="fieldlabel">{t.pagesLabel}</div>
          <input
            className="numinput"
            type="number"
            min={1}
            max={500}
            value={pages}
            onChange={(e) => setPages(Math.max(1, Math.min(500, Number(e.target.value) || 1)))}
          />
        </div>
        <div className="mfoot">
          <button onClick={onClose} disabled={busy}>
            {t.cancel}
          </button>
          <button className="primary" onClick={create} disabled={busy}>
            {busy ? '…' : t.create}
          </button>
        </div>
      </div>
    </div>
  );
}
