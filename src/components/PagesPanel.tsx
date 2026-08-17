import { useCallback, useEffect, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import { PDFDocument, degrees } from 'pdf-lib';
import { api, isTauri } from '../api';
import { bytesToBase64, downloadBytes } from '../bytes';
import { t } from '../i18n';

interface SourceDoc {
  bytes: Uint8Array;
  pdfjsDoc: Promise<pdfjsLib.PDFDocumentProxy>;
}

interface PageSlot {
  id: number;
  kind: 'page' | 'blank';
  sourceIndex: number; // index into `sources` — unused for 'blank'
  sourcePageIndex: number; // 0-based — unused for 'blank'
  rotation: number; // additional rotation on top of the page's own, degrees
  width: number; // only meaningful for 'blank'
  height: number;
  selected: boolean;
}

interface Props {
  data: Uint8Array;
  onApply: (bytes: Uint8Array) => void;
  onClose: () => void;
  onError: (msg: string) => void;
}

const A4: [number, number] = [595.28, 841.89];
let nextSlotId = 1;

export default function PagesPanel({ data, onApply, onClose, onError }: Props) {
  const [sources, setSources] = useState<SourceDoc[]>([]);
  const [slots, setSlots] = useState<PageSlot[]>([]);
  const [thumbs, setThumbs] = useState<Record<string, string>>({}); // `${sourceIndex}:${pageIndex}` -> data URL
  const [busy, setBusy] = useState<string | null>(null); // status message while applying/exporting
  const fileInputRef = useRef<HTMLInputElement>(null);

  // load the currently-open document as source 0
  useEffect(() => {
    const pdfjsDoc = pdfjsLib.getDocument({ data: data.slice() }).promise;
    setSources([{ bytes: data, pdfjsDoc }]);
    pdfjsDoc
      .then((doc) => {
        const initial: PageSlot[] = Array.from({ length: doc.numPages }, (_, i) => ({
          id: nextSlotId++,
          kind: 'page',
          sourceIndex: 0,
          sourcePageIndex: i,
          rotation: 0,
          width: 0,
          height: 0,
          selected: false,
        }));
        setSlots(initial);
      })
      .catch((err) => onError(String(err)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  // render thumbnails lazily as sources/slots change
  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (const slot of slots) {
        if (slot.kind !== 'page') continue;
        const key = `${slot.sourceIndex}:${slot.sourcePageIndex}`;
        if (thumbs[key]) continue;
        const src = sources[slot.sourceIndex];
        if (!src) continue;
        try {
          const doc = await src.pdfjsDoc;
          const page = await doc.getPage(slot.sourcePageIndex + 1);
          const vp = page.getViewport({ scale: 0.22 });
          const canvas = document.createElement('canvas');
          canvas.width = vp.width;
          canvas.height = vp.height;
          await page.render({ canvas, viewport: vp }).promise;
          if (cancelled) return;
          const url = canvas.toDataURL();
          setThumbs((t) => (t[key] ? t : { ...t, [key]: url }));
        } catch {
          // a broken thumbnail isn't fatal — the slot still works for reorder/rotate/delete
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [slots, sources, thumbs]);

  const move = useCallback((index: number, dir: -1 | 1) => {
    setSlots((s) => {
      const j = index + dir;
      if (j < 0 || j >= s.length) return s;
      const next = s.slice();
      [next[index], next[j]] = [next[j], next[index]];
      return next;
    });
  }, []);

  const rotate = useCallback((index: number) => {
    setSlots((s) =>
      s.map((slot, i) => (i === index ? { ...slot, rotation: (slot.rotation + 90) % 360 } : slot))
    );
  }, []);

  const remove = useCallback((index: number) => {
    setSlots((s) => (s.length <= 1 ? s : s.filter((_, i) => i !== index)));
  }, []);

  const toggleSelect = useCallback((index: number) => {
    setSlots((s) => s.map((slot, i) => (i === index ? { ...slot, selected: !slot.selected } : slot)));
  }, []);

  const insertBlank = useCallback(() => {
    setSlots((s) => [
      ...s,
      {
        id: nextSlotId++,
        kind: 'blank',
        sourceIndex: -1,
        sourcePageIndex: -1,
        rotation: 0,
        width: A4[0],
        height: A4[1],
        selected: false,
      },
    ]);
  }, []);

  // Source index for the NEXT appended (merged) document. Index 0 is
  // always the initially-open doc (assigned directly in the load effect,
  // never through here). Kept as a ref, not derived from `sources.length`
  // inside the setSources updater: React 18 StrictMode intentionally
  // double-invokes state updaters to catch impure ones, and the pdfjsDoc
  // load + setSlots side effect used to live inside that updater — so in
  // dev it ran twice and merged pages showed up doubled.
  const nextSourceIndex = useRef(1);

  const appendSourceBytes = useCallback(
    (bytes: Uint8Array) => {
      const sourceIndex = nextSourceIndex.current++;
      const pdfjsDoc = pdfjsLib.getDocument({ data: bytes.slice() }).promise;
      setSources((prev) => [...prev, { bytes, pdfjsDoc }]);
      pdfjsDoc
        .then((doc) => {
          const added: PageSlot[] = Array.from({ length: doc.numPages }, (_, i) => ({
            id: nextSlotId++,
            kind: 'page',
            sourceIndex,
            sourcePageIndex: i,
            rotation: 0,
            width: 0,
            height: 0,
            selected: false,
          }));
          setSlots((s) => [...s, ...added]);
        })
        .catch((err) => onError(String(err)));
    },
    [onError]
  );

  const mergePdf = useCallback(async () => {
    if (!isTauri) {
      fileInputRef.current?.click();
      return;
    }
    try {
      const path = await api.pickPdf();
      if (!path) return;
      const buf = await api.readPdf(path);
      appendSourceBytes(new Uint8Array(buf));
    } catch (err) {
      onError(String(err));
    }
  }, [appendSourceBytes, onError]);

  const onBrowserMergeFile = useCallback(
    async (file: File | undefined) => {
      if (!file) return;
      appendSourceBytes(new Uint8Array(await file.arrayBuffer()));
    },
    [appendSourceBytes]
  );

  // Build a pdf-lib document from a list of slots, copying pages from their
  // (possibly several) source documents and applying rotation/blank pages.
  const buildDocument = useCallback(
    async (list: PageSlot[]): Promise<Uint8Array> => {
      const out = await PDFDocument.create();
      const libCache = new Map<number, PDFDocument>();
      const getLib = async (sourceIndex: number) => {
        let doc = libCache.get(sourceIndex);
        if (!doc) {
          doc = await PDFDocument.load(sources[sourceIndex].bytes);
          libCache.set(sourceIndex, doc);
        }
        return doc;
      };
      for (const slot of list) {
        if (slot.kind === 'blank') {
          const [w, h] = slot.rotation % 180 === 0 ? [slot.width, slot.height] : [slot.height, slot.width];
          out.addPage([w, h]);
          continue;
        }
        const libDoc = await getLib(slot.sourceIndex);
        const [copied] = await out.copyPages(libDoc, [slot.sourcePageIndex]);
        out.addPage(copied);
        if (slot.rotation) {
          copied.setRotation(degrees((copied.getRotation().angle + slot.rotation) % 360));
        }
      }
      return out.save();
    },
    [sources]
  );

  const apply = useCallback(async () => {
    setBusy(t.pagesApplying);
    try {
      const bytes = await buildDocument(slots);
      onApply(bytes);
      onClose();
    } catch (err) {
      onError(String(err));
      setBusy(null);
    }
  }, [buildDocument, slots, onApply, onClose, onError]);

  const exportSelected = useCallback(async () => {
    const chosen = slots.filter((s) => s.selected);
    if (chosen.length === 0) return;
    setBusy(t.pagesExporting);
    try {
      const bytes = await buildDocument(chosen);
      if (isTauri) {
        const path = await api.pickSavePdf(t.pagesExportName);
        if (path) {
          await api.writePdf(path, bytesToBase64(bytes));
        }
      } else {
        downloadBytes(t.pagesExportName, bytes);
      }
    } catch (err) {
      onError(String(err));
    } finally {
      setBusy(null);
    }
  }, [buildDocument, slots, onError]);

  const selectedCount = slots.filter((s) => s.selected).length;

  return (
    <div className="overlay" onClick={busy ? undefined : onClose}>
      <div className="modal pagesmodal" onClick={(e) => e.stopPropagation()}>
        <div className="mhead">
          <h3>{t.pagesTitle}</h3>
          <button className="ghost" onClick={onClose} disabled={!!busy}>
            ×
          </button>
        </div>
        <div className="mbody">
          <div className="pagesToolbar">
            <button onClick={insertBlank} disabled={!!busy}>
              {t.pagesInsertBlank}
            </button>
            <button onClick={mergePdf} disabled={!!busy}>
              {t.pagesMerge}
            </button>
            <span className="spacer" />
            <button onClick={exportSelected} disabled={!!busy || selectedCount === 0}>
              {t.pagesExportSelected(selectedCount)}
            </button>
          </div>
          <div className="pagesgrid">
            {slots.map((slot, i) => {
              const key = slot.kind === 'page' ? `${slot.sourceIndex}:${slot.sourcePageIndex}` : null;
              const thumb = key ? thumbs[key] : null;
              return (
                <div key={slot.id} className={slot.selected ? 'pagecard selected' : 'pagecard'}>
                  <div className="pagecard-thumb" onClick={() => toggleSelect(i)}>
                    {thumb ? (
                      <img
                        src={thumb}
                        alt=""
                        style={{ transform: `rotate(${slot.rotation}deg)` }}
                      />
                    ) : (
                      <div className="pagecard-blank" />
                    )}
                    <span className="pagecard-num">{i + 1}</span>
                  </div>
                  <div className="pagecard-actions">
                    <button onClick={() => move(i, -1)} disabled={i === 0} aria-label="up">
                      ↑
                    </button>
                    <button onClick={() => move(i, 1)} disabled={i === slots.length - 1} aria-label="down">
                      ↓
                    </button>
                    <button onClick={() => rotate(i)} aria-label="rotate">
                      ⟳
                    </button>
                    <button onClick={() => remove(i)} disabled={slots.length <= 1} aria-label="delete">
                      ×
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        <div className="mfoot">
          {busy && <span className="faint">{busy}</span>}
          <span className="spacer" />
          <button onClick={onClose} disabled={!!busy}>
            {t.cancel}
          </button>
          <button className="primary" onClick={apply} disabled={!!busy}>
            {t.pagesApply}
          </button>
        </div>
        {!isTauri && (
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf"
            style={{ display: 'none' }}
            onChange={(e) => {
              onBrowserMergeFile(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
        )}
      </div>
    </div>
  );
}
