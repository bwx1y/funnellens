import React, { useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Modal, Notice, SearchInput } from '../components/ui.jsx';
import { useWorkspace } from '../context.jsx';
import { useAuth } from '../auth.jsx';
import { campaigns, creatives, leads } from '../lib/referenceData.js';
import {
  navigationGroups,
  pageNames,
  pageSubtitles,
  secondaryPages,
  useReference,
} from './ReferenceContext.jsx';
import { currentInsights } from './ReferencePages.jsx';
import ReferenceSelect from './ReferenceSelect.jsx';
import { Icon } from './ui.jsx';

function routeGroup(route) {
  return navigationGroups.find(group => group.items.some(([id]) => id === route));
}

function ReferenceSidebar() {
  const context = useReference();
  const unread = currentInsights(context).filter(item => !context.history[item.historyKey]).length;
  const accountName = context.account === 'demo' ? 'ABT Grosir' : 'Akun baru';
  return <>
    {context.menu && <button className="scrim" aria-label="Tutup navigasi" onClick={() => context.setMenu(false)} />}
    <aside className={`sidebar ${context.menu ? 'open' : ''}`} id="sidebar">
      <Link to="/app/ringkasan" className="brand"><span className="brand-icon"><Icon name="funnel" size={23} /></span>FunnelLens<span className="brand-dot">.</span></Link>
      <button type="button" className="drawer-close" aria-label="Tutup navigasi" onClick={() => context.setMenu(false)}><Icon name="x" /></button>
      <div className="workspace-id"><span className="workspace-avatar">A</span><span><strong>{accountName}</strong><small>Workspace demo</small></span></div>
      <nav aria-label="Menu aplikasi">
        <Link to="/app/ringkasan" className={`nav-link ${context.route === 'ringkasan' ? 'selected' : ''}`} aria-current={context.route === 'ringkasan' ? 'page' : undefined}><Icon name="layout-dashboard" /><span>Ringkasan</span></Link>
        <span className="nav-caption separate">Analisis</span>
        {navigationGroups.map(group => <details className="nav-group" key={group.id} open={group.items.some(([id]) => id === context.route)}>
          <summary><Icon name={group.icon} /><span>{group.label}</span><Icon name="chevron-down" className="nav-caret" size={14} /></summary>
          <div className="nav-children">{group.items.map(([id, label]) => <Link key={id} to={`/app/${id}`} aria-current={context.route === id ? 'page' : undefined}>{label}</Link>)}</div>
        </details>)}
        <div className="nav-divider" />
        {secondaryPages.map(([id, label, icon]) => <Link className={`nav-link ${context.route === id ? 'selected' : ''}`} key={id} to={`/app/${id}`} aria-current={context.route === id ? 'page' : undefined}>
          <Icon name={icon} /><span>{label}</span>{id === 'peringatan' && unread > 0 && <span className="nav-count">{unread}</span>}
        </Link>)}
      </nav>
      <div className="sidebar-bottom"><button className="help-link" type="button" onClick={() => context.setModal({ type: 'about' })}><Icon name="circle-help" />Tentang FunnelLens</button></div>
    </aside>
  </>;
}

function AccountSwitch() {
  const context = useReference();
  return <ReferenceSelect
    variant="account"
    label="Akun iklan"
    value={context.account}
    options={[{ value: 'demo', label: 'Akun Iklan ABT' }, { value: 'empty', label: 'Akun baru' }]}
    onChange={context.setAccount}
    icon="layers-2"
  />;
}

function ReferenceTopbar() {
  const context = useReference();
  const unread = currentInsights(context).filter(item => !context.history[item.historyKey]).length;
  const overview = context.route === 'ringkasan';
  return <header className="topbar" id="topbar">
    <div className="top-left">
      <button className="icon-button mobile-menu" type="button" aria-controls="sidebar" aria-expanded={context.menu} aria-label="Buka navigasi" onClick={() => context.setMenu(true)}><Icon name="menu" size={21} /></button>
      {overview ? <button className="search-shortcut" type="button" onClick={() => { context.setSearch(''); context.setSearchOpen(true); }}><Icon name="search" /><span>Cari halaman atau lead</span><kbd>Ctrl K</kbd></button> : <AccountSwitch />}
    </div>
    <div className="top-right">
      {overview ? <AccountSwitch /> : <button className="search-shortcut compact-search" type="button" aria-label="Cari halaman atau lead" onClick={() => { context.setSearch(''); context.setSearchOpen(true); }}><Icon name="search" /><span>Cari</span><kbd>Ctrl K</kbd></button>}
      <button className="icon-button alert-button" type="button" aria-label={`Peringatan${unread ? `, ${unread} baru` : ''}`} onClick={() => context.goTo('peringatan')}><Icon name="bell" />{unread > 0 && <i />}</button>
      <button className="top-avatar" type="button" aria-label="Pengaturan workspace" onClick={() => context.goTo('pengaturan')}>AB</button>
    </div>
  </header>;
}

