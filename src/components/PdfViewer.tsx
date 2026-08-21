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
import { redactPdf, type RedactMark, type RedactStyle } from '../redact';
import Sidebar, { type AnnotObject } from './Sidebar';
import OcrDialog, { type OcrScope } from './OcrDialog';
import { ocrPdf, type OcrLang, type OcrProgress } from '../ocr';
import EditRegionDialog from './EditRegionDialog';
import { applyRegionEdit, type EditContent, type EditRegion } from '../regionEdit';
import FormFieldDialog from './FormFieldDialog';
import {
  addFormField,
  FieldNameTakenError,
  listFormFields,
  removeFormField,
  suggestFieldName,
  updateFormField,
  type FieldRegion,
  type FieldSpec,
  type FieldSummary,
} from '../formFields';
import SignDialog, { type SignRequest } from './SignDialog';
import { signPdf, type SignRegion } from '../sign';
import ProtectDialog from './ProtectDialog';
import type { Protection } from '../protect';
import { movePage } from '../pages';
import WatermarkDialog from './WatermarkDialog';
import { applyWatermark, readWatermarks, verifyAgainstPng, type WatermarkReport } from '../watermark';
import {
  applyFreetextFonts,
  type FontApplication,
  type FreetextEntry,
  type FreetextFontChoice,
} from '../freetextFont';
import { api, isTauri, type SystemFont } from '../api';
import TextEditDialog, { type TextEditSpec } from './TextEditDialog';
import { applyRunEdit } from '../textEdit';
import { matchFont, parsePdfFontName, type FontMatch } from '../fontMatch';
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
  IconEditRegion,
  IconFormField,
  IconSign,
  IconLock,
  IconDroplet,
  IconTextEdit,
} from './Icon';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(window as any).__debugPdfjs = pdfjsLib;

const { AnnotationEditorType, AnnotationMode, AnnotationEditorParamsType } = pdfjsLib;

// Must stay in sync with `annotationEditorHighlightColors` further down —
// pdf.js only accepts highlight colors from that configured list.
const HIGHLIGHT_COLORS = ['#FFFF98', '#53FFBC', '#80EBFF', '#FFB3FF', '#FF4F5F'];
const PEN_COLORS = ['#0B1220', '#E11D48', '#2563EB', '#16A34A', '#F59E0B', '#7C3AED'];

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

/** A clicked, uniformly-formatted text run waiting in the edit dialog. */
interface PendingRunEdit {
  pageIndex: number;
  /** Baseline origin + width in PDF points (exact, from getTextContent). */
  x: number;
  baseline: number;
  width: number;
  sizePt: number;
  ascent: number;
  descent: number;
  text: string;
  /** Sampled original text color / page background. */
  colorHex: string;
  bg: [number, number, number];
  detectedLabel: string | null;
  match: FontMatch | null;
  /** Marker box in viewport px (relative to the canvasWrapper). */
  overlay: { left: number; top: number; width: number; height: number };
}

let nextMarkId = 1;

/** A dragged page rectangle in page-relative percentages — the shared
 *  currency of every drag-to-mark mode (redact, region edit, form field,
 *  signature field). */
interface PageRegion {
  pageIndex: number;
  xPct: number;
  yPct: number;
  wPct: number;
  hPct: number;
}

/** The overlay/measurement anchor inside a .page element. The page box
 *  itself carries a 9px transparent border, so its rect is offset and
 *  larger than the rendered PDF area — percentages measured against it
 *  land visibly wrong at low zoom (verified: a line-edit placed ~one line
 *  too low). The canvasWrapper is borderless and exactly canvas-sized;
 *  our CSS gives it position:relative so marks can be %-positioned in it. */
const pageAnchor = (pageEl: HTMLElement): HTMLElement =>
  (pageEl.querySelector('.canvasWrapper') as HTMLElement | null) ?? pageEl;

/** Drag-to-mark a rectangle on a pdf.js page. Attached directly to the
 *  pdf.js-managed page DOM (outside React's tree) rather than as a React
 *  overlay, since pdf.js owns and reflows those page elements on
 *  zoom/scroll itself. `onRegion` must be referentially stable — the
 *  effect re-subscribes (and drops an in-progress drag) when it changes. */
