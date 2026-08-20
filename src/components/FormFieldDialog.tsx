import { useState } from 'react';
import { t } from '../i18n';
import type { FieldKind, FieldSpec } from '../formFields';

interface Props {
  suggestedName: string;
  busy: boolean;
  onCreate: (spec: FieldSpec) => void;
  onCancel: () => void;
}

/** Opens after the user dragged the region for a new form field — collects
 *  type, name and type-specific options, then hands the spec back up. */
export default function FormFieldDialog({ suggestedName, busy, onCreate, onCancel }: Props) {
  const [kind, setKind] = useState<FieldKind>('text');
  const [name, setName] = useState(suggestedName);
  const [optionsText, setOptionsText] = useState('');
  const [defaultValue, setDefaultValue] = useState('');
  const [checked, setChecked] = useState(false);

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
          <h3>{t.formFieldTitle}</h3>
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
            {busy ? t.formFieldCreating : t.formFieldCreate}
          </button>
        </div>
      </div>
    </div>
  );
}
