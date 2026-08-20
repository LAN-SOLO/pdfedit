import { useCallback, useEffect, useRef, useState } from 'react';
import { getVersion } from '@tauri-apps/api/app';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { api, isTauri, UpdateInfo } from './api';
import { bytesToBase64, downloadBytes } from './bytes';
import { t } from './i18n';
import UpdateModal from './components/UpdateModal';
import Help from './components/Help';
import NewPdfModal, { CreatedPdf } from './components/NewPdfModal';
import PasswordPrompt from './components/PasswordPrompt';
import PdfViewer, { PdfViewerHandle } from './components/PdfViewer';
import {
  allPermissions,
  decryptPdf,
  encryptPdf,
  isPasswordProtected,
  isWrongPasswordError,
  type Protection,
} from './protect';

interface OpenDoc {
  id: number;
  name: string;
  data: Uint8Array;
  path: string | null;
  dirty: boolean;
  /** Applied at save time; the in-memory `data` always stays unencrypted. */
  protection: Protection | null;
  /** Protection taken over from opening an encrypted file. */
  protectionInherited: boolean;
}

/** A just-opened, still-locked PDF waiting for its password. */
interface PendingProtected {
  name: string;
  data: Uint8Array;
  path: string | null;
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
  const docsRef = useRef<OpenDoc[]>([]);
  docsRef.current = docs;
  // Only ONE PdfViewer is ever mounted at a time (see PdfViewer.tsx docstring
  // for why) — this ref always points at whichever one that currently is.
  const viewerRef = useRef<PdfViewerHandle>(null);

