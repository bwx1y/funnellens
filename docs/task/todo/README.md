# FunnelLens Backend Implementation Roadmap (TODO)

Direktori ini berisi rincian TODO implementasi backend FunnelLens per fitur. Aturan angka yang mengikat seluruh fitur:

- Uang selalu `*_minor` bigint dengan mata uang akun. Tidak ada nilai uang turunan; dampak ditulis sebagai jumlah chat (`impactCaption`), `impactMinor` dibiarkan `null`.
- Angka yang tidak terukur dikembalikan `null` beserta `note`, tidak pernah `0` sebagai pengganti.
- Tidak ada skor komposit (lead maupun kreatif). Skor kesehatan hanya `funnelHealth()` dengan 3 komponen berbobot 40/30/30.
- Tidak ada klaim penyebab. Narasi hanya menyebut pemeriksaan berikutnya (`nextCheck`).
- Setiap blok mengembalikan `sample: {n, denominator, eligible, gate}`.

## Status

File `01`–`11` di direktori ini adalah draft lama dan **seluruh isinya sudah selesai** — lihat [`../done/`](../done/README.md) untuk catatan implementasi finalnya. Jangan kerjakan ulang.

Task aktif dimulai dari nomor **17**. Latar belakangnya: audit 25 Nov 2026 terhadap checklist `FunnelLens-Backend-Checklist.md` menemukan **30/80 item terpenuhi, 32 parsial, 18 belum ada**. Nomor 12–16 tidak dipakai agar tidak bertabrakan dengan penomoran `../done/`.

## Task Aktif

| No | Task | Menutup item checklist | Isi |
|---|---|---|---|
| 17 | [seed-parity.md](./17-seed-parity.md) | F-01.4 | Skrip `db:seed` deterministik (3 campaign, 11 kreatif, 8 lead, 63 hari) di tenant demo terpisah + golden test |
| 18 | [period-contract.md](./18-period-contract.md) | F-07.1, F-07.2, F-07.3, F-07.4 | `days ∈ {7,14,30}`, snapshot end 19 Nov 2026, label id-ID, `isPartial`, `direction` |
| 19 | [funnel-gaps.md](./19-funnel-gaps.md) | F-06.1, F-08.3, F-09.1, F-09.2, F-09.3, F-10.2, F-10.3 | `daily_clicks`, `previousCount`/`share`, `priorityStage`, riwayat kebocoran 4 periode, perbandingan per campaign |
| 20 | [lead-detail-pipeline-search.md](./20-lead-detail-pipeline-search.md) | F-13.1, F-13.2, F-13.3, F-19.1, F-19.2 | `page_size`/`dir`/`counts`, `GET /leads/{id}`, pipeline lane + `q`, `GET /search` |
| 21 | [report-export.md](./21-report-export.md) | F-16.1, F-16.2, F-20.1, F-20.3 | Tren kreatif berparameter, `creative-trend.csv`, `campaigns.csv`, audit log ekspor |
| 22 | [settings-workspace.md](./22-settings-workspace.md) | F-20.2 | `GET /settings`: objek workspace, mode read-only, status sumber, limits |
| 23 | [ops-production.md](./23-ops-production.md) | F-21.1, F-21.2, F-21.3, F-21.4, F-21.5, F-21.6 | Cache agregasi TTL 5 menit, `healthz`/`readyz`, DLQ, rate limit, request id + metrik, backup/retensi/runbook |
| 24 | [ingestion-hardening.md](./24-ingestion-hardening.md) | F-02.1, F-02.3, F-02.4, F-03.6, F-04.2, F-04.3, F-05.2, F-05.3, F-05.5 | Token terenkripsi + refresh, status sumber + `/sources`, cursor incremental, null semantik event, rekonsiliasi pembelian, CTWA + retensi |
| 25 | [api-envelope-auth.md](./25-api-envelope-auth.md) | F-01.2, F-01.3 | Envelope `{data, meta}` / `{error:{code,message,details}}`, paginasi `page_size`/`pages`, role `viewer`/`admin` |
| 26 | [insight-review.md](./26-insight-review.md) | F-18.3, F-18.4 | Status review per user `read`/`done`/`active`, `tab=active\|done`, `unread-count`, history, idempotency |
| 27 | [analytics-gap-fields.md](./27-analytics-gap-fields.md) | F-08.2, F-09.4, F-11.1, F-11.2, F-12.1, F-12.2, F-15.1, F-17.2 | KPI sadar channel, `warnings[]` + `dataFreshness`, field `lead_assessments`, KPI kreatif, `supported`/`consistent`/`clear` |

## Urutan yang Disarankan

1. **17** (seed) — tanpa dataset parity, tidak ada test yang bisa mengunci angka untuk task lain.
2. **18** (periode) — F-19 dan F-21 butuh `days` + label.
3. **19**, **20**, **21**, **22** — fitur yang belum ada, tidak saling bergantung.
4. **27** — field tambahan di atas fondasi 18/19.
5. **26** — review per user; butuh `insightKey` stabil.
6. **25** — envelope & role adalah perubahan lintas potong; kerjakan setelah endpoint baru stabil agar tidak mengubah test dua kali.
7. **24**, **23** — pengerasan ingestion dan operasional; keduanya menyentuh worker & queue, jalankan terakhir dan berurutan.

## Yang Tidak Dikerjakan

Item checklist yang sengaja dibiarkan berbeda dari spesifikasi (bukan bug, tapi keputusan produk yang perlu persetujuan dulu):

- **`tenant_id` → `workspace_id`**: kolom fisik tetap `tenant_id`. Rename menyentuh 26 tabel dan seluruh query; cukup ekspos `workspaceId` di respons bila memang dibutuhkan klien.
- **Funnel `wa` 7 tahap vs 6**: tahap `observed` dipertahankan karena `replied`/`qualified` diukur terhadapnya. Task 19 menambahkan `stageCount`/`stageKeys` agar klien tidak menebak.
- **`GET /creatives/compare` (GET) vs `POST /comparisons`**: POST dipertahankan karena daftar id bisa panjang.
