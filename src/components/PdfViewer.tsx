import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import {
  EventBus,
  PDFLinkService,
  PDFFindController,
  PDFViewer as PdfJsViewer,
} from 'pdfjs-dist/web/pdf_viewer.mjs';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import 'pdfjs-dist/web/pdf_viewer.css';
import { t } from '../i18n';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

const { AnnotationEditorType, AnnotationMode } = pdfjsLib;

type Tool = 'select' | 'highlight' | 'freetext' | 'ink' | 'stamp' | 'signature';

const TOOL_MODE: Record<Tool, number> = {
  select: AnnotationEditorType.NONE,
  highlight: AnnotationEditorType.HIGHLIGHT,
  freetext: AnnotationEditorType.FREETEXT,
  ink: AnnotationEditorType.INK,
  stamp: AnnotationEditorType.STAMP,
  signature: AnnotationEditorType.SIGNATURE,
};

interface PdfViewerProps {
  data: Uint8Array;
  name: string;
  onDirtyChange: (dirty: boolean) => void;
  onSave: (bytes: Uint8Array) => void;
  onError: (msg: string) => void;
}

export interface PdfViewerHandle {
  /** Bake in-progress edits into fresh PDF bytes without touching disk —
   *  used to preserve work when the tab is hidden (switched away from).
   *  Returns null when there is nothing unsaved to preserve. */
  checkpoint: () => Promise<Uint8Array | null>;
}

/** One PDF document, rendered via pdf.js's own PDFViewer widget — the same
 *  component Firefox uses for its built-in PDF viewer. That gets us, for
 *  free: text layer + search, rendering of existing annotations and
 *  AcroForm fields from any PDF, and an annotation *editor* (highlight,
 *  free text, ink, stamp, signature) whose edits round-trip via
 *  pdfDocument.saveDocument() into a real, spec-compliant PDF.
 *
 *  IMPORTANT: pdf.js's AnnotationEditorUIManager attaches listeners on
 *  `document` (selectionchange, keydown for undo/redo, ...) regardless of
 *  whether its container is visible. Mounting more than one instance at
 *  once makes them cross-talk (verified: a second, hidden instance
 *  silently swallowed edits meant for the visible one). Only ever mount
 *  ONE of these at a time — the parent unmounts inactive tabs and uses
 *  `checkpoint()` beforehand to keep their in-progress edits. */
