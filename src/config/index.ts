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
        cors: getEnv("CORS", "localhost"),
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
        url: getEnv("OPEN_WA_URL", "localhost"),
        appKey: getEnv("OPEN_WA_APP_KEY", "localhost"),
        // Must be reachable from the OpenWA container, not from the host: host.docker.internal is the
        // host-gateway alias configured under open_wa.extra_hosts in docker-compose.yml.
        webhookUrl: getEnv("OPEN_WA_WEBHOOK_URL", "http://host.docker.internal:3000/api/wa/webhook"),
    },
    ollama: {
        baseUrl: getEnv("OLLAMA_BASE_URL", "http://localhost:11434"),
        model: getEnv("OLLAMA_MODEL", "qwen2.5:0.5b"),
    }
};