function useRegionDrag(
  containerRef: React.RefObject<HTMLDivElement>,
  active: boolean,
  markClass: string,
  onRegion: (region: PageRegion) => void
) {
  useEffect(() => {
    const container = containerRef.current;
    if (!active || !container) return;

    container.classList.add('redacting');

    let drag: { anchor: HTMLElement; pageIndex: number; startX: number; startY: number; el: HTMLDivElement } | null =
      null;

    const onDown = (e: PointerEvent) => {
      const pageEl = (e.target as HTMLElement).closest('.page') as HTMLElement | null;
      if (!pageEl) return;
      const anchor = pageAnchor(pageEl);
      const rect = anchor.getBoundingClientRect();
      const el = document.createElement('div');
      el.className = markClass;
      anchor.appendChild(el);
      drag = {
        anchor,
        pageIndex: Number(pageEl.dataset.pageNumber) - 1,
        startX: e.clientX - rect.left,
        startY: e.clientY - rect.top,
        el,
      };
    };

    const onMove = (e: PointerEvent) => {
      if (!drag) return;
      const rect = drag.anchor.getBoundingClientRect();
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
      const { anchor, pageIndex, startX, startY, el } = drag;
      drag = null;
      el.remove();
      const rect = anchor.getBoundingClientRect();
      const curX = e.clientX - rect.left;
      const curY = e.clientY - rect.top;
      const x = Math.min(startX, curX);
      const y = Math.min(startY, curY);
      const w = Math.abs(curX - startX);
      const h = Math.abs(curY - startY);
      if (w < 6 || h < 6 || rect.width === 0 || rect.height === 0) return;
      onRegion({
        pageIndex,
        xPct: x / rect.width,
        yPct: y / rect.height,
        wPct: w / rect.width,
        hPct: h / rect.height,
      });
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
  }, [containerRef, active, markClass, onRegion]);
}

interface PdfViewerProps {
  data: Uint8Array;
  name: string;
  /** Password protection applied at save time (null = save unencrypted). */
  protection: Protection | null;
  /** True when the protection came from opening an encrypted file. */
  protectionInherited: boolean;
  onDirtyChange: (dirty: boolean) => void;
  /** `protectionOverride`: pass the protection to apply for THIS save,
   *  sidestepping the async race between updating the doc's protection
   *  state and reading it back in the save path. `undefined` keeps the
   *  doc's stored protection. */
  onSave: (bytes: Uint8Array, protectionOverride?: Protection | null) => void;
  /** Replace the working document in place (e.g. after reordering/rotating/
   *  merging pages in the Pages panel) — an in-memory change, same as a
   *  drawn stroke: it marks the tab dirty but does not touch disk. */
  onReplace: (bytes: Uint8Array) => void;
  onProtectionChange: (protection: Protection | null) => void;
  onError: (msg: string) => void;
  onNotice: (msg: string) => void;
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
  {
    data,
    name,
    protection,
    protectionInherited,
    onDirtyChange,
    onSave,
    onReplace,
    onProtectionChange,
    onError,
    onNotice,
  },
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
  const [editingRegion, setEditingRegion] = useState(false);
  const [pendingRegion, setPendingRegion] = useState<EditRegion | null>(null);
  const [regionEditBusy, setRegionEditBusy] = useState(false);
  const pendingRegionRef = useRef<EditRegion | null>(null);
  // form-field creation
  const [placingField, setPlacingField] = useState(false);
  const [pendingFieldRegion, setPendingFieldRegion] = useState<FieldRegion | null>(null);
  const [suggestedFieldName, setSuggestedFieldName] = useState('feld_1');
  const [fieldBusy, setFieldBusy] = useState(false);
  const pendingFieldRegionRef = useRef<FieldRegion | null>(null);
  // digital signature
  const [showSign, setShowSign] = useState(false);
  const [signPlacing, setSignPlacing] = useState(false);
  const [signBusy, setSignBusy] = useState(false);
  const pendingSignReqRef = useRef<SignRequest | null>(null);
  const doSignRef = useRef<((req: SignRequest, region: SignRegion | null) => Promise<void>) | null>(null);
  // password protection
  const [showProtect, setShowProtect] = useState(false);
  const [protectBusy, setProtectBusy] = useState(false);
  // objects panel (annotations + form fields)
  const [objectsVersion, setObjectsVersion] = useState(0);
  const [annotObjects, setAnnotObjects] = useState<AnnotObject[]>([]);
  const [fieldList, setFieldList] = useState<FieldSummary[]>([]);
  const [editingField, setEditingField] = useState<FieldSummary | null>(null);
  // in-place line editing
  const [editingText, setEditingText] = useState(false);
  const [pendingRunEdit, setPendingRunEdit] = useState<PendingRunEdit | null>(null);
  const [lineEditBusy, setLineEditBusy] = useState(false);
  // invisible watermark
  const [showWatermark, setShowWatermark] = useState(false);
  const [wmBusy, setWmBusy] = useState(false);
  const [wmReport, setWmReport] = useState<WatermarkReport | null>(null);
  // custom fonts for the Text tool
  const [fontChoice, setFontChoice] = useState<FreetextFontChoice>({ kind: 'default' });
  const [systemFonts, setSystemFonts] = useState<SystemFont[] | null>(null);
  const freetextFontMapRef = useRef<Map<string, FreetextFontChoice>>(new Map());
  const fontBytesCacheRef = useRef<Map<string, Uint8Array>>(new Map());
  const fontChoiceRef = useRef<FreetextFontChoice>({ kind: 'default' });
  fontChoiceRef.current = fontChoice;
  // per-tool editor defaults, mirrored to pdf.js via updateParams
  const [highlightColor, setHighlightColor] = useState(HIGHLIGHT_COLORS[0]);
  const [highlightThickness, setHighlightThickness] = useState(12);
  const [freetextColor, setFreetextColor] = useState(PEN_COLORS[0]);
  const [freetextSize, setFreetextSize] = useState(12);
  const [inkColor, setInkColor] = useState(PEN_COLORS[0]);
  const [inkThickness, setInkThickness] = useState(2);
  const [inkOpacity, setInkOpacity] = useState(100);

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
    setPendingRegion(null);
    setEditingRegion(false);
    setPendingFieldRegion(null);
    setPlacingField(false);
    setSignPlacing(false);
    setEditingText(false);
    setPendingRunEdit(null);
    pendingSignReqRef.current = null;
    // editors don't survive a document swap — neither do their font tags
    freetextFontMapRef.current.clear();

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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__debugViewer = pdfViewer; // dev aid, same convention as __debugPdfjs
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
      setObjectsVersion((v) => v + 1);
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

  useEffect(() => {
    pendingRegionRef.current = pendingRegion;
  }, [pendingRegion]);

  useEffect(() => {
    pendingFieldRegionRef.current = pendingFieldRegion;
  }, [pendingFieldRegion]);

  // Pending (unapplied) redaction marks / a just-marked edit region live
  // only in this component's state — unlike a drawn Ink stroke, they have
  // no pdf.js editor object that checkpoint()/saveDocument() could
  // preserve across an unmount (e.g. switching tabs). Rather than silently
  // lose them, tell the user.
  useEffect(() => {
    return () => {
      if (marksRef.current.length > 0) onError(t.redactMarksLostWarning);
      if (pendingRegionRef.current) onError(t.editRegionLostWarning);
      if (pendingFieldRegionRef.current) onError(t.formFieldLostWarning);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Turns a released drag into an accumulated redaction mark.
  const onRedactRegion = useCallback((region: PageRegion) => {
    setMarks((prev) => [...prev, { id: nextMarkId++, ...region }]);
  }, []);
  useRegionDrag(containerRef, redacting, 'redact-mark', onRedactRegion);

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
      pageAnchor(pageEl as HTMLElement).appendChild(el);
      placed.push(el);
    }
    return () => {
      placed.forEach((el) => el.remove());
    };
  }, [marks]);

  // Same mechanism, single-shot: the released region opens the content
  // picker dialog immediately rather than accumulating into a list.
  const onEditRegionDone = useCallback((region: PageRegion) => {
    setPendingRegion(region);
  }, []);
  useRegionDrag(containerRef, editingRegion, 'editregion-mark', onEditRegionDone);

  // Form-field placement: drag the field's area, then collect its details.
  const onFieldRegionDone = useCallback((region: PageRegion) => {
    setPendingFieldRegion(region);
  }, []);
  useRegionDrag(containerRef, placingField, 'editregion-mark', onFieldRegionDone);

  // Visible-signature placement: the drag finishes the flow started in the
  // sign dialog (certificate + password are already validated and waiting).
  const onSignRegionDone = useCallback((region: PageRegion) => {
    setSignPlacing(false);
    const req = pendingSignReqRef.current;
    pendingSignReqRef.current = null;
    if (req) void doSignRef.current?.(req, region);
  }, []);
  useRegionDrag(containerRef, signPlacing, 'editregion-mark', onSignRegionDone);

  // Renders the pending region as an overlay while its content dialog is
  // open, so the user can still see exactly which spot they marked.
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !pendingRegion) return;
    const pageEl = container.querySelector(`.page[data-page-number="${pendingRegion.pageIndex + 1}"]`);
    if (!pageEl) return;
    const el = document.createElement('div');
    el.className = 'editregion-mark';
    Object.assign(el.style, {
      left: `${pendingRegion.xPct * 100}%`,
      top: `${pendingRegion.yPct * 100}%`,
      width: `${pendingRegion.wPct * 100}%`,
      height: `${pendingRegion.hPct * 100}%`,
    });
    pageAnchor(pageEl as HTMLElement).appendChild(el);
    return () => {
      el.remove();
    };
  }, [pendingRegion]);

  // Same for the pending form-field region while its dialog is open.
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !pendingFieldRegion) return;
    const pageEl = container.querySelector(`.page[data-page-number="${pendingFieldRegion.pageIndex + 1}"]`);
    if (!pageEl) return;
    const el = document.createElement('div');
    el.className = 'editregion-mark';
    Object.assign(el.style, {
      left: `${pendingFieldRegion.xPct * 100}%`,
      top: `${pendingFieldRegion.yPct * 100}%`,
      width: `${pendingFieldRegion.wPct * 100}%`,
      height: `${pendingFieldRegion.hPct * 100}%`,
    });
    pageAnchor(pageEl as HTMLElement).appendChild(el);
    return () => {
      el.remove();
    };
  }, [pendingFieldRegion]);

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

  // --- Text-tool fonts -----------------------------------------------------
  // pdf.js's FreeText editor has no font parameter — see freetextFont.ts for
  // how the chosen font is baked into the annotation's appearance at save
  // time. Here: per-editor bookkeeping + live CSS preview.

  const cssFontFamily = (choice: FreetextFontChoice): string => {
    if (choice.kind === 'standard') {
      if (choice.font.startsWith('times')) return '"Times New Roman", Times, serif';
      if (choice.font.startsWith('courier')) return '"Courier New", Courier, monospace';
      return 'Helvetica, Arial, sans-serif';
    }
    if (choice.kind === 'system') return `"pdfedit-sys-${choice.name}"`;
    return 'Helvetica, Arial, sans-serif';
  };

  /** Tags every FreeText editor in the DOM with the font it was created
   *  under (first sighting wins) and mirrors that font into its inline
   *  style for a truthful live preview. */
  const recordFreetextEditors = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    for (const el of container.querySelectorAll<HTMLElement>('.freeTextEditor')) {
      if (!el.id) continue;
      if (!freetextFontMapRef.current.has(el.id)) {
        freetextFontMapRef.current.set(el.id, fontChoiceRef.current);
      }
      const fam = cssFontFamily(freetextFontMapRef.current.get(el.id)!);
      el.style.fontFamily = fam;
      const internal = el.querySelector<HTMLElement>('.internal');
      if (internal) internal.style.fontFamily = fam;
    }
  }, []);

  const loadedFacesRef = useRef<Set<string>>(new Set());
  const ensureFontFace = async (choice: { name: string; path: string }) => {
    if (loadedFacesRef.current.has(choice.name)) return;
    let bytes = fontBytesCacheRef.current.get(choice.path);
    if (!bytes) {
      bytes = new Uint8Array(await api.readFont(choice.path));
      fontBytesCacheRef.current.set(choice.path, bytes);
    }
    const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const face = new FontFace(`pdfedit-sys-${choice.name}`, buf);
    await face.load();
    document.fonts.add(face);
    loadedFacesRef.current.add(choice.name);
  };

  const changeFont = async (key: string) => {
    let choice: FreetextFontChoice = { kind: 'default' };
    if (key === 'std:times') choice = { kind: 'standard', font: 'times' };
    else if (key === 'std:courier') choice = { kind: 'standard', font: 'courier' };
    else if (key.startsWith('sys:')) {
      const path = key.slice(4);
      const f = systemFonts?.find((x) => x.path === path);
      if (!f) return;
      choice = { kind: 'system', name: f.name, path };
    }
    if (choice.kind === 'system') {
      try {
        await ensureFontFace(choice);
      } catch (err) {
        onError(`${t.fontLoadError}: ${String(err)}`);
        return;
      }
    }
    setFontChoice(choice);
    fontChoiceRef.current = choice;
    const container = containerRef.current;
    container?.style.setProperty('--pdfedit-ft-font', cssFontFamily(choice));
    // a selected text box switches over immediately
    for (const el of container?.querySelectorAll<HTMLElement>('.freeTextEditor.selectedEditor') ?? []) {
      if (el.id) freetextFontMapRef.current.set(el.id, choice);
    }
    recordFreetextEditors();
  };

  // enumerate installed fonts once, on first demand (Text tool or the run
  // editor) — the promise is shared so the click handler can await it
  const systemFontsPromiseRef = useRef<Promise<SystemFont[]> | null>(null);
  const ensureSystemFonts = useCallback((): Promise<SystemFont[]> => {
    if (!isTauri) {
      setSystemFonts((v) => v ?? []);
      return Promise.resolve([]);
    }
    if (!systemFontsPromiseRef.current) {
      systemFontsPromiseRef.current = api.listSystemFonts().catch(() => [] as SystemFont[]);
      void systemFontsPromiseRef.current.then(setSystemFonts);
    }
    return systemFontsPromiseRef.current;
  }, []);
  useEffect(() => {
    if (tool === 'freetext' || editingText) void ensureSystemFonts();
  }, [tool, editingText, ensureSystemFonts]);

  // a fresh text box only exists after the pointer is released — tag it
  // with the active font right away so the live preview is truthful
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const onUp = () =>
      window.setTimeout(() => {
        recordFreetextEditors();
        setObjectsVersion((v) => v + 1);
      }, 60);
    container.addEventListener('pointerup', onUp, true);
    return () => container.removeEventListener('pointerup', onUp, true);
  }, [recordFreetextEditors, data]);

  /** saveDocument() + custom-font appearance pass — the single exit point
   *  every feature uses to get the current bytes. */
  const saveWithFonts = useCallback(async (): Promise<Uint8Array> => {
    const pdfViewer = pdfViewerRef.current;
    if (!pdfViewer?.pdfDocument) throw new Error('no document');
    recordFreetextEditors();
    const bytes = await pdfViewer.pdfDocument.saveDocument();
    const map = freetextFontMapRef.current;
    if (![...map.values()].some((c) => c.kind !== 'default')) return bytes;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ser = (pdfViewer.pdfDocument.annotationStorage as any)?.serializable;
    const entries: [string, Record<string, unknown>][] = ser?.map ? [...ser.map.entries()] : [];
    const apps: FontApplication[] = [];
    for (const [id, v] of entries) {
      if ((v as { annotationType?: number })?.annotationType !== 3 /* FREETEXT */) continue;
      const choice = map.get(id) ?? ({ kind: 'default' } as FreetextFontChoice);
      if (choice.kind === 'default') continue;
      let fontBytes: Uint8Array | null = null;
      if (choice.kind === 'system') {
        fontBytes = fontBytesCacheRef.current.get(choice.path) ?? null;
        if (!fontBytes) {
          try {
            fontBytes = new Uint8Array(await api.readFont(choice.path));
            fontBytesCacheRef.current.set(choice.path, fontBytes);
          } catch {
            continue; // font vanished — the annotation keeps Helvetica
          }
        }
      }
      const val = v as {
        pageIndex: number;
        rect: [number, number, number, number];
        value: string;
        fontSize: number;
        color?: number[];
      };
      const entry: FreetextEntry = {
        pageIndex: val.pageIndex,
        rect: val.rect,
        value: val.value,
        fontSize: val.fontSize,
        color: [val.color?.[0] ?? 0, val.color?.[1] ?? 0, val.color?.[2] ?? 0],
      };
      apps.push({ entry, choice, fontBytes });
    }
    if (apps.length === 0) return bytes;
    try {
      return await applyFreetextFonts(bytes, apps);
    } catch (err) {
      onError(`${t.fontLoadError}: ${String(err)}`);
      return bytes;
    }
  }, [recordFreetextEditors, onError]);

  const doCheckpoint = useCallback(async (): Promise<Uint8Array | null> => {
    const pdfViewer = pdfViewerRef.current;
    if (!pdfViewer?.pdfDocument) return null;
    try {
      // Commit BEFORE checking dirty: a just-drawn, not-yet-committed stroke
      // can still be the only reason this doc is dirty at all.
      await commitPendingEdits();
      if (!dirtyRef.current) return null;
      return await saveWithFonts();
    } catch (err) {
      // best-effort — losing the in-memory checkpoint beats crashing the tab
      // switch, but surface it: the user's edits since the last real Save
      // are about to become unrecoverable once this tab unmounts.
      onError(`${t.saveError}: ${String(err)}`);
      return null;
    }
  }, [onError, commitPendingEdits, saveWithFonts]);

  useImperativeHandle(ref, () => ({ checkpoint: doCheckpoint }), [doCheckpoint]);

  // The drag-capture modes (redact, region edit, field placement, signature
  // placement) all grab pointer events on the pages — only ever one at a time.
  const resetDragModes = () => {
    setRedacting(false);
    setEditingRegion(false);
    setPlacingField(false);
    setSignPlacing(false);
    setEditingText(false);
    pendingSignReqRef.current = null;
  };

  const selectTool = (next: Tool) => {
    setTool(next);
    resetDragModes();
    const pdfViewer = pdfViewerRef.current;
    if (pdfViewer) pdfViewer.annotationEditorMode = { mode: TOOL_MODE[next] };
    // switching to Select must really let go: deselect any editor so its
    // floating toolbar/handles disappear and no tool keeps drawing
    if (next === 'select') uiManager()?.unselectAll();
  };

  const enterDragMode = (wasActive: boolean, set: (v: boolean) => void) => {
    const pdfViewer = pdfViewerRef.current;
    if (pdfViewer) pdfViewer.annotationEditorMode = { mode: AnnotationEditorType.NONE };
    setTool('select');
    resetDragModes();
    if (!wasActive) set(true);
  };

  const toggleRedact = () => enterDragMode(redacting, setRedacting);
  const toggleEditRegion = () => enterDragMode(editingRegion, setEditingRegion);
  const togglePlaceField = () => enterDragMode(placingField, setPlacingField);
  const toggleTextEdit = () => enterDragMode(editingText, setEditingText);

  /** pdf.js's AnnotationEditorUIManager — not part of PDFViewer's public
   *  d.ts (reached via `_layerProperties`, the same stability class as the
   *  `_pages` access above), hence the cast. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const uiManager = (): any =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (pdfViewerRef.current as any)?._layerProperties?.annotationEditorUIManager;

  /** Pushes a tool default (color, size, …) into pdf.js's editor UI
   *  manager — applies to the current selection or, without one, becomes
   *  the default for the next created annotation. */
  const updateEditorParam = (type: number, value: unknown) => {
    uiManager()?.updateParams(type, value);
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
      const bytes = await saveWithFonts();
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
      const bytes = await saveWithFonts();
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
      const bytes = await saveWithFonts();
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

  const doRedact = async (cleanMetadata: boolean, style: RedactStyle) => {
    const pdfViewer = pdfViewerRef.current;
    if (!pdfViewer?.pdfDocument || marks.length === 0) return;
    setRedactBusy(true);
    try {
      await commitPendingEdits();
      const bytes = await saveWithFonts();
      const marksByPage = new Map<number, RedactMark[]>();
      for (const mark of marks) {
        const list = marksByPage.get(mark.pageIndex) ?? [];
        list.push(mark);
        marksByPage.set(mark.pageIndex, list);
      }
      const { bytes: redacted } = await redactPdf(bytes, marksByPage, { cleanMetadata, style });
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

  const doApplyRegionEdit = async (content: EditContent) => {
    const pdfViewer = pdfViewerRef.current;
    if (!pdfViewer?.pdfDocument || !pendingRegion) return;
    setRegionEditBusy(true);
    try {
      await commitPendingEdits();
      const bytes = await saveWithFonts();
      const edited = await applyRegionEdit(bytes, pendingRegion, content);
      setPendingRegion(null);
      setEditingRegion(false);
      dirtyRef.current = true;
      onDirtyChange(true);
      onReplace(edited);
    } catch (err) {
      onError(`${t.editRegionError}: ${String(err)}`);
    } finally {
      setRegionEditBusy(false);
    }
  };

  const doOcr = async (scope: OcrScope, langs: OcrLang[]) => {
    const pdfViewer = pdfViewerRef.current;
    if (!pdfViewer?.pdfDocument || langs.length === 0) return;
    setOcrResult(null);
    try {
      await commitPendingEdits();
      const bytes = await saveWithFonts();
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

  // Pre-compute the next free field name while the user is still dragging,
  // so the dialog opens with it already filled in.
  useEffect(() => {
    if (!placingField) return;
    let cancelled = false;
    suggestFieldName(data, t.formFieldNameBase).then((n) => {
      if (!cancelled) setSuggestedFieldName(n);
    });
    return () => {
      cancelled = true;
    };
  }, [placingField, data]);

  const doAddField = async (spec: FieldSpec) => {
    const pdfViewer = pdfViewerRef.current;
    const region = pendingFieldRegion;
    if (!pdfViewer?.pdfDocument || !region) return;
    setFieldBusy(true);
    try {
      await commitPendingEdits();
      const bytes = await saveWithFonts();
      const withField = await addFormField(bytes, region, spec);
      setPendingFieldRegion(null);
      setPlacingField(false);
      dirtyRef.current = true;
      onDirtyChange(true);
      onReplace(withField);
    } catch (err) {
      if (err instanceof FieldNameTakenError) {
        onError(t.formFieldNameTaken); // dialog stays open for a rename
      } else {
        onError(`${t.formFieldError}: ${String(err)}`);
      }
    } finally {
      setFieldBusy(false);
    }
  };

  const doSign = async (req: SignRequest, region: SignRegion | null) => {
    const pdfViewer = pdfViewerRef.current;
    if (!pdfViewer?.pdfDocument) return;
    setSignBusy(true);
    try {
      await commitPendingEdits();
      const bytes = await saveWithFonts();
      const signed = await signPdf(bytes, {
        p12Bytes: req.p12Bytes,
        p12Password: req.p12Password,
        reason: req.reason,
        region,
      });
      setShowSign(false);
      // Write the signed bytes to disk EXACTLY as produced — any later
      // rewrite (even a no-op resave) would append to or restructure the
      // file and show up as "modified after signing" in validators.
      dirtyRef.current = false;
      onDirtyChange(false);
      onReplace(signed);
      onSave(signed);
      onNotice(t.signDone);
    } catch (err) {
      onError(`${t.signError}: ${String(err)}`);
    } finally {
      setSignBusy(false);
    }
  };
  doSignRef.current = doSign;

  const onSignRequest = (req: SignRequest) => {
    if (protection) {
      // encrypting rewrites the whole file and would break the signature
      onError(t.signProtectedConflict);
      return;
    }
    if (req.visible) {
      pendingSignReqRef.current = req;
      setShowSign(false);
      setSignPlacing(true);
    } else {
      void doSign(req, null);
    }
  };

  const doApplyProtection = async (next: Protection) => {
    const pdfViewer = pdfViewerRef.current;
    if (!pdfViewer?.pdfDocument) return;
    setProtectBusy(true);
    try {
      await commitPendingEdits();
      const bytes = await saveWithFonts();
      onProtectionChange(next);
      onSave(bytes, next);
      setShowProtect(false);
      onNotice(t.protectApplied);
    } catch (err) {
      onError(`${t.protectError}: ${String(err)}`);
    } finally {
      setProtectBusy(false);
    }
  };

  const doRemoveProtection = async () => {
    const pdfViewer = pdfViewerRef.current;
    if (!pdfViewer?.pdfDocument) return;
    setProtectBusy(true);
    try {
      await commitPendingEdits();
      const bytes = await saveWithFonts();
      onProtectionChange(null);
      onSave(bytes, null);
      setShowProtect(false);
      onNotice(t.protectRemoved);
    } catch (err) {
      onError(`${t.protectError}: ${String(err)}`);
    } finally {
      setProtectBusy(false);
    }
  };

  // In-place text editing: with the mode active, a click on the page is
  // resolved through pdf.js's getTextContent — exact baselines, widths,
  // sizes and the ORIGINAL font per text run. The clicked run (a stretch
  // of uniform formatting) opens the dialog with its text, true point
  // size, sampled text color and the matched replacement font preselected.
  useEffect(() => {
    const container = containerRef.current;
    if (!editingText || !container) return;
    container.classList.add('textediting');

    const handleClick = async (e: MouseEvent) => {
      const pageEl = (e.target as HTMLElement).closest?.('.page') as HTMLElement | null;
      const pdfViewer = pdfViewerRef.current;
      if (!pageEl || !pdfViewer?.pdfDocument) return;
      const pageIndex = Number(pageEl.dataset.pageNumber) - 1;
      const canvas = pageEl.querySelector('canvas');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const viewport = (pdfViewer as any)._pages?.[pageIndex]?.viewport;
      if (!canvas || !viewport) return;
      const canvasRect = canvas.getBoundingClientRect();
      if (canvasRect.width === 0) return;

      // click → PDF points (viewport css px scale can differ from rect px)
      const vs = viewport.width / canvasRect.width;
      const pdfPoint = viewport.convertToPdfPoint(
        (e.clientX - canvasRect.left) * vs,
        (e.clientY - canvasRect.top) * vs
      );
      const px = pdfPoint[0];
      const py = pdfPoint[1];

      const fontsPromise = ensureSystemFonts();
      const page = await pdfViewer.pdfDocument.getPage(pageIndex + 1);
      const tc = await page.getTextContent();
      // defensive: some WebKit paths surfaced getTextContent results whose
      // items weren't iterable — fail with a clear message, and iterate by
      // index so nothing here depends on the iterator protocol
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rawItems: any[] = Array.isArray((tc as any)?.items) ? (tc as any).items : [];
      if (rawItems.length === 0) {
        onError(t.textEditNoText);
        return;
      }

      interface It {
        str: string;
        fontName: string;
        tx: number;
        ty: number;
        w: number;
        size: number;
      }
      const its: It[] = [];
      for (let idx = 0; idx < rawItems.length; idx++) {
        const item = rawItems[idx];
        if (!item?.str || !item.width || !item.transform) continue;
        const size =
          Math.hypot(item.transform[2], item.transform[3]) || Math.abs(item.transform[3]) || 10;
        its.push({
          str: item.str,
          fontName: item.fontName,
          tx: item.transform[4],
          ty: item.transform[5],
          w: item.width,
          size,
        });
      }

      let hit = its.find(
        (i) =>
          px >= i.tx - 1 &&
          px <= i.tx + i.w + 1 &&
          py >= i.ty - i.size * 0.35 &&
          py <= i.ty + i.size * 0.95
      );
      if (!hit) {
        hit = its
          .filter((i) => Math.abs(i.ty - py) < i.size)
          .sort(
            (a, b) => Math.abs(a.tx + a.w / 2 - px) - Math.abs(b.tx + b.w / 2 - px)
          )[0];
      }
      if (!hit) {
        onError(t.textEditNoText);
        return;
      }

      // the line = same baseline; merge adjacent same-font items into runs
      const line = its
        .filter((i) => Math.abs(i.ty - hit!.ty) < 2)
        .sort((a, b) => a.tx - b.tx);
      interface Run {
        items: It[];
        fontName: string;
        x0: number;
        x1: number;
      }
      const runs: Run[] = [];
      for (let li = 0; li < line.length; li++) {
        const it = line[li];
        const last = runs[runs.length - 1];
        if (last && last.fontName === it.fontName && it.tx - last.x1 < hit.size * 0.6) {
          last.items.push(it);
          last.x1 = Math.max(last.x1, it.tx + it.w);
        } else {
          runs.push({ items: [it], fontName: it.fontName, x0: it.tx, x1: it.tx + it.w });
        }
      }
      const run =
        runs.find((r) => px >= r.x0 - 1 && px <= r.x1 + 1) ??
        runs.reduce((a, b) =>
          Math.abs((a.x0 + a.x1) / 2 - px) < Math.abs((b.x0 + b.x1) / 2 - px) ? a : b
        );
      const text = run.items.map((i) => i.str).join('');
      if (!text.trim()) {
        onError(t.textEditNoText);
        return;
      }

      // original font: PostScript name via commonObjs, metrics via styles
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const style = (tc as any).styles?.[run.fontName];
      let psName = '';
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const fontObj = (page as any).commonObjs.get(run.fontName);
        psName = fontObj?.name ?? '';
      } catch {
        // font not resolved yet — matching falls back to the css class
      }
      const detected = parsePdfFontName(psName, style?.fontFamily ?? 'sans-serif');
      const systemFontsNow = await fontsPromise;
      const match = matchFont(detected, systemFontsNow);
      if (!match.label && match.choice.kind === 'standard') {
        match.label = t.stdFontLabel(match.choice.font);
      }

      const sizePt = Math.round(run.items[0].size * 100) / 100;
      const ascent = style?.ascent && style.ascent > 0 ? style.ascent : 0.9;
      const descent = style?.descent && style.descent < 0 ? style.descent : -0.22;
      const baseline = hit.ty;

      // sample text color (darkest pixel) and background (majority shade)
      // from the rendered canvas inside the run box
      let colorHex = '#000000';
      let bg: [number, number, number] = [255, 255, 255];
      const cctx = canvas.getContext('2d', { willReadFrequently: true });
      if (cctx) {
        const toCanvas = (pdfX: number, pdfY: number): [number, number] => {
          const vp = viewport.convertToViewportPoint(pdfX, pdfY);
          const vx = vp[0];
          const vy = vp[1];
          return [
            Math.min(canvas.width - 1, Math.max(0, Math.round((vx / viewport.width) * canvas.width))),
            Math.min(canvas.height - 1, Math.max(0, Math.round((vy / viewport.height) * canvas.height))),
          ];
        };
        const c0 = toCanvas(run.x0, baseline + ascent * sizePt);
        const c1 = toCanvas(run.x1, baseline + descent * sizePt);
        const cx0 = c0[0];
        const cy0 = c0[1];
        const cx1 = c1[0];
        const cy1 = c1[1];
        const xLo = Math.min(cx0, cx1);
        const xHi = Math.max(cx0, cx1);
        const yLo = Math.min(cy0, cy1);
        const yHi = Math.max(cy0, cy1);
        if (xHi > xLo && yHi > yLo) {
          const img = cctx.getImageData(xLo, yLo, xHi - xLo, yHi - yLo).data;
          let darkest = 765;
          let darkestRgb: [number, number, number] = [0, 0, 0];
          const counts = new Map<string, { n: number; rgb: [number, number, number] }>();
          const stepX = Math.max(1, Math.floor((xHi - xLo) / 48));
          const stepY = Math.max(1, Math.floor((yHi - yLo) / 16));
          for (let y = 0; y < yHi - yLo; y += stepY) {
            for (let x = 0; x < xHi - xLo; x += stepX) {
              const o = (y * (xHi - xLo) + x) * 4;
              const r = img[o];
              const g = img[o + 1];
              const b = img[o + 2];
              const lum = r + g + b;
              if (lum < darkest) {
                darkest = lum;
                darkestRgb = [r, g, b];
              }
              const key = `${r >> 4},${g >> 4},${b >> 4}`;
              const c = counts.get(key);
              if (c) c.n++;
              else counts.set(key, { n: 1, rgb: [r, g, b] });
            }
          }
          let best = 0;
          counts.forEach((c) => {
            if (c.n > best) {
              best = c.n;
              bg = c.rgb;
            }
          });
          const hx = (n: number) => n.toString(16).padStart(2, '0');
          colorHex = `#${hx(darkestRgb[0])}${hx(darkestRgb[1])}${hx(darkestRgb[2])}`;
        }
      }

      // marker box in viewport px for the overlay
      const ov0 = viewport.convertToViewportPoint(run.x0, baseline + ascent * sizePt);
      const ov1 = viewport.convertToViewportPoint(run.x1, baseline + descent * sizePt);
      const ovx0 = ov0[0];
      const ovy0 = ov0[1];
      const ovx1 = ov1[0];
      const ovy1 = ov1[1];

      setPendingRunEdit({
        pageIndex,
        x: run.x0,
        baseline,
        width: run.x1 - run.x0,
        sizePt,
        ascent,
        descent,
        text,
        colorHex,
        bg,
        detectedLabel: detected.psName || null,
        match,
        overlay: {
          left: Math.min(ovx0, ovx1),
          top: Math.min(ovy0, ovy1),
          width: Math.abs(ovx1 - ovx0),
          height: Math.abs(ovy1 - ovy0),
        },
      });
      setEditingText(false);
    };

    const onClick = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      void handleClick(e).catch((err) => {
        // WebKit stacks carry no message line — prepend String(err) so the
        // toast names the error AND the top stack frame
        const top = String((err as Error)?.stack ?? '')
          .split('\n')
          .slice(0, 1)
          .join(' ');
        onError(`${t.textEditError}: ${String(err)} ${top}`.slice(0, 260));
      });
    };

    container.addEventListener('click', onClick, true);
    return () => {
      container.classList.remove('textediting');
      container.removeEventListener('click', onClick, true);
    };
  }, [editingText, onError, ensureSystemFonts]);

  // keep the picked run visible while its dialog is open
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !pendingRunEdit) return;
    const pageEl = container.querySelector(`.page[data-page-number="${pendingRunEdit.pageIndex + 1}"]`);
    if (!pageEl) return;
    const el = document.createElement('div');
    el.className = 'editregion-mark';
    Object.assign(el.style, {
      left: `${pendingRunEdit.overlay.left - 2}px`,
      top: `${pendingRunEdit.overlay.top - 2}px`,
      width: `${pendingRunEdit.overlay.width + 4}px`,
      height: `${pendingRunEdit.overlay.height + 4}px`,
    });
    pageAnchor(pageEl as HTMLElement).appendChild(el);
    return () => el.remove();
  }, [pendingRunEdit]);

  const previewFontFamily = async (choice: FreetextFontChoice): Promise<string> => {
    if (choice.kind === 'system') await ensureFontFace(choice);
    return cssFontFamily(choice);
  };

  const doApplyRunEdit = async (spec: TextEditSpec) => {
    const pdfViewer = pdfViewerRef.current;
    const pending = pendingRunEdit;
    if (!pdfViewer?.pdfDocument || !pending) return;
    setLineEditBusy(true);
    try {
      await commitPendingEdits();
      const bytes = await saveWithFonts();
      let fontBytes: Uint8Array | null = null;
      if (spec.choice.kind === 'system') {
        fontBytes = fontBytesCacheRef.current.get(spec.choice.path) ?? null;
        if (!fontBytes) {
          fontBytes = new Uint8Array(await api.readFont(spec.choice.path));
          fontBytesCacheRef.current.set(spec.choice.path, fontBytes);
        }
      }
      const hex = spec.colorHex.replace('#', '');
      const color: [number, number, number] = [
        parseInt(hex.slice(0, 2), 16) || 0,
        parseInt(hex.slice(2, 4), 16) || 0,
        parseInt(hex.slice(4, 6), 16) || 0,
      ];
      const edited = await applyRunEdit(bytes, {
        pageIndex: pending.pageIndex,
        x: pending.x,
        baseline: pending.baseline,
        width: pending.width,
        sizePt: spec.sizePt,
        ascent: pending.ascent,
        descent: pending.descent,
        newText: spec.newText,
        color,
        bg: pending.bg,
        choice: spec.choice,
        fontBytes,
      });
      setPendingRunEdit(null);
      dirtyRef.current = true;
      onDirtyChange(true);
      onReplace(edited);
    } catch (err) {
      onError(`${t.textEditError}: ${String(err)}`);
    } finally {
      setLineEditBusy(false);
    }
  };

  // Sidebar drag & drop — one page moves, everything else stays untouched
  // (see pages.ts for why this is safe for form fields).
  const doMovePage = async (from: number, to: number) => {
    const pdfViewer = pdfViewerRef.current;
    if (!pdfViewer?.pdfDocument) return;
    try {
      await commitPendingEdits();
      const bytes = await saveWithFonts();
      const moved = await movePage(bytes, from, to);
      dirtyRef.current = true;
      onDirtyChange(true);
      onReplace(moved);
    } catch (err) {
      onError(`${t.pageMoveError}: ${String(err)}`);
    }
  };

  // ---- objects panel ------------------------------------------------------
  // Session annotations from pdf.js's editor registry; refreshed whenever
  // the editor state changes (create/edit/delete/undo).
  useEffect(() => {
    if (!ready) {
      setAnnotObjects([]);
      return;
    }
    const ui = uiManager();
    const pdfViewer = pdfViewerRef.current;
    if (!ui || !pdfViewer) return;
    const list: AnnotObject[] = [];
    for (let p = 0; p < pdfViewer.pagesCount; p++) {
      try {
        for (const e of ui.getEditors(p)) {
          if (typeof e.isEmpty === 'function' && e.isEmpty()) continue;
          const type: string = e.constructor?._type ?? 'annotation';
          const text = (e.div?.textContent ?? '').replace(/\s+/g, ' ').trim();
          list.push({
            id: e.id,
            type,
            label: text.slice(0, 40) || (t.objTypeLabels[type] ?? type),
            pageIndex: e.pageIndex ?? p,
          });
        }
      } catch {
        // page's editor layer not built yet — it will bump the version later
      }
    }
    setAnnotObjects(list);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [objectsVersion, ready]);

  // Document form fields (they only change when the working bytes change)
  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    void listFormFields(data).then((f) => {
      if (!cancelled) setFieldList(f);
    });
    return () => {
      cancelled = true;
    };
  }, [data, ready]);

  const findEditor = (id: string) => {
    const ui = uiManager();
    const pdfViewer = pdfViewerRef.current;
    if (!ui || !pdfViewer) return null;
    for (let p = 0; p < pdfViewer.pagesCount; p++) {
      try {
        for (const e of ui.getEditors(p)) if (e.id === id) return e;
      } catch {
        // ignore unbuilt pages
      }
    }
    return null;
  };

  const selectObject = (id: string) => {
    const e = findEditor(id);
    const pdfViewer = pdfViewerRef.current;
    if (!e || !pdfViewer) return;
    resetDragModes();
    jumpToPage((e.pageIndex ?? 0) + 1);
    // interacting with an editor needs its layer in the matching mode —
    // the switch is async inside pdf.js, so select after a beat
    const toolFor: Record<string, Tool> = { freetext: 'freetext', ink: 'ink', highlight: 'highlight' };
    const type: string = e.constructor?._type ?? '';
    setTool(toolFor[type] ?? 'select');
    pdfViewer.annotationEditorMode = { mode: e.mode };
    window.setTimeout(() => uiManager()?.setSelected(e), 150);
  };

  const deleteObject = (id: string) => {
    const e = findEditor(id);
    const pdfViewer = pdfViewerRef.current;
    const ui = uiManager();
    if (!e || !pdfViewer || !ui) return;
    pdfViewer.annotationEditorMode = { mode: e.mode };
    window.setTimeout(() => {
      ui.setSelected(e);
      ui.delete();
      setObjectsVersion((v) => v + 1);
      // pdf.js detaches the editor asynchronously — refresh once more
      window.setTimeout(() => setObjectsVersion((v) => v + 1), 300);
    }, 150);
  };

  const doDeleteField = async (name: string) => {
    const pdfViewer = pdfViewerRef.current;
    if (!pdfViewer?.pdfDocument) return;
    try {
      await commitPendingEdits();
      const bytes = await saveWithFonts();
      const out = await removeFormField(bytes, name);
      dirtyRef.current = true;
      onDirtyChange(true);
      onReplace(out);
    } catch (err) {
      onError(`${t.formFieldError}: ${String(err)}`);
    }
  };

  const doEditFieldApply = async (spec: FieldSpec) => {
    const pdfViewer = pdfViewerRef.current;
    const field = editingField;
    if (!pdfViewer?.pdfDocument || !field?.region) return;
    setFieldBusy(true);
    try {
      await commitPendingEdits();
      const bytes = await saveWithFonts();
      const out = await updateFormField(bytes, field.name, field.region, spec);
      setEditingField(null);
      dirtyRef.current = true;
      onDirtyChange(true);
      onReplace(out);
    } catch (err) {
      if (err instanceof FieldNameTakenError) onError(t.formFieldNameTaken);
      else onError(`${t.formFieldError}: ${String(err)}`);
    } finally {
      setFieldBusy(false);
    }
  };

  const openWatermark = async () => {
    setWmReport(null);
    setShowWatermark(true);
    const pdfViewer = pdfViewerRef.current;
    if (!pdfViewer?.pdfDocument) return;
    try {
      await commitPendingEdits();
      const bytes = await saveWithFonts();
      setWmReport(await readWatermarks(bytes));
    } catch (err) {
      onError(`${t.wmError}: ${String(err)}`);
    }
  };

  const doApplyWatermark = async (pngBytes: Uint8Array, scope: 'all' | 'current') => {
    const pdfViewer = pdfViewerRef.current;
    if (!pdfViewer?.pdfDocument) return;
    setWmBusy(true);
    try {
      await commitPendingEdits();
      const bytes = await saveWithFonts();
      const marked = await applyWatermark(
        bytes,
        pngBytes,
        scope === 'all' ? 'all' : [pdfViewer.currentPageNumber - 1]
      );
      setShowWatermark(false);
      dirtyRef.current = true;
      onDirtyChange(true);
      onReplace(marked);
      onNotice(t.wmApplied);
    } catch (err) {
      onError(`${t.wmError}: ${String(err)}`);
    } finally {
      setWmBusy(false);
    }
  };

  const doVerifyWatermarkPng = async (pngBytes: Uint8Array) => {
    if (!wmReport) return [];
    return verifyAgainstPng(wmReport, pngBytes);
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
          <button
            className={editingText ? 'iconbtn active' : 'iconbtn'}
            onClick={toggleTextEdit}
            disabled={!ready}
            title={t.textEditHint}
          >
            <IconTextEdit size={16} />
            {t.textEditButton}
          </button>
          <button
            className={editingRegion ? 'iconbtn active' : 'iconbtn'}
            onClick={toggleEditRegion}
            disabled={!ready}
            title={t.editRegionHint}
          >
            <IconEditRegion size={16} />
            {t.editRegionButton}
          </button>
        </div>

        <div className="tooldivider" />

        <div className="toolgroup">
          <button
            className={placingField ? 'iconbtn active' : 'iconbtn'}
            onClick={togglePlaceField}
            disabled={!ready}
            title={t.formFieldHint}
          >
            <IconFormField size={16} />
            {t.formFieldButton}
          </button>
          <button
            className="iconbtn"
            onClick={() => setShowSign(true)}
            disabled={!ready || signBusy}
            title={t.signTitle}
          >
            <IconSign size={16} />
            {signBusy ? t.signSigning : t.signButton}
          </button>
          <button
            className="iconbtn"
            onClick={() => setShowProtect(true)}
            disabled={!ready}
            title={t.protectTitle}
          >
            <IconLock size={16} />
            {t.protectButton}
          </button>
          <button
            className="iconbtn"
            onClick={() => void openWatermark()}
            disabled={!ready}
            title={t.wmTitle}
          >
            <IconDroplet size={16} />
            {t.wmButton}
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

      {(tool === 'highlight' || tool === 'freetext' || tool === 'ink') && (
        <div className="propsbar">
          <span className="proplabel">{t.propColor}</span>
          {(tool === 'highlight' ? HIGHLIGHT_COLORS : PEN_COLORS).map((c) => {
            const current =
              tool === 'highlight' ? highlightColor : tool === 'freetext' ? freetextColor : inkColor;
            return (
              <button
                key={c}
                className={current === c ? 'swatch active' : 'swatch'}
                style={{ background: c }}
                aria-label={`${t.propColor} ${c}`}
                onClick={() => {
                  if (tool === 'highlight') {
                    setHighlightColor(c);
                    updateEditorParam(AnnotationEditorParamsType.HIGHLIGHT_COLOR, c);
                  } else if (tool === 'freetext') {
                    setFreetextColor(c);
                    updateEditorParam(AnnotationEditorParamsType.FREETEXT_COLOR, c);
                  } else {
                    setInkColor(c);
                    updateEditorParam(AnnotationEditorParamsType.INK_COLOR, c);
                  }
                }}
              />
            );
          })}
          <input
            type="color"
            className="colorwell"
            value={tool === 'highlight' ? highlightColor : tool === 'freetext' ? freetextColor : inkColor}
            title={t.propColor}
            onChange={(e) => {
              const c = e.target.value;
              if (tool === 'highlight') {
                setHighlightColor(c);
                updateEditorParam(AnnotationEditorParamsType.HIGHLIGHT_COLOR, c);
              } else if (tool === 'freetext') {
                setFreetextColor(c);
                updateEditorParam(AnnotationEditorParamsType.FREETEXT_COLOR, c);
              } else {
                setInkColor(c);
                updateEditorParam(AnnotationEditorParamsType.INK_COLOR, c);
              }
            }}
          />
          {tool === 'freetext' && (
            <>
              <span className="proplabel">{t.propFont}</span>
              <select
                className="fontselect"
                value={
                  fontChoice.kind === 'default'
                    ? 'default'
                    : fontChoice.kind === 'standard'
                      ? `std:${fontChoice.font}`
                      : `sys:${fontChoice.path}`
                }
                onChange={(e) => void changeFont(e.target.value)}
              >
                <option value="default">{t.fontDefault}</option>
                <option value="std:times">{t.fontTimes}</option>
                <option value="std:courier">{t.fontCourier}</option>
                {isTauri && systemFonts === null && <option disabled>{t.fontsLoading}</option>}
                {systemFonts && systemFonts.length > 0 && (
                  <optgroup label={t.fontSystemGroup}>
                    {systemFonts.map((f) => (
                      <option key={f.path} value={`sys:${f.path}`}>
                        {f.name}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
              <span className="proplabel">{t.propSize}</span>
              <input
                type="range"
                min={8}
                max={48}
                value={freetextSize}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setFreetextSize(v);
                  updateEditorParam(AnnotationEditorParamsType.FREETEXT_SIZE, v);
                }}
              />
              <span className="propvalue">{freetextSize}</span>
            </>
          )}
          {tool === 'ink' && (
            <>
              <span className="proplabel">{t.propThickness}</span>
              <input
                type="range"
                min={1}
                max={20}
                value={inkThickness}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setInkThickness(v);
                  updateEditorParam(AnnotationEditorParamsType.INK_THICKNESS, v);
                }}
              />
              <span className="propvalue">{inkThickness}</span>
              <span className="proplabel">{t.propOpacity}</span>
              <input
                type="range"
                min={10}
                max={100}
                value={inkOpacity}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setInkOpacity(v);
                  // pdf.js v6 expects stroke opacity on a 0–1 scale
                  updateEditorParam(AnnotationEditorParamsType.INK_OPACITY, v / 100);
                }}
              />
              <span className="propvalue">{inkOpacity}%</span>
            </>
          )}
          {tool === 'highlight' && (
            <>
              <span className="proplabel" title={t.propThicknessFreeHint}>
                {t.propThickness}
              </span>
              <input
                type="range"
                min={8}
                max={24}
                value={highlightThickness}
                title={t.propThicknessFreeHint}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setHighlightThickness(v);
                  updateEditorParam(AnnotationEditorParamsType.HIGHLIGHT_THICKNESS, v);
                }}
              />
              <span className="propvalue">{highlightThickness}</span>
            </>
          )}
        </div>
      )}

      {placingField && !pendingFieldRegion && (
        <div className="redactbar">
          <span className="faint">{t.formFieldHint}</span>
        </div>
      )}

      {editingText && (
        <div className="redactbar">
          <span className="faint">{t.textEditHint}</span>
        </div>
      )}

      {signPlacing && (
        <div className="redactbar">
          <span className="faint">{t.signPlaceHint}</span>
        </div>
      )}

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
            onMove={doMovePage}
            objects={annotObjects}
            fields={fieldList}
            onSelectObject={selectObject}
            onDeleteObject={deleteObject}
            onEditField={setEditingField}
            onDeleteField={(name) => void doDeleteField(name)}
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

      {pendingRegion && (
        <EditRegionDialog
          busy={regionEditBusy}
          onApply={doApplyRegionEdit}
          onCancel={() => setPendingRegion(null)}
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

      {pendingFieldRegion && (
        <FormFieldDialog
          suggestedName={suggestedFieldName}
          busy={fieldBusy}
          onCreate={doAddField}
          onCancel={() => setPendingFieldRegion(null)}
        />
      )}

      {editingField && (
        <FormFieldDialog
          suggestedName={editingField.name}
          initial={{
            kind: editingField.kind,
            name: editingField.name,
            options: editingField.options,
            defaultValue: editingField.defaultValue,
          }}
          busy={fieldBusy}
          onCreate={doEditFieldApply}
          onCancel={() => setEditingField(null)}
        />
      )}

      {showSign && (
        <SignDialog busy={signBusy} onSign={onSignRequest} onCancel={() => setShowSign(false)} />
      )}

      {showProtect && (
        <ProtectDialog
          protection={protection}
          inherited={protectionInherited}
          busy={protectBusy}
          onApply={doApplyProtection}
          onRemove={doRemoveProtection}
          onCancel={() => setShowProtect(false)}
        />
      )}

      {pendingRunEdit && (
        <TextEditDialog
          initialText={pendingRunEdit.text}
          initialSizePt={pendingRunEdit.sizePt}
          initialColorHex={pendingRunEdit.colorHex}
          detectedLabel={pendingRunEdit.detectedLabel}
          match={pendingRunEdit.match}
          systemFonts={systemFonts}
          busy={lineEditBusy}
          onPreviewFont={previewFontFamily}
          onApply={doApplyRunEdit}
          onCancel={() => setPendingRunEdit(null)}
        />
      )}

      {showWatermark && (
        <WatermarkDialog
          currentPage={pageInfo.current}
          totalPages={pageInfo.total}
          busy={wmBusy}
          report={wmReport}
          onApply={doApplyWatermark}
          onVerifyPng={doVerifyWatermarkPng}
          onClose={() => setShowWatermark(false)}
        />
      )}
    </div>
  );
});

export default PdfViewer;
