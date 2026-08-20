import { useState } from 'react';
import { t } from '../i18n';
import type { SystemFont } from '../api';
import type { FreetextFontChoice } from '../freetextFont';

export interface TextEditSpec {
  newText: string;
  sizePt: number;
  colorHex: string;
  choice: FreetextFontChoice;
}

interface Props {
  /** The clicked line's current text — prefilled for typo fixing. */
  initialText: string;
  /** Estimated original size in points. */
  initialSizePt: number;
  systemFonts: SystemFont[] | null;
  busy: boolean;
  /** Loads a system font into document.fonts for the live preview. */
  onPreviewFont: (choice: FreetextFontChoice) => Promise<string>;
  onApply: (spec: TextEditSpec) => void;
  onCancel: () => void;
}

const SWATCHES = ['#000000', '#E11D48', '#2563EB', '#16A34A', '#F59E0B', '#7C3AED'];

/** Edit one existing text line: fix typos, recolor, resize, restyle. */
export default function TextEditDialog({
  initialText,
  initialSizePt,
  systemFonts,
  busy,
  onPreviewFont,
  onApply,
  onCancel,
}: Props) {
  const [text, setText] = useState(initialText);
  const [size, setSize] = useState(Math.round(initialSizePt * 2) / 2);
  const [color, setColor] = useState('#000000');
  const [fontKey, setFontKey] = useState('default');
  const [previewFamily, setPreviewFamily] = useState('Helvetica, Arial, sans-serif');

  const keyToChoice = (key: string): FreetextFontChoice => {
    if (key === 'std:times') return { kind: 'standard', font: 'times' };
    if (key === 'std:courier') return { kind: 'standard', font: 'courier' };
    if (key.startsWith('sys:')) {
      const path = key.slice(4);
      const f = systemFonts?.find((x) => x.path === path);
      if (f) return { kind: 'system', name: f.name, path };
    }
    return { kind: 'default' };
  };

  const changeFont = async (key: string) => {
    setFontKey(key);
    const choice = keyToChoice(key);
    try {
      setPreviewFamily(await onPreviewFont(choice));
    } catch {
      // preview only — applying still works, the embed path loads the bytes itself
    }
  };

  return (
    <div className="overlay" onClick={busy ? undefined : onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="mhead">
          <h3>{t.textEditTitle}</h3>
          <button className="ghost" onClick={onCancel} disabled={busy}>
            ×
          </button>
        </div>
        <div className="mbody">
          <label className="fieldlabel">{t.textEditNewText}</label>
          <input
            className="findinput"
            style={{ width: '100%' }}
            value={text}
            onChange={(e) => setText(e.target.value)}
            autoFocus
          />

          <div
            className="textedit-preview"
            style={{ fontFamily: previewFamily, color, fontSize: Math.min(28, Math.max(11, size)) }}
          >
            {text || ' '}
          </div>

          <label className="fieldlabel">{t.propFont}</label>
          <select className="fontselect" value={fontKey} onChange={(e) => void changeFont(e.target.value)}>
            <option value="default">{t.fontDefault}</option>
            <option value="std:times">{t.fontTimes}</option>
            <option value="std:courier">{t.fontCourier}</option>
            {systemFonts === null && <option disabled>{t.fontsLoading}</option>}
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

          <label className="fieldlabel">{t.propSize}</label>
          <input
            className="findinput numinput"
            type="number"
            min={4}
            max={144}
            step={0.5}
            value={size}
            onChange={(e) => setSize(Number(e.target.value) || initialSizePt)}
          />

          <label className="fieldlabel">{t.propColor}</label>
          <div className="swatchrow">
            {SWATCHES.map((c) => (
              <button
                key={c}
                className={color.toUpperCase() === c.toUpperCase() ? 'swatch active' : 'swatch'}
                style={{ background: c }}
                aria-label={c}
                onClick={() => setColor(c)}
              />
            ))}
            <input
              type="color"
              className="colorwell"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              title={t.propColor}
            />
          </div>

          <p className="faint dialoghint">{t.textEditNote}</p>
        </div>
        <div className="mfoot">
          <button onClick={onCancel} disabled={busy}>
            {t.cancel}
          </button>
          <button
            className="primary"
            disabled={busy || text.trim().length === 0}
            onClick={() => onApply({ newText: text, sizePt: size, colorHex: color, choice: keyToChoice(fontKey) })}
          >
            {busy ? t.textEditApplying : t.textEditApply}
          </button>
        </div>
      </div>
    </div>
  );
}
