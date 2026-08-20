import { useState } from 'react';
import { t } from '../i18n';

interface Props {
  name: string;
  /** True after a failed attempt — shows the "wrong password" hint. */
  failed: boolean;
  onSubmit: (password: string) => void;
  onCancel: () => void;
}

/** Shown when an opened PDF turns out to be password-protected. */
export default function PasswordPrompt({ name, failed, onSubmit, onCancel }: Props) {
  const [pw, setPw] = useState('');

  return (
    <div className="overlay" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="mhead">
          <h3>{t.pwPromptTitle}</h3>
          <button className="ghost" onClick={onCancel}>
            ×
          </button>
        </div>
        <div className="mbody">
          <p>{t.pwPromptBody(name)}</p>
          <input
            className="findinput"
            style={{ width: '100%' }}
            type="password"
            placeholder={t.pwPromptPlaceholder}
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && pw) onSubmit(pw);
            }}
            autoFocus
          />
          {failed && <div className="err-text">{t.pwPromptWrong}</div>}
        </div>
        <div className="mfoot">
          <button onClick={onCancel}>{t.cancel}</button>
          <button className="primary" onClick={() => onSubmit(pw)} disabled={!pw}>
            {t.pwPromptOpen}
          </button>
        </div>
      </div>
    </div>
  );
}
