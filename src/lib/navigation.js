export const APP_PAGE_GROUPS = [
  {
    key: 'funnel',
    label: 'Funnel Intelligence',
    items: [
      { path: 'funnel', label: 'Ikhtisar funnel' },
      { path: 'funnel/leakage', label: 'Deteksi kebocoran' },
      { path: 'audience/speed', label: 'Kecepatan & umur lead' },
      { path: 'tracking', label: 'Kesehatan tracking' },
    ],
  },
  {
    key: 'audience',
    label: 'Audience Intelligence',
    items: [
      { path: 'audience', label: 'Daftar lead' },
      { path: 'audience/pipeline', label: 'Papan pipeline' },
      { path: 'audience/conversations', label: 'Insight percakapan' },
    ],
  },
  {
    key: 'creative',
    label: 'Creative Intelligence',
    items: [
      { path: 'creative', label: 'Analisis kreatif' },
      { path: 'creative/fatigue', label: 'Kejenuhan' },
      { path: 'creative/quality', label: 'Kualitas lead' },
      { path: 'creative/compare', label: 'Perbandingan kreatif' },
    ],
  },
];

export const APP_SECONDARY_NAV = [
  { path: 'insights', label: 'Peringatan' },
  { path: 'reports', label: 'Laporan' },
  { path: 'settings', label: 'Pengaturan' },
];
