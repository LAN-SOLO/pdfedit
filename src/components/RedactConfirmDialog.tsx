import { useState } from 'react';
import { t } from '../i18n';
import type { RedactStyle } from '../redact';

interface Props {
  markCount: number;
  onConfirm: (cleanMetadata: boolean, style: RedactStyle) => void;
  onCancel: () => void;
  busy: boolean;
}

export default function RedactConfirmDialog({ markCount, onConfirm, onCancel, busy }: Props) {
  const [cleanMetadata, setCleanMetadata] = useState(false);
  const [style, setStyle] = useState<RedactStyle>('black');

  return (
    <div className="overlay" onClick={busy ? undefined : onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="mhead">
          <h3>{t.redactConfirmTitle}</h3>
          <button className="ghost" onClick={onCancel} disabled={busy}>
            ×
          </button>
        </div>
        <div className="mbody">
          <p>{t.redactConfirmBody(markCount)}</p>
          <p className="faint">{t.redactConfirmHint}</p>
          <label className="fieldlabel">{t.redactStyleLabel}</label>
          <label className="checkrow">
            <input
              type="radio"
              name="redactstyle"
              checked={style === 'black'}
              onChange={() => setStyle('black')}
              disabled={busy}
            />
            {t.redactStyleBlack}
          </label>
          <label className="checkrow">
            <input
              type="radio"
              name="redactstyle"
              checked={style === 'pixelate'}
              onChange={() => setStyle('pixelate')}
              disabled={busy}
            />
            {t.redactStylePixelate}
          </label>
          {style === 'pixelate' && <p className="faint dialoghint">{t.redactStylePixelateHint}</p>}
          <label className="checkrow">
            <input
              type="checkbox"
              checked={cleanMetadata}
              onChange={(e) => setCleanMetadata(e.target.checked)}
              disabled={busy}
            />
            {t.redactCleanMetadata}
          </label>
        </div>
        <div className="mfoot">
          <button onClick={onCancel} disabled={busy}>
            {t.cancel}
          </button>
          <button className="danger" onClick={() => onConfirm(cleanMetadata, style)} disabled={busy}>
            {busy ? t.redacting : t.redactApply}
          </button>
        </div>
      </div>
    </div>
  );
}
