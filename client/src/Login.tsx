import { useEffect, useState } from 'react';
import type { Role } from '../../shared/schema';
import { api } from './api';
import { Icon } from './ui';

export function Login({ onSignedIn, onCancel }: { onSignedIn: () => void; onCancel?: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dev, setDev] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    api.authConfig().then(c => { setDev(c.devLogin); setOpen(c.publicAccess); }).catch(() => undefined);
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.login(email, password);
      onSignedIn();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const devLogin = async (role: Role) => {
    await api.devLogin(role);
    onSignedIn();
  };

  return (
    <div className="login">
      <form className="login-card" onSubmit={submit}>
        <div className="brand">
          <div className="brand-mark">PN</div>
          <div>
            <div className="brand-name">Sunpharma-Diabeto-Dashboard</div>
            <div className="brand-sub">Project dashboard · Sun Pharma × OneAlphaMed</div>
          </div>
        </div>
        <label htmlFor="email">Email</label>
        <input id="email" type="email" autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} required />
        <label htmlFor="password">Password</label>
        <input id="password" type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} required />
        {error && (
          <div className="notice notice-error" role="alert">
            <Icon name="alert" /> {error}
          </div>
        )}
        <button className="btn btn-primary btn-block" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        {open ? (
          <>
            <p className="muted small">Team sign-in is only needed to edit from the dashboard. Everyone else can view without signing in.</p>
            {onCancel && <button type="button" className="btn btn-block" onClick={onCancel}>← Back to the dashboard</button>}
          </>
        ) : (
          <p className="muted small">Access is by invitation. Contact the OneAlphaMed project manager if you need an account.</p>
        )}
        {dev && (
          <div className="dev-login">
            <div className="small"><strong>Development sign-in</strong> (disabled in production)</div>
            <div className="row">
              <button type="button" className="btn btn-sm" onClick={() => devLogin('admin')}>Project manager</button>
              <button type="button" className="btn btn-sm" onClick={() => devLogin('editor')}>OneAlphaMed editor</button>
              <button type="button" className="btn btn-sm" onClick={() => devLogin('client')}>Sun Pharma viewer (read-only)</button>
            </div>
          </div>
        )}
      </form>
    </div>
  );
}
