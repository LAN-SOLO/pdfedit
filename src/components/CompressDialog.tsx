import { useState } from 'react';
import { t } from '../i18n';
import type { CompressPreset } from '../compress';

interface Props {
  onCompress: (preset: CompressPreset) => Promise<{ before: number; after: number } | null>;
  onClose: () => void;
}

const PRESETS: CompressPreset[] = ['fast', 'balanced', 'small'];

const formatSize = (bytes: number) => `${(bytes / 1024).toFixed(0)} KB`;

/** Picks a preset, then shows the before/after result inline — same shape
 *  as StampDialog: a small focused dialog, the actual work happens in
 *  PdfViewer.doCompress via compress.ts. */
export default function CompressDialog({ onCompress, onClose }: Props) {
  const [busy, setBusy] = useState<CompressPreset | null>(null);
  const [result, setResult] = useState<{ before: number; after: number } | null>(null);
  const [none, setNone] = useState(false);

  const run = async (preset: CompressPreset) => {
    setBusy(preset);
    setNone(false);
    setResult(null);
    const r = await onCompress(preset);
    setBusy(null);
    if (r) setResult(r);
    else setNone(true);
  };

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="mhead">
          <h3>{t.compressTitle}</h3>
          <button className="ghost" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="mbody">
          {result ? (
            <p className="ok-text">
              {t.compressResult(formatSize(result.before), formatSize(result.after))}
            </p>
          ) : none ? (
            <p className="faint">{t.compressNone}</p>
          ) : (
            <div className="choices">
              {PRESETS.map((preset) => (
                <button key={preset} disabled={!!busy} onClick={() => run(preset)}>
                  {busy === preset ? t.compressing : t.compressPreset[preset]}
                </button>
              ))}
            </div>
          )}
          <p className="faint">{t.compressHint}</p>
        </div>
        <div className="mfoot">
          <button onClick={onClose}>{t.close}</button>
        </div>
      </div>
    </div>
  );
}
