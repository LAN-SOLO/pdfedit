import { useCallback, useEffect, useRef, useState } from 'react';
import { getVersion } from '@tauri-apps/api/app';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { api, isTauri, UpdateInfo } from './api';
import { t } from './i18n';
import UpdateModal from './components/UpdateModal';
import NewPdfModal, { CreatedPdf } from './components/NewPdfModal';
import PdfViewer from './components/PdfViewer';

interface OpenDoc {
  id: number;
  name: string;
  data: Uint8Array;
}

export default function App() {
  const [version, setVersion] = useState('');
  const [update, setUpdate] = useState<UpdateInfo | null | 'unchecked'>('unchecked');
  const [checking, setChecking] = useState(false);
  const [showUpdateModal, setShowUpdateModal] = useState(false);
  const [showNewModal, setShowNewModal] = useState(false);
  const [toastMsg, setToastMsg] = useState<{ msg: string; err: boolean } | null>(null);
  const [docs, setDocs] = useState<OpenDoc[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const toastTimer = useRef<number>(0);
  const nextId = useRef(1);
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

  const addDoc = useCallback((name: string, data: Uint8Array) => {
    const id = nextId.current++;
    setDocs((d) => [...d, { id, name, data }]);
    setActiveId(id);
  }, []);

  const closeTab = useCallback(
    (id: number) => {
      setDocs((d) => {
        const idx = d.findIndex((doc) => doc.id === id);
        const rest = d.filter((doc) => doc.id !== id);
        setActiveId((cur) => {
          if (cur !== id) return cur;
          const neighbor = rest[Math.min(idx, rest.length - 1)];
          return neighbor ? neighbor.id : null;
        });
        return rest;
      });
    },
    []
  );

  const openPath = useCallback(
    async (path: string) => {
      try {
        const buf = await api.readPdf(path);
        const name = path.split('/').pop()?.split('\\').pop() ?? 'PDF';
        addDoc(name, new Uint8Array(buf));
      } catch (err) {
        toast(`${t.loadError}: ${String(err)}`, true);
      }
    },
    [addDoc, toast]
  );

  // native drag & drop (Tauri delivers file paths, not File objects)
  useEffect(() => {
    if (!isTauri) return;
    const unlisten = getCurrentWebview().onDragDropEvent((event) => {
      if (event.payload.type === 'drop') {
        for (const p of event.payload.paths) {
          if (p.toLowerCase().endsWith('.pdf')) openPath(p);
        }
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
  const onBrowserFile = useCallback(
    async (file: File | undefined) => {
      if (!file) return;
      addDoc(file.name, new Uint8Array(await file.arrayBuffer()));
    },
    [addDoc]
  );

  const onCreated = useCallback(
    (pdf: CreatedPdf) => {
      setShowNewModal(false);
      addDoc(pdf.name, pdf.data);
    },
    [addDoc]
  );

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

  const active = docs.find((d) => d.id === activeId) ?? null;

  return (
    <div
      className={active ? 'shell wide' : 'shell'}
      onDragOver={isTauri ? undefined : (e) => e.preventDefault()}
      onDrop={
        isTauri
          ? undefined
          : (e) => {
              e.preventDefault();
              for (const f of Array.from(e.dataTransfer.files)) onBrowserFile(f);
            }
      }
    >
      {docs.length > 0 && (
        <div className="tabbar">
          <div className="tabs">
            {docs.map((d) => (
              <div
                key={d.id}
                className={d.id === activeId ? 'tab active' : 'tab'}
                onClick={() => setActiveId(d.id)}
                title={d.name}
              >
                <span className="tabname">{d.name}</span>
                <button
                  className="ghost tabclose"
                  aria-label={t.closeTab}
                  onClick={(e) => {
                    e.stopPropagation();
                    closeTab(d.id);
                  }}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
          <button className="tabaction" onClick={openPdf}>
            {t.openPdf}
          </button>
          <button className="tabaction" onClick={() => setShowNewModal(true)}>
            {t.newPdf}
          </button>
        </div>
      )}

      {!active && (
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
            <div className="choices center">
              <button className="primary big" onClick={openPdf}>
                {t.openPdf}
              </button>
              <button className="big" onClick={() => setShowNewModal(true)}>
                {t.newPdf}
              </button>
            </div>
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

      {active && <PdfViewer key={active.id} data={active.data} name={active.name} />}

      {!isTauri && (
        <input
          ref={fileInputRef}
          type="file"
          accept="application/pdf"
          style={{ display: 'none' }}
          onChange={(e) => {
            onBrowserFile(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
      )}

      {showNewModal && (
        <NewPdfModal
          onCreated={onCreated}
          onError={(msg) => toast(msg, true)}
          onClose={() => setShowNewModal(false)}
        />
      )}

      {showUpdateModal && update !== 'unchecked' && update !== null && (
        <UpdateModal info={update} onToast={toast} onClose={() => setShowUpdateModal(false)} />
      )}

      {toastMsg && <div className={`toast${toastMsg.err ? ' error' : ''}`}>{toastMsg.msg}</div>}
    </div>
  );
}
