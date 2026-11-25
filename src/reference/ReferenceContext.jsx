import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useToast } from '../components/ui.jsx';
import {
  campaigns,
  creatives,
  leads,
  periods,
  selectCampaigns,
  visibleLeads,
} from './domain.js';

const ReferenceContext = createContext(null);
const HISTORY_KEY = 'funnellens-revisi-v1';

export const navigationGroups = [
  {
    id: 'funnel',
    label: 'Funnel Intelligence',
    icon: 'funnel',
    items: [
      ['funnel', 'Ikhtisar funnel'],
      ['kebocoran', 'Deteksi kebocoran'],
      ['kecepatan', 'Kecepatan & umur lead'],
      ['tracking', 'Kesehatan tracking'],
    ],
  },
  {
    id: 'audiens',
    label: 'Audience Intelligence',
    icon: 'users',
    items: [
      ['lead', 'Daftar lead'],
      ['pipeline', 'Papan pipeline'],
      ['percakapan', 'Insight percakapan'],
    ],
  },
  {
    id: 'kreatif',
    label: 'Creative Intelligence',
    icon: 'clapperboard',
    items: [
      ['kreatif', 'Analisis kreatif'],
      ['kejenuhan', 'Kejenuhan'],
      ['kualitas', 'Kualitas lead'],
      ['bandingkan', 'Perbandingan kreatif'],
    ],
  },
];

export const secondaryPages = [
  ['peringatan', 'Peringatan', 'bell'],
  ['laporan', 'Laporan', 'file-chart-column'],
  ['pengaturan', 'Pengaturan', 'settings'],
];

export const pageNames = Object.fromEntries([
  ['ringkasan', 'Ringkasan'],
  ...navigationGroups.flatMap(group => group.items),
  ...secondaryPages.map(([id, label]) => [id, label]),
]);

export const pageSubtitles = {
  ringkasan: 'Performa Meta Ads untuk WhatsApp dan website · Data simulasi',
  funnel: 'Volume dan konversi setiap tahap',
  kebocoran: 'Bandingkan konversi dengan periode sebelumnya',
  tracking: 'Periksa sumber, cakupan, dan keterlambatan data.',
  kecepatan: 'Lihat jeda dari pesan pengiklan sampai lead membalas.',
  pipeline: 'Lihat posisi lead menurut temperatur terbaru dari percakapan.',
  lead: 'Telusuri temperatur, sumber iklan, dan bukti percakapan.',
  percakapan: 'Telusuri jenis jawaban, sentimen, dan jeda setelah pesan CS.',
  kreatif: 'Tinjau performa campaign dan efektivitas konten iklan.',
  kejenuhan: 'Baca sinyal gabungan CTR, frekuensi, dan biaya per ad set.',
  kualitas: 'Hubungkan kualitas prospek WhatsApp dengan kreatif asalnya.',
  bandingkan: 'Bandingkan kekuatan, kelemahan, dan pesan setiap kreatif yang dipilih.',
  peringatan: 'Tinjau temuan dan simpan status tindak lanjut di prototipe.',
  laporan: 'Unduh data demonstrasi untuk periode dan campaign aktif.',
  pengaturan: 'Lihat konfigurasi sumber data dalam ruang kerja demo.',
};

const routeAliases = {
  overview: 'ringkasan',
  audience: 'lead',
  creative: 'kreatif',
  alerts: 'peringatan',
  reports: 'laporan',
  settings: 'pengaturan',
};

function readHistory() {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY)) || {};
  } catch {
    return {};
  }
}

