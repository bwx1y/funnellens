# TODO: Alerts & Health Scoring Engine

## Gambaran Fitur
Engine komputasi skor kesehatan funnel (3 komponen), rule generator alert otomatis (`insight_alerts`), serta endpoint manajemen alert. Tidak ada skor gabungan bisnis dan tidak ada estimasi kerugian dalam uang.

## Daftar Pekerjaan

### 1. Skor Kesehatan Funnel
- [ ] `funnelHealth({conversion, baseline, onTimeReplyShare, emq, dedup})` → `{score, badge, components}`.
- [ ] Tiga komponen berbobot 40/30/30:
  - Konversi funnel kini vs baseline historis (40).
  - Porsi chat dibalas ≤ 15 menit (30).
  - Kualitas tracking: EMQ dan dedup CAPI (30).
- [ ] Komponen `null` dikeluarkan dan bobot dinormalkan ulang; komponen tersisa `< 2` → `score: null`, `badge: null`, `note: "Komponen pengukuran belum cukup"`.
- [ ] Badge: `≥ 80 "Prima"`, `60–79 "Perlu perhatian"`, `< 60 "Kritis"`.

### 2. Rule Generator (`insight_alerts`)
- [ ] `evaluate(accountId, period)` mengembalikan `InsightAlertUpsert[]`; idempoten lewat `upsert` pada `(account_id, rule_key, entity_id)`; `entity_id` level akun = string kosong, bukan `NULL`.
- [ ] `ruleKey` dan ambang:
  - `leak_click_to_landing`, `leak_chat_to_reply`, `leak_qualified_to_closed` — dari hasil kebocoran; `WARNING` bila `deltaPp ≤ −5`, `CRITICAL` bila `≤ −15`; `impactMinor = null`, `impactCaption = "≈{estimatedGap} chat hilang"`.
  - `unreplied_hot_lead` — lead HOT tanpa balasan > 30 menit → `CRITICAL`, `entityId = leadId`, `route = "/leads/{id}"`.
  - `creative_fatigue` — `fatigue() === "Jenuh"` → `WARNING`, `entityId = creativeId`.
  - `tracking_emq` — `emqAvg < 6` atau `dedupRate < 0.85` → `WARNING`.
- [ ] Setiap baris membawa `evidence` (snapshot, angka pemicu) dan `confidence`.
- [ ] Queue `alerts-evaluate` (BullMQ repeat tiap jam) memanggil `evaluate` untuk setiap akun terpilih.

### 3. Alerts Management API
- [ ] `GET /api/alerts` (`accountId`, `status`): `active` = `ACTIVE` dan `snoozed_until` kosong/lewat; `snoozed` = `SNOOZED` dengan `snoozed_until > now()`; `resolved` = `DONE`.
- [ ] `PATCH /api/alerts/:id/snooze` body `{hours: 24 | 168}`: `status="SNOOZED"`, `snoozedUntil = now() + hours`.
- [ ] `PATCH /api/alerts/:id/resolve`: `status="DONE"`, `resolvedAt = now()`, `resolvedBy = user.iss`.
- [ ] `GET /api/alerts/badge`: `{count}` jumlah alert `ACTIVE` yang belum di-snooze.
- [ ] Semua route memakai `JwtUtil.isAuthenticated` + `requireAccountScope`; alert milik tenant lain → 404.

## Uji Selesai
- `snooze` 24 jam → alert hilang dari `status=active`, muncul di `status=snoozed` dengan `snoozedUntil` ≈ +24 jam.
- `resolve` → `resolvedAt` terisi dan alert pindah ke `status=resolved`.
- Akun milik tenant lain → 404.
- Tanpa komponen tracking, `funnelHealth()` mengembalikan `score: null` + `note`, bukan `0`.
