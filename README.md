# Funnel Lens API

Backend REST API multi-tenant menggunakan [Bun](https://bun.sh), [Elysia](https://elysiajs.com), [Drizzle ORM](https://orm.drizzle.team), PostgreSQL, dan Redis/BullMQ. Terintegrasi dengan gateway WhatsApp [OpenWA](https://github.com/rmyndharis/openwa).

## Fitur
- Multi-tenancy (relasi tenant dan user)
- Autentikasi JWT (HS256 via `jose`) dengan role `ADMIN` / `MANAGER`
- Manajemen profil user (detail, update profil, ubah password)
- Manajemen user per tenant (khusus `ADMIN`)
- Verifikasi email dan reset password via OTP/token
- Manajemen sesi WhatsApp via OpenWA (buat sesi, ambil QR login, update, hapus)
- Webhook OpenWA: `session.authenticated` menyinkronkan status sesi, `session.disconnected` menandai sesi terputus dan mengirim email notifikasi ke seluruh user `ADMIN` tenant terkait
- Hashing password (native `Bun.password` bcrypt)
- Antrean background job via BullMQ & Redis (`email-queue`, `queue-session-wa`)
- Validasi request TypeBox via Elysia schema
- Logging HTTP terstruktur via `pino` (console & file rotation otomatis di `log/` max 5MB via `pino-roll`)
- Dokumentasi API interaktif via Scalar OpenAPI (`/docs`)

## Prasyarat
- [Bun](https://bun.sh) (v1.1+)
- PostgreSQL (v14+)
- Redis (v7+)
- SMTP server (Mailpit/MailHog untuk lokal; email tidak terkirim tanpa SMTP yang hidup)
- Gateway OpenWA (opsional; wajib untuk fitur sesi WhatsApp)
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
| `OLLAMA_BASE_URL` | `http://localhost:11434` | URL endpoint Ollama API (di compose: `http://ollama:11434`) |
| `OLLAMA_MODEL` | `qwen2.5:0.5b` | Nama model AI Ollama yang digunakan |
| `OLLAMA_PORT` | `11434` | Port publish container Ollama pada `docker-compose.yml` |

3. Setup database:
```bash
# Push skema langsung ke database
bun run db:push

# Atau generate file migrasi SQL ke src/database/migration/
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

Email notifikasi memakai template `src/utils/mail/template/session-disconnected.html` dengan subject `Sesi WhatsApp "<nama sesi>" terputus`.

---

## Testing

```bash
bun test                              # seluruh suite
bun test tests/wa-disconnected.test.ts # satu file
```

Sebagian test butuh service hidup sesuai `.env`:
- `tests/queue.test.ts` — butuh Redis (BullMQ benar-benar antre).
- `tests/user.test.ts` — mengimpor `app` (menyalakan listener + worker), jadi butuh PostgreSQL dan Redis.

`tests/email-token.test.ts` dan `tests/wa-disconnected.test.ts` mem-monkeypatch repository/`queue.add` sehingga tidak menyentuh DB maupun SMTP nyata.

---

## Struktur Proyek

```
src/
├── config/         # Konfigurasi env & default
├── database/
│   ├── entity/     # Skema tabel Drizzle & relasi
│   ├── migration/  # File migrasi SQL Drizzle
│   └── repository/ # Data access layer + base DatabaseRepository
├── modules/
│   ├── auth/       # Route, schema, service, & worker email
│   ├── profile/    # Route, schema, & service profil user
│   ├── user/       # Route, schema, & service manajemen user tenant
│   └── wa/
│       ├── session/ # Route, schema, service, & worker registrasi webhook OpenWA
│       └── webhook/ # Route & service penerima event OpenWA
├── plugins/        # Plugin Elysia (httpLogger)
├── utils/
│   ├── error/      # AppError & subclass (BadRequest, Unauthorized, Forbidden, NotFound, Conflict)
│   ├── jwt/        # JwtUtil (verifikasi token & guard isAuthenticated)
│   ├── logger/     # pino + pino-roll
│   ├── mail/       # MailUtil & template HTML
│   ├── password/   # PasswordUtil (Bun.password)
│   ├── queue/      # QueueManager & WorkerManager (BullMQ)
│   └── redis/      # Koneksi ioredis bersama
├── routes.ts       # Agregasi route utama (/api)
└── index.ts        # Entrypoint server, error handler, auto-load worker, listener
```