export function ReferenceProvider({ children }) {
  const location = useLocation();
  const navigate = useNavigate();
  const toast = useToast();
  const requestedRoute = location.pathname.split('/').filter(Boolean).at(-1) || 'ringkasan';
  const route = routeAliases[requestedRoute] || requestedRoute;
  const [account, setAccount] = useState('demo');
  const [campaign, setCampaign] = useState('all');
  const [days, setDays] = useState(7);
  const [channel, setChannel] = useState('wa');
  const [leadLevel, setLeadLevel] = useState('Semua');
  const [leadSearch, setLeadSearch] = useState('');
  const [leadSort, setLeadSort] = useState('temperature');
  const [leadSortDirection, setLeadSortDirection] = useState(-1);
  const [leadPage, setLeadPage] = useState(1);
  const [leadPageSize, setLeadPageSize] = useState(10);
  const [pipelineSearch, setPipelineSearch] = useState('');
  const [creativeChannel, setCreativeChannel] = useState('all');
  const [creativeMetric, setCreativeMetric] = useState('clicks');
  const [compareType, setCompareType] = useState('obs');
  const [compareObjective, setCompareObjective] = useState('wa');
  const [compareSort, setCompareSort] = useState('name');
  const [compact, setCompact] = useState(false);
  const [selection, setSelection] = useState(() => new Set(['CL-101', 'CL-102']));
  const [alertTab, setAlertTab] = useState('active');
  const [history, setHistory] = useState(readHistory);
  const [historyError, setHistoryError] = useState('');
  const [menu, setMenu] = useState(false);
  const [modal, setModal] = useState(null);
  const [search, setSearch] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);

  const scope = useMemo(() => selectCampaigns(campaign, account), [campaign, account]);
  const filteredLeads = useMemo(
    () => visibleLeads(leads, campaign, days),
    [campaign, days],
  );
  const visibleCreatives = useMemo(
    () => creatives.filter(item => campaign === 'all' || item.campaign === campaign),
    [campaign],
  );

  useEffect(() => {
    document.title = `${pageNames[route] || 'Ringkasan'} · FunnelLens`;
    setMenu(false);
    window.scrollTo(0, 0);
  }, [location.pathname, route]);

  useEffect(() => {
    const handleKeyDown = event => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setSearch('');
        setSearchOpen(value => !value);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
      setHistoryError('');
    } catch {
      setHistoryError('Status tindak lanjut tidak dapat disimpan di browser ini.');
    }
  }, [history]);

  const goTo = (destination, query = '') => {
    navigate(`/app/${destination}${query}`);
    setMenu(false);
    setModal(null);
    setSearchOpen(false);
  };

  const changeCampaign = value => {
    setCampaign(value);
    setLeadPage(1);
    const selected = campaigns.find(item => item.id === value);
    if (selected) {
      setChannel(selected.channel);
      setCompareObjective(selected.channel);
      if (route === 'kreatif' && creativeChannel !== 'all') {
        setCreativeChannel(selected.channel);
      }
    }
  };

  const updateHistory = (key, value) => {
    setHistory(current => ({ ...current, [key]: value }));
  };

  const value = {
    route,
    account,
    setAccount,
    campaign,
    changeCampaign,
    days,
    setDays,
    channel,
    setChannel,
    scope,
    filteredLeads,
    visibleCreatives,
    leadLevel,
    setLeadLevel,
    leadSearch,
    setLeadSearch,
    leadSort,
    setLeadSort,
    leadSortDirection,
    setLeadSortDirection,
    leadPage,
    setLeadPage,
    leadPageSize,
    setLeadPageSize,
    pipelineSearch,
    setPipelineSearch,
    creativeChannel,
    setCreativeChannel,
    creativeMetric,
    setCreativeMetric,
    compareType,
    setCompareType,
    compareObjective,
    setCompareObjective,
    compareSort,
    setCompareSort,
    compact,
    setCompact,
    selection,
    setSelection,
    alertTab,
    setAlertTab,
    history,
    updateHistory,
    historyError,
    menu,
    setMenu,
    modal,
    setModal,
    search,
    setSearch,
    searchOpen,
    setSearchOpen,
    goTo,
    toast,
    periods,
  };

  return <ReferenceContext.Provider value={value}>{children}</ReferenceContext.Provider>;
}

export function useReference() {
  const context = useContext(ReferenceContext);
  if (!context) throw new Error('useReference must be used within ReferenceProvider.');
  return context;
}
