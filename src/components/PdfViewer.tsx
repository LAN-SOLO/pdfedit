import { useEffect, useRef, useState } from 'react';
import * as pdfjs from 'pdfjs-dist';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { t } from '../i18n';

// Same-origin worker; if the platform webview rejects module workers,
// pdf.js falls back to running on the main thread automatically.
pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

interface PageViewProps {
  doc: PDFDocumentProxy;
  pageNumber: number;
  scale: number;
}

/** One PDF page: renders lazily once scrolled near the viewport, and
 *  re-renders when the zoom level changes. */
function PageView({ doc, pageNumber, scale }: PageViewProps) {
  const holderRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = useState(false);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);

  useEffect(() => {
    let alive = true;
    doc.getPage(pageNumber).then((page) => {
      const vp = page.getViewport({ scale });
      if (alive) setSize({ w: vp.width, h: vp.height });
    });
    return () => {
      alive = false;
    };
  }, [doc, pageNumber, scale]);

  useEffect(() => {
    const el = holderRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), {
      rootMargin: '800px 0px',
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    let task: { cancel: () => void } | null = null;
    doc.getPage(pageNumber).then((page) => {
      if (cancelled || !canvasRef.current) return;
      const vp = page.getViewport({ scale });
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const canvas = canvasRef.current;
      canvas.width = Math.floor(vp.width * dpr);
      canvas.height = Math.floor(vp.height * dpr);
      canvas.style.width = `${vp.width}px`;
      canvas.style.height = `${vp.height}px`;
      const render = page.render({
        canvas,
        viewport: vp,
        transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
      });
      task = render;
      render.promise.catch(() => {
        /* cancelled mid-scroll — fine */
      });
    });
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [doc, pageNumber, scale, visible]);

  return (
    <div
      ref={holderRef}
      className="page"
      style={size ? { width: size.w, height: size.h } : undefined}
    >
      <canvas ref={canvasRef} />
    </div>
  );
}

interface PdfViewerProps {
  data: Uint8Array;
  name: string;
}

const ZOOM_STEPS = [0.5, 0.67, 0.8, 1, 1.2, 1.5, 2, 2.5, 3];

export default function PdfViewer({ data, name }: PdfViewerProps) {
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [error, setError] = useState('');
  const [scale, setScale] = useState(1.2);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    // pdf.js takes ownership of the buffer — hand it a copy so reopening works
    const loading = pdfjs.getDocument({ data: data.slice() });
    loading.promise
      .then((d) => {
        if (alive) setDoc(d);
      })
      .catch((err) => {
        if (alive) setError(String(err?.message ?? err));
      });
    return () => {
      alive = false;
      loading.destroy();
    };
  }, [data]);

  const zoom = (dir: 1 | -1) => {
    setScale((s) => {
      const idx = ZOOM_STEPS.findIndex((z) => Math.abs(z - s) < 0.01);
      if (idx === -1) return dir === 1 ? s * 1.25 : s / 1.25;
      return ZOOM_STEPS[Math.min(ZOOM_STEPS.length - 1, Math.max(0, idx + dir))];
    });
  };

  const fitWidth = async () => {
    if (!doc || !scrollRef.current) return;
    const page = await doc.getPage(1);
    const vp = page.getViewport({ scale: 1 });
    const avail = scrollRef.current.clientWidth - 48;
    setScale(Math.max(0.25, Math.min(4, avail / vp.width)));
  };

  return (
    <div className="viewer">
      <div className="toolbar">
        <span className="docname" title={name}>
          {name}
        </span>
        {doc && <span className="faint">{t.pageCount(doc.numPages)}</span>}
        <span className="spacer" />
        <button onClick={() => zoom(-1)} aria-label="zoom out">
          −
        </button>
        <span className="zoomlevel">{Math.round(scale * 100)}%</span>
        <button onClick={() => zoom(1)} aria-label="zoom in">
          +
        </button>
        <button onClick={fitWidth}>{t.fitWidth}</button>
      </div>
      <div className="pages" ref={scrollRef}>
        {error && <div className="load-error">{`${t.loadError}: ${error}`}</div>}
        {!doc && !error && <div className="faint loading">{t.loading}</div>}
        {doc &&
          Array.from({ length: doc.numPages }, (_, i) => (
            <PageView key={`${i + 1}-${scale}`} doc={doc} pageNumber={i + 1} scale={scale} />
          ))}
      </div>
    </div>
  );
}
