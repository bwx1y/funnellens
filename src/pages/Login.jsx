import React, { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { useAuth } from '../auth.jsx';
import { Button, Field, Input, Logo, Notice, Tabs } from '../components/ui.jsx';

export default function Login() {
  const { session, ready, signIn, register } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [mode, setMode] = useState('login');

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [tenantName, setTenantName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  if (ready && session) {
    return <Navigate to={location.state?.from || '/app/overview'} replace/>;
  }

  const submitLogin = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    setInfo('');
    const { error: authError } = await signIn(email, password);
    setBusy(false);
    if (authError) setError(authError.message);
    else navigate('/app/overview', { replace: true });
  };

  const submitRegister = async (event) => {
    event.preventDefault();
    if (password !== confirmPassword) {
      setError('Konfirmasi password tidak cocok.');
      return;
    }
    setBusy(true);
    setError('');
    setInfo('');
    const { error: regError } = await register({
      fullName,
      email,
      password,
      confirmPassword,
      tenantName,
    });
    setBusy(false);
    if (regError) {
      setError(regError.message);
    } else {
      setInfo('Akun berhasil dibuat. Silakan masuk dengan email dan password Anda.');
      setMode('login');
    }
  };

  return (
    <main className="auth-page">
      <div className="auth-card">
        <Logo/>
        <h1>{mode === 'login' ? 'Masuk ke FunnelLens' : 'Buat Workspace Baru'}</h1>
        <p className="auth-description">
          {mode === 'login' ? 'Masuk untuk melanjutkan ke workspace Anda.' : 'Buat akun dan workspace FunnelLens Anda.'}
        </p>

        <div className="auth-mode-switch">
          <Tabs
            value={mode}
            onChange={(next) => { setMode(next); setError(''); setInfo(''); }}
            options={[
              { value: 'login', label: 'Masuk' },
              { value: 'register', label: 'Daftar' },
            ]}
          />
        </div>

        {info && <Notice tone="blue" className="mb-3">{info}</Notice>}

        {mode === 'login' ? (
          <form className="stack" onSubmit={submitLogin}>
            <Field label="Email">
              <Input type="email" autoComplete="username" required value={email} onChange={e => setEmail(e.target.value)} placeholder="nama@bisnis.com"/>
            </Field>
            <Field label="Password">
              <Input type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} placeholder="Masukkan password"/>
            </Field>
            {error && <Notice tone="amber">{error}</Notice>}
            <Button type="submit" disabled={busy}>
              {busy ? 'Memverifikasi…' : 'Masuk'} <ArrowRight size={16}/>
            </Button>
          </form>
        ) : (
          <form className="stack" onSubmit={submitRegister}>
            <Field label="Nama Lengkap">
              <Input required value={fullName} onChange={e => setFullName(e.target.value)} placeholder="Nama Anda"/>
            </Field>
            <Field label="Nama Bisnis / Workspace">
              <Input required value={tenantName} onChange={e => setTenantName(e.target.value)} placeholder="Contoh: Toko Maju"/>
            </Field>
            <Field label="Email">
              <Input type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="nama@bisnis.com"/>
            </Field>
            <Field label="Password">
              <Input type="password" autoComplete="new-password" required value={password} onChange={e => setPassword(e.target.value)} placeholder="Minimal 8 karakter"/>
            </Field>
            <Field label="Konfirmasi Password">
              <Input type="password" autoComplete="new-password" required value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} placeholder="Ulangi password"/>
            </Field>
            {error && <Notice tone="amber">{error}</Notice>}
            <Button type="submit" disabled={busy}>
              {busy ? 'Mendaftarkan…' : 'Daftar & Buat Workspace'} <ArrowRight size={16}/>
            </Button>
          </form>
        )}
      </div>
    </main>
  );
}
