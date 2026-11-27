import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Users } from 'lucide-react';
import { useWorkspace } from '../context.jsx';
import { Badge, EmptyState, PageHead, Panel, SearchInput, SectionHead } from '../components/ui.jsx';
import { apiRequest } from '../lib/supabase.js';

export default function Audience() {
  const { workspace } = useWorkspace();
  const { campaign, period } = workspace.preferences;
  const [leads, setLeads] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const days = ['7', '14', '30'].includes(String(period)) ? String(period) : '30';
    const qs = new URLSearchParams({
      days,
      ...(campaign && campaign !== 'all' ? { campaignId: campaign } : {}),
      ...(search ? { search } : {}),
    });
    apiRequest(`/api/leads?${qs.toString()}`)
      .then(res => { if (!cancelled) setLeads(res?.items || res?.leads || []); })
      .catch(() => { if (!cancelled) setLeads([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [campaign, period, search]);

  return (
    <div className="stack">
      <PageHead
        eyebrow="AUDIENCE INTELLIGENCE"
        title="Daftar lead & klasifikasi AI."
        description="Prospek dari WhatsApp dan landing page yang diklasifikasikan otomatis."
      />

      <Panel>
        <SectionHead
          title="Daftar Lead"
          caption={`${leads.length} lead tercatat`}
          action={<SearchInput value={search} onChange={setSearch} placeholder="Cari lead…"/>}
        />

        {loading ? (
          <p className="muted">Memuat data lead…</p>
        ) : !leads.length ? (
          <EmptyState
            icon={Users}
            title="Belum ada lead masuk"
            description="Hubungkan WhatsApp OpenWA atau Landing Page Tracker agar lead mulai masuk dan diklasifikasikan oleh AI."
            action={<Link className="btn btn-primary" to="/app/integrations">Atur Integrasi</Link>}
          />
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Kontak / ID</th>
                  <th>Temperatur</th>
                  <th>Sumber</th>
                  <th>Ringkasan Sinyal</th>
                  <th>Terakhir Aktif</th>
                </tr>
              </thead>
              <tbody>
                {leads.map(l => (
                  <tr key={l.id}>
                    <td><strong>{l.name || l.phoneMasked || l.maskedPhone || l.id}</strong></td>
                    <td>
                      <Badge color={l.temperature === 'HOT' ? 'amber' : l.temperature === 'WARM' ? 'teal' : 'blue'}>
                        {l.temperature || l.level || 'COLD'}
                      </Badge>
                    </td>
                    <td>{l.channel || l.source || 'whatsapp'}</td>
                    <td className="muted">{l.summary || l.topic || l.responseType || l.signal || '-'}</td>
                    <td className="small muted">{l.createdAt ? new Date(l.createdAt).toLocaleString('id-ID') : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
