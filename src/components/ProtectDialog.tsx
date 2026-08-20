import { useState } from 'react';
import { t } from '../i18n';
import { allPermissions, type Protection, type ProtectPermissions } from '../protect';

interface Props {
  protection: Protection | null;
  /** True when the protection was inherited from opening an encrypted file
   *  (as opposed to being set in this session). */
  inherited: boolean;
  busy: boolean;
  onApply: (protection: Protection) => void;
  onRemove: () => void;
  onCancel: () => void;
}

/** Acrobat's "Protect using password": set/change the open password, an
 *  optional owner password with per-action permissions, or remove the
 *  protection entirely. Everything is applied at save time — this dialog's
 *  primary actions therefore save immediately so the file on disk matches
 *  what the user just decided. */
export default function ProtectDialog({ protection, inherited, busy, onApply, onRemove, onCancel }: Props) {
  const [userPw, setUserPw] = useState('');
  const [userPw2, setUserPw2] = useState('');
  const [ownerPw, setOwnerPw] = useState('');
  const [perms, setPerms] = useState<ProtectPermissions>(protection?.permissions ?? allPermissions);
  const [validation, setValidation] = useState('');

  const apply = () => {
    if (!userPw) {
      setValidation(t.protectPwEmpty);
      return;
    }
    if (userPw !== userPw2) {
      setValidation(t.protectPwMismatch);
      return;
    }
    setValidation('');
    onApply({ userPassword: userPw, ownerPassword: ownerPw, permissions: perms });
  };

  const permKeys = Object.keys(t.protectPerms) as (keyof ProtectPermissions)[];

  return (
    <div className="overlay" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="mhead">
          <h3>{t.protectTitle}</h3>
          <button className="ghost" onClick={onCancel}>
            ×
          </button>
        </div>
        <div className="mbody">
          <p className={protection ? 'ok-text' : 'faint dialoghint'}>
            {protection ? (inherited ? t.protectStateInherited : t.protectStateActive) : t.protectStateNone}
          </p>

          <label className="fieldlabel">{t.protectSetTitle}</label>
          <input
            className="findinput"
            style={{ width: '100%' }}
            type="password"
            placeholder={t.protectUserPw}
            value={userPw}
            onChange={(e) => setUserPw(e.target.value)}
          />
          <input
            className="findinput"
            style={{ width: '100%' }}
            type="password"
            placeholder={t.protectUserPwRepeat}
            value={userPw2}
            onChange={(e) => setUserPw2(e.target.value)}
          />
          <input
            className="findinput"
            style={{ width: '100%' }}
            type="password"
            placeholder={t.protectOwnerPw}
            value={ownerPw}
            onChange={(e) => setOwnerPw(e.target.value)}
          />
          {validation && <div className="err-text">{validation}</div>}

          <label className="fieldlabel">{t.protectPermsTitle}</label>
          {permKeys.map((k) => (
            <label key={k} className="checkrow">
              <input
                type="checkbox"
                checked={perms[k]}
                onChange={(e) => setPerms((p) => ({ ...p, [k]: e.target.checked }))}
              />
              {t.protectPerms[k]}
            </label>
          ))}

          {protection && (
            <>
              <label className="fieldlabel">{t.protectRemove}</label>
              <p className="faint dialoghint">{t.protectRemoveHint}</p>
              <button className="danger" onClick={onRemove} disabled={busy}>
                {t.protectRemove}
              </button>
            </>
          )}
        </div>
        <div className="mfoot">
          <button onClick={onCancel}>{t.cancel}</button>
          <button className="primary" onClick={apply} disabled={busy}>
            {busy ? t.protectApplying : t.protectApplySave}
          </button>
        </div>
      </div>
    </div>
  );
}
