import { useRef, useState } from 'react';
import { t } from '../i18n';
import type { EditContent } from '../regionEdit';

type Mode = 'text' | 'image';

interface Props {
  busy: boolean;
  onApply: (content: EditContent) => void;
  onCancel: () => void;
}

export default function EditRegionDialog({ busy, onApply, onCancel }: Props) {
  const [mode, setMode] = useState<Mode>('text');
  const [text, setText] = useState('');
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const onImageChosen = (file: File | undefined) => {
    if (!file) return;
    setImageFile(file);
    setImagePreview(URL.createObjectURL(file));
  };

  const canApply = mode === 'text' ? text.trim().length > 0 : !!imageFile;
  const apply = () => {
    if (mode === 'text') onApply({ kind: 'text', text: text.trim() });
    else if (imageFile) onApply({ kind: 'image', file: imageFile });
  };

  return (
    <div className="overlay" onClick={busy ? undefined : onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="mhead">
          <h3>{t.editRegionTitle}</h3>
          <button className="ghost" onClick={onCancel} disabled={busy}>
            ×
          </button>
        </div>
        <div className="mbody">
          <p className="faint">{t.editRegionHint}</p>
          <div className="choices">
            <button className={mode === 'text' ? 'primary' : ''} onClick={() => setMode('text')} disabled={busy}>
              {t.editRegionText}
            </button>
            <button className={mode === 'image' ? 'primary' : ''} onClick={() => setMode('image')} disabled={busy}>
              {t.editRegionImage}
            </button>
          </div>

          {mode === 'text' && (
            <input
              className="findinput"
              style={{ width: '100%' }}
              placeholder={t.editRegionTextPlaceholder}
              value={text}
              onChange={(e) => setText(e.target.value)}
              disabled={busy}
              autoFocus
            />
          )}

          {mode === 'image' && (
            <>
              <button onClick={() => fileInputRef.current?.click()} disabled={busy}>
                {t.stampPickImage}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                style={{ display: 'none' }}
                onChange={(e) => onImageChosen(e.target.files?.[0])}
              />
              {imagePreview && (
                <div className="signaturepreview">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={imagePreview} alt="" style={{ maxWidth: '100%', maxHeight: 160 }} />
                </div>
              )}
            </>
          )}
        </div>
        <div className="mfoot">
          <button onClick={onCancel} disabled={busy}>
            {t.cancel}
          </button>
          <button className="primary" onClick={apply} disabled={busy || !canApply}>
            {busy ? t.editRegionApplying : t.editRegionApply}
          </button>
        </div>
      </div>
    </div>
  );
}
