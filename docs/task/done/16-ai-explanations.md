# DONE: AI Explanations per Blok

## Status
- Selesai & Terverifikasi (`bunx tsc --noEmit` 0 error; `bun test` 250 pass / 0 fail / 37 file).
- **Tanggal Selesai**: 2026-11-21
- **File Terkait**:
  - `src/modules/explanations/rules.ts` (baru) — `stableJson`, `hashJson`, `extractPlaceholders`, `validateNarrative`, `render`, `fallbackText`, `formatMoney`, `formatPercent`, `formatNumber`, `formatDuration`
  - `src/modules/explanations/contexts.ts` (baru) — `EXPLANATION_CONTEXTS` (13 konteks), `EXPLAIN_PROMPT_VERSION`, `EXPLAIN_RULE_VERSION`, `systemPromptFor`, `outputSchemaFor`
  - `src/modules/explanations/service.ts` (baru) — `ExplanationService.ensure`/`ensureMany`/`get`
  - `src/modules/explanations/queue.ts` (baru) — `ExplainQueue`, `EXPLAIN_QUEUE_NAME`, `ExplainJobData`
  - `src/modules/explanations/worker.ts` (baru) — `ExplainWorkerProcessor`, `explainWorker`
  - `src/modules/explanations/index.ts` (baru) — `ExplanationController` (`GET /api/insights/explanations/:id`)
  - `src/infra/database/repositories/explanation.repository.ts` — `insertPendingBatch`, `findBatch`, `findByIdForWorker`, `markFallback({error})`
  - `src/modules/analytics/service.ts`, `src/modules/audience/service.ts`, `src/modules/tracking-health/service.ts`, `src/modules/creative/service.ts`, `src/modules/alerts/service.ts` — field `explanation` per blok
  - `src/routes.ts` — `ExplanationController` setelah `AlertsController`
  - `tests/unit/explanation-rules.test.ts` (baru), `tests/integration/explanations.test.ts` (baru)

## Ruang Lingkup
Setiap blok insight membawa satu kalimat Indonesia yang angkanya identik dengan angka blok itu. Server memegang angkanya: `facts` sudah berupa string terformat, template model dilarang memuat digit, dan `nextCheck` dipilih dari enum tertutup per konteks. Model hanya menyusun kalimat; angka masuk lewat `render`. Template yang melanggar ditolak dan diganti kalimat deterministik per konteks yang tetap memuat angka blok.

## Implementasi

### 1. Aturan & validasi (`rules.ts`)
| Ekspor | Isi |
|---|---|
| `stableJson` / `hashJson` | JSON dengan kunci objek diurutkan di setiap kedalaman; `hashJson` = sha256 hex dari `stableJson` |
| `extractPlaceholders` | semua isi `{...}` sesuai urutan kemunculan |
| `validateNarrative(context, template, facts)` | masalah pertama atau `null`; urutan: digit (`template mengandung angka`), placeholder asing, placeholder wajib konteks, arah kata bertentangan dengan `__direction`, template kosong |
| `render(template, facts)` | mengganti placeholder dengan fakta; kunci hilang → `Error` (kesalahan program, bukan masukan model) |
| `fallbackText(context, facts)` | `fallbackDown` bila `__direction === "down"` dan konteks punya varian itu, selain itu `fallback` |
| `formatMoney` / `formatPercent` / `formatNumber` / `formatDuration` | `null` → `"belum tersedia"`/`"belum terukur"`; `120000000 IDR` → `"Rp 1.200.000"`; `0.125` → `"12,5%"`; `125` dtk → `"2 menit"` |

Validasi berjalan pada **template**, bukan pada teks hasil render: teks hasil render memang harus memuat digit (berasal dari fakta).

### 2. Registry konteks (`contexts.ts`)
13 konteks dengan `label`, `required`, `nextChecks` (enum tertutup), dan `fallback` bebas digit. Hanya `funnel_leak` punya `fallbackDown` (`"Konversi {transition} turun dari {previous} ke {current}. ..."`). `systemPromptFor` menyusun instruksi (tanpa angka, tanpa sebab, daftar placeholder **tersedia** dan daftar placeholder **wajib**, `nextCheck` salah satu dari enum); `outputSchemaFor` mengembalikan JSON Schema biasa `{template, nextCheck: {enum}}` — adapter meneruskannya apa adanya ke Gemini, jadi `const`/`anyOf` tidak dipakai.

### 3. Service (`service.ts`)
`ensureMany` adalah satu-satunya jalur tulis; `ensure` = `(await ensureMany([input]))[0]`. Per input: `filterHash = hashJson(filter)`, `evidenceHash = hashJson(facts)`, `ruleVersion`/`promptVersion`/`model` dari konstanta dan `Config.ai.gemini.model`, `state` awal `PENDING`. Penulisan: satu `insert ... onConflictDoNothing` multi-baris, lalu satu `select` per scope (`accountId, context, snapshotId, ruleVersion, promptVersion, model`) dan pencocokan baris lewat `${entityType}|${entityId}|${filterHash}|${evidenceHash}`. Baris yang hilang setelah insert = kesalahan program (`Error`). Enqueue satu job per baris `PENDING` dengan `jobId = id` (UUID, tanpa `:`), sehingga permintaan berulang tidak menambah job. `get(id, tenantId)` → `NotFoundError("Penjelasan tidak ditemukan")` untuk tenant lain.

### 4. Worker (`worker.ts`)
Urutan: baca baris (`findByIdForWorker`) → `null` warning → `state !== "PENDING"` berhenti → konteks tak dikenal → `markUnavailable` → `apiKeys` kosong → `markFallback` tanpa panggilan model → maksimal 2 percobaan `generateObject` (`temperature: 0`) → template valid → `markReady` (`nextCheck` hanya disimpan bila termasuk enum konteks) → masih gagal → `markFallback` dengan `error` berisi masalah terakhir.

