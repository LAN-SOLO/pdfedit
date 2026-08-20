import { useRef, useState } from 'react';
import { t } from '../i18n';
import { isWrongP12Password, readP12, type CertInfo } from '../sign';

export interface SignRequest {
  p12Bytes: Uint8Array;
  p12Password: string;
  reason: string;
  visible: boolean;
}

interface Props {
  busy: boolean;
  onSign: (req: SignRequest) => void;
  onCancel: () => void;
}

/** Collects certificate (.p12/.pfx), its password, reason and appearance.
 *  The certificate is parsed on the spot so the user sees who they are
 *  about to sign as before anything touches the document. */
export default function SignDialog({ busy, onSign, onCancel }: Props) {
  const [p12Bytes, setP12Bytes] = useState<Uint8Array | null>(null);
  const [p12Name, setP12Name] = useState('');
  const [password, setPassword] = useState('');
  const [reason, setReason] = useState('');
  const [visible, setVisible] = useState(true);
  const [certInfo, setCertInfo] = useState<CertInfo | null>(null);
  const [certError, setCertError] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const onCertChosen = async (file: File | undefined) => {
    if (!file) return;
    setP12Bytes(new Uint8Array(await file.arrayBuffer()));
    setP12Name(file.name);
    setCertInfo(null);
    setCertError(false);
  };

  // parsing a .p12 is instant — validate as soon as both parts are there
  const tryReadCert = (bytes: Uint8Array | null, pw: string) => {
    setCertInfo(null);
    setCertError(false);
    if (!bytes || !pw) return;
    try {
      setCertInfo(readP12(bytes, pw));
    } catch (err) {
      setCertError(true);
      void isWrongP12Password(err); // same user-facing message either way
    }
  };

  const canSign = !!p12Bytes && !!certInfo && !busy;

  return (
    <div className="overlay" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="mhead">
          <h3>{t.signTitle}</h3>
          <button className="ghost" onClick={onCancel}>
            ×
          </button>
        </div>
        <div className="mbody">
          <p className="faint dialoghint">{t.signIntro}</p>

          <button onClick={() => fileInputRef.current?.click()}>
            {p12Name || t.signPickCert}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".p12,.pfx,application/x-pkcs12"
            style={{ display: 'none' }}
            onChange={(e) => {
              onCertChosen(e.target.files?.[0]);
              e.target.value = '';
            }}
          />

          <label className="fieldlabel">{t.signCertPassword}</label>
          <input
            className="findinput"
            style={{ width: '100%' }}
            type="password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              tryReadCert(p12Bytes, e.target.value);
            }}
          />
          {certInfo && (
            <div className="ok-text certinfo">
              {t.signCertInfo(
                certInfo.commonName,
                certInfo.issuerCommonName ?? '?',
                certInfo.validTo ? certInfo.validTo.toISOString().slice(0, 10) : '?'
              )}
            </div>
          )}
          {certError && p12Bytes && password && <div className="err-text">{t.signCertInvalid}</div>}

          <label className="fieldlabel">{t.signReason}</label>
          <input
            className="findinput"
            style={{ width: '100%' }}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />

          <label className="fieldlabel">{t.signVisibility}</label>
          <label className="checkrow">
            <input type="radio" name="signvis" checked={visible} onChange={() => setVisible(true)} />
            {t.signVisible}
          </label>
          <label className="checkrow">
            <input type="radio" name="signvis" checked={!visible} onChange={() => setVisible(false)} />
            {t.signInvisible}
          </label>

          <p className="faint dialoghint">{t.signEditWarning}</p>
          <p className="faint dialoghint">{t.signSelfSignedNote}</p>
        </div>
        <div className="mfoot">
          <button onClick={onCancel}>{t.cancel}</button>
          <button
            className="primary"
            disabled={!canSign}
            onClick={() =>
              p12Bytes && onSign({ p12Bytes, p12Password: password, reason: reason.trim(), visible })
            }
          >
            {busy ? t.signSigning : visible ? t.signVisible : t.signNow}
          </button>
        </div>
      </div>
    </div>
  );
}
