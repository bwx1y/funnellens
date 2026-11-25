import React, { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { ArrowRight, LockKeyhole } from 'lucide-react';
import { DEFAULT_OWNER_EMAIL, useAuth } from '../auth.jsx';
import { Button, Field, Input, Logo, Notice } from '../components/ui.jsx';

export default function Login() {
  const { session, ready, signIn, signInDemo } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [email, setEmail] = useState(DEFAULT_OWNER_EMAIL);
  const [password, setPassword] = useState('PasswordFunnel123!');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (ready && session) {
    return <Navigate to={location.state?.from || '/app/overview'} replace/>;
  }

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    const { error: authError } = await signIn(email, password);
    setBusy(false);
    if (authError) setError(authError.message);
    else navigate('/app/overview', { replace: true });
  };

  return (
    <main className="auth-page">
      <div className="auth-card">
        <Logo/>
        <span className="auth-icon"><LockKeyhole size={22}/></span>
        <h1>Masuk ke FunnelLens</h1>
        <p className="muted">Terhubung dengan backend Bun + Elysia JWT API (atau mode demo offline).</p>
        <form className="stack" onSubmit={submit}>
          <Field label="Email">
            <Input type="email" autoComplete="username" required value={email} onChange={e => setEmail(e.target.value)}/>
          </Field>
          <Field label="Password">
            <Input type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)}/>
          </Field>
          {error && <Notice tone="amber">{error}</Notice>}
          <Button type="submit" disabled={busy}>
            {busy ? 'Memverifikasi…' : 'Masuk'} <ArrowRight size={16}/>
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => { signInDemo(); navigate('/app/overview', { replace: true }); }}
          >
            Masuk Mode Demo
          </Button>
        </form>
      </div>
    </main>
  );
}
