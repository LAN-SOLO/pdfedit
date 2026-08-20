import { useRef, useState } from 'react';
import { t } from '../i18n';
import type { WatermarkReport } from '../watermark';

interface Props {
  currentPage: number;
  totalPages: number;
  busy: boolean;
  /** Pre-computed report for the open document (null while loading). */
  report: WatermarkReport | null;
  onApply: (pngBytes: Uint8Array, scope: 'all' | 'current') => void;
  onVerifyPng: (pngBytes: Uint8Array) => Promise<{ pageIndex: number; matches: boolean }[]>;
  onClose: () => void;
}

/** Invisible watermark: embed an uploaded PNG (transparency preserved) on
 *  all or the current page, and read the marks back to spot swapped or
 *  reordered pages. */
export default function WatermarkDialog({
  currentPage,
  totalPages,
  busy,
  report,
  onApply,
  onVerifyPng,
  onClose,
}: Props) {
  const [tab, setTab] = useState<'embed' | 'verify'>('embed');
  const [png, setPng] = useState<Uint8Array | null>(null);
  const [pngName, setPngName] = useState('');
  const [scope, setScope] = useState<'all' | 'current'>('all');
  const [pngCheck, setPngCheck] = useState<{ pageIndex: number; matches: boolean }[] | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const verifyInputRef = useRef<HTMLInputElement>(null);

  const marked = report?.pages.filter((p) => p.present) ?? [];
  const unmarked = report?.pages.filter((p) => !p.present) ?? [];
  const moved = marked.filter((p) => !p.indexMatches);
  const mixedHashes = (report?.hashes.length ?? 0) > 1;

  return (
    <div className="overlay" onClick={busy ? undefined : onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="mhead">
          <h3>{t.wmTitle}</h3>
          <button className="ghost" onClick={onClose} disabled={busy}>
            ×
          </button>
        </div>
        <div className="mbody">
          <div className="choices">
            <button className={tab === 'embed' ? 'primary' : ''} onClick={() => setTab('embed')}>
              {t.wmEmbedTab}
            </button>
            <button className={tab === 'verify' ? 'primary' : ''} onClick={() => setTab('verify')}>
              {t.wmVerifyTab}
            </button>
          </div>

          {tab === 'embed' && (
            <>
              <p className="faint dialoghint">{t.wmIntro}</p>
              <button onClick={() => fileInputRef.current?.click()}>{pngName || t.wmPickPng}</button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png"
                style={{ display: 'none' }}
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  e.target.value = '';
                  if (!f) return;
                  setPng(new Uint8Array(await f.arrayBuffer()));
                  setPngName(f.name);
                }}
              />
              <label className="fieldlabel">{t.wmScope}</label>
              <label className="checkrow">
                <input type="radio" name="wmscope" checked={scope === 'all'} onChange={() => setScope('all')} />
                {t.ocrScopeAll(totalPages)}
              </label>
              <label className="checkrow">
                <input
                  type="radio"
                  name="wmscope"
                  checked={scope === 'current'}
                  onChange={() => setScope('current')}
                />
                {t.ocrScopeCurrent(currentPage)}
              </label>
              <p className="faint dialoghint">{t.wmHonestNote}</p>
            </>
          )}

          {tab === 'verify' && (
            <>
              {!report && <p className="faint">{t.loading}</p>}
              {report && (
                <>
                  <p>
                    {t.wmReportSummary(marked.length, report.pageCount)}
                  </p>
                  {marked.length > 0 && unmarked.length > 0 && (
                    <p className="err-text">
                      {t.wmReportUnmarked(unmarked.map((p) => p.pageIndex + 1).join(', '))}
                    </p>
                  )}
                  {moved.length > 0 && (
                    <p className="err-text">
                      {t.wmReportMoved(
                        moved
                          .map((p) => t.wmMovedEntry(p.pageIndex + 1, (p.recordedIndex ?? 0) + 1))
                          .join(', ')
                      )}
                    </p>
                  )}
                  {mixedHashes && <p className="err-text">{t.wmReportMixed}</p>}
                  {marked.length > 0 && unmarked.length === 0 && moved.length === 0 && !mixedHashes && (
                    <p className="ok-text">{t.wmReportAllGood}</p>
                  )}
                  {marked.length > 0 && (
                    <>
                      <label className="fieldlabel">{t.wmVerifyPngTitle}</label>
                      <button onClick={() => verifyInputRef.current?.click()}>{t.wmPickPng}</button>
                      <input
                        ref={verifyInputRef}
                        type="file"
                        accept="image/png"
                        style={{ display: 'none' }}
                        onChange={async (e) => {
                          const f = e.target.files?.[0];
                          e.target.value = '';
                          if (!f) return;
                          setPngCheck(await onVerifyPng(new Uint8Array(await f.arrayBuffer())));
                        }}
                      />
                      {pngCheck && (
                        <p className={pngCheck.every((c) => c.matches) ? 'ok-text' : 'err-text'}>
                          {pngCheck.every((c) => c.matches)
                            ? t.wmPngMatches
                            : t.wmPngMismatch(
                                pngCheck
                                  .filter((c) => !c.matches)
                                  .map((c) => c.pageIndex + 1)
                                  .join(', ')
                              )}
                        </p>
                      )}
                    </>
                  )}
                </>
              )}
            </>
          )}
        </div>
        <div className="mfoot">
          <button onClick={onClose} disabled={busy}>
            {tab === 'embed' ? t.cancel : t.close}
          </button>
          {tab === 'embed' && (
            <button className="primary" disabled={!png || busy} onClick={() => png && onApply(png, scope)}>
              {busy ? t.wmApplying : t.wmApply}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
