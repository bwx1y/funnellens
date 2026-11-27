import React, { useEffect, useState } from 'react';
import { Navigate, NavLink, Link, Outlet, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import {
  ArrowRight, Bell, Building2, ChartNoAxesCombined,
  ChevronDown, CircleHelp, FileText, Home, Image, Layers,
  Menu, Search, Settings2, SlidersHorizontal,
  Sparkles, Target, TrendingUp, Users
} from 'lucide-react';
import { WorkspaceProvider, useWorkspace } from './context.jsx';
import { AuthProvider, useAuth } from './auth.jsx';
import Login from './pages/Login.jsx';
import Landing from './pages/Landing.jsx';
import { Badge, Button, Logo, Modal, Notice, SearchInput, ToastProvider } from './components/ui.jsx';
import { apiRequest } from './lib/supabase.js';
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
import {
  ComparisonPage, ConversationsPage, FatiguePage, LeakagePage,
  PipelinePage, QualityPage, ReportsPage, SpeedPage, TrackingPage,
} from './pages/IntelSubpages.jsx';
import { APP_PAGE_GROUPS, APP_SECONDARY_NAV } from './lib/navigation.js';

const NAV = [
  { path: 'overview', label: 'Ringkasan', icon: Home },
  ...APP_PAGE_GROUPS.flatMap(group => group.items),
  ...APP_SECONDARY_NAV,
  { path: 'campaigns', label: 'Campaign & Budget', icon: Layers },
  { path: 'strategy', label: 'Strategy & Recalibration', icon: Target },
  { path: 'business', label: 'Business Impact', icon: TrendingUp },
  { path: 'controls', label: 'Campaign Controls', icon: SlidersHorizontal },
  { path: 'integrations', label: 'Integrations & Data', icon: Settings2 },
];

const NAV_GROUPS = [
  ...APP_PAGE_GROUPS.map((group, index) => ({
    ...group,
    icon: [ChartNoAxesCombined, Users, Image][index],
  })),
];

function Protected() {
  const { session, ready } = useAuth();
  const location = useLocation();
  if (!ready) return <div className="auth-loading">Memeriksa sesi…</div>;
  return session ? <Outlet/> : <Navigate to="/login" state={{ from: location.pathname }} replace/>;
}

function SavedDraft() {
  const { workspace } = useWorkspace();
  return (
    <div className="welcome">
      <Logo/>
      <Badge color="teal">Workspace tersimpan</Badge>
      <h1>Lanjutkan saat Anda siap.</h1>
      <p>Profil bisnis dan pengaturan campaign Anda tersedia di workspace ini.</p>
      <div className="flex center">
        <Link className="btn btn-primary" to={`/onboarding/${workspace.onboarding.maxStep}`}>Lanjut onboarding <ArrowRight size={17}/></Link>
        <Link className="btn btn-secondary" to="/app/overview">Buka dashboard</Link>
      </div>
    </div>
  );
}

function GlobalSearch({ open, onClose }) {
  const [query, setQuery] = useState('');
  const navigate = useNavigate();
  const pages = NAV.map(n => ({ title: n.label, type: 'Halaman', route: `/app/${n.path}` }));
  const list = pages.filter(i => !query || i.title.toLowerCase().includes(query.toLowerCase())).slice(0, 12);

  return (
    <Modal open={open} onClose={onClose} title="Cari di workspace">
      <SearchInput value={query} onChange={setQuery} placeholder="Cari halaman…" autoFocus/>
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

function Shell() {
  const { workspace, patch, storageError } = useWorkspace();
  const { session, signOut } = useAuth();
  const [mobile, setMobile] = useState(false);
  const [search, setSearch] = useState(false);
  const [notifications, setNotifications] = useState(false);
  const [profile, setProfile] = useState(false);
  const [help, setHelp] = useState(false);
  const [alerts, setAlerts] = useState([]);
  const [campaigns, setCampaigns] = useState([]);
  const [expandedGroups, setExpandedGroups] = useState({
    funnel: true,
    audience: true,
    creative: true,
  });

  const location = useLocation();
  const navigate = useNavigate();
  const current = NAV.find(n => location.pathname === `/app/${n.path}`);

  useEffect(() => { setMobile(false); setProfile(false); setNotifications(false); window.scrollTo(0, 0); }, [location.pathname]);
  useEffect(() => {
    const key = e => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setSearch(v => !v); } };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const loadHeaderData = async () => {
      try {
        const [alertsResult, summary] = await Promise.all([
          apiRequest('/api/alerts?status=active'),
          apiRequest('/api/analytics/summary'),
        ]);
        if (cancelled) return;
        const nextCampaigns = summary?.campaigns || [];
        setAlerts(alertsResult?.items || alertsResult?.alerts || []);
        setCampaigns(nextCampaigns);
        const selected = workspace.preferences.campaign;
        if (selected !== 'all' && !nextCampaigns.some(c => (c.campaignId || c.id) === selected)) {
          patch('preferences', { campaign: 'all' });
        }
      } catch {
        if (!cancelled) {
          setAlerts([]);
          setCampaigns([]);
        }
      }
    };
    loadHeaderData();
    window.addEventListener('funnellens:account-changed', loadHeaderData);
    return () => {
      cancelled = true;
      window.removeEventListener('funnellens:account-changed', loadHeaderData);
    };
  }, [workspace.preferences.campaign, patch]);

  const brand = workspace.brand.name || session?.user?.tenant?.name || 'Workspace';

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main" onClick={e => { e.preventDefault(); document.getElementById('main')?.focus(); }}>Langsung ke konten</a>
      {mobile && <div className="sidebar-overlay" onClick={() => setMobile(false)}/>}

      <aside className={`sidebar ${mobile ? 'open' : ''}`}>
        <Link to="/app/overview" className="brand-link">
          <span className="brand-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 6h16l-6 8v5l-4 2v-7L4 6z"/>
            </svg>
          </span>
          <span>FunnelLens</span>
        </Link>

        <div className="workspace-id">
          <span className="workspace-avatar">{brand[0].toUpperCase()}</span>
          <div>
            <strong>{brand}</strong>
            <small>{session?.user?.email || 'Workspace aktif'}</small>
          </div>
        </div>

        <nav aria-label="Navigasi utama">
          <NavLink to="/app/overview" end className={({ isActive }) => `nav-link ${isActive ? 'selected' : ''}`}>
            <Home size={17}/>
            <span>Ringkasan</span>
          </NavLink>

          <span className="sidebar-caption">Analisis</span>
          {NAV_GROUPS.map(group => (
            <details
              key={group.label}
              className="nav-group"
              open={expandedGroups[group.key]}
              onToggle={event => {
                const isOpen = event.currentTarget.open;
                setExpandedGroups(current => ({
                  ...current,
                  [group.key]: isOpen,
                }));
              }}
            >
              <summary>
                <group.icon size={17}/>
                <span>{group.label}</span>
                <ChevronDown size={14} className="nav-caret"/>
              </summary>
              <div className="nav-children">
                {group.items.map(item => (
                  <NavLink key={item.path} to={`/app/${item.path}`} end className={({ isActive }) => isActive ? 'active' : ''}>
                    {item.label}
                  </NavLink>
                ))}
              </div>
            </details>
          ))}
        </nav>

        <div className="nav-divider"/>

        <nav aria-label="Menu lainnya">
          {APP_SECONDARY_NAV.map((item, index) => {
            const Icon = [Bell, FileText, Settings2][index];
            return (
              <NavLink key={item.path} to={`/app/${item.path}`} end className={({ isActive }) => `nav-link ${isActive ? 'selected' : ''}`}>
                <Icon size={16}/>
                <span>{item.label}</span>
                {item.path === 'insights' && alerts.length > 0 && (
                  <span className="nav-count">{alerts.length > 99 ? '99+' : alerts.length}</span>
                )}
              </NavLink>
            );
          })}
        </nav>

        <div className="sidebar-bottom">
          <button className="help-link" onClick={() => setHelp(true)}>
            <CircleHelp size={16}/> Tentang FunnelLens
          </button>
        </div>
      </aside>

      <div className="app-main">
        <header className="topbar">
          <button className="icon-btn mobile-menu" aria-label="Buka navigasi" onClick={() => setMobile(true)}>
            <Menu size={21}/>
          </button>

          <div className="topbar-context">
            <div className="breadcrumb">
              Workspace <span>/</span> <strong>{current?.label || (location.pathname.includes('controls') ? 'Campaign Controls' : 'Integrations & Data')}</strong>
            </div>

            <button className="global-search-btn" aria-label="Cari di workspace" onClick={() => setSearch(true)}>
              <Search size={15}/>
              <span>Cari di workspace</span>
              <kbd>⌘ K</kbd>
            </button>
          </div>

          <div className="topbar-actions">
            <select
              className="top-select"
              aria-label="Periode"
              value={workspace.preferences.period || '30'}
              onChange={e => patch('preferences', { period: e.target.value })}
            >
              <option value="7">7 hari terakhir</option>
              <option value="14">14 hari terakhir</option>
              <option value="30">30 hari terakhir</option>
            </select>

            <select
              className="top-select campaign-global"
              aria-label="Campaign global"
              value={workspace.preferences.campaign}
              onChange={e => patch('preferences', { campaign: e.target.value })}
            >
              <option value="all">Semua campaign</option>
              {campaigns.map(c => <option key={c.campaignId || c.id} value={c.campaignId || c.id}>{c.name}</option>)}
            </select>

            <div className="popover-anchor">
              <button
                className="icon-btn notification-btn"
                aria-label="Notifikasi"
                onClick={() => { setNotifications(v => !v); setProfile(false); }}
              >
                <Bell size={18}/>
                {alerts.length > 0 && <i/>}
              </button>
              {notifications && (
                <div className="popover notifications">
                  <h3>Peringatan</h3>
                  {alerts.length ? alerts.slice(0, 5).map(a => (
                    <Link key={a.id} to="/app/insights">
                      <Sparkles size={15}/>
                      <span>{a.title}<small>{a.severity || 'Info'}</small></span>
                    </Link>
                  )) : <p className="muted small">Belum ada peringatan aktif.</p>}
                </div>
              )}
            </div>

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
                  <small>{session?.user?.email}</small>
                  <Link to="/onboarding/1"><Building2 size={15}/> Edit profil</Link>
                  <Link to="/app/integrations"><Settings2 size={15}/> Integrasi</Link>
                  <button onClick={async () => { await signOut(); navigate('/login'); }}>Keluar</button>
                </div>
              )}
            </div>
          </div>
        </header>

        <main id="main" tabIndex={-1} className="page-canvas">
          {storageError && <Notice tone="amber">{storageError}</Notice>}
          <Outlet/>
        </main>

        <footer className="app-footer">
          <span><span className="status-dot"/> FunnelLens · Production Workspace</span>
          <span>Meta Ads &amp; WhatsApp Intelligence</span>
        </footer>
      </div>

      <GlobalSearch open={search} onClose={() => setSearch(false)}/>
      <Modal open={help} onClose={() => setHelp(false)} title="Tentang FunnelLens">
        <div className="stack">
          <p>Hubungkan akun Meta Ads melalui OAuth dan sesi WhatsApp OpenWA di halaman Integrations &amp; Data untuk mulai menarik data asli.</p>
          <ul className="readable-list">
            <li>Buka <strong>Integrations &amp; Data</strong> untuk menghubungkan Meta OAuth dan memilih Ad Account.</li>
            <li>Gunakan filter periode dan campaign di bagian atas untuk memfilter metrik.</li>
            <li>Tekan Ctrl/⌘ + K untuk pencarian cepat.</li>
          </ul>
          <Button onClick={() => { setHelp(false); navigate('/app/integrations'); }}>Buka Integrations &amp; Data</Button>
        </div>
      </Modal>
    </div>
  );
}

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
              <Route path="/app" element={<Shell/>}>
                <Route index element={<Navigate to="overview" replace/>}/>
                <Route path="overview" element={<Overview/>}/>
                <Route path="funnel" element={<Funnel/>}/>
                <Route path="funnel/leakage" element={<LeakagePage/>}/>
                <Route path="audience" element={<Audience/>}/>
                <Route path="audience/speed" element={<SpeedPage/>}/>
                <Route path="audience/pipeline" element={<PipelinePage/>}/>
                <Route path="audience/conversations" element={<ConversationsPage/>}/>
                <Route path="tracking" element={<TrackingPage/>}/>
                <Route path="campaigns" element={<Campaign/>}/>
                <Route path="creative" element={<Creative/>}/>
                <Route path="creative/fatigue" element={<FatiguePage/>}/>
                <Route path="creative/quality" element={<QualityPage/>}/>
                <Route path="creative/compare" element={<ComparisonPage/>}/>
                <Route path="insights" element={<Insights/>}/>
                <Route path="reports" element={<ReportsPage/>}/>
                <Route path="settings" element={<Integrations/>}/>
                <Route path="strategy" element={<Strategy/>}/>
                <Route path="business" element={<Business/>}/>
                <Route path="controls" element={<Controls/>}/>
                <Route path="integrations" element={<Integrations/>}/>
              </Route>
            </Route>
            <Route path="*" element={<Navigate to="/" replace/>}/>
          </Routes>
        </ToastProvider>
      </WorkspaceProvider>
    </AuthProvider>
  );
}
