# TODO: AI Explanations per Blok

## Gambaran Fitur
Setiap blok insight punya penjelasan yang angkanya identik dengan angka blok: apa yang terjadi, bukti apa yang mendukungnya, dan pemeriksaan apa yang layak dilakukan. Angka disisipkan server dari fakta terverifikasi; model hanya menyusun kalimat dan memilih `nextCheck`. Tidak ada klaim penyebab.

## Daftar Pekerjaan

### 1. Penyimpanan (`explanations`)
- [ ] Tabel `explanations`: `tenantId`, `accountId`, `context`, `entityType`, `entityId`, `filterHash`, `snapshotId`, `evidenceHash`, `ruleVersion`, `promptVersion`, `model`, `state` (`PENDING`/`READY`/`FALLBACK`/`UNAVAILABLE`), `source` (`model`/`template`), `text`, `nextCheck`, `evidenceIds`, `error`, `createdAt`, `updatedAt`.
- [ ] `uniqueIndex("uq_explanations_key")` atas (`accountId, context, entityType, entityId, filterHash, snapshotId, evidenceHash, ruleVersion, promptVersion, model`); `model` diisi `Config.ai.gemini.model` sejak baris PENDING dibuat.

### 2. Service `ensure` / `get`
- [ ] `ensure({tenantId, accountId, context, entityType?, entityId?, filter, snapshotId, facts, evidenceIds})`: `filterHash` = sha256 dari filter berurut kunci, `evidenceHash` = sha256 dari `facts` berurut kunci.
- [ ] `insert ... onConflictDoNothing` pada kunci unik lalu `select` baris; bila `PENDING` → `queue.add("explain", {id}, {jobId: id, attempts: 2, backoff: exponential 5s})`.
- [ ] Kembalikan `{id, context, state, source, text, evidenceIds, snapshotId}`; `text: null` saat PENDING.
- [ ] `get(id, tenantId)`: `NotFoundError` bila beda tenant.

### 3. Worker `explain`
- [ ] Prompt sistem per konteks: bahasa Indonesia, "jangan menetapkan penyebab", "pakai placeholder untuk angka".
- [ ] User message = `JSON.stringify(facts)`; skema keluaran `{template: STRING, nextCheck: STRING}` dengan enum `nextCheck` per konteks; `temperature: 0`.

### 4. Validasi & fallback (`rules.ts`)
- [ ] `extractPlaceholders(template)` = semua isi `{...}`.
- [ ] `validateNarrative(context, template, facts)`: tolak bila ada digit, placeholder tidak dikenal, placeholder wajib konteks tidak ada (mis. `funnel_leak` wajib `previous` + `current`), atau arah kata bertentangan dengan `facts.__direction`.
- [ ] `render(template, facts)` mengganti placeholder dengan nilai fakta.
- [ ] `fallbackText(context, facts)` deterministik per konteks, mis. `funnel_leak`: "Konversi klik ke chat turun dari {previous} ke {current}. Periksa campaign yang menyumbang penurunan terbesar."; `velocity`: "Median jeda CS ke lead {median} dari {measured} lead terukur (dari {observed} lead teramati)."
- [ ] Gagal validasi → ulangi sekali; masih gagal → `state: "FALLBACK"`, `source: "template"`, `text: fallbackText(...)`.
- [ ] Sukses → `state: "READY"`, `source: "model"`, `text: render(...)`, `nextCheck`.

### 5. Konteks dan integrasi
- [ ] 13 konteks: `summary`, `funnel_leak`, `velocity`, `tracking_health`, `lead_detail`, `conversation_types`, `conversation_timing`, `creative_dimensions`, `creative_fatigue`, `creative_pattern`, `lead_quality`, `comparison`, `alert`.
- [ ] Setiap endpoint menambahkan field `explanation` dari `ensure`; angka di `facts` diambil dari hasil service yang sama yang membentuk respons.
- [ ] `GET /api/insights/explanations/:id` di controller explanation, terdaftar di `src/routes.ts`.
- [ ] Tanpa `GEMINI_API_KEYS`: semua penjelasan `FALLBACK`, sistem tetap jalan.

## Uji Selesai
- Dua permintaan identik → satu baris `explanations` dan satu job.
- Template model berisi `"25%"` → ditolak; hasil `FALLBACK` dengan teks yang tetap memuat `25%` dari fakta.
- Dua tombol untuk kreatif yang sama (kualitas vs perbandingan) → dua `explanation.id` berbeda dengan teks berbeda.
- Request dengan tenant lain → 404.
