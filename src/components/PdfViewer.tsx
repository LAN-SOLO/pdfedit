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
import { PDFDocument as PdfLibDocument } from 'pdf-lib';
import { t } from '../i18n';
import PagesPanel from './PagesPanel';
import StampDialog from './StampDialog';
import CompressDialog from './CompressDialog';
import { compressPdf, type CompressPreset } from '../compress';
import RedactConfirmDialog from './RedactConfirmDialog';
import { redactPdf, type RedactMark } from '../redact';
import Sidebar from './Sidebar';
import OcrDialog, { type OcrScope } from './OcrDialog';
import { ocrPdf, type OcrLang, type OcrProgress } from '../ocr';
import {
  IconSelect,
  IconHighlight,
  IconText,
  IconDraw,
  IconStamp,
  IconRedact,
  IconPages,
  IconCompress,
  IconFlatten,
  IconSave,
  IconSearch,
  IconZoomOut,
  IconZoomIn,
  IconFitWidth,
  IconFitPage,
  IconSidebar,
  IconOcr,
} from './Icon';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

const { AnnotationEditorType, AnnotationMode } = pdfjsLib;

// Stamp/Signature aren't in this list: pdf.js's built-in editors for both
// expect the full Firefox-viewer chrome we don't have. Placement for them
// goes through our own dialog + pdf.js's pasteEditor() instead — see
// placeStamp() and StampDialog.
type Tool = 'select' | 'highlight' | 'freetext' | 'ink';

const TOOL_MODE: Record<Tool, number> = {
  select: AnnotationEditorType.NONE,
  highlight: AnnotationEditorType.HIGHLIGHT,
  freetext: AnnotationEditorType.FREETEXT,
  ink: AnnotationEditorType.INK,
};

const TOOL_ICON: Record<Tool, (props: { size?: number }) => JSX.Element> = {
  select: IconSelect,
  highlight: IconHighlight,
  freetext: IconText,
  ink: IconDraw,
};

interface PlacedMark extends RedactMark {
  id: number;
  pageIndex: number;
}

let nextMarkId = 1;

interface PdfViewerProps {
  data: Uint8Array;
  name: string;
  onDirtyChange: (dirty: boolean) => void;
  onSave: (bytes: Uint8Array) => void;
  /** Replace the working document in place (e.g. after reordering/rotating/
   *  merging pages in the Pages panel) — an in-memory change, same as a
   *  drawn stroke: it marks the tab dirty but does not touch disk. */
  onReplace: (bytes: Uint8Array) => void;
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
  { data, name, onDirtyChange, onSave, onReplace, onError },
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
  const [showPages, setShowPages] = useState(false);
  const [hasFormFields, setHasFormFields] = useState(false);
  const [flattening, setFlattening] = useState(false);
  const [showStamp, setShowStamp] = useState(false);
  const [showCompress, setShowCompress] = useState(false);
  const [redacting, setRedacting] = useState(false);
  const [marks, setMarks] = useState<PlacedMark[]>([]);
  const [showRedactConfirm, setShowRedactConfirm] = useState(false);
  const [redactBusy, setRedactBusy] = useState(false);
  const marksRef = useRef<PlacedMark[]>([]);
  const [showSidebar, setShowSidebar] = useState(true);
  const [showOcr, setShowOcr] = useState(false);
  const [ocrProgress, setOcrProgress] = useState<OcrProgress | null>(null);
  const [ocrResult, setOcrResult] = useState<{ pagesOcred: number; wordsFound: number } | null>(null);

