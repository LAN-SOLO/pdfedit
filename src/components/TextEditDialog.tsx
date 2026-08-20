import { useState } from 'react';
import { t } from '../i18n';
import type { SystemFont } from '../api';
import type { FreetextFontChoice, StdFontKey } from '../freetextFont';
import type { FontMatch } from '../fontMatch';

export interface TextEditSpec {
  newText: string;
  sizePt: number;
  colorHex: string;
  choice: FreetextFontChoice;
}

interface Props {
  /** The clicked run's current text — prefilled for typo fixing. */
  initialText: string;
  /** Exact original size in points (from the content stream). */
  initialSizePt: number;
  /** Sampled original text color. */
  initialColorHex: string;
  /** The original font's display name ("Helvetica-Bold"), if detected. */
  detectedLabel: string | null;
  /** Best available replacement, preselected. */
  match: FontMatch | null;
  systemFonts: SystemFont[] | null;
  busy: boolean;
  /** Loads a system font into document.fonts for the live preview and
   *  returns its CSS family. */
  onPreviewFont: (choice: FreetextFontChoice) => Promise<string>;
  onApply: (spec: TextEditSpec) => void;
  onCancel: () => void;
}

const SWATCHES = ['#000000', '#E11D48', '#2563EB', '#16A34A', '#F59E0B', '#7C3AED'];

const STD_KEYS: StdFontKey[] = [
  'helv',
  'helv-b',
  'helv-o',
  'helv-bo',
  'times',
  'times-b',
  'times-i',
  'times-bi',
  'courier',
  'courier-b',
  'courier-o',
  'courier-bo',
];

const stdCss = (key: StdFontKey): { family: string; bold: boolean; italic: boolean } => ({
  family: key.startsWith('times')
    ? '"Times New Roman", Times, serif'
    : key.startsWith('courier')
      ? '"Courier New", Courier, monospace'
      : 'Helvetica, Arial, sans-serif',
  bold: key.includes('-b'),
  italic: key.includes('-o') || key.includes('-i') || key.endsWith('bo') || key.endsWith('bi'),
});

const choiceToKey = (choice: FreetextFontChoice): string => {
  if (choice.kind === 'standard') return `std:${choice.font}`;
  if (choice.kind === 'system') return `sys:${choice.path}`;
  return 'std:helv';
};

/** Edit one existing text run while preserving its formatting: the
 *  original font/cut/size/color are detected and preselected; the dialog
 *  says whether the exact font is installed or which substitute it picked. */
export default function TextEditDialog({
  initialText,
  initialSizePt,
  initialColorHex,
  detectedLabel,
  match,
  systemFonts,
  busy,
  onPreviewFont,
  onApply,
  onCancel,
}: Props) {
  const [text, setText] = useState(initialText);
  const [size, setSize] = useState(Math.round(initialSizePt * 100) / 100);
  const [color, setColor] = useState(initialColorHex || '#000000');
  const [fontKey, setFontKey] = useState(match ? choiceToKey(match.choice) : 'std:helv');
  const [preview, setPreview] = useState(() => {
    if (match?.choice.kind === 'standard') return stdCss(match.choice.font);
    return { family: 'Helvetica, Arial, sans-serif', bold: false, italic: false };
  });

  const keyToChoice = (key: string): FreetextFontChoice => {
    if (key.startsWith('std:')) return { kind: 'standard', font: key.slice(4) as StdFontKey };
    if (key.startsWith('sys:')) {
      const path = key.slice(4);
      const f = systemFonts?.find((x) => x.path === path);
      if (f) return { kind: 'system', name: f.name, path };
    }
    return { kind: 'standard', font: 'helv' };
  };

  const changeFont = async (key: string) => {
    setFontKey(key);
    const choice = keyToChoice(key);
    if (choice.kind === 'standard') {
      setPreview(stdCss(choice.font));
      return;
    }
    try {
      const family = await onPreviewFont(choice);
      setPreview({ family, bold: false, italic: false });
    } catch {
      // preview only — applying still works, the embed path loads the bytes itself
    }
  };

  // system-font preview needs the FontFace loaded once for the initial match
  useState(() => {
    if (match?.choice.kind === 'system') void changeFont(choiceToKey(match.choice));
  });

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
          {detectedLabel && (
            <p className="faint dialoghint">{t.textEditDetected(detectedLabel, initialSizePt)}</p>
          )}
          {match && match.quality === 'exact' && (
            <p className="ok-text dialoghint">{t.textEditMatchExact(match.label)}</p>
          )}
          {match && match.quality === 'family' && (
            <p className="ok-text dialoghint">
              {t.textEditMatchFamily(match.label || t.stdFontLabel(fontKey.startsWith('std:') ? (fontKey.slice(4) as StdFontKey) : 'helv'))}
            </p>
          )}
          {match && match.quality === 'fallback' && (
            <p className="err-text dialoghint">
              {t.textEditMatchFallback(t.stdFontLabel(fontKey.startsWith('std:') ? (fontKey.slice(4) as StdFontKey) : 'helv'))}
            </p>
          )}

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
            style={{
              fontFamily: preview.family,
              fontWeight: preview.bold ? 700 : 400,
              fontStyle: preview.italic ? 'italic' : 'normal',
              color,
              fontSize: Math.min(28, Math.max(11, size * 1.6)),
            }}
          >
            {text || ' '}
          </div>

          <label className="fieldlabel">{t.propFont}</label>
          <select className="fontselect" value={fontKey} onChange={(e) => void changeFont(e.target.value)}>
            <optgroup label={t.fontStandardGroup}>
              {STD_KEYS.map((k) => (
                <option key={k} value={`std:${k}`}>
                  {t.stdFontLabel(k)}
                </option>
              ))}
            </optgroup>
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
            min={2}
            max={288}
            step={0.25}
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
