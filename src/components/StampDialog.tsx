import { useEffect, useRef, useState } from 'react';
import { t } from '../i18n';

type Mode = 'image' | 'draw' | 'type';

interface Props {
  onPlace: (file: File) => void;
  onClose: () => void;
}

/** Produces an image (picked file, hand-drawn signature, or typed name in a
 *  script font) and hands it off as a File — placement, moving and resizing
 *  on the page itself is then pdf.js's own Stamp editor, not ours (see
 *  PdfViewer.placeStamp). We only ever need to produce pixels. */
export default function StampDialog({ onPlace, onClose }: Props) {
  const [mode, setMode] = useState<Mode>('draw');
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const last = useRef<[number, number] | null>(null);
  const hasInk = useRef(false);
  const [typedName, setTypedName] = useState('');
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const clearCanvas = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    hasInk.current = false;
  };

  useEffect(() => {
    if (mode !== 'draw') return;
    clearCanvas();
  }, [mode]);

  const pointerPos = (e: React.PointerEvent<HTMLCanvasElement>): [number, number] => {
    const rect = e.currentTarget.getBoundingClientRect();
    return [e.clientX - rect.left, e.clientY - rect.top];
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drawing.current = true;
    last.current = pointerPos(e);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current || !last.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!ctx) return;
    const [x, y] = pointerPos(e);
    ctx.strokeStyle = '#0b1220';
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(...last.current);
    ctx.lineTo(x, y);
    ctx.stroke();
    last.current = [x, y];
    hasInk.current = true;
  };
  const onPointerUp = () => {
    drawing.current = false;
    last.current = null;
  };

  const confirmDraw = () => {
    const canvas = canvasRef.current;
    if (!canvas || !hasInk.current) return;
    canvas.toBlob((blob) => {
      if (blob) onPlace(new File([blob], 'signature.png', { type: 'image/png' }));
    }, 'image/png');
  };

  const confirmType = () => {
    const name = typedName.trim();
    if (!name) return;
    const canvas = document.createElement('canvas');
    canvas.width = 600;
    canvas.height = 160;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.font = "72px 'Segoe Script', 'Brush Script MT', cursive";
    ctx.fillStyle = '#0b1220';
    ctx.textBaseline = 'middle';
    ctx.fillText(name, 20, canvas.height / 2, canvas.width - 40);
    canvas.toBlob((blob) => {
      if (blob) onPlace(new File([blob], 'signature.png', { type: 'image/png' }));
    }, 'image/png');
  };

  const confirmImage = () => {
    if (imageFile) onPlace(imageFile);
  };

  const onImageChosen = (file: File | undefined) => {
    if (!file) return;
    setImageFile(file);
    setImagePreview(URL.createObjectURL(file));
  };

  const canConfirm = mode === 'draw' ? true : mode === 'type' ? typedName.trim().length > 0 : !!imageFile;
  const confirm = () => {
    if (mode === 'draw') confirmDraw();
    else if (mode === 'type') confirmType();
    else confirmImage();
  };

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal stampmodal" onClick={(e) => e.stopPropagation()}>
        <div className="mhead">
          <h3>{t.stampTitle}</h3>
          <button className="ghost" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="mbody">
          <div className="choices">
            <button className={mode === 'draw' ? 'primary' : ''} onClick={() => setMode('draw')}>
              {t.stampDraw}
            </button>
            <button className={mode === 'type' ? 'primary' : ''} onClick={() => setMode('type')}>
              {t.stampType}
            </button>
            <button className={mode === 'image' ? 'primary' : ''} onClick={() => setMode('image')}>
              {t.stampImage}
            </button>
          </div>

          {mode === 'draw' && (
            <>
              <canvas
                ref={canvasRef}
                width={520}
                height={200}
                className="signaturepad"
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerLeave={onPointerUp}
              />
              <button onClick={clearCanvas}>{t.stampClear}</button>
            </>
          )}

          {mode === 'type' && (
            <>
              <input
                className="findinput"
                style={{ width: '100%' }}
                placeholder={t.stampTypePlaceholder}
                value={typedName}
                onChange={(e) => setTypedName(e.target.value)}
                autoFocus
              />
              {typedName.trim() && (
                <div className="signaturepreview" style={{ fontFamily: "'Segoe Script','Brush Script MT',cursive" }}>
                  {typedName}
                </div>
              )}
            </>
          )}

          {mode === 'image' && (
            <>
              <button onClick={() => fileInputRef.current?.click()}>{t.stampPickImage}</button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                style={{ display: 'none' }}
                onChange={(e) => onImageChosen(e.target.files?.[0])}
              />
              {imagePreview && (
                <div className="signaturepreview">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={imagePreview} alt="" style={{ maxWidth: '100%', maxHeight: 160 }} />
                </div>
              )}
            </>
          )}
        </div>
        <div className="mfoot">
          <button onClick={onClose}>{t.cancel}</button>
          <button className="primary" onClick={confirm} disabled={!canConfirm}>
            {t.stampPlace}
          </button>
        </div>
      </div>
    </div>
  );
}
