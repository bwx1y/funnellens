const getEnv = (key: string, fallback: string = "") =>
    (typeof Bun !== "undefined" ? Bun.env[key] : process.env[key]) || fallback;

export const Config = {
    database: {
        host: getEnv("DATABASE_HOST", "localhost"),
        port: parseInt(getEnv("DATABASE_PORT", "5432")),
        name: getEnv("DATABASE_NAME", "db_testing"),
        user: getEnv("DATABASE_USER", "postgres"),
        password: getEnv("DATABASE_PASSWORD", "nedy_888"),
    },
    application: {
        mode: getEnv("NODE_ENV", "development"),
        port: parseInt(getEnv("PORT", "3000")),
        secret: getEnv("SECRET", "super_secret_default_key"),
        cors: getEnv("CORS", "localhost,127.0.0.1"),
        frontendUrl: getEnv("FRONTEND_URL", "http://127.0.0.1:5173"),
    },
    email: {
        host: getEnv("SMTP_HOST", "localhost"),
        port: parseInt(getEnv("SMTP_PORT", "587")),
        user: getEnv("SMTP_USER", ""),
        pass: getEnv("SMTP_PASS", ""),
        secure: getEnv("SMTP_SECURE", "false") === "true",
        from: getEnv("MAIL_FROM", "noreply@localhost"),
    },
    redis: {
        host: getEnv("REDIS_HOST", "localhost"),
        port: parseInt(getEnv("REDIS_PORT", "6379")),
        password: getEnv("REDIS_PASSWORD", "") || undefined,
        db: parseInt(getEnv("REDIS_DB", "0")),
    },
    openWa: {
        url: getEnv("OPEN_WA_URL", "http://localhost:2785"),
        appKey: getEnv("OPEN_WA_APP_KEY", "localhost"),
        // Must be reachable from the OpenWA container, not from the host: host.docker.internal is the
        // host-gateway alias configured under open_wa.extra_hosts in docker-compose.yml.
        webhookUrl: getEnv("OPEN_WA_WEBHOOK_URL", "http://host.docker.internal:3000/api/wa/webhook"),
    },
    meta: {
        appId: getEnv("META_APP_ID", "APP_ID"),
        appSecret: getEnv("META_APP_SECRET", "APP_SECRET"),
        apiVersion: getEnv("META_API_VERSION", "v21.0"),
        redirectUri: getEnv("META_REDIRECT_URI", "http://localhost:3000/api/meta/oauth/callback"),
        scopes: getEnv("META_OAUTH_SCOPES", "ads_read,ads_management")
            .split(",")
            .map((scope) => scope.trim())
            .filter(Boolean),
    },
    ai: {
        gemini: {
            apiKeys: getEnv("GEMINI_API_KEYS", "")
                .split(",")
                .map((key) => key.trim())
                .filter(Boolean),
            model: getEnv("GEMINI_MODEL", "gemini-2.5-flash"),
        },
    },
    analytics: {
        maturityDays: parseInt(getEnv("ANALYTICS_MATURITY_DAYS", "7")),
    },
    retention: {
        /** Insight rows older than this are deleted; the funnel only reports recent windows. */
        insightDays: parseInt(getEnv("RETENTION_INSIGHT_DAYS", "400")),
        /** Message bodies are nulled, never deleted: the row carries the response statistics. */
        messageBodyDays: parseInt(getEnv("RETENTION_MESSAGE_BODY_DAYS", "180")),
        syncRunDays: parseInt(getEnv("RETENTION_SYNC_RUN_DAYS", "90")),
    },
    whatsapp: {
        verifyToken: getEnv("WA_VERIFY_TOKEN", ""),
    },
};