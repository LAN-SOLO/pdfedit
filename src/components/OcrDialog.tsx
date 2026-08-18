import { useState } from 'react';
import { t } from '../i18n';
import type { OcrLang, OcrProgress } from '../ocr';

export type OcrScope = 'current' | 'all';

interface Props {
  currentPage: number;
  totalPages: number;
  progress: OcrProgress | null;
  result: { pagesOcred: number; wordsFound: number } | null;
  onStart: (scope: OcrScope, langs: OcrLang[]) => void;
  onClose: () => void;
}

/** Controlled by the parent: this component only owns the pre-run input
 *  state (scope/language picks). Once started, `progress`/`result` come
 *  from PdfViewer's doOcr so the live per-page status (which needs to
 *  update mid-run, not just at the end) has somewhere to land. */
export default function OcrDialog({ currentPage, totalPages, progress, result, onStart, onClose }: Props) {
  const [scope, setScope] = useState<OcrScope>(totalPages > 1 ? 'all' : 'current');
  const [langs, setLangs] = useState<OcrLang[]>(['deu', 'eng']);
  const busy = !!progress;

  const toggleLang = (lang: OcrLang) => {
    setLangs((prev) => (prev.includes(lang) ? prev.filter((l) => l !== lang) : [...prev, lang]));
  };

  return (
    <div className="overlay" onClick={busy ? undefined : onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="mhead">
          <h3>{t.ocrTitle}</h3>
          <button className="ghost" onClick={onClose} disabled={busy}>
            ×
          </button>
        </div>
        <div className="mbody">
          {result ? (
            <p className="ok-text">{t.ocrResult(result.pagesOcred, result.wordsFound)}</p>
          ) : busy ? (
            <p className="faint">
              {progress!.status === 'rendering' ? t.ocrRendering : t.ocrRecognizing}{' '}
              {progress!.totalPages > 1 ? `(${progress!.pageDone + 1}/${progress!.totalPages})` : ''}
            </p>
          ) : (
            <>
              <p className="fieldlabel">{t.ocrScope}</p>
              <div className="choices">
                {totalPages > 1 && (
                  <button className={scope === 'all' ? 'primary' : ''} onClick={() => setScope('all')}>
                    {t.ocrScopeAll(totalPages)}
                  </button>
                )}
                <button className={scope === 'current' ? 'primary' : ''} onClick={() => setScope('current')}>
                  {t.ocrScopeCurrent(currentPage)}
                </button>
              </div>
              <p className="fieldlabel">{t.ocrLanguages}</p>
              <div className="choices">
                <button className={langs.includes('deu') ? 'primary' : ''} onClick={() => toggleLang('deu')}>
                  {t.ocrLangDe}
                </button>
                <button className={langs.includes('eng') ? 'primary' : ''} onClick={() => toggleLang('eng')}>
                  {t.ocrLangEn}
                </button>
              </div>
              <p className="faint">{t.ocrHint}</p>
            </>
          )}
        </div>
        <div className="mfoot">
          <button onClick={onClose} disabled={busy}>
            {t.close}
          </button>
          {!result && (
            <button className="primary" onClick={() => onStart(scope, langs)} disabled={busy || langs.length === 0}>
              {busy ? t.ocrRunning : t.ocrStart}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
