# Runbook: Rekonsiliasi Data Meta ↔ WhatsApp

Dipakai ketika angka funnel terlihat tidak masuk akal: chat yang tidak muncul, pembelian yang tidak
tercatat, atau belanja yang berbeda dari Ads Manager. Urutannya dari bukti paling murah ke paling mahal.

## 0. Cek cepat: apakah sistem sehat?

```bash
curl -s localhost:3000/api/healthz          # 200 selama proses hidup
curl -s localhost:3000/api/readyz | jq      # 200 hanya bila DB, Redis, dan sync segar
```

`readyz` yang `503` dengan `checks.sync.overdue: true` berarti pipeline berhenti mengirim angka baru:
perbaiki sync dulu, jangan menelusuri selisih angka. `checks.database`/`checks.redis` yang `false`
adalah gangguan infrastruktur, bukan data.

## 1. Bandingkan percakapan Meta dengan chat WhatsApp

| Sumber | Angka | Endpoint |
|---|---|---|
| Meta (klik yang memulai chat) | `messaging_started` | `GET /api/analytics/funnel?accountId=…&objectiveGroup=wa` |
| WhatsApp (chat yang benar-benar masuk) | `observed` | sama, tahap `observed` |
| Chat yang dibalas | `replied` | sama, tahap `replied` |

Selisih `messaging_started − observed` adalah chat yang tidak pernah sampai ke WhatsApp. Selisih ini
wajar dalam jumlah kecil (user menutup WhatsApp sebelum pesan terkirim, nomor tidak valid, CTWA yang
tidak membuka aplikasi). Yang **tidak** wajar: selisih > 20% atau bertambah terus setiap hari.

Rinciannya per lead:

```bash
curl -s -H "Authorization: Bearer $TOKEN" \
  "localhost:3000/api/leads?accountId=$ACC&pageSize=15&sortBy=createdAt&dir=desc" | jq '.data[] | {id,name,campaignId,firstSeenAt}'
```

Lead dengan `firstSeenAt` kosong tetapi `campaignId` terisi berarti atribusi Meta ada tanpa jejak chat:
periksa `sourcePlatform` dan `attributionNote` di `GET /api/leads/{id}`.

## 2. Baca `/tracking-health`

```bash
curl -s -H "Authorization: Bearer $TOKEN" \
  "localhost:3000/api/tracking-health?accountId=$ACC" | jq '{date,pixel,capi,emq}'
```

Yang dicari:

- `pixel.connected: false` atau `pixel.lastSeenAt` basi → event browser tidak terkirim, pembelian akan
  hilang dari view `ad_insight_metrics`.
- `capi.dedupRate` jauh di bawah `capi.target` → event ganda atau tidak terpasang `event_id`.
- `emq.average` di bawah `emq.threshold` → match quality rendah, pembelian sulit diatribusikan ke ad.

Bila `tracking-health` bersih tetapi pembelian tetap nol, lanjut ke langkah 3: datanya mungkin belum
disinkronkan, bukan salah.

## 3. Picu sync ulang

```bash
# 28 hari terakhir; aman diulang, upsert bersifat idempotent
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"accountId":"'$ACC'"}' localhost:3000/api/meta/queue/re-sync-trailing
```

Job masuk antrean `meta-sync` dengan `attempts: 5` dan backoff eksponensial. Setelah sukses, cache
agregasi akun otomatis dihapus, jadi `/api/analytics/summary` berikutnya membaca angka baru.

Cek hasilnya lewat `sync_runs` terbaru:

```bash
curl -s -H "Authorization: Bearer $TOKEN" \
  "localhost:3000/api/settings" | jq '.sources[] | select(.key=="meta")'
```

`lastSyncAt` harus bergerak. `lastError` yang terisi berarti run gagal setelah sukses terakhir.

## 4. Periksa dead-letter queue

Job yang menghabiskan 5 percobaan dipindahkan ke `meta-sync-dlq` dan memunculkan alert `sync_failed`.

```bash
curl -s -H "Authorization: Bearer $TOKEN" localhost:3000/api/meta/queue/dlq | jq '.[] | {id,jobName,error,attemptsMade,failedAt}'
```

Bacaan yang lazim:

| `error` | Artinya | Tindakan |
|---|---|---|
| `(#17) User request limit reached` / `(#613)` | rate limit Meta | tunggu, lalu picu ulang; tidak perlu ubah kode |
| `Invalid OAuth access token` / `(#190)` | token kedaluwarsa | sambungkan ulang lewat `GET /api/meta/oauth/url` |
| `timeout` berulang | jaringan ke Graph API | cek egress; picu ulang setelah jaringan pulih |

Setelah entri ditangani dan re-sync berhasil, hapus dari DLQ agar daftar tetap bersih:

```bash
curl -s -X DELETE -H "Authorization: Bearer $TOKEN" localhost:3000/api/meta/queue/dlq/$JOB_ID
```

Alert `sync_failed` tertutup sendiri setelah sync akun tersebut sukses.

## 5. Kalau angkanya tetap berbeda

1. Pastikan `days`/`since`/`until` yang dipakai klien sama dengan yang diuji — `resolvePeriod` memakai
   `DEFAULT_SNAPSHOT_END` (`2026-11-19`) ketika `days` dikirim tanpa `until`, sehingga "hari ini" bukan
   jendela default.
2. Bandingkan belanja: `GET /api/reports/campaigns.csv` (kolom `Belanja IDR`) dengan Ads Manager pada
   rentang tanggal yang sama. Selisih kecil berasal dari `attribution_window` (`7d_click`).
3. Periksa retensi: insight lebih tua dari `RETENTION_INSIGHT_DAYS` (default 400) sudah dihapus, jadi
   perbandingan tahun-lalu hanya bisa dilakukan dari dump backup.
4. Kalau perlu bukti historis, pulihkan dump ke database sementara:
   `pg_restore --no-owner -d <db_sementara> backup/funnellens-YYYYMMDD-HHmm.dump`.