  const toast = useCallback((msg: string, isError = false) => {
    setToastMsg({ msg, err: isError });
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToastMsg(null), 4000);
  }, []);

  useEffect(() => {
    getVersion()
      .then(setVersion)
      .catch(() => {});
    api
      .checkUpdate()
      .then((u) => {
        setUpdate(u);
        if (u) setShowUpdateModal(true);
      })
      .catch(() => {});
  }, []);

  // guard against quitting with unsaved edits anywhere
  useEffect(() => {
    if (!isTauri) return;
    let unlisten: (() => void) | undefined;
    getCurrentWindow()
      .onCloseRequested(async (event) => {
        if (docsRef.current.some((d) => d.dirty)) {
          if (!window.confirm(t.unsavedQuitConfirm)) event.preventDefault();
        }
      })
      .then((fn) => {
        unlisten = fn;
      });
    return () => unlisten?.();
  }, []);

  // Switching away from the active tab unmounts its PdfViewer — checkpoint
  // its edits into memory first so they aren't lost (this does NOT write to
  // disk and does NOT clear the dirty flag; only an explicit Save does
  // that). EVERY path that can change `activeId` while a doc is open must
  // go through this first — that includes opening/creating a new PDF, not
  // just clicking another tab.
  const checkpointActive = useCallback(async () => {
    if (activeId === null) return;
    const bytes = await viewerRef.current?.checkpoint();
    if (bytes) {
      const outgoingId = activeId;
      setDocs((d) => d.map((x) => (x.id === outgoingId ? { ...x, data: bytes } : x)));
    }
  }, [activeId]);

  const addDoc = useCallback(
    async (
      name: string,
      data: Uint8Array,
      path: string | null,
      protection: Protection | null = null,
      protectionInherited = false
    ) => {
      await checkpointActive();
      const id = nextId.current++;
      setDocs((d) => [...d, { id, name, data, path, dirty: false, protection, protectionInherited }]);
      setActiveId(id);
    },
    [checkpointActive]
  );

  const [pendingProtected, setPendingProtected] = useState<PendingProtected | null>(null);
  const [pwFailed, setPwFailed] = useState(false);

  // Every open path funnels through here: password-protected files stop at
  // the prompt; everything else opens directly.
  const openBytes = useCallback(
    async (name: string, data: Uint8Array, path: string | null) => {
      if (await isPasswordProtected(data)) {
        setPwFailed(false);
        setPendingProtected({ name, data, path });
        return;
      }
      await addDoc(name, data, path);
    },
    [addDoc]
  );

  // The working copy is decrypted in memory so every tool just works;
  // saving re-encrypts with the same password (kept as inherited
  // protection) until the user changes or removes it in the Protect dialog.
  const onPasswordSubmit = useCallback(
    async (password: string) => {
      if (!pendingProtected) return;
      try {
        const decrypted = await decryptPdf(pendingProtected.data, password);
        const protection: Protection = {
          userPassword: password,
          ownerPassword: password,
          permissions: allPermissions,
        };
        setPendingProtected(null);
        await addDoc(pendingProtected.name, decrypted, pendingProtected.path, protection, true);
      } catch (err) {
        if (isWrongPasswordError(err)) {
          setPwFailed(true);
        } else {
          setPendingProtected(null);
          toast(`${t.loadError}: ${String(err)}`, true);
        }
      }
    },
    [pendingProtected, addDoc, toast]
  );

  const setDirty = useCallback((id: number, dirty: boolean) => {
    setDocs((d) => d.map((doc) => (doc.id === id ? { ...doc, dirty } : doc)));
  }, []);

  const switchTab = useCallback(
    async (id: number) => {
      if (id === activeId) return;
      await checkpointActive();
      setActiveId(id);
    },
    [activeId, checkpointActive]
  );

  const closeTab = useCallback(
    (id: number) => {
      const doc = docsRef.current.find((d) => d.id === id);
      if (doc?.dirty && !window.confirm(t.unsavedCloseConfirm)) return;
      setDocs((d) => {
        const idx = d.findIndex((x) => x.id === id);
        const rest = d.filter((x) => x.id !== id);
        if (id === activeId) {
          const neighbor = rest[Math.min(idx, rest.length - 1)];
          setActiveId(neighbor ? neighbor.id : null);
        }
        return rest;
      });
    },
    [activeId]
  );

  const openPath = useCallback(
    async (path: string) => {
      try {
        const buf = await api.readPdf(path);
        const name = path.split('/').pop()?.split('\\').pop() ?? 'PDF';
        await openBytes(name, new Uint8Array(buf), path);
      } catch (err) {
        toast(`${t.loadError}: ${String(err)}`, true);
      }
    },
    [openBytes, toast]
  );

  // native drag & drop (Tauri delivers file paths, not File objects)
  useEffect(() => {
    if (!isTauri) return;
    const unlisten = getCurrentWebview().onDragDropEvent(async (event) => {
      if (event.payload.type === 'drop') {
        for (const p of event.payload.paths) {
          if (p.toLowerCase().endsWith('.pdf')) await openPath(p);
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
      await openBytes(file.name, new Uint8Array(await file.arrayBuffer()), null);
    },
    [openBytes]
  );

  const onCreated = useCallback(
    async (pdf: CreatedPdf) => {
      setShowNewModal(false);
      await addDoc(pdf.name, pdf.data, pdf.path);
    },
    [addDoc]
  );

  const saveDoc = useCallback(
    async (id: number, bytes: Uint8Array, protectionOverride?: Protection | null) => {
      const doc = docsRef.current.find((d) => d.id === id);
      if (!doc) return;
      try {
        const protection = protectionOverride !== undefined ? protectionOverride : doc.protection;
        // encrypt only what goes to disk — the working copy stays plain
        const fileBytes = protection ? await encryptPdf(bytes, protection) : bytes;
        if (isTauri && doc.path) {
          await api.writePdf(doc.path, bytesToBase64(fileBytes));
        } else {
          downloadBytes(doc.name, fileBytes);
        }
        setDocs((d) => d.map((x) => (x.id === id ? { ...x, data: bytes, dirty: false } : x)));
        toast(t.saved);
      } catch (err) {
        toast(`${t.saveError}: ${String(err)}`, true);
      }
    },
    [toast]
  );

  const setProtection = useCallback((id: number, protection: Protection | null) => {
    setDocs((d) =>
      d.map((x) => (x.id === id ? { ...x, protection, protectionInherited: false } : x))
    );
  }, []);

  // In-memory replace (page reorder/rotate/delete/merge) — unlike saveDoc
  // this never touches disk; it only updates the working bytes so the
  // viewer reloads with them. The tab is left/marked dirty by the caller.
  const replaceDoc = useCallback((id: number, bytes: Uint8Array) => {
    setDocs((d) => d.map((x) => (x.id === id ? { ...x, data: bytes } : x)));
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

  const active = docs.find((d) => d.id === activeId) ?? null;

  return (
    <div
      className={docs.length > 0 ? 'shell wide' : 'shell'}
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
                onClick={() => switchTab(d.id)}
                title={d.name}
              >
                {d.dirty && <span className="dirtydot" aria-hidden="true" />}
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
          {update !== 'unchecked' && update !== null && (
            <button className="tabaction update" onClick={() => setShowUpdateModal(true)}>
              {t.updateAvailable(update.version)}
            </button>
          )}
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

      {active && (
        <PdfViewer
          key={active.id}
          ref={viewerRef}
          data={active.data}
          name={active.name}
          protection={active.protection}
          protectionInherited={active.protectionInherited}
          onDirtyChange={(dirty) => setDirty(active.id, dirty)}
          onSave={(bytes, protectionOverride) => saveDoc(active.id, bytes, protectionOverride)}
          onReplace={(bytes) => replaceDoc(active.id, bytes)}
          onProtectionChange={(p) => setProtection(active.id, p)}
          onError={(msg) => toast(msg, true)}
          onNotice={(msg) => toast(msg)}
        />
      )}

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

      {pendingProtected && (
        <PasswordPrompt
          name={pendingProtected.name}
          failed={pwFailed}
          onSubmit={onPasswordSubmit}
          onCancel={() => setPendingProtected(null)}
        />
      )}

      <Help
        version={version}
        updateState={update === 'unchecked' ? 'unknown' : update === null ? 'none' : 'available'}
        updateVersion={update !== 'unchecked' && update !== null ? update.version : null}
        checking={checking}
        onCheckUpdate={doCheckUpdate}
        onOpenUpdate={() => setShowUpdateModal(true)}
      />
      {toastMsg && <div className={`toast${toastMsg.err ? ' error' : ''}`}>{toastMsg.msg}</div>}
    </div>
  );
}
