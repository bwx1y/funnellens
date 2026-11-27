import React, { useState } from 'react';
import { Field, Input, PageHead, Panel, SectionHead } from '../components/ui.jsx';
import { number, shortMoney } from '../lib/domain.js';

export default function Strategy() {
  const [spend, setSpend] = useState(0);
  const [cpc, setCpc] = useState(1500);
  const [leadRate, setLeadRate] = useState(10);
  const [closeRate, setCloseRate] = useState(15);
  const [aov, setAov] = useState(250000);

  const estClicks = cpc > 0 ? Math.round(spend / cpc) : 0;
  const estLeads = Math.round(estClicks * (leadRate / 100));
  const estSales = Math.round(estLeads * (closeRate / 100));
  const estRevenue = estSales * aov;
  const estRoas = spend > 0 ? (estRevenue / spend).toFixed(2) : '0.00';

  return (
    <div className="stack">
      <PageHead
        eyebrow="STRATEGY & RECALIBRATION"
        title="Simulasi skenario anggaran."
        description="Hitung proyeksi klik, lead, dan pendapatan berdasarkan parameter target Anda."
      />

      <div className="grid grid-2">
        <Panel>
          <SectionHead title="Parameter Simulasi" caption="Masukkan target anggaran & konversi"/>
          <div className="stack">
            <Field label="Anggaran Iklan (IDR)">
              <Input type="number" min="0" step="100000" value={spend} onChange={e => setSpend(Number(e.target.value) || 0)}/>
            </Field>
            <Field label="Estimasi CPC (IDR)">
              <Input type="number" min="100" step="100" value={cpc} onChange={e => setCpc(Number(e.target.value) || 0)}/>
            </Field>
            <Field label="Rasio Klik ke Lead (%)">
              <Input type="number" min="0" max="100" value={leadRate} onChange={e => setLeadRate(Number(e.target.value) || 0)}/>
            </Field>
            <Field label="Rasio Lead ke Closing (%)">
              <Input type="number" min="0" max="100" value={closeRate} onChange={e => setCloseRate(Number(e.target.value) || 0)}/>
            </Field>
            <Field label="Rata-rata Nilai Order (IDR)">
              <Input type="number" min="0" step="10000" value={aov} onChange={e => setAov(Number(e.target.value) || 0)}/>
            </Field>
          </div>
        </Panel>

        <Panel>
          <SectionHead title="Proyeksi Hasil" caption="Kalkulasi otomatis"/>
          <div className="stack">
            <div className="flex between"><span>Estimasi Klik</span><strong>{number(estClicks)}</strong></div>
            <div className="flex between"><span>Estimasi Leads</span><strong>{number(estLeads)}</strong></div>
            <div className="flex between"><span>Estimasi Closing</span><strong>{number(estSales)}</strong></div>
            <div className="flex between"><span>Estimasi Revenue</span><strong>{shortMoney(estRevenue)}</strong></div>
            <div className="flex between"><span>Estimasi ROAS</span><strong>{estRoas}x</strong></div>
          </div>
        </Panel>
      </div>
    </div>
  );
}
