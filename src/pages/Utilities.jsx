import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowRight, Check, Database, Download, Globe, Link2, MessageCircle,
  Plus, RefreshCw, RotateCcw, Trash2, Upload
} from 'lucide-react';
import { useWorkspace } from '../context.jsx';
import { Badge, Button, EmptyState, Field, Input, Modal, Notice, PageHead, Panel, Select, useToast } from '../components/ui.jsx';
import { download, shortMoney } from '../lib/domain.js';
import { apiRequest } from '../lib/supabase.js';

export function Controls() {
  const { workspace: w, setWorkspace } = useWorkspace();
  const toast = useToast();
  const navigate = useNavigate();
  const [campaigns, setCampaigns] = useState([]);
  const [loading, setLoading] = useState(true);

  const loadCampaigns = async () => {
    setLoading(true);
    try {
      const res = await apiRequest('/api/analytics/summary');
      setCampaigns(res?.campaigns || []);
    } catch {
      setCampaigns([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadCampaigns(); }, []);

  const newCampaign = () => {
    if (!w.business.name || !w.brand.name) {
      navigate('/onboarding/1');
      toast('Lengkapi profil dan brand terlebih dahulu.');
      return;
    }
    setWorkspace(prev => ({
      ...prev,
      onboarding: { ...prev.onboarding, completed: false, maxStep: 3 },
      campaign: { ...prev.campaign, name: `${prev.brand.name} | Campaign baru` },
      execution: { ...prev.execution, status: 'draft', progress: 0, receiptId: null, approvedSnapshot: null },
    }));
    navigate('/onboarding/3');
  };

  return (
    <div className="stack">
      <PageHead
        eyebrow="KONTROL CAMPAIGN"
        filters={false}
        title="Campaign & kontrol."
        description="Daftar campaign aktif dari akun iklan Meta yang terhubung."
        action={<Button icon={Plus} onClick={newCampaign}>Campaign baru</Button>}
      />

      <Panel>
        <div className="section-head">
          <div>
            <h2>Campaign Meta Ads</h2>
            <p className="muted small">Data disinkronkan dari Meta Marketing API.</p>
          </div>
          <Button variant="secondary" icon={RefreshCw} onClick={loadCampaigns} loading={loading}>
            Muat ulang
          </Button>
        </div>

        {campaigns.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Campaign</th>
                  <th>Kanal</th>
                  <th>Spend</th>
                  <th>Klik</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {campaigns.map(c => (
                  <tr key={c.id}>
                    <td>
                      <strong>{c.name}</strong>
                      <small className="cell-caption">ID {c.id}</small>
                    </td>
                    <td><Badge color="blue">{c.channel || 'meta'}</Badge></td>
                    <td>{shortMoney(c.spend || 0)}</td>
                    <td>{c.clicks ?? 0}</td>
                    <td><Badge color={c.status === 'ACTIVE' ? 'teal' : 'gray'}>{c.status || 'UNKNOWN'}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            title="Belum ada campaign tersinkron"
            description="Hubungkan Meta OAuth di halaman Integrations & Data lalu pilih Ad Account untuk mulai menyinkronkan campaign."
            action={<Link className="btn btn-primary" to="/app/integrations">Hubungkan Meta Ads</Link>}
          />
        )}
      </Panel>
    </div>
  );
}

export function Integrations() {
  const { workspace: w, patch, reset, importWorkspace, storageError, connected } = useWorkspace();
  const toast = useToast();
  const navigate = useNavigate();

  const [confirmReset, setConfirmReset] = useState(false);
  const [importData, setImportData] = useState(null);
  const [importError, setImportError] = useState('');
  const [lpSettings, setLpSettings] = useState(false);
  const [headline, setHeadline] = useState(w.campaign.lpHeadline || '');

  const [metaConn, setMetaConn] = useState(null);
  const [metaAccounts, setMetaAccounts] = useState([]);
  const [selectedAccount, setSelectedAccount] = useState(null);
  const [waSessions, setWaSessions] = useState([]);
  const [sources, setSources] = useState([]);
  const [busy, setBusy] = useState('');
  const fileRef = useRef();

  const refreshAll = async () => {
    try {
      const conn = await apiRequest('/api/meta/connection');
      setMetaConn(conn || null);
      if (conn) {
        try {
          const accRes = await apiRequest('/api/meta/accounts');
          setMetaAccounts(accRes?.accounts || accRes || []);
        } catch {
          setMetaAccounts([]);
        }
        try {
          const sel = await apiRequest('/api/meta/accounts/selected');
          setSelectedAccount(sel || null);
        } catch {
          setSelectedAccount(null);
        }
      } else {
        setMetaAccounts([]);
        setSelectedAccount(null);
      }
    } catch {
      setMetaConn(null);
    }

    try {
      const waRes = await apiRequest('/api/wa/session');
      setWaSessions(Array.isArray(waRes) ? waRes : waRes?.sessions || []);
    } catch {
      setWaSessions([]);
    }

    try {
      const srcRes = await apiRequest('/api/sources');
      setSources(srcRes?.sources || []);
    } catch {
      setSources([]);
    }
  };

  useEffect(() => {
    refreshAll();
  }, []);

  const connectMeta = async () => {
    setBusy('meta');
    try {
      const result = await apiRequest('/api/meta/oauth/url');
      const url = result?.url || result?.data?.url;
      if (!url) throw new Error('URL Meta OAuth tidak ditemukan.');
      window.location.assign(url);
    } catch (error) {
      toast(error.message, 'error');
      setBusy('');
    }
  };

  const disconnectMeta = async () => {
    setBusy('meta-disconnect');
    try {
      await apiRequest('/api/meta/connection', { method: 'DELETE' });
      setMetaConn(null);
      setMetaAccounts([]);
      setSelectedAccount(null);
      toast('Koneksi Meta Ads diputus.');
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      setBusy('');
    }
  };

  const selectAdAccount = async (accountId) => {
    if (!accountId) return;
    setBusy('select-account');
    try {
      const res = await apiRequest('/api/meta/accounts/select', {
        method: 'POST',
        body: JSON.stringify({ accountId }),
      });
      setSelectedAccount(res);
      toast('Ad Account dipilih.');
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      setBusy('');
    }
  };

  const syncMetaNow = async () => {
    setBusy('sync-meta');
    try {
      await apiRequest('/api/meta/sync/master', { method: 'POST', body: '{}' });
      await apiRequest('/api/meta/sync/insights', { method: 'POST', body: '{}' });
      toast('Sinkronisasi data Meta Ads selesai.');
      await refreshAll();
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      setBusy('');
    }
  };

  const createWaSession = async () => {
    setBusy('wa');
    try {
      await apiRequest('/api/wa/session', {
        method: 'POST',
        body: JSON.stringify({ name: w.brand.name || 'default-session' }),
      });
      toast('Sesi WhatsApp dibuat. Silakan scan QR di gateway OpenWA.');
      await refreshAll();
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      setBusy('');
    }
  };

  const exportData = () => {
    download('funnellens-workspace.json', JSON.stringify(w, null, 2));
    toast('Workspace berhasil diekspor.');
  };

  const readImport = file => {
    setImportError('');
    if (!file) return;
    if (file.size > 5000000) { setImportError('File maksimal 5 MB.'); return; }
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const value = JSON.parse(reader.result);
        if (value.version !== 1 || !value.business || typeof value.business.name !== 'string') {
          throw Error('Format file tidak sesuai.');
        }
        setImportData(value);
      } catch (e) {
        setImportError(`File tidak dapat diimpor: ${e.message}`);
      }
    };
    reader.readAsText(file);
  };

  const waReady = waSessions.some(s => s.status === 'ready' || s.status === 'AUTHENTICATED');
  const pixelSource = sources.find(s => s.key === 'pixel' || s.source === 'pixel');
  const metaConnected = Boolean(metaConn);

  return (
    <div className="stack">
      <PageHead
        eyebrow="INTEGRASI & DATA"
        filters={false}
        title="Kelola koneksi dan data FunnelLens."
        description="Hubungkan Meta Ads OAuth, WhatsApp OpenWA, dan Pixel tracking untuk mulai menarik data asli."
        action={<Button variant="secondary" onClick={() => navigate('/onboarding/1')}>Edit profil bisnis</Button>}
      />

      {storageError && <Notice tone="amber">{storageError}</Notice>}

      <div className="grid grid-3">
        <IntegrationCard
          icon={Link2}
          title="Meta Ads (OAuth)"
          connected={metaConnected}
          description={
            metaConnected
              ? `Terhubung sebagai ${metaConn.metaUserName || metaConn.metaUserId || 'Meta User'}.`
              : 'Hubungkan akun Meta Ads via OAuth untuk membaca campaign, ad set, creative, dan insights.'
          }
          busy={busy === 'meta'}
          onToggle={connectMeta}
          action={metaConnected ? 'Sambungkan ulang OAuth' : 'Hubungkan Meta OAuth'}
          onManage={metaConnected ? syncMetaNow : connectMeta}
          manageLabel={metaConnected ? (busy === 'sync-meta' ? 'Menyinkronkan…' : 'Sinkronkan data sekarang') : 'Mulai OAuth'}
        />

        <IntegrationCard
          icon={MessageCircle}
          title="WhatsApp OpenWA"
          connected={waReady}
          description={
            waReady
              ? `${waSessions.length} sesi WhatsApp aktif dan siap menerima pesan.`
              : 'Buat sesi WhatsApp dan tautkan QR di gateway OpenWA untuk klasifikasi lead otomatis.'
          }
          busy={busy === 'wa'}
          onToggle={createWaSession}
          action={waReady ? 'Tambah sesi baru' : 'Buat sesi WhatsApp'}
          onManage={refreshAll}
          manageLabel="Periksa status sesi"
        />

        <IntegrationCard
          icon={Globe}
          title="Landing Page & Pixel"
          connected={pixelSource?.status === 'ok'}
          description={
            pixelSource?.status === 'ok'
              ? 'Tracking Pixel & CAPI aktif.'
              : 'Pasang Meta Pixel atau snippet tracker di landing page Anda.'
          }
          busy={false}
          onToggle={() => setLpSettings(true)}
          action="Lihat konfigurasi"
          onManage={() => setLpSettings(true)}
          manageLabel="Pengaturan tracker"
        />
      </div>

      {metaConnected && (
        <Panel>
          <div className="section-head">
            <div>
              <h2>Akun Iklan Meta (Ad Account)</h2>
              <p className="muted small">Pilih Ad Account yang akan digunakan untuk analitik FunnelLens.</p>
            </div>
            <div className="flex wrap">
              <Button variant="secondary" icon={RefreshCw} onClick={syncMetaNow} loading={busy === 'sync-meta'}>
                Sync Master &amp; Insights
              </Button>
              <Button variant="danger" icon={Trash2} onClick={disconnectMeta} loading={busy === 'meta-disconnect'}>
                Putuskan Meta
              </Button>
            </div>
          </div>

          {metaAccounts.length ? (
            <div className="flex wrap">
              <Select
                value={selectedAccount?.accountId || selectedAccount?.id || ''}
                onChange={e => selectAdAccount(e.target.value)}
                disabled={busy === 'select-account'}
              >
                <option value="">-- Pilih Ad Account --</option>
                {metaAccounts.map(acc => {
                  const id = acc.accountId || acc.id;
                  return (
                    <option key={id} value={id}>
                      {acc.name} ({id})
                    </option>
                  );
                })}
              </Select>
              {selectedAccount && (
                <Badge color="teal"><Check size={13}/> Aktif: {selectedAccount.name || selectedAccount.accountId}</Badge>
              )}
            </div>
          ) : (
            <EmptyState
              title="Belum ada Ad Account ditemukan"
              description="Pastikan akun Facebook Anda memiliki akses ke Ad Account Meta Ads, lalu muat ulang."
              action={<Button variant="secondary" onClick={refreshAll}>Muat ulang akun</Button>}
            />
          )}
        </Panel>
      )}

      <Panel className="workspace-storage-panel">
        <div className="section-head">
          <div>
            <h2>Penyimpanan workspace</h2>
            <p className="muted small">Ekspor, impor, atau reset konfigurasi workspace Anda.</p>
          </div>
          <Badge color={connected ? 'teal' : 'gray'}><Database size={13}/> {connected ? 'Terhubung API' : 'Lokal'}</Badge>
        </div>
        <div className="workspace-actions">
          <div className="workspace-action">
            <span className="workspace-action-icon"><Download size={20}/></span>
            <h3>Ekspor workspace</h3>
            <p>Simpan salinan profil bisnis dan konfigurasi workspace untuk digunakan kembali.</p>
            <Button variant="secondary" onClick={exportData}>Unduh JSON</Button>
          </div>
          <div className="workspace-action">
            <span className="workspace-action-icon"><Upload size={20}/></span>
            <h3>Impor workspace</h3>
            <p>Pulihkan konfigurasi FunnelLens dari file JSON yang sudah Anda simpan.</p>
            <input
              ref={fileRef}
              type="file"
              className="visually-hidden"
              accept="application/json,.json"
              onChange={e => { readImport(e.target.files[0]); e.target.value = ''; }}
            />
            <Button variant="secondary" onClick={() => fileRef.current.click()}>Pilih file JSON</Button>
            {importError && <p className="error-text">{importError}</p>}
          </div>
          <div className="workspace-action">
            <span className="workspace-action-icon"><RotateCcw size={20}/></span>
            <h3>Reset workspace</h3>
            <p>Kosongkan seluruh profil dan pengaturan workspace ini.</p>
            <Button variant="danger" onClick={() => setConfirmReset(true)}>Reset workspace</Button>
          </div>
        </div>
      </Panel>

      <Modal
        open={confirmReset}
        onClose={() => setConfirmReset(false)}
        title="Reset workspace?"
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmReset(false)}>Batal</Button>
            <Button
              variant="danger"
              onClick={async () => {
                try {
                  await reset();
                  setConfirmReset(false);
                  navigate('/onboarding/1');
                  toast('Workspace direset.');
                } catch (error) {
                  toast(error.message, 'error');
                }
              }}
            >
              Hapus &amp; mulai ulang
            </Button>
          </>
        }
      >
        <p>Profil bisnis dan pengaturan workspace akan dihapus. Ekspor terlebih dahulu jika ingin menyimpannya.</p>
      </Modal>

      <Modal
        open={!!importData}
        onClose={() => setImportData(null)}
        title="Impor workspace"
        footer={
          <Button
            onClick={() => {
              try {
                importWorkspace(importData);
                setImportData(null);
                toast('Workspace berhasil dipulihkan.');
              } catch (e) {
                toast(e.message, 'error');
              }
            }}
          >
            Ganti workspace
          </Button>
        }
      >
        <p>Workspace <strong>{importData?.business?.name || 'tanpa nama'}</strong> akan menggantikan pengaturan saat ini.</p>
      </Modal>

      <Modal
        open={lpSettings}
        onClose={() => setLpSettings(false)}
        title="Konfigurasi Landing Page Tracker"
        footer={
          <Button onClick={() => { patch('campaign', { lpHeadline: headline }); setLpSettings(false); toast('Pengaturan disimpan.'); }}>
            Simpan
          </Button>
        }
      >
        <div className="stack">
          <Field label="Headline form / Landing Page">
            <Input value={headline} onChange={e => setHeadline(e.target.value)} placeholder="Contoh: Konsultasi Gratis"/>
          </Field>
          <Notice>Tambahkan Meta Pixel &amp; Conversions API pada landing page agar event PageView, ViewContent, dan Purchase masuk ke FunnelLens.</Notice>
        </div>
      </Modal>
    </div>
  );
}

function IntegrationCard({ icon: Icon, title, description, connected, onToggle, onManage, action, manageLabel, busy }) {
  return (
    <Panel className="integration-card">
      <span className="integration-icon"><Icon size={26}/></span>
      <div className="flex between">
        <h2>{title}</h2>
        <Badge color={connected ? 'teal' : 'gray'}>{connected ? 'Terhubung' : 'Belum terhubung'}</Badge>
      </div>
      <p className="muted">{description}</p>
      <Button className="integration-primary-action" variant={connected ? 'secondary' : 'primary'} disabled={busy} onClick={onToggle}>
        {busy ? 'Memproses…' : action}
      </Button>
      <Button className="integration-manage-action" variant="ghost" onClick={onManage}>
        {manageLabel || 'Kelola / lihat detail'} <ArrowRight size={15}/>
      </Button>
    </Panel>
  );
}