### 5. Integrasi endpoint
| Endpoint | Konteks | `entityType`/`entityId` |
|---|---|---|
| `GET /api/analytics/summary` | `summary` | `account`/`accountId` |
| `GET /api/analytics/leakage` | `funnel_leak` | `account`/`accountId` (`explanation: null` saat tidak ada kebocoran) |
| `GET /api/analytics/audience/speed` | `velocity` | `account`/`accountId` |
| `GET /api/analytics/audience/conversations` | `conversation_types` + `conversation_timing` | `account`/`accountId`, `filter.block = "timing"` untuk yang kedua |
| `GET /api/analytics/audience/pipeline` | `lead_detail` (satu per baris, satu `ensureMany`) | `lead`/`leadId` |
| `GET /api/tracking-health` | `tracking_health` | `account`/`accountId`, `snapshotId = date ?? "tanpa-tanggal"` |
| `GET /api/analytics/creatives` | `creative_dimensions` | `account`/`accountId`, filter + `campaignId` |
| `GET /api/analytics/creatives/fatigue` | `creative_fatigue` | `account`/`accountId` |
| `GET /api/analytics/creatives/patterns` | `creative_pattern` | `account`/`accountId` |
| `GET /api/analytics/creatives/lead-quality` | `lead_quality` | `account`/`accountId` |
| `POST /api/analytics/creatives/comparisons` | `comparison` (satu per tab) | `creative`/`${ids.join("|")}:${goal}`, `snapshotId` = id sync run |
| `GET /api/alerts` | `alert` | `account`/`accountId`, `snapshotId` = status |

`snapshotId` blok berperiode adalah jendela data `${since}..${until}`; `facts` memakai helper format sehingga nilai kosong menjadi `"belum …"`, tidak pernah `"0"`.

## Pengujian
| Uji | Cakupan |
|---|---|
| `tests/unit/explanation-rules.test.ts` | `stableJson`/`hashJson` stabil terhadap urutan kunci; `extractPlaceholders`; tolak digit (`"Konversi naik 25%"` → `template mengandung angka` lebih dulu), placeholder asing, placeholder wajib hilang, arah bertentangan; `render` + `Error` kunci hilang; `fallbackText` varian `down`/`up`; 13 fallback bebas digit; baris placeholder wajib pada prompt sistem + bentuk `outputSchemaFor`; `formatMoney(120000000,"IDR") === "Rp 1.200.000"`, `formatPercent(0.125) === "12,5%"`, `formatDuration(125) === "2 menit"` |
| `tests/integration/explanations.test.ts` (Postgres nyata, `QueueManager.prototype.add` di-stub) | dua `ensure` identik → satu baris dan satu job ber-`jobId` = id baris; model mengembalikan `"Konversi naik 25%"` → `FALLBACK`/`source template` dengan teks memuat `25%` dari fakta + `error "template mengandung angka"`; `lead_quality` vs `comparison` untuk kreatif yang sama → id dan teks berbeda (`nextCheck` di luar enum → `null`); tanpa API key → `FALLBACK` tanpa panggilan model; baris `READY` tidak pernah diregenerasi; `GET /api/insights/explanations/:id` → 200 untuk tenant sendiri, 404 untuk tenant lain |

## Keputusan & Catatan
- **Prompt menyebut placeholder wajib secara eksplisit.** Probe model nyata menunjukkan sekitar 1 dari 3 jawaban `summary` menghilangkan `{spend}` walau placeholder itu ada di daftar "tersedia", sehingga lolos menjadi `FALLBACK` padahal model tersedia. Prompt kini punya baris kedua (`Placeholder yang wajib ada: ...`), dan percobaan kedua membawa alasan penolakan (`Jawaban ditolak: <masalah>. Ulangi.`). Sesudah perbaikan, smoke nyata berakhir `READY`/`source model` dengan teks memuat `Rp 2.500` dan `12` dari fakta, `nextCheck "campaign"`.
- **`velocity` dan `conversation_timing` dipisah**: kalimat fallback literal TODO (median/measured/observed) hanya bisa diisi blok `timed` pada `/audience/conversations`, jadi kalimat itu dipakai `conversation_timing`; `velocity` memakai kalimat blok kecepatan (`avg`, `longest`, `stuck`).
- **`/audience/conversations` membawa dua penjelasan**: `explanation` (`conversation_types`) dan `timingExplanation` (`conversation_timing`); `filter.block` menjaga kunci alaminya tidak bertabrakan.
- **`creative_dimensions` memakai `CreativeRow.fatigued` dan status `"Pertimbangkan dihentikan"`**: `CreativeStatus` tidak punya nilai `"Jenuh"`/`"Perlu perbaikan"` (itu `FatigueStatus`), jadi hitungan diambil dari kolom yang benar-benar ada di baris blok itu.
- **`UNAVAILABLE` hanya untuk konteks tersimpan yang tak dikenal**; kegagalan model atau template invalid menjadi `FALLBACK`, mengikuti preseden "tanpa `GEMINI_API_KEYS`: semua `FALLBACK`".
- **`queue.test.ts` tidak lagi `quit()` koneksi Redis bersama**: `redisConnection` adalah singleton seluruh suite, dan mematikannya membuat file uji setelahnya gagal saat meng-enqueue (sebelumnya tidak terlihat karena belum ada service HTTP yang meng-enqueue saat request).
- **`lead_detail` menumpang baris pipeline**: satu `ensureMany` per request, jadi biaya tetap dua query berapa pun jumlah baris.
