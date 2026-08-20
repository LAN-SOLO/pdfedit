import { useEffect, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import { t } from '../i18n';
import { IconPages } from './Icon';
import type { FieldSummary } from '../formFields';

/** One session annotation (pdf.js editor) shown in the objects panel. */
export interface AnnotObject {
  id: string;
  type: string;
  label: string;
  pageIndex: number;
}

interface Props {
  data: Uint8Array;
  currentPage: number;
  onJump: (page: number) => void;
  onOpenPages: () => void;
  /** Move page `from` (0-based) to position `to` — sidebar drag & drop. */
  onMove: (from: number, to: number) => void;
  /** Objects panel: session annotations + document form fields. */
  objects: AnnotObject[];
  fields: FieldSummary[];
  onSelectObject: (id: string) => void;
  onDeleteObject: (id: string) => void;
  onEditField: (field: FieldSummary) => void;
  onDeleteField: (name: string) => void;
}

/** Page rail, always visible next to the viewer — jump between pages by
 *  click, reorder them by drag & drop. Rotating/merging/deleting stays in
 *  the full Pages dialog (opened via the button at the top), which needs
 *  the extra room for per-page actions that a ~150px-wide rail doesn't
 *  have. */
export default function Sidebar({
  data,
  currentPage,
  onJump,
  onOpenPages,
  onMove,
  objects,
  fields,
  onSelectObject,
  onDeleteObject,
  onEditField,
  onDeleteField,
}: Props) {
  const [tab, setTab] = useState<'pages' | 'objects'>('pages');
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
        <button
          className={tab === 'pages' ? 'sidebar-tab active' : 'sidebar-tab'}
          onClick={() => setTab('pages')}
        >
          {t.sidebarTabPages}
        </button>
        <button
          className={tab === 'objects' ? 'sidebar-tab active' : 'sidebar-tab'}
          onClick={() => setTab('objects')}
        >
          {t.sidebarTabObjects}
        </button>
        <span style={{ flex: 1 }} />
        <button className="ghost small" onClick={onOpenPages} title={t.pagesTitle} aria-label={t.pagesTitle}>
          <IconPages size={15} />
        </button>
      </div>
      {tab === 'objects' && (
        <div className="sidebar-list objects-list">
          {objects.length === 0 && fields.length === 0 && (
            <p className="faint objects-empty">{t.objEmpty}</p>
          )}
          {objects.length > 0 && <div className="objects-heading">{t.objAnnotations}</div>}
          {objects.map((o) => (
            <div key={o.id} className="object-item">
              <button className="object-label" onClick={() => onSelectObject(o.id)} title={o.label}>
                <span className="object-type">{t.objTypeLabels[o.type] ?? o.type}</span>
                <span className="object-text">{o.label}</span>
                <span className="object-page">{t.objPage(o.pageIndex + 1)}</span>
              </button>
              <button
                className="ghost small object-del"
                title={t.objDelete}
                aria-label={t.objDelete}
                onClick={() => onDeleteObject(o.id)}
              >
                ×
              </button>
            </div>
          ))}
          {fields.length > 0 && <div className="objects-heading">{t.objFields}</div>}
          {fields.map((f) => (
            <div key={f.name} className="object-item">
              <button className="object-label" onClick={() => onEditField(f)} title={t.objEditField}>
                <span className="object-type">{t.formFieldKinds[f.kind]}</span>
                <span className="object-text">{f.name}</span>
                <span className="object-page">{t.objPage(f.pageIndex + 1)}</span>
              </button>
              <button
                className="ghost small object-del"
                title={t.objDelete}
                aria-label={t.objDelete}
                onClick={() => onDeleteField(f.name)}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
      {tab === 'pages' && (
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
      )}
    </div>
  );
}
