import React, { useEffect, useState } from 'react';
import { Navigate, NavLink, Link, Outlet, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import {
  Activity, ArrowRight, Bell, BookOpen, Building2, ChartNoAxesCombined,
  ChevronDown, CircleHelp, Command, FileText, Home, Image, Layers,
  Menu, MessageCircle, PanelLeftClose, Search, Settings2, SlidersHorizontal,
  Sparkles, Target, TrendingUp, Users, X
} from 'lucide-react';
import { WorkspaceProvider, useWorkspace } from './context.jsx';
import { AuthProvider, useAuth } from './auth.jsx';
import Login from './pages/Login.jsx';
import Landing from './pages/Landing.jsx';
import { Badge, Button, Logo, Modal, Notice, SearchInput, ToastProvider, useToast } from './components/ui.jsx';
import { CAMPAIGNS, CREATIVES, INSIGHTS, LEADS } from './lib/data.js';
import Onboarding from './pages/Onboarding.jsx';
import Overview from './pages/Overview.jsx';
import Funnel from './pages/Funnel.jsx';
import Audience from './pages/Audience.jsx';
import Campaign from './pages/Campaign.jsx';
import Creative from './pages/Creative.jsx';
import Insights from './pages/Insights.jsx';
import Strategy from './pages/Strategy.jsx';
import Business from './pages/Business.jsx';
import { Controls, Integrations } from './pages/Utilities.jsx';
import ReferenceDashboard from './reference/ReferenceDashboard.jsx';

/* ── Navigation structure ─────────────────────────────────────── */
const NAV = [
  { path: 'overview', label: 'Ringkasan', icon: Home },
  { path: 'funnel', label: 'Ikhtisar funnel', icon: ChartNoAxesCombined },
  { path: 'audience', label: 'Daftar lead', icon: Users },
  { path: 'campaigns', label: 'Campaign & Budget', icon: Layers },
  { path: 'creative', label: 'Analisis kreatif', icon: Image },
  { path: 'insights', label: 'Peringatan', icon: Sparkles },
  { path: 'strategy', label: 'Strategi', icon: Target },
  { path: 'business', label: 'Business Impact', icon: TrendingUp },
  { path: 'controls', label: 'Campaign Controls', icon: SlidersHorizontal },
  { path: 'integrations', label: 'Pengaturan', icon: Settings2 },
];

const NAV_GROUPS = [
  {
    label: 'Funnel Intelligence',
    icon: ChartNoAxesCombined,
    items: [{ path: 'funnel', label: 'Ikhtisar funnel' }],
  },
  {
    label: 'Audience Intelligence',
    icon: Users,
    items: [{ path: 'audience', label: 'Daftar lead' }],
  },
  {
    label: 'Creative Intelligence',
    icon: Image,
    items: [{ path: 'creative', label: 'Analisis kreatif' }],
  },
];

/* ── Helper components ────────────────────────────────────────── */
function Start() {
  const { workspace } = useWorkspace(), { session } = useAuth();
  return <Navigate to={!session ? '/login' : workspace.onboarding.completed ? '/app/overview' : '/onboarding/1'} replace/>;
}

function Protected() {
  const { session, ready } = useAuth(), location = useLocation();
  if (!ready) return <div className="auth-loading">Memeriksa sesi Supabase…</div>;
  return session ? <Outlet/> : <Navigate to="/login" state={{ from: location.pathname }} replace/>;
}

function SavedDraft() {
  const { workspace, connected } = useWorkspace();
  return (
    <div className="welcome">
      <Logo/>
      <Badge color="teal">{connected ? 'Draft tersimpan di Supabase' : 'Draft tersimpan di browser'}</Badge>
      <h1>Lanjutkan saat Anda siap.</h1>
      <p>{connected ? 'Profil bisnis dan rencana campaign tersimpan di workspace Supabase.' : 'Profil bisnis dan rencana campaign Anda tetap tersedia di perangkat ini.'}</p>
      <div className="flex center">
        <Link className="btn btn-primary" to={`/onboarding/${workspace.onboarding.maxStep}`}>Lanjut onboarding <ArrowRight size={17}/></Link>
        <Link className="btn btn-secondary" to="/app/overview">Jelajahi insight demo</Link>
      </div>
    </div>
  );
}

function GlobalSearch({ open, onClose }) {
  const [query, setQuery] = useState('');
  const navigate = useNavigate();
  const all = [
    ...NAV.map(n => ({ title: n.label, type: 'Halaman', route: `/app/${n.path}` })),
    ...CAMPAIGNS.map(c => ({ title: c.name, type: 'Campaign', route: `/app/campaigns?select=${c.id}` })),
    ...CREATIVES.map(c => ({ title: c.name, type: 'Creative', route: `/app/creative?select=${c.id}` })),
    ...INSIGHTS.map(i => ({ title: i.title, type: 'Insight', route: `/app/insights?select=${i.id}` })),
    ...LEADS.slice(0, 10).map(l => ({ title: l.name, type: 'Lead demo', route: `/app/audience?lead=${l.id}&source=${l.source}` })),
  ];
  const list = all.filter(i => !query || i.title.toLowerCase().includes(query.toLowerCase())).slice(0, 12);
  return (
    <Modal open={open} onClose={onClose} title="Cari di workspace">
      <SearchInput value={query} onChange={setQuery} placeholder="Halaman, campaign, creative, atau lead…" autoFocus/>
      <div className="search-results">
        {list.map((i, idx) => (
          <button key={`${i.title}-${idx}`} onClick={() => { navigate(i.route); onClose(); setQuery(''); }}>
            <span>{i.title}</span>
            <Badge color="gray">{i.type}</Badge>
            <ArrowRight size={15}/>
          </button>
        ))}
        {!list.length && <p className="muted">Tidak ditemukan. Coba kata lain.</p>}
      </div>
    </Modal>
  );
}

/* ── Shell (main app layout) ──────────────────────────────────── */
function Shell() {
  const { workspace, storageError } = useWorkspace();
  const [mobile, setMobile] = useState(false);
  const [search, setSearch] = useState(false);
  const [notifications, setNotifications] = useState(false);
  const [profile, setProfile] = useState(false);
  const [help, setHelp] = useState(false);
  const { signOut } = useAuth();
  const location = useLocation(), navigate = useNavigate();
  useEffect(() => { setMobile(false); setProfile(false); setNotifications(false); window.scrollTo(0, 0); }, [location.pathname]);
  useEffect(() => {
    const key = e => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setSearch(v => !v); } };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);

  const brand = workspace.brand.name || 'Demo Workspace';

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main" onClick={e => { e.preventDefault(); document.getElementById('main')?.focus(); }}>Langsung ke konten</a>

      {/* Sidebar overlay (mobile) */}
      {mobile && <div className="sidebar-overlay" onClick={() => setMobile(false)}/>}

      {/* ── Sidebar ──────────────────────────────────────────────── */}
      <aside className={`sidebar ${mobile ? 'open' : ''}`}>
        {/* Logo */}
        <Link to="/app/overview" className="brand-link">
          <span className="brand-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 6h16l-6 8v5l-4 2v-7L4 6z"/>
            </svg>
          </span>
          <span>FunnelLens</span>
        </Link>

        {/* Workspace badge */}
        <div className="workspace-id">
          <span className="workspace-avatar">{brand[0].toUpperCase()}</span>
          <div>
            <strong>{brand}</strong>
            <small>{workspace.business.name || 'Workspace baru'}</small>
          </div>
        </div>

        {/* Primary nav — grouped */}
        <nav aria-label="Navigasi utama">
          <NavLink to="/app/overview" className={({ isActive }) => `nav-link ${isActive ? 'selected' : ''}`}>
            <Home size={17}/>
            <span>Ringkasan</span>
          </NavLink>

          <span className="sidebar-caption separate">Analisis</span>
          {NAV_GROUPS.map(group => (
            <details key={group.label} className="nav-group" open>
              <summary>
                <group.icon size={17}/>
                <span>{group.label}</span>
                <ChevronDown size={14} className="nav-caret"/>
              </summary>
              <div className="nav-children">
                {group.items.map(item => (
                  <NavLink
                    key={item.path}
                    to={`/app/${item.path}`}
                    className={({ isActive }) => isActive ? 'active' : ''}
                  >
                    {item.label}
                  </NavLink>
                ))}
              </div>
            </details>
          ))}
        </nav>

        {/* Divider */}
        <div className="nav-divider"/>

        {/* Secondary nav */}
        <nav aria-label="Utilitas">
          {NAV.filter(item => ['campaigns', 'insights', 'strategy', 'business', 'controls', 'integrations'].includes(item.path)).map(({ path, label, icon: Icon }) => (
            <NavLink key={path} to={`/app/${path}`} className={({ isActive }) => `nav-link ${isActive ? 'selected' : ''}`}>
              <Icon size={17}/>
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>

        {/* Sidebar bottom */}
        <div className="sidebar-bottom">
          <div className="local-note">
            <span className="status-dot"/>
            Supabase · owner workspace
          </div>
          <button className="workspace-pill" onClick={() => navigate('/app/integrations')}>
            <span className="avatar" style={{ borderRadius: '7px' }}>{brand[0].toUpperCase()}</span>
            <span>
              <strong>{brand}</strong>
              <small>{workspace.business.name || 'Workspace baru'}</small>
            </span>
            <ChevronDown size={14}/>
          </button>
          <button className="help-link" onClick={() => setHelp(true)}>
            <CircleHelp size={16}/> Panduan
          </button>
        </div>
      </aside>

      {/* ── Main area ─────────────────────────────────────────────── */}
      <div className="app-main">
        {/* Topbar */}
        <header className="topbar">
          <button className="icon-btn mobile-menu" aria-label="Buka navigasi" onClick={() => setMobile(true)}>
            <Menu size={21}/>
          </button>

          <button className="global-search-btn" aria-label="Cari halaman atau lead" onClick={() => setSearch(true)}>
            <Search size={15}/><span>Cari halaman atau lead</span><kbd>Ctrl K</kbd>
          </button>

          {/* Right actions */}
          <div className="topbar-actions">
            <button className="account-switcher" onClick={() => navigate('/app/integrations')} aria-label="Kelola akun iklan">
              <Layers size={18}/><span><small>Akun iklan</small><strong>{workspace.meta.account || brand}</strong></span><ChevronDown size={14}/>
            </button>

            {/* Notifications */}
            <div className="popover-anchor">
              <button
                className="icon-btn notification-btn"
                aria-label="Notifikasi"
                onClick={() => { setNotifications(v => !v); setProfile(false); }}
              >
                <Bell size={18}/>
                <i/>
              </button>
              {notifications && (
                <div className="popover notifications">
                  <h3>Insight demo</h3>
                  {INSIGHTS.map(i => (
                    <Link key={i.id} to={`/app/insights?select=${i.id}`}>
                      <Sparkles size={15}/>
                      <span>{i.title}<small>Periksa data contoh</small></span>
                    </Link>
                  ))}
                </div>
              )}
            </div>

            {/* Avatar / profile */}
            <div className="popover-anchor">
              <button
                className="avatar"
                aria-label="Menu workspace"
                onClick={() => { setProfile(v => !v); setNotifications(false); }}
              >
                {brand.slice(0, 2).toUpperCase()}
              </button>
              {profile && (
                <div className="popover">
                  <strong>{brand}</strong>
                  <small>Data tersimpan di Supabase</small>
                  <Link to="/onboarding/1"><Building2 size={15}/> Edit profil</Link>
                  <Link to="/app/integrations"><Settings2 size={15}/> Integrasi</Link>
                  <button onClick={async () => { await signOut(); navigate('/login'); }}>Keluar</button>
                </div>
              )}
            </div>
          </div>
        </header>

        {/* Page content */}
        <main id="main" tabIndex={-1} className="page-canvas">
          {storageError && (
            <Notice tone="amber">{storageError} <Link to="/app/integrations">Kelola data</Link></Notice>
          )}
          <Outlet/>
        </main>

        <footer className="app-footer">
          <span>FunnelLens</span>
          <span>Revisi UI · Data simulasi</span>
        </footer>
      </div>

      {/* Modals */}
      <GlobalSearch open={search} onClose={() => setSearch(false)}/>
      <Modal open={help} onClose={() => setHelp(false)} title="Panduan mencoba FunnelLens">
        <div className="stack">
          <p>Mulai dari onboarding untuk menyimpan profil, memilih brand, dan mensimulasikan campaign pertama.</p>
          <Notice>Semua metrik insight adalah data dummy. Tombol koneksi, AI, budget, dan pengiriman hanya mengubah simulasi lokal.</Notice>
          <ul className="readable-list">
            <li>Ubah campaign dan periode melalui filter di atas.</li>
            <li>Klik tahap, baris lead, atau creative untuk membuka bukti.</li>
            <li>Gunakan Integrations &amp; Data untuk ekspor, impor, atau reset workspace.</li>
            <li>Tekan Ctrl/⌘ + K untuk pencarian global.</li>
          </ul>
          <Button onClick={() => { setHelp(false); navigate('/onboarding/1'); }}>Buka onboarding</Button>
        </div>
      </Modal>
    </div>
  );
}

/* ── Root app ─────────────────────────────────────────────────── */
export default function App() {
  return (
    <AuthProvider>
      <WorkspaceProvider>
        <ToastProvider>
          <Routes>
            <Route path="/" element={<Landing/>}/>
            <Route path="/login" element={<Login/>}/>
            <Route element={<Protected/>}>
              <Route path="/saved" element={<SavedDraft/>}/>
              <Route path="/onboarding/:step" element={<Onboarding/>}/>
              <Route path="/app/integrations" element={<Shell/>}>
                <Route index element={<Integrations/>}/>
              </Route>
              <Route path="/app/*" element={<ReferenceDashboard/>}/>
            </Route>
            <Route path="*" element={<Navigate to="/" replace/>}/>
          </Routes>
        </ToastProvider>
      </WorkspaceProvider>
    </AuthProvider>
  );
}
