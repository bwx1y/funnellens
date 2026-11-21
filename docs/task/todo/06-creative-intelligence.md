# TODO: Creative Intelligence & Fatigue Detection

## Gambaran Fitur
Endpoint dan service untuk menilai kreatif lewat empat dimensi bergerbang, mendeteksi kejenuhan dengan faktor pengganggu, mencari pola atribut kreatif, menghubungkan biaya iklan dengan mutu lead, membandingkan kreatif per tujuan, dan membaca hasil studi A/B Meta.

## Daftar Pekerjaan

### 1. Peringkat Kreatif & Empat Dimensi
- [ ] Endpoint `GET /api/analytics/creatives` (`accountId`, `since`, `until`, `campaignId`, `sortBy`).
- [ ] Agregasi per `creativeId` + `objectiveGroup` (satu kreatif dipakai beberapa ad tetap satu baris): `spendMinor`, `results`, `costPerResultMinor`, `ctr` (total klik / total tayangan), `roas`, `frequency`, tanggal tayang pertama teramati.
- [ ] Empat dimensi, masing-masing `{label: "kuat"|"rata-rata"|"lemah"|null, certainty: "kurang"|"indikatif"|"terukur"}`:
  - **Biaya**: persentil biaya/hasil, arah dibalik (lebih rendah lebih baik). Gerbang 15 hasil (indikatif) dan 50 hasil (terukur).
  - **Perhatian**: persentil CTR. Gerbang 3.000 tayangan (indikatif) dan 5.000 (terukur).
  - **Kualitas**: persentil Hot rate (WA) atau konversi (web). Gerbang 10 lead matang (indikatif) dan 20 (terukur).
  - **Kesehatan**: umur setelah matang + tren. Gerbang 7 hari (indikatif) dan 14 hari (terukur).
- [ ] Persentil hanya dihitung bila ada ≥ 5 pembanding; kurang dari itu `label: null`, `certainty: "kurang"`.
- [ ] Status dari `overall(cost, attention, quality, health, mature, fatigued, allocationLimited)` → `Belum cukup data` / `Pantau` / `Winner` / `Pertimbangkan dihentikan`. Tidak ada skor gabungan kreatif.
- [ ] `allocationLimited` = ad set penerima kreatif punya `daily_budget_minor` < 3× biaya harian kreatif, atau `effective_status` bukan `ACTIVE`.

### 2. Detail Kreatif
- [ ] Endpoint `GET /api/analytics/creatives/:id`: thumbnail, durasi video, judul, body, CTA, `daily[]` (spend, ctr, cpm, cpr, frequency), empat dimensi, `sample`, dan `note` bila gerbang belum lolos.
- [ ] Metrik tampilan video (tidak memengaruhi status): `video: {hookRate, holdRate, retention:{p25,p50,p75,p100}}`; `hookRate = video_3_sec_watched_actions / impressions`, `holdRate = video_thruplay_watched_actions / video_3_sec_watched_actions`; `null` + `note` bila pembilang atau penyebut kosong.

### 3. Kejenuhan
- [ ] Endpoint `GET /api/analytics/creatives/fatigue` (`accountId`, `since`, `until`).
- [ ] Baseline = 7 hari pertama setelah tayangan pertama teramati (CTR, frekuensi, CPR).
- [ ] `fatigue(base, now, consecutiveDays, complete, confounded)`:
  - `!complete` atau `base.ctr ≤ 0` → `Belum cukup data`.
  - Drop < 15% atau frekuensi tidak naik → `Sehat`.
  - `confounded` (CPM kini lebih murah) → `Perlu ditinjau`.
  - Drop ≥ 25% dan CPR naik dan `consecutiveDays ≥ 3` → `Jenuh`.
  - Selain itu → `Waspada`.
- [ ] `complete` = tidak ada hari hilang dalam jendela; `consecutiveDays` dihitung dari `getCreativeDaily`.
- [ ] Respons `{status, drop, frequency, base, now, confounded, note}`; tidak ada daftar rekomendasi naratif, hanya `nextCheck`.

### 4. Pola Kreatif
- [ ] Endpoint `GET /api/analytics/creatives/patterns` (`accountId`, `since`, `until`).
- [ ] Atribut dari `creative_tags` tipe `hook_type`, `format`, `tone`, `product_theme`.
- [ ] `costPattern(withAttr, withoutAttr)` → `insufficient_sample` bila total < 8 kreatif atau salah satu sisi < 3; selain itu median per sisi, `pValue` (Mann-Whitney U), dan signifikansi setelah Benjamini-Hochberg (`q = 0.1`).
- [ ] Tiga keadaan keluaran: `insufficient_sample`, `no_clear_pattern`, `eligible_for_test`.

### 5. Kualitas Lead per Kreatif
- [ ] Endpoint `GET /api/analytics/creatives/lead-quality` (`accountId`, `since`, `until`).
- [ ] Belanja dan hasil diagregasi **per kreatif dulu** (subquery), baru join ringkasan lead agar penambahan baris chat tidak menggandakan belanja.
- [ ] Baris: `{creativeId, costPerConversationMinor, hotLeads, assessedMatureLeads, hotRate, completeness, messageEvidence:{present, assessed, expected:7}, sample}`.
- [ ] `hotRate = null` bila `assessedMatureLeads < 10`.
- [ ] Tujuh elemen konten (`penawaran`, `produk_manfaat`, `harga`, `cta`, `target`, `kredibilitas`, `urgensi`) masing-masing berstatus `hadir`/`absen`/`tak_teramati`; `completeness = null` bila ada elemen `tak_teramati`, selain itu `present / 7`.

### 6. Perbandingan & Eksperimen
- [ ] `POST /api/analytics/creatives/comparisons` body `{accountId, snapshotId, creativeIds[]}`: dedupe ID, verifikasi semua ID milik tenant+akun dan punya baris insight pada snapshot; gagal → `BadRequestError("Pilihan kreatif tidak tersedia pada snapshot ini")`; hasil `[{goal:"wa"|"web", items, canCompare, evidenceType:"observational", snapshotId}]`.
- [ ] `GET /api/analytics/creatives/experiments`: Graph `GET /{metaUserId}/ad_studies` memakai token `meta_connection`; `experimentState(hasAccess, studyCount, hasResult)` → `permission_missing` / `no_studies` / `results_pending` / `results_available`. Kegagalan izin Graph → `permission_missing`, bukan 500.
- [ ] Tidak ada pemenang diumumkan lintas tujuan.

### 7. Tagging
- [ ] `POST /api/analytics/creatives/:id/tags` dan `DELETE /api/analytics/creatives/:id/tags/:tagId`.
- [ ] `tagType ∈ {hook_type, format, tone, product_theme}`; `source` `manual` atau `ai`.
- [ ] Job `creative-tagging` (jobId `tag:${creativeId}`) memakai `GeminiAdapter.generateObject` untuk empat `tagType` beserta `confidence`, `source: "ai"`.

## Uji Selesai
- Satu kreatif dipakai tiga ad dengan tujuan sama → satu baris; CTR = total klik / total tayangan.
- Kreatif dengan 14 hasil → dimensi biaya `certainty: "indikatif"` dan status `Pantau`.
- CTR 2,7% → 1,9%, frekuensi dan CPR naik, tiga hari, tanpa pengganggu → `Jenuh`.
- Dua kreatif ber-hook → `insufficient_sample`.
- Memilih satu kreatif WA dan satu web menghasilkan dua tab berisi satu baris; dua dari tujuan yang sama membuka `canCompare: true` tanpa mengubah persentil akun.
