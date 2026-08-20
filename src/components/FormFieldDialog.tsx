import { useState } from 'react';
import { t } from '../i18n';
import type { FieldKind, FieldSpec } from '../formFields';

interface Props {
  suggestedName: string;
  /** When set, the dialog edits an existing field (prefilled). */
  initial?: FieldSpec | null;
  busy: boolean;
  onCreate: (spec: FieldSpec) => void;
  onCancel: () => void;
}

/** Opens after the user dragged the region for a new form field — or, in
 *  edit mode, prefilled with an existing field's spec — collects type,
 *  name and type-specific options, then hands the spec back up. */
export default function FormFieldDialog({ suggestedName, initial, busy, onCreate, onCancel }: Props) {
  const [kind, setKind] = useState<FieldKind>(initial?.kind ?? 'text');
  const [name, setName] = useState(initial?.name ?? suggestedName);
  const [optionsText, setOptionsText] = useState(initial?.options.join('\n') ?? '');
  const [defaultValue, setDefaultValue] = useState(
    initial && initial.kind !== 'checkbox' ? initial.defaultValue : ''
  );
  const [checked, setChecked] = useState(initial?.kind === 'checkbox' && initial.defaultValue === 'on');

  const canCreate = name.trim().length > 0 && !busy;

  const create = () => {
    if (!canCreate) return;
    onCreate({
      kind,
      name: name.trim(),
      options: optionsText.split('\n').map((o) => o.trim()).filter(Boolean),
      defaultValue: kind === 'checkbox' ? (checked ? 'on' : '') : defaultValue.trim(),
    });
  };

  return (
    <div className="overlay" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="mhead">
          <h3>{initial ? t.formFieldEditTitle : t.formFieldTitle}</h3>
          <button className="ghost" onClick={onCancel}>
            ×
          </button>
        </div>
        <div className="mbody">
          <label className="fieldlabel">{t.formFieldKind}</label>
          <div className="choices">
            {(Object.keys(t.formFieldKinds) as FieldKind[]).map((k) => (
              <button key={k} className={kind === k ? 'primary' : ''} onClick={() => setKind(k)}>
                {t.formFieldKinds[k]}
              </button>
            ))}
          </div>

          <label className="fieldlabel">{t.formFieldName}</label>
          <input
            className="findinput"
            style={{ width: '100%' }}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />

          {kind === 'dropdown' && (
            <>
              <label className="fieldlabel">{t.formFieldOptions}</label>
              <textarea
                className="findinput"
                style={{ width: '100%', minHeight: 80, resize: 'vertical' }}
                value={optionsText}
                onChange={(e) => setOptionsText(e.target.value)}
              />
            </>
          )}

          {(kind === 'text' || kind === 'multiline' || kind === 'dropdown') && (
            <>
              <label className="fieldlabel">{t.formFieldDefault}</label>
              <input
                className="findinput"
                style={{ width: '100%' }}
                value={defaultValue}
                onChange={(e) => setDefaultValue(e.target.value)}
              />
            </>
          )}

          {kind === 'checkbox' && (
            <label className="checkrow">
              <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
              {t.formFieldDefaultCheck}
            </label>
          )}
        </div>
        <div className="mfoot">
          <button onClick={onCancel}>{t.cancel}</button>
          <button className="primary" onClick={create} disabled={!canCreate}>
            {busy ? t.formFieldCreating : initial ? t.formFieldSave : t.formFieldCreate}
          </button>
        </div>
      </div>
    </div>
  );
}
