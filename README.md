# FunnelLens

FunnelLens combines a React/Vite dashboard with a Bun/Elysia API for marketing analytics, Meta Ads data, lead workflows, and funnel insights.

## Run locally

1. Install frontend dependencies with `npm install`.
2. Copy `.env.example` to `.env`; keep `VITE_API_URL` empty to use the Vite `/api` proxy.
3. Start the frontend with `npm run dev`, then open `http://127.0.0.1:5173`.

The onboarding workspace is currently saved in the browser. Meta OAuth and account selection use the API; campaign publishing and lead-form submission are not available until their backend endpoints are implemented.

## Backend

Install Bun dependencies with `bun install`, configure the backend values in `.env`, then start PostgreSQL and Redis:

```bash
docker compose up -d postgres redis
bun run backend:dev
```

The API listens on port `3000`; Scalar API documentation is available at `http://127.0.0.1:3000/docs` in development. To start the API and its dependencies as containers, run `docker compose up -d`.

Meta OAuth requires a Meta app ID, secret, and registered callback URL. Optional OpenWA services can be started with `docker compose --profile whatsapp up -d`.

## Validation

```bash
npm test
npm run build
bun test tests/unit
```

Backend integration tests may require PostgreSQL and Redis. The `backend/` directory also contains the previous backend package and its own README; the root API package and scripts follow the current `main` layout.
