# Selesai: Seed Parity Dataset Demo

Dokumentasi implementasi dataset parity dan golden test deterministik untuk demo workspace.

## Ringkasan Fitur
- Skrip seed deterministik di `scripts/seed-demo.ts` (`bun run db:seed`).
- Tenant terisolasi `00000000-0000-4000-8000-000000000001` dengan akun `act_demo_funnellens` dan admin `demo@funnellens.test`.
- Dataset parity lengkap: 3 campaign (Prospecting wa, Retargeting wa, Website Checkout web), 11 ad creatives, 11 ads, 63 hari metrik `ad_insights_daily` (693 baris), 8 leads (3 HOT, 3 WARM, 2 COLD) dengan median reply time 1440 detik (24 menit), 7 response types terwakili, breakdown segments, pixel sources & tracking health, serta 5 insight alerts.
- Golden test `tests/integration/seed-parity.test.ts` mengunci angka seluruh endpoint analitik.

## Verifikasi
- `bun run db:seed` dijalankan berulang kali idempoten tanpa duplikasi baris.
- Seluruh unit & integration test (256 tests) lulus 100%.