function PageHeading() {
  const context = useReference();
  const group = routeGroup(context.route);
  const showFilters = context.account === 'demo' && context.route !== 'pengaturan' && context.route !== 'tracking';
  return <>
    <div className="page-heading">
      <div>{group && <div className="breadcrumb"><Icon name={group.icon} />{group.label}</div>}<h1>{pageNames[context.route] || 'Ringkasan'}</h1><p>{pageSubtitles[context.route] || pageSubtitles.ringkasan}</p></div>
      {showFilters && <div className="global-filters">
        <ReferenceSelect
          label="Campaign"
          value={context.campaign}
          options={[{ value: 'all', label: 'Semua campaign' }, ...campaigns.map(campaign => ({ value: campaign.id, label: campaign.name }))]}
          onChange={context.changeCampaign}
          icon="layers-2"
        />
        {context.route === 'kreatif' ? null : group?.id === 'kreatif'
          ? <span className="button secondary static-date"><Icon name="calendar-days" />Snapshot 19 Nov</span>
          : <ReferenceSelect
            className="date-control"
            label="Periode"
            value={context.days}
            options={context.periods.map(period => ({ value: period.id, label: period.label }))}
            onChange={context.setDays}
            icon="calendar-days"
          />}
      </div>}
    </div>
    {group && <nav className="page-tabs" aria-label={`Halaman ${group.label}`}>{group.items.map(([id, label]) => <Link key={id} to={`/app/${id}`} aria-current={context.route === id ? 'page' : undefined}>{label}</Link>)}</nav>}
  </>;
}

function ReferenceSearch() {
  const context = useReference();
  const query = context.search;
  const pageItems = Object.entries(pageNames).map(([id, title]) => ({ title, type: 'Halaman', run: () => context.goTo(id) }));
  const dataItems = [
    ...campaigns.map(item => ({ title: item.name, type: 'Campaign', run: () => { context.changeCampaign(item.id); context.goTo('ringkasan'); } })),
    ...creatives.map(item => ({ title: item.name, type: 'Creative', run: () => { context.changeCampaign(item.campaign); context.goTo('kreatif'); context.setModal({ type: 'creative', id: item.id }); } })),
    ...leads.slice(0, 10).map(item => ({ title: item.alias, type: 'Lead demo', run: () => { context.setModal({ type: 'lead', id: item.id }); } })),
  ];
  const results = [...pageItems, ...dataItems].filter(item => !query || item.title.toLocaleLowerCase('id').includes(query.toLocaleLowerCase('id'))).slice(0, 12);
  return <Modal open={context.searchOpen} onClose={() => context.setSearchOpen(false)} title="Cari di FunnelLens">
    <SearchInput autoFocus value={query} onChange={context.setSearch} placeholder="Halaman, campaign, creative, atau lead…" />
    <div className="search-results">{results.map((item, index) => <button key={`${item.type}-${item.title}-${index}`} type="button" onClick={() => { item.run(); context.setSearchOpen(false); context.setSearch(''); }}>
      <span>{item.title}</span><span className="chip neutral">{item.type}</span><Icon name="chevron-right" />
    </button>)}{!results.length && <p className="muted">Tidak ditemukan. Coba kata lain.</p>}</div>
  </Modal>;
}

export default function ReferenceShell({ children }) {
  const context = useReference();
  const { storageError } = useWorkspace();
  const { signOut } = useAuth();

  useEffect(() => {
    if (!context.menu) return undefined;
    const onKeyDown = event => {
      if (event.key === 'Escape') context.setMenu(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [context.menu, context.setMenu]);

  const account = useMemo(() => context.account === 'demo' ? 'ABT Grosir' : 'Akun baru', [context.account]);
  return <div className={`layout ${context.menu ? 'menu-open' : ''}`}>
    <a className="skip" href="#main">Langsung ke konten</a>
    <ReferenceSidebar />
    <div className="workspace">
      <ReferenceTopbar />
      <main id="main" tabIndex={-1}>
        <PageHeading />
        {storageError && <Notice tone="amber">{storageError} <Link to="/app/integrations">Kelola data</Link></Notice>}
        {context.historyError && <Notice tone="amber">{context.historyError}</Notice>}
        <div className="page-content">{children}</div>
        <footer className="site-footer"><span>FunnelLens</span><span>Data simulasi · Snapshot 19 Nov 2026</span><button type="button" onClick={() => context.setModal({ type: 'about' })}>Tentang</button></footer>
      </main>
    </div>
    <ReferenceSearch />
    <Modal open={context.modal?.type === 'profile'} onClose={() => context.setModal(null)} title={`Workspace ${account}`}>
      <div className="stack"><p>Data simulasi FunnelLens.</p><Link className="button secondary" to="/app/integrations" onClick={() => context.setModal(null)}>Integrasi backend</Link><button className="button secondary" type="button" onClick={async () => { await signOut(); context.setModal(null); }}>Keluar</button></div>
    </Modal>
  </div>;
}
