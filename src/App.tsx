import { useCallback, useEffect, useRef, useState } from 'react';
import { getVersion } from '@tauri-apps/api/app';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { api, isTauri, UpdateInfo } from './api';
import { t } from './i18n';
import UpdateModal from './components/UpdateModal';
import PdfViewer from './components/PdfViewer';

interface OpenDoc {
  name: string;
  data: Uint8Array;
}

export default function App() {
  const [version, setVersion] = useState('');
  const [update, setUpdate] = useState<UpdateInfo | null | 'unchecked'>('unchecked');
  const [checking, setChecking] = useState(false);
  const [showUpdateModal, setShowUpdateModal] = useState(false);
  const [toastMsg, setToastMsg] = useState<{ msg: string; err: boolean } | null>(null);
  const [doc, setDoc] = useState<OpenDoc | null>(null);
  const toastTimer = useRef<number>(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const toast = useCallback((msg: string, isError = false) => {
    setToastMsg({ msg, err: isError });
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToastMsg(null), 4000);
  }, []);

  useEffect(() => {
    getVersion()
      .then(setVersion)
      .catch(() => {});
    // silent update check on app start; when an update exists the changelog
    // dialog opens first — installing always needs an explicit confirmation
    api
      .checkUpdate()
      .then((u) => {
        setUpdate(u);
        if (u) setShowUpdateModal(true);
      })
      .catch(() => {});
  }, []);

  const openPath = useCallback(
    async (path: string) => {
      try {
        const buf = await api.readPdf(path);
        const name = path.split('/').pop()?.split('\\').pop() ?? 'PDF';
        setDoc({ name, data: new Uint8Array(buf) });
      } catch (err) {
        toast(`${t.loadError}: ${String(err)}`, true);
      }
    },
    [toast]
  );

  // native drag & drop (Tauri delivers file paths, not File objects)
  useEffect(() => {
    if (!isTauri) return;
    const unlisten = getCurrentWebview().onDragDropEvent((event) => {
      if (event.payload.type === 'drop') {
        const pdf = event.payload.paths.find((p) => p.toLowerCase().endsWith('.pdf'));
        if (pdf) openPath(pdf);
      }
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [openPath]);

  const openPdf = useCallback(async () => {
    if (!isTauri) {
      fileInputRef.current?.click();
      return;
    }
    try {
      const path = await api.pickPdf();
      if (path) await openPath(path);
    } catch (err) {
      toast(String(err), true);
    }
  }, [openPath, toast]);

  // plain-browser dev fallback (vite dev without the Tauri shell)
  const onBrowserFile = useCallback(async (file: File | undefined) => {
    if (!file) return;
    setDoc({ name: file.name, data: new Uint8Array(await file.arrayBuffer()) });
  }, []);

  const doCheckUpdate = async () => {
    setChecking(true);
    try {
      const u = await api.checkUpdate();
      setUpdate(u);
      if (u) setShowUpdateModal(true);
    } catch (err) {
      toast(String(err), true);
    } finally {
      setChecking(false);
    }
  };

  return (
    <div
      className={doc ? 'shell wide' : 'shell'}
      onDragOver={isTauri ? undefined : (e) => e.preventDefault()}
      onDrop={
        isTauri
          ? undefined
          : (e) => {
              e.preventDefault();
              onBrowserFile(e.dataTransfer.files[0]);
            }
      }
    >
      {!doc && (
        <>
          <header>
            <h1>
              <span className="brand">pdfedit</span>
              <span className="dot">.</span>
            </h1>
            <div className="subtitle">{t.subtitle}</div>
            {version && <div className="version">v{version}</div>}
          </header>

          <div className="open-area">
            <button className="primary big" onClick={openPdf}>
              {t.openPdf}
            </button>
            <div className="faint drop-hint">{t.dropHint}</div>
          </div>

          <section className="card">
            <h2>{t.statusTitle}</h2>
            <p>{t.statusText}</p>
            <div className="updrow">
              {update !== 'unchecked' && update !== null ? (
                <button className="primary" onClick={() => setShowUpdateModal(true)}>
                  {t.updateAvailable(update.version)} — {t.updateNow}
                </button>
              ) : (
                <button onClick={doCheckUpdate} disabled={checking}>
                  {checking ? t.updateChecking : t.checkForUpdates}
                </button>
              )}
              {update === null && <span className="ok-text">{t.upToDate}</span>}
            </div>
            <div className="faint safenote">{t.updateSafeNote}</div>
          </section>
        </>
      )}

      {doc && <PdfViewer data={doc.data} name={doc.name} onClose={() => setDoc(null)} />}

      {!isTauri && (
        <input
          ref={fileInputRef}
          type="file"
          accept="application/pdf"
          style={{ display: 'none' }}
          onChange={(e) => onBrowserFile(e.target.files?.[0])}
        />
      )}

      {showUpdateModal && update !== 'unchecked' && update !== null && (
        <UpdateModal info={update} onToast={toast} onClose={() => setShowUpdateModal(false)} />
      )}

      {toastMsg && <div className={`toast${toastMsg.err ? ' error' : ''}`}>{toastMsg.msg}</div>}
    </div>
  );
}