  useEffect(() => {
    if (!containerRef.current || !viewerElRef.current) return;
    let destroyed = false;

    // Redaction marks are page-coordinate percentages tied to this exact
    // document's pages — any time `data` changes underneath (a replace from
    // Pages/Stamp/Flatten/Compress, or a fresh load), stale marks could
    // point at the wrong page/content. Drop them rather than risk a
    // silently misaligned redaction.
    setMarks([]);
    setRedacting(false);

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
        pdfDocument
          .getFieldObjects()
          .then((fields) => {
            if (!destroyed) setHasFormFields(!!fields && Object.keys(fields).length > 0);
          })
          .catch(() => {});
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
      // pdfViewer.cleanup() only cancels unfinished renders — it does not
      // detach finished pages from the DOM. Without this, replacing the
      // document in an already-mounted tab (Pages panel apply, or a
      // checkpoint reload) would leave the old pages behind for the next
      // PDFViewer instance to render alongside the new ones.
      if (viewerElRef.current) viewerElRef.current.innerHTML = '';
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  useEffect(() => {
    marksRef.current = marks;
  }, [marks]);

  // Pending (unapplied) redaction marks live only in this component's
  // state — unlike a drawn Ink stroke, they have no pdf.js editor object
  // that checkpoint()/saveDocument() could preserve across an unmount
  // (e.g. switching tabs). Rather than silently lose them, tell the user.
  useEffect(() => {
    return () => {
      if (marksRef.current.length > 0) onError(t.redactMarksLostWarning);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Draws the in-progress drag rectangle and turns it into a normalized
  // mark on release. Attached directly to the pdf.js-managed page DOM
  // (outside React's tree, same reasoning as the rest of this component's
  // pdf.js integration) rather than as a React overlay, since pdf.js owns
  // and reflows those page elements on zoom/scroll itself.
  useEffect(() => {
    const container = containerRef.current;
    if (!redacting || !container) return;

    container.classList.add('redacting');

    let drag: { pageEl: HTMLElement; pageIndex: number; startX: number; startY: number; el: HTMLDivElement } | null =
      null;

    const onDown = (e: PointerEvent) => {
      const pageEl = (e.target as HTMLElement).closest('.page') as HTMLElement | null;
      if (!pageEl) return;
      const rect = pageEl.getBoundingClientRect();
      const el = document.createElement('div');
      el.className = 'redact-mark';
      pageEl.appendChild(el);
      drag = {
        pageEl,
        pageIndex: Number(pageEl.dataset.pageNumber) - 1,
        startX: e.clientX - rect.left,
        startY: e.clientY - rect.top,
        el,
      };
    };

    const onMove = (e: PointerEvent) => {
      if (!drag) return;
      const rect = drag.pageEl.getBoundingClientRect();
      const curX = e.clientX - rect.left;
      const curY = e.clientY - rect.top;
      const x = Math.min(drag.startX, curX);
      const y = Math.min(drag.startY, curY);
      const w = Math.abs(curX - drag.startX);
      const h = Math.abs(curY - drag.startY);
      Object.assign(drag.el.style, { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px` });
    };

    const onUp = (e: PointerEvent) => {
      if (!drag) return;
      const { pageEl, pageIndex, startX, startY, el } = drag;
      drag = null;
      el.remove();
      const rect = pageEl.getBoundingClientRect();
      const curX = e.clientX - rect.left;
      const curY = e.clientY - rect.top;
      const x = Math.min(startX, curX);
      const y = Math.min(startY, curY);
      const w = Math.abs(curX - startX);
      const h = Math.abs(curY - startY);
      if (w < 6 || h < 6 || rect.width === 0 || rect.height === 0) return;
      setMarks((prev) => [
        ...prev,
        {
          id: nextMarkId++,
          pageIndex,
          xPct: x / rect.width,
          yPct: y / rect.height,
          wPct: w / rect.width,
          hPct: h / rect.height,
        },
      ]);
    };

    container.addEventListener('pointerdown', onDown);
    container.addEventListener('pointermove', onMove);
    container.addEventListener('pointerup', onUp);
    return () => {
      container.classList.remove('redacting');
      container.removeEventListener('pointerdown', onDown);
      container.removeEventListener('pointermove', onMove);
      container.removeEventListener('pointerup', onUp);
      drag?.el.remove();
    };
  }, [redacting]);

  // Renders already-placed marks as overlays. Percentage-based sizing keeps
  // them correctly positioned across zoom changes without recomputing here.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const placed: HTMLElement[] = [];
    for (const mark of marks) {
      const pageEl = container.querySelector(`.page[data-page-number="${mark.pageIndex + 1}"]`);
      if (!pageEl) continue;
      const el = document.createElement('div');
      el.className = 'redact-mark';
      Object.assign(el.style, {
        left: `${mark.xPct * 100}%`,
        top: `${mark.yPct * 100}%`,
        width: `${mark.wPct * 100}%`,
        height: `${mark.hPct * 100}%`,
      });
      pageEl.appendChild(el);
      placed.push(el);
    }
    return () => {
      placed.forEach((el) => el.remove());
    };
  }, [marks]);

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
    setRedacting(false);
    const pdfViewer = pdfViewerRef.current;
    if (pdfViewer) pdfViewer.annotationEditorMode = { mode: TOOL_MODE[next] };
  };

  const toggleRedact = () => {
    setRedacting((v) => !v);
    setTool('select');
    const pdfViewer = pdfViewerRef.current;
    if (pdfViewer) pdfViewer.annotationEditorMode = { mode: AnnotationEditorType.NONE };
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

  const jumpToPage = useCallback((raw: string | number) => {
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

  const doFlatten = async () => {
    const pdfViewer = pdfViewerRef.current;
    if (!pdfViewer?.pdfDocument) return;
    setFlattening(true);
    try {
      await commitPendingEdits();
      const bytes = await pdfViewer.pdfDocument.saveDocument();
      const libDoc = await PdfLibDocument.load(bytes);
      libDoc.getForm().flatten();
      const flat = await libDoc.save();
      dirtyRef.current = true;
      onDirtyChange(true);
      onReplace(flat);
    } catch (err) {
      onError(`${t.flattenError}: ${String(err)}`);
    } finally {
      setFlattening(false);
    }
  };

  const doCompress = async (preset: CompressPreset): Promise<{ before: number; after: number } | null> => {
    const pdfViewer = pdfViewerRef.current;
    if (!pdfViewer?.pdfDocument) return null;
    try {
      await commitPendingEdits();
      const bytes = await pdfViewer.pdfDocument.saveDocument();
      const { bytes: compressed, imagesTouched } = await compressPdf(bytes, preset);
      if (imagesTouched === 0) return null;
      dirtyRef.current = true;
      onDirtyChange(true);
      onReplace(compressed);
      return { before: bytes.length, after: compressed.length };
    } catch (err) {
      onError(`${t.compressError}: ${String(err)}`);
      return null;
    }
  };

  const doRedact = async (cleanMetadata: boolean) => {
    const pdfViewer = pdfViewerRef.current;
    if (!pdfViewer?.pdfDocument || marks.length === 0) return;
    setRedactBusy(true);
    try {
      await commitPendingEdits();
      const bytes = await pdfViewer.pdfDocument.saveDocument();
      const marksByPage = new Map<number, RedactMark[]>();
      for (const mark of marks) {
        const list = marksByPage.get(mark.pageIndex) ?? [];
        list.push(mark);
        marksByPage.set(mark.pageIndex, list);
      }
      const { bytes: redacted } = await redactPdf(bytes, marksByPage, { cleanMetadata });
      setMarks([]);
      setShowRedactConfirm(false);
      setRedacting(false);
      dirtyRef.current = true;
      onDirtyChange(true);
      onReplace(redacted);
    } catch (err) {
      onError(`${t.redactError}: ${String(err)}`);
    } finally {
      setRedactBusy(false);
    }
  };

  const doOcr = async (scope: OcrScope, langs: OcrLang[]) => {
    const pdfViewer = pdfViewerRef.current;
    if (!pdfViewer?.pdfDocument || langs.length === 0) return;
    setOcrResult(null);
    try {
      await commitPendingEdits();
      const bytes = await pdfViewer.pdfDocument.saveDocument();
      const pageIndices =
        scope === 'all'
          ? Array.from({ length: pdfViewer.pagesCount }, (_, i) => i)
          : [pdfViewer.currentPageNumber - 1];
      const { bytes: ocred, pagesOcred, wordsFound } = await ocrPdf(bytes, pageIndices, langs, setOcrProgress);
      setOcrProgress(null);
      dirtyRef.current = true;
      onDirtyChange(true);
      onReplace(ocred);
      setOcrResult({ pagesOcred, wordsFound });
    } catch (err) {
      setOcrProgress(null);
      onError(`${t.ocrError}: ${String(err)}`);
    }
  };

  // Placement, moving and resizing is pdf.js's own Stamp editor — we only
  // supply the image. `pasteEditor` lives on the PAGE's AnnotationEditorLayer
  // instance (reached through the page view's builder wrapper), not on the
  // top-level PDFViewer; it isn't part of the public d.ts, hence the casts.
  const placeStamp = async (file: File) => {
    setShowStamp(false);
    const pdfViewer = pdfViewerRef.current;
    if (!pdfViewer) return;
    try {
      const pageIndex = pdfViewer.currentPageNumber - 1;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pageView = (pdfViewer as any)._pages?.[pageIndex];
      const builder = pageView?.annotationEditorLayer;
      const layer = builder?.annotationEditorLayer;
      if (!layer) {
        onError(t.stampError);
        return;
      }
      await layer.pasteEditor({ mode: AnnotationEditorType.STAMP }, { bitmapFile: file });
      if (!dirtyRef.current) {
        dirtyRef.current = true;
        onDirtyChange(true);
      }
    } catch (err) {
      onError(`${t.stampError}: ${String(err)}`);
    }
  };

  return (
    <div className="viewer">
      <div className="toolbar">
        <button
          className={showSidebar ? 'iconbtn active' : 'iconbtn'}
          onClick={() => setShowSidebar((v) => !v)}
          disabled={!ready}
          title={t.sidebarToggle}
          aria-label={t.sidebarToggle}
        >
          <IconSidebar size={16} />
        </button>
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
        <button
          className={showFind ? 'iconbtn active' : 'iconbtn'}
          onClick={() => setShowFind((v) => !v)}
          title={t.find}
          aria-label={t.find}
        >
          <IconSearch size={16} />
        </button>
        <div className="segmented">
          <button onClick={() => zoom(-1)} aria-label="zoom out" title={t.zoomOut}>
            <IconZoomOut size={15} />
          </button>
          <span className="zoomlevel">{scalePct}%</span>
          <button onClick={() => zoom(1)} aria-label="zoom in" title={t.zoomIn}>
            <IconZoomIn size={15} />
          </button>
        </div>
        <div className="segmented">
          <button onClick={fitWidth} title={t.fitWidth} aria-label={t.fitWidth}>
            <IconFitWidth size={15} />
          </button>
          <button onClick={fitPage} title={t.fitPage} aria-label={t.fitPage}>
            <IconFitPage size={15} />
          </button>
        </div>
        <button className="primary iconbtn" onClick={doSave} disabled={saving || !ready}>
          <IconSave size={16} />
          {saving ? t.saving : t.save}
        </button>
      </div>

      <div className="edittoolbar">
        <div className="toolgroup">
          {(Object.keys(TOOL_MODE) as Tool[]).map((tl) => {
            const ToolIcon = TOOL_ICON[tl];
            return (
              <button
                key={tl}
                className={tool === tl ? 'iconbtn active' : 'iconbtn'}
                onClick={() => selectTool(tl)}
                title={t.tools[tl]}
              >
                <ToolIcon size={16} />
                {t.tools[tl]}
              </button>
            );
          })}
          <button className="iconbtn" onClick={() => setShowStamp(true)} disabled={!ready} title={t.stampButton}>
            <IconStamp size={16} />
            {t.stampButton}
          </button>
          <button
            className={redacting ? 'iconbtn active' : 'iconbtn'}
            onClick={toggleRedact}
            disabled={!ready}
            title={t.redactHint}
          >
            <IconRedact size={16} />
            {t.redactButton}
          </button>
        </div>

        <div className="tooldivider" />

        <div className="toolgroup">
          <button className="iconbtn" onClick={() => setShowPages(true)} disabled={!ready} title={t.pagesTitle}>
            <IconPages size={16} />
            {t.pagesButton}
          </button>
          {hasFormFields && (
            <button className="iconbtn" onClick={doFlatten} disabled={flattening || !ready} title={t.flattenHint}>
              <IconFlatten size={16} />
              {flattening ? t.flattening : t.flatten}
            </button>
          )}
          <button className="iconbtn" onClick={() => setShowCompress(true)} disabled={!ready} title={t.compressButton}>
            <IconCompress size={16} />
            {t.compressButton}
          </button>
          <button
            className="iconbtn"
            onClick={() => {
              setOcrResult(null);
              setShowOcr(true);
            }}
            disabled={!ready}
            title={t.ocrTitle}
          >
            <IconOcr size={16} />
            {t.ocrButton}
          </button>
        </div>
      </div>

      {(redacting || marks.length > 0) && (
        <div className="redactbar">
          <span className="faint">{redacting ? t.redactHint : t.redactMarkCount(marks.length)}</span>
          <span className="spacer" />
          {marks.length > 0 && (
            <>
              <button onClick={() => setMarks([])}>{t.redactDiscard}</button>
              <button className="danger" onClick={() => setShowRedactConfirm(true)}>
                {t.redactApply}
              </button>
            </>
          )}
        </div>
      )}

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

      <div className="viewer-body">
        {showSidebar && ready && (
          <Sidebar
            data={data}
            currentPage={pageInfo.current}
            onJump={jumpToPage}
            onOpenPages={() => setShowPages(true)}
          />
        )}
        <div className="pdfjs-outer">
          <div className="pdfjs-container" ref={containerRef}>
            <div className="pdfViewer" ref={viewerElRef} />
          </div>
          {error && <div className="load-error">{`${t.loadError}: ${error}`}</div>}
          {!ready && !error && <div className="faint loading">{t.loading}</div>}
        </div>
      </div>

      {showPages && (
        <PagesPanel
          data={data}
          onApply={(bytes) => {
            dirtyRef.current = true;
            onDirtyChange(true);
            onReplace(bytes);
          }}
          onClose={() => setShowPages(false)}
          onError={onError}
        />
      )}

      {showStamp && <StampDialog onPlace={placeStamp} onClose={() => setShowStamp(false)} />}

      {showCompress && <CompressDialog onCompress={doCompress} onClose={() => setShowCompress(false)} />}

      {showRedactConfirm && (
        <RedactConfirmDialog
          markCount={marks.length}
          busy={redactBusy}
          onConfirm={doRedact}
          onCancel={() => setShowRedactConfirm(false)}
        />
      )}

      {showOcr && (
        <OcrDialog
          currentPage={pageInfo.current}
          totalPages={pageInfo.total}
          progress={ocrProgress}
          result={ocrResult}
          onStart={doOcr}
          onClose={() => setShowOcr(false)}
        />
      )}
    </div>
  );
});

export default PdfViewer;
