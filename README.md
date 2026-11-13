# Funnel Lens API

Backend REST API multi-tenant menggunakan [Bun](https://bun.sh), [Elysia](https://elysiajs.com), [Drizzle ORM](https://orm.drizzle.team), PostgreSQL, dan Redis/BullMQ.

## Fitur
- Multi-tenancy (relasi tenant dan user)
- Autentikasi JWT (HS256 via `jose`)
- Manajemen profil user (detail, update profil, ubah password)
- Verifikasi email dan reset password via OTP/token
- Hashing password (native `Bun.password` bcrypt)
- Antrean background job via BullMQ & Redis
- Validasi request TypeBox via Elysia schema
- Logging HTTP terstruktur via `pino` (console & file rotation otomatis di `log/` max 5MB via `pino-roll`)
- Dokumentasi API interaktif via Scalar OpenAPI (`/docs`)

## Prasyarat
- [Bun](https://bun.sh) (v1.1+)
- PostgreSQL (v14+)
- Redis (v7+)
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
Sesuaikan nilai variabel di `.env` (database, redis, SMTP mailer, JWT secret).

3. Setup database:
```bash
# Push skema langsung ke database
bun run db:push

# Atau generate dan jalankan migrasi
bun run db:generate
```

4. Jalankan aplikasi:
```bash
# Development mode (hot reload)
bun run dev

# Drizzle Studio (DB GUI)
bun run db:studio
```

Server berjalan di `http://localhost:3000`.

---

## Menjalankan dengan Docker

Jalankan seluruh stack (API, PostgreSQL, Redis) dengan Docker Compose:

```bash
# Jalankan container di background
docker compose up -d

# Cek logs
docker compose logs -f app

# Matikan container
docker compose down
```

Log aplikasi otomatis tersimpan di folder `./log/` pada host via bind mount volume.

---

## Dokumentasi API

Buka di browser pada mode development:
- **Scalar UI**: `http://localhost:3000/docs`

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

---

## Struktur Proyek

```
src/
├── config/         # Konfigurasi env & default
├── database/
│   ├── entity/     # Skema tabel Drizzle & relasi
│   ├── migration/  # File migrasi SQL Drizzle
│   └── repository/ # Data access layer
├── modules/
│   ├── auth/       # Route, schema, & service autentikasi
│   └── profile/    # Route, schema, & service profil user
├── plugins/        # Plugin Elysia (httpLogger)
├── queues/         # Background job queues (BullMQ)
├── utils/          # Helper (error, jwt, password, logger, mail)
├── routes.ts       # Agregasi route utama (/api)
└── index.ts        # Entrypoint server, error handler & listener
```
