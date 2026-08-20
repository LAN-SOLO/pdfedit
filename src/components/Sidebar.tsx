import { useEffect, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import { t } from '../i18n';
import { IconPages } from './Icon';

interface Props {
  data: Uint8Array;
  currentPage: number;
  onJump: (page: number) => void;
  onOpenPages: () => void;
  /** Move page `from` (0-based) to position `to` — sidebar drag & drop. */
  onMove: (from: number, to: number) => void;
}

/** Page rail, always visible next to the viewer — jump between pages by
 *  click, reorder them by drag & drop. Rotating/merging/deleting stays in
 *  the full Pages dialog (opened via the button at the top), which needs
 *  the extra room for per-page actions that a ~150px-wide rail doesn't
 *  have. */
export default function Sidebar({ data, currentPage, onJump, onOpenPages, onMove }: Props) {
  const [thumbs, setThumbs] = useState<Record<number, string>>({});
  const [pageCount, setPageCount] = useState(0);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const activeThumbRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let cancelled = false;
    setThumbs({});
    setPageCount(0);

    (async () => {
      const doc = await pdfjsLib.getDocument({ data: data.slice() }).promise;
      if (cancelled) return;
      setPageCount(doc.numPages);
      for (let i = 1; i <= doc.numPages; i++) {
        if (cancelled) return;
        try {
          const page = await doc.getPage(i);
          const vp = page.getViewport({ scale: 0.2 });
          const canvas = document.createElement('canvas');
          canvas.width = vp.width;
          canvas.height = vp.height;
          await page.render({ canvas, viewport: vp }).promise;
          if (cancelled) return;
          const url = canvas.toDataURL();
          setThumbs((prev) => ({ ...prev, [i]: url }));
        } catch {
          // a missing thumbnail isn't fatal — the page number still works for jumping
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [data]);

  useEffect(() => {
    activeThumbRef.current?.scrollIntoView({ block: 'nearest' });
  }, [currentPage]);

  const resetDrag = () => {
    setDragIndex(null);
    setOverIndex(null);
  };

  return (
    <div className="sidebar">
      <div className="sidebar-head">
        <span className="sidebar-title">{t.pagesButton}</span>
        <button className="ghost small" onClick={onOpenPages} title={t.pagesTitle} aria-label={t.pagesTitle}>
          <IconPages size={15} />
        </button>
      </div>
      <div className="sidebar-list">
        {Array.from({ length: pageCount }, (_, i) => i + 1).map((n) => (
          <button
            key={n}
            ref={n === currentPage ? activeThumbRef : undefined}
            className={[
              'sidebar-thumb',
              n === currentPage ? 'active' : '',
              overIndex === n - 1 && dragIndex !== null && dragIndex !== n - 1 ? 'dragover' : '',
              dragIndex === n - 1 ? 'dragging' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            onClick={() => onJump(n)}
            title={t.sidebarDragHint}
            draggable
            onDragStart={(e) => {
              setDragIndex(n - 1);
              e.dataTransfer.effectAllowed = 'move';
              // some engines need data set for a drag to start
              e.dataTransfer.setData('text/plain', String(n));
            }}
            onDragOver={(e) => {
              if (dragIndex === null) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
              setOverIndex(n - 1);
            }}
            onDragLeave={() => {
              setOverIndex((v) => (v === n - 1 ? null : v));
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (dragIndex !== null && dragIndex !== n - 1) onMove(dragIndex, n - 1);
              resetDrag();
            }}
            onDragEnd={resetDrag}
          >
            {thumbs[n] ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={thumbs[n]} alt="" draggable={false} />
            ) : (
              <span className="sidebar-thumb-placeholder" />
            )}
            <span className="sidebar-thumb-num">{n}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
