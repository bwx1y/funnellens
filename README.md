# Funnel Lens API

Backend REST API multi-tenant menggunakan [Bun](https://bun.sh), [Elysia](https://elysiajs.com), [Drizzle ORM](https://orm.drizzle.team), PostgreSQL, dan Redis/BullMQ. Terintegrasi dengan gateway WhatsApp [OpenWA](https://github.com/rmyndharis/openwa).

## Fitur
- Multi-tenancy (relasi tenant dan user)
- Autentikasi JWT (HS256 via `jose`) dengan role `ADMIN` / `MANAGER`
- Manajemen profil user (detail, update profil, ubah password)
- Manajemen user per tenant (khusus `ADMIN`)
- Verifikasi email dan reset password via OTP/token
- Manajemen sesi WhatsApp via OpenWA (buat sesi, ambil QR login, update, hapus)
- Webhook OpenWA: `session.authenticated` menyinkronkan status sesi, `session.disconnected` menandai sesi terputus dan mengirim email notifikasi ke admin, serta `message.received` untuk klasifikasi pesan via AI
- Klasifikasi prospek otomatis via Google Gemini dengan rotasi API key (kategori `HOT`, `WARM`, `COLD`)
- Manajemen kontak dan statistik prospek WhatsApp (`/api/contact`)
- Hashing password (native `Bun.password` bcrypt)
- Antrean background job via BullMQ & Redis (`email-queue`, `queue-session-wa`, `WaWebhook-Chat`)
- Graceful shutdown untuk HTTP server, worker BullMQ, dan Redis client (`SIGINT`/`SIGTERM`)
- Validasi request TypeBox via Elysia schema
- Logging HTTP terstruktur via `pino` (console & file rotation otomatis di `log/` max 5MB via `pino-roll`)
- Dokumentasi API interaktif via Scalar OpenAPI (`/docs`)

## Prasyarat
- [Bun](https://bun.sh) (v1.1+)
- PostgreSQL (v14+)
- Redis (v7+)
- SMTP server (Mailpit/MailHog untuk lokal; email tidak terkirim tanpa SMTP yang hidup)
- Gateway OpenWA (opsional; wajib untuk fitur sesi WhatsApp)
- API key Google Gemini (`GEMINI_API_KEYS`) untuk klasifikasi prospek; tanpa key ini worker klasifikasi gagal
- Docker & Docker Compose (opsional)

## Setup Lokal

1. Install dependensi:
```bash
bun install
```

2. Konfigurasi environment:
```bash
cp .env.example .env
```

| Variabel | Default | Keterangan |
|---|---|---|
| `NODE_ENV` | `development` | `development` mengaktifkan `/docs` |
| `PORT` | `3000` | Port HTTP server |
| `CORS` | `localhost` | Origin yang diizinkan |
| `SECRET` | `super_secret_default_key` | Secret penandatangan JWT |
| `DATABASE_HOST` / `DATABASE_PORT` | `localhost` / `5432` | Koneksi PostgreSQL |
| `DATABASE_NAME` / `DATABASE_USER` / `DATABASE_PASSWORD` | `db_testing` / `postgres` / - | Kredensial PostgreSQL |
| `SMTP_HOST` / `SMTP_PORT` | `localhost` / `587` | Koneksi SMTP |
| `SMTP_USER` / `SMTP_PASS` | kosong | Kredensial SMTP (opsional) |
| `SMTP_SECURE` | `false` | `true` untuk TLS implisit (port 465) |
| `MAIL_FROM` | `noreply@localhost` | Alamat pengirim email |
| `REDIS_HOST` / `REDIS_PORT` / `REDIS_DB` | `localhost` / `6379` / `0` | Koneksi Redis (BullMQ) |
| `REDIS_PASSWORD` | kosong | Password Redis (opsional) |
| `OPEN_WA_URL` | `localhost` | Base URL OpenWA gateway |
| `OPEN_WA_APP_KEY` | - | API key OpenWA |
| `OPEN_WA_WEBHOOK_URL` | `http://host.docker.internal:3000/api/wa/webhook` | URL webhook yang didaftarkan ke OpenWA; harus terjangkau dari container gateway, bukan dari host |
| `OPEN_WA_PORT` | `2785` | Hanya dipakai `docker-compose.yml` untuk publish port gateway |
| `GEMINI_API_KEYS` | kosong | Daftar API key Gemini dipisah koma; rotasi otomatis saat kuota key habis |
| `GEMINI_MODEL` | `gemini-2.5-flash` | Model Gemini untuk klasifikasi prospek |
| `META_APP_ID` | `APP_ID` | App ID Meta untuk OAuth Ads |
| `META_APP_SECRET` | `APP_SECRET` | App secret Meta untuk OAuth Ads |
| `META_API_VERSION` | `v21.0` | Versi Graph API Meta |
| `META_REDIRECT_URI` | `http://localhost:3000/api/meta/oauth/callback` | Redirect URI terdaftar di app Meta |
| `META_OAUTH_SCOPES` | `ads_read,ads_management,business_management` | Scope OAuth dipisah koma |

3. Setup database:
```bash
# Push skema langsung ke database
bun run db:push

# Atau generate file migrasi SQL ke src/infra/database/migration/
bun run db:generate
```

4. Jalankan aplikasi:
```bash
# Development mode (hot reload)
bun run dev

# Drizzle Studio (DB GUI)
bun run db:studio
```

Server berjalan di `http://localhost:3000`. Worker (`src/modules/**/worker.ts`) terdaftar otomatis saat boot; Redis harus hidup atau koneksi BullMQ akan retry terus-menerus.

---

## Menjalankan dengan Docker

Jalankan seluruh stack (API, PostgreSQL, Redis, OpenWA) dengan Docker Compose:

```bash
# Jalankan container di background
docker compose up -d

# Cek logs
docker compose logs -f app

# Matikan container
docker compose down
```

Log aplikasi otomatis tersimpan di folder `./log/` pada host via bind mount volume. Gateway OpenWA di-publish ke `http://localhost:${OPEN_WA_PORT:-2785}` dan mengirim webhook ke host lewat `host.docker.internal` (lihat `extra_hosts` pada service `open_wa`).

---

## Dokumentasi API

Buka di browser pada mode development:
- **Scalar UI**: `http://localhost:3000/docs`

Semua respons memakai bentuk `{ status: boolean, message?: string, ...data }`. Error ditangani global di `src/index.ts`.

### Daftar Endpoint

#### Autentikasi (`/api/auth`)
| Method | Endpoint | Auth | Deskripsi |
|---|---|---|---|
| `POST` | `/api/auth/register` | Publik | Mendaftarkan tenant & user admin |
| `POST` | `/api/auth/login` | Publik | Login & mendapatkan bearer token |
| `POST` | `/api/auth/forgot-password` | Publik | Request kode OTP reset password ke email |
| `POST` | `/api/auth/reset-password` | Publik | Reset password menggunakan kode OTP |
| `POST` | `/api/auth/verify-email` | Publik | Verifikasi email user via kode OTP |
| `POST` | `/api/auth/resend-verification` | Publik | Kirim ulang kode verifikasi email |

#### Profil (`/api/profile`)
| Method | Endpoint | Auth | Deskripsi |
|---|---|---|---|
| `GET` | `/api/profile` | Bearer | Ambil data profil user yang sedang login |
| `PUT` | `/api/profile` | Bearer | Update informasi profil user |
| `PUT` | `/api/profile/password` | Bearer | Ubah password user |

#### User (`/api/users`, khusus role `ADMIN`)
| Method | Endpoint | Auth | Deskripsi |
|---|---|---|---|
| `GET` | `/api/users` | Bearer | List user dalam tenant yang sama |
| `GET` | `/api/users/:id` | Bearer | Detail user dalam tenant yang sama |
| `POST` | `/api/users` | Bearer | Buat user baru dalam tenant (`role` default `ADMIN`) |
| `PUT` | `/api/users/:id` | Bearer | Update user dalam tenant |
| `DELETE` | `/api/users/:id` | Bearer | Hapus user dalam tenant (tidak bisa menghapus diri sendiri) |

#### Sesi WhatsApp (`/api/wa/session`)
| Method | Endpoint | Auth | Deskripsi |
|---|---|---|---|
| `GET` | `/api/wa/session` | Bearer | List sesi WhatsApp dalam tenant |
| `GET` | `/api/wa/session/:id` | Bearer | Detail sesi |
| `GET` | `/api/wa/session/:id/qr` | Bearer | Ambil QR code login sesi |
| `POST` | `/api/wa/session` | Bearer | Buat sesi baru & daftarkan webhook ke OpenWA (async, `201`) |
| `PUT` | `/api/wa/session/:id` | Bearer | Update sesi |
| `DELETE` | `/api/wa/session/:id` | Bearer | Hapus sesi |

#### Kontak WhatsApp (`/api/contact`)
| Method | Endpoint | Auth | Deskripsi |
|---|---|---|---|
| `GET` | `/api/contact` | Bearer | List kontak pelanggan per tenant (opsional filter `sessionId`) |
| `GET` | `/api/contact/stats` | Bearer | Statistik persentase prospek (`COLD`, `WARM`, `HOT`) per tenant |

#### Meta Ads (`/api/meta`)
| Method | Endpoint | Auth | Deskripsi |
|---|---|---|---|
| `GET` | `/api/meta/oauth/url` | Bearer | URL otorisasi OAuth Meta untuk user yang sedang login |
| `GET` | `/api/meta/oauth/callback` | Publik | Callback redirect Meta; menukar `code` menjadi access token & menyimpan koneksi |
| `GET` | `/api/meta/connection` | Bearer | Detail koneksi Meta milik user yang sedang login |
| `DELETE` | `/api/meta/connection` | Bearer | Putuskan koneksi Meta user |

#### Webhook OpenWA (`/api/wa/webhook`)
| Method | Endpoint | Auth | Deskripsi |
|---|---|---|---|
| `POST` | `/api/wa/webhook` | Publik | Penerima delivery event dari gateway OpenWA |
Body mengikuti `WebhookDelivery` dari SDK OpenWA:

```json
{
  "event": "session.disconnected",
  "timestamp": "2026-11-14T00:00:00Z",
  "sessionId": "5c3648a9-9af7-4d41-93eb-f018cdc93770",
  "idempotencyKey": "delivery-1",
  "deliveryId": "d1",
  "data": { "reason": "logged out" }
}
```

Perilaku per event:
- `session.authenticated` — set `status = ready`, isi `phone_number` dan `phone_name` sesi.
- `session.disconnected` — set `status = disconnected`, lalu enqueue job `send-session-disconnected` ke `email-queue` untuk semua user `ADMIN` tenant pemilik sesi. `jobId` diisi dari `idempotencyKey`, jadi retry delivery yang sama tidak mengirim email ganda. Sesi tak dikenal, tenant kosong, atau tenant tanpa admin hanya menghasilkan log `warn` (endpoint tetap `{"status":true}`).
- `message.received` — hanya memproses pesan masuk dari pelanggan (`!fromMe`), enqueue job ke antrean `WaWebhook-Chat` untuk diklasifikasi oleh AI worker via Gemini (`HOT`/`WARM`/`COLD`), kemudian disimpan ke riwayat pesan `wa_message`. Pesan di-buffer 10 detik per kombinasi sesi + pengirim sebelum diklasifikasi, sehingga satu batch percakapan hanya menghasilkan satu panggilan AI.
Email notifikasi memakai template `src/infra/mail/templates/session-disconnected.html` dengan subject `Sesi WhatsApp "<nama sesi>" terputus`.

---

## Testing

```bash
bun test                              # seluruh suite
bun test tests/unit                   # unit tests saja (cepat, tanpa external service)
bun test tests/integration/wa-disconnected.test.ts # satu file
```

Sebagian test butuh service hidup sesuai `.env`:
- `tests/integration/queue.test.ts` — butuh Redis (BullMQ benar-benar antre).
- `tests/integration/user.test.ts` — mengimpor `app` (menyalakan listener + worker), jadi butuh PostgreSQL dan Redis.

`tests/unit/email-token.test.ts` dan `tests/integration/wa-disconnected.test.ts` mem-monkeypatch repository/`queue.add` sehingga tidak menyentuh DB maupun SMTP nyata.

### Smoke test orkestrasi AI dengan data dummy

Jalankan PostgreSQL dan Redis lokal khusus pengujian. Buat database kosong bernama `funnellens_qa`, lalu atur `DATABASE_HOST`, `DATABASE_PORT`, `DATABASE_NAME`, `DATABASE_USER`, `DATABASE_PASSWORD`, `REDIS_HOST`, dan `REDIS_PORT` agar menunjuk ke layanan tersebut. Gunakan `127.0.0.1` atau `localhost` dan sisakan Redis DB 15 untuk uji ini, atau set `REDIS_DB` ke database Redis khusus QA.

```bash
bun install --frozen-lockfile
bun run db:push
bun run scripts/qa-ai-orchestration.ts
```

Uji ini memakai dua campaign dan tiga percakapan dummy. Webhook, worker BullMQ, penulisan PostgreSQL, dan rute analitik memakai implementasi aplikasi. Adapter Gemini diarahkan ke server respons fixture di loopback. Hasil yang diperiksa mencakup HOT, WARM, COLD, deduplikasi pesan, funnel Website, narasi `READY`, dan narasi `FALLBACK` setelah dua respons model yang ditolak.

---

## Struktur Proyek

```
scripts/                # Script utilitas dan maintenance (db-drop.ts)
playground/             # Sandbox scripts & tools pengujian (meta-oauth.php, qr-login.html)
tests/
├── unit/               # Unit test (tanpa external service DB/Redis)
└── integration/        # Integration test (DB, Redis, BullMQ)
src/
├── config/             # Konfigurasi env & default
├── shared/             # Pure stateless utilities (errors.ts, jwt.ts, logger.ts, password.ts)
├── infra/              # External infrastructure integrations & stateful clients
│   ├── ai/             # AI provider adapters (base.ai.ts, adapters/gemini.adapter.ts)
│   ├── database/       # Database client, migrations, schema, & repositories
│   │   ├── schema/     # Drizzle entity & relation per domain (core/, ads/, wa/, enums.ts)
│   │   ├── repositories/ # Repositories data-access terpusat
│   │   └── migration/  # Snapshot & migration SQL files Drizzle
│   ├── mail/           # Mail client (MailUtil) & templates HTML
│   ├── queue/          # BullMQ QueueManager & WorkerManager + shutdown registry
│   └── redis/          # Client koneksi ioredis
├── modules/            # Domain feature modules (Modular Monolith)
│   ├── auth/           # Route, schema, service, & worker email
│   ├── profile/        # Route, schema, & service profil user
│   ├── user/           # Route, schema, & service manajemen user tenant
│   ├── meta/           # Route, schema, & service koneksi Meta Ads (OAuth)
│   ├── campaign/       # Modul campaign
│   └── wa/
│       ├── session/    # Route, schema, service, & worker registrasi webhook OpenWA
│       ├── contact/    # Route, schema, & service kontak & audience stats
│       └── webhook/    # Route, schema, service, & worker klasifikasi pesan AI OpenWA
├── plugins/            # Plugin Elysia (logger.plugin.ts)
├── routes.ts           # Agregasi route utama (/api)
└── index.ts            # Entrypoint server, error handler, auto-load worker, listener
```