const PdfViewer = forwardRef<PdfViewerHandle, PdfViewerProps>(function PdfViewer(
  { data, name, onDirtyChange, onSave, onError },
  ref
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerElRef = useRef<HTMLDivElement>(null);

  const pdfViewerRef = useRef<InstanceType<typeof PdfJsViewer> | null>(null);
  const eventBusRef = useRef<EventBus | null>(null);
  const dirtyRef = useRef(false);

  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [tool, setTool] = useState<Tool>('select');
  const [scalePct, setScalePct] = useState(100);
  const [pageInfo, setPageInfo] = useState({ current: 1, total: 0 });
  const [pageInput, setPageInput] = useState('1');
  const [showFind, setShowFind] = useState(false);
  const [findQuery, setFindQuery] = useState('');
  const [findResult, setFindResult] = useState<{ current: number; total: number } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!containerRef.current || !viewerElRef.current) return;
    let destroyed = false;

    const eventBus = new EventBus();
    eventBusRef.current = eventBus;
    const linkService = new PDFLinkService({ eventBus });
    const findController = new PDFFindController({ eventBus, linkService });

    const pdfViewer = new PdfJsViewer({
      container: containerRef.current,
      viewer: viewerElRef.current,
      eventBus,
      linkService,
      findController,
      annotationMode: AnnotationMode.ENABLE_FORMS,
      annotationEditorMode: AnnotationEditorType.NONE,
      annotationEditorHighlightColors: 'yellow=#FFFF98,green=#53FFBC,blue=#80EBFF,pink=#FFB3FF,red=#FF4F5F',
      imageResourcesPath: '/pdfjs-images/',
      removePageBorders: false,
    });
    pdfViewerRef.current = pdfViewer;
    linkService.setViewer(pdfViewer);

    const onPagesInit = () => {
      if (destroyed) return;
      pdfViewer.currentScaleValue = 'page-width';
    };
    const onScaleChange = () => {
      if (destroyed) return;
      setScalePct(Math.round(pdfViewer.currentScale * 100));
    };
    const onPageChange = () => {
      if (destroyed) return;
      setPageInfo({ current: pdfViewer.currentPageNumber, total: pdfViewer.pagesCount });
      setPageInput(String(pdfViewer.currentPageNumber));
    };
    const markDirty = () => {
      if (destroyed || dirtyRef.current) return;
      dirtyRef.current = true;
      onDirtyChange(true);
    };
    const onEditorState = (e: { hasSomethingToUndo?: boolean }) => {
      if (e?.hasSomethingToUndo) markDirty();
    };
    // AcroForm field edits (text/checkbox/radio/dropdown) are native inputs
    // rendered by the annotation layer — they don't go through the editor
    // undo stack, so catch them generically via delegated DOM events too.
    const container = containerRef.current;
    container?.addEventListener('input', markDirty, true);
    container?.addEventListener('change', markDirty, true);
    // A freehand stroke (Ink/Signature) only reaches the undo stack once
    // it's *committed* — but committing only happens inside our own
    // checkpoint/save path, which itself was gated on `dirty`. Without this,
    // a drawn-but-uncommitted stroke would never be considered dirty, so
    // checkpoint/save would bail out before ever committing it, silently
    // dropping the stroke. Mark dirty the moment the user starts drawing,
    // before pdf.js's own signals would.
    const onPointerDown = () => {
      if (pdfViewerRef.current?.annotationEditorMode?.mode !== AnnotationEditorType.NONE) markDirty();
    };
    container?.addEventListener('pointerdown', onPointerDown, true);
    const onFindMatches = (e: { matchesCount?: { current: number; total: number } }) => {
      if (destroyed) return;
      setFindResult(e.matchesCount ?? null);
    };

    eventBus.on('pagesinit', onPagesInit);
    eventBus.on('scalechanging', onScaleChange);
    eventBus.on('pagechanging', onPageChange);
    eventBus.on('annotationeditorstateschanged', onEditorState);
    eventBus.on('updatefindmatchescount', onFindMatches);

    const loadingTask = pdfjsLib.getDocument({ data: data.slice() });
    loadingTask.promise
      .then((pdfDocument) => {
        if (destroyed) {
          loadingTask.destroy();
          return;
        }
        pdfViewer.setDocument(pdfDocument);
        linkService.setDocument(pdfDocument, null);
        setReady(true);
      })
      .catch((err: unknown) => {
        if (!destroyed) setError(String((err as Error)?.message ?? err));
      });

    return () => {
      destroyed = true;
      eventBus.off('pagesinit', onPagesInit);
      eventBus.off('scalechanging', onScaleChange);
      eventBus.off('pagechanging', onPageChange);
      eventBus.off('annotationeditorstateschanged', onEditorState);
      eventBus.off('updatefindmatchescount', onFindMatches);
      container?.removeEventListener('input', markDirty, true);
      container?.removeEventListener('change', markDirty, true);
      container?.removeEventListener('pointerdown', onPointerDown, true);
      pdfViewer.cleanup();
      loadingTask.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  // A stroke/text-box/etc. the user just created stays "live" in its editor
  // until something commits it — normally clicking the Select tool. Forcing
  // the mode to NONE does exactly that, so a pending edit is never lost to
  // a tab switch or Save just because the user never explicitly deselected.
  //
  // The mode switch itself is asynchronous inside pdf.js (it can even chain
  // through a setTimeout while waiting on a page re-render) — the setter
  // returns immediately, well before the commit has actually happened. A
  // fire-and-forget call here loses the race against saveDocument() and
  // silently drops the pending edit, so this waits for pdf.js's own
  // 'annotationeditormodechanged' event, which only fires once the switch
  // (and the commit that precedes it) has truly finished.
  const commitPendingEdits = useCallback((): Promise<void> => {
    const pdfViewer = pdfViewerRef.current;
    const eventBus = eventBusRef.current;
    if (!pdfViewer || !eventBus || pdfViewer.annotationEditorMode?.mode === AnnotationEditorType.NONE) {
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      let settled = false;
      let timer: number;
      const finish = () => {
        if (settled) return;
        settled = true;
        eventBus.off('annotationeditormodechanged', finish);
        window.clearTimeout(timer);
        resolve();
      };
      timer = window.setTimeout(finish, 800); // safety net if the event never fires
      eventBus.on('annotationeditormodechanged', finish);
      setTool('select');
      pdfViewer.annotationEditorMode = { mode: AnnotationEditorType.NONE };
    });
  }, []);

  const doCheckpoint = useCallback(async (): Promise<Uint8Array | null> => {
    const pdfViewer = pdfViewerRef.current;
    if (!pdfViewer?.pdfDocument) return null;
    try {
      // Commit BEFORE checking dirty: a just-drawn, not-yet-committed stroke
      // can still be the only reason this doc is dirty at all.
      await commitPendingEdits();
      if (!dirtyRef.current) return null;
      return await pdfViewer.pdfDocument.saveDocument();
    } catch (err) {
      // best-effort — losing the in-memory checkpoint beats crashing the tab
      // switch, but surface it: the user's edits since the last real Save
      // are about to become unrecoverable once this tab unmounts.
      onError(`${t.saveError}: ${String(err)}`);
      return null;
    }
  }, [onError, commitPendingEdits]);

  useImperativeHandle(ref, () => ({ checkpoint: doCheckpoint }), [doCheckpoint]);

  const selectTool = (next: Tool) => {
    setTool(next);
    const pdfViewer = pdfViewerRef.current;
    if (pdfViewer) pdfViewer.annotationEditorMode = { mode: TOOL_MODE[next] };
  };

  const zoom = (dir: 1 | -1) => {
    const pdfViewer = pdfViewerRef.current;
    if (!pdfViewer) return;
    pdfViewer.currentScale = Math.max(0.25, Math.min(5, pdfViewer.currentScale * (dir === 1 ? 1.15 : 1 / 1.15)));
  };
  const fitWidth = () => {
    if (pdfViewerRef.current) pdfViewerRef.current.currentScaleValue = 'page-width';
  };
  const fitPage = () => {
    if (pdfViewerRef.current) pdfViewerRef.current.currentScaleValue = 'page-fit';
  };

  const jumpToPage = useCallback((raw: string) => {
    const n = Math.round(Number(raw));
    const pdfViewer = pdfViewerRef.current;
    if (!pdfViewer || !Number.isFinite(n)) return;
    pdfViewer.currentPageNumber = Math.max(1, Math.min(pdfViewer.pagesCount, n));
  }, []);

  const runFind = (query: string, again = false) => {
    eventBusRef.current?.dispatch('find', {
      source: null,
      type: again ? 'again' : '',
      query,
      caseSensitive: false,
      entireWord: false,
      highlightAll: true,
      findPrevious: false,
      matchDiacritics: true,
    });
  };

  const doSave = async () => {
    const pdfViewer = pdfViewerRef.current;
    if (!pdfViewer?.pdfDocument) return;
    setSaving(true);
    try {
      await commitPendingEdits();
      const bytes = await pdfViewer.pdfDocument.saveDocument();
      dirtyRef.current = false;
      onDirtyChange(false);
      onSave(bytes);
    } catch (err) {
      onError(`${t.saveError}: ${String(err)}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="viewer">
      <div className="toolbar">
        <span className="docname" title={name}>
          {name}
        </span>
        {pageInfo.total > 0 && (
          <span className="pagejump">
            <input
              className="pageinput"
              value={pageInput}
              onChange={(e) => setPageInput(e.target.value)}
              onBlur={() => jumpToPage(pageInput)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') jumpToPage(pageInput);
              }}
            />
            <span className="faint">/ {pageInfo.total}</span>
          </span>
        )}
        <span className="spacer" />
        <button className={showFind ? 'primary' : ''} onClick={() => setShowFind((v) => !v)}>
          {t.find}
        </button>
        <button onClick={() => zoom(-1)} aria-label="zoom out">
          −
        </button>
        <span className="zoomlevel">{scalePct}%</span>
        <button onClick={() => zoom(1)} aria-label="zoom in">
          +
        </button>
        <button onClick={fitWidth}>{t.fitWidth}</button>
        <button onClick={fitPage}>{t.fitPage}</button>
        <button className="primary" onClick={doSave} disabled={saving || !ready}>
          {saving ? t.saving : t.save}
        </button>
      </div>

      <div className="edittoolbar">
        {(Object.keys(TOOL_MODE) as Tool[]).map((tl) => (
          <button key={tl} className={tool === tl ? 'primary' : ''} onClick={() => selectTool(tl)}>
            {t.tools[tl]}
          </button>
        ))}
      </div>

      {showFind && (
        <div className="findbar">
          <input
            className="findinput"
            placeholder={t.findPlaceholder}
            value={findQuery}
            onChange={(e) => {
              setFindQuery(e.target.value);
              runFind(e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') runFind(findQuery, true);
              if (e.key === 'Escape') setShowFind(false);
            }}
            autoFocus
          />
          <span className="faint">
            {findQuery
              ? findResult
                ? `${findResult.current}/${findResult.total}`
                : t.findNoResults
              : ''}
          </span>
        </div>
      )}

      <div className="pdfjs-outer">
        <div className="pdfjs-container" ref={containerRef}>
          <div className="pdfViewer" ref={viewerElRef} />
        </div>
        {error && <div className="load-error">{`${t.loadError}: ${error}`}</div>}
        {!ready && !error && <div className="faint loading">{t.loading}</div>}
      </div>
    </div>
  );
});

export default PdfViewer;
