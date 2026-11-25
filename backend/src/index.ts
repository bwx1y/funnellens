import {Elysia} from "elysia";
import openapi from "@elysia/openapi";
import {AppError, codeForStatus} from "@shared/errors";
import {Config} from "@/config";
import {routes} from "@/routes";
import {envelope} from "@/plugins/envelope.plugin";
import {httpLogger} from "@/plugins/logger.plugin";
import {rateLimit} from "@/plugins/rate-limit.plugin";
import {idempotency} from "@/plugins/idempotency.plugin";
import {WorkerManager} from "@infra/queue";
import {redisConnection} from "@infra/redis";
import {logger} from "@shared/logger";
import {WaSessionService} from "@/modules/wa/session/service";
import {AlertsQueue} from "@/modules/alerts/queue";
import {RetentionQueue} from "@/modules/retention/queue";

// Dynamic discovery of worker files across feature modules
const workerGlob = new Bun.Glob("./modules/**/worker.ts");
for await (const file of workerGlob.scan({ cwd: import.meta.dir })) {
    await import(file);
}

export const app = new Elysia()
    .use(httpLogger)
    // Order matters: the id runs first so every later log line and error carries it, the limiter runs
    // before the idempotency replay so a retry storm cannot bypass the budget.
    .use(rateLimit)
    .use(idempotency)
    .onError(({code, error, set}) => {
        if (error instanceof AppError) {
            set.status = error.statusCode
            return {
                error: {
                    code: error.code ?? codeForStatus(error.statusCode),
                    message: error.message,
                    details: null
                }
            }
        }

        if (code === "VALIDATION") {
            set.status = 400
            return {
                error: {
                    code: "VALIDATION_ERROR",
                    message: "Validation Error",
                    details: error.all?.map((item) => ({
                        path: item.path,
                        message: item.schema?.error ?? item.message
                    })) ?? null
                }
            }
        }

        if (code === "PARSE") {
            set.status = 400
            return {
                error: {
                    code: "PARSE_ERROR",
                    message: "Invalid JSON format",
                    details: null
                }
            }
        }

        if (code === "NOT_FOUND") {
            set.status = 404
            return {
                error: {
                    code: "NOT_FOUND",
                    message: "Route not found",
                    details: null
                }
            }
        }

        set.status = 500
        return {
            error: {
                code: "INTERNAL_ERROR",
                message: Config.application.mode == "development" ? error : "Internal Server Error",
                details: null
            }
        }
    })
    // Registered before the routes: Elysia applies a global hook only to the routes mounted after it.
    // It rewrites successful handler payloads, never the error envelope above.
    .use(envelope)
    .use(routes);

if (Config.application.mode == "development") {
    app.use(openapi({
        provider: "scalar",
        path: "/docs",
        documentation: {
            info: {
                title: "Funnel Lens API",
                version: "1.0.50",
                description: "Dokumentasi API WhatsApp Funnel & Lead Classifier",
            },
            components: {
                securitySchemes: {
                    bearerAuth: {
                        type: "http",
                        scheme: "bearer",
                        bearerFormat: "JWT"
                    },
                    metaOAuth2: {
                        type: "oauth2",
                        description: "Autentikasi OAuth 2.0 untuk Meta Marketing API",
                        flows: {
                            authorizationCode: {
                                authorizationUrl: `https://www.facebook.com/${Config.meta.apiVersion}/dialog/oauth`,
                                tokenUrl: `https://graph.facebook.com/${Config.meta.apiVersion}/oauth/access_token`,
                                scopes: {
                                    ads_read: "Membaca laporan dan metrik performa iklan",
                                }
                            },
                            implicit: {
                                authorizationUrl: "https://www.facebook.com/v21.0/dialog/oauth",
                                scopes: {
                                    ads_read: "Membaca daftar kampanye dan laporan performa iklan"
                                }
                            }
                        }
                    }
                }
            }
        }
    }));
}

if (Config.application.mode !== "test") {
    app.listen({
        port: Config.application.port,
        hostname: "0.0.0.0"
    });

    console.log(
        `🦊 Elysia is running at ${app.server?.hostname}:${app.server?.port}`
    );

    // Background check on startup: sync DB ready sessions with OpenWA
    const waSessionService = new WaSessionService();
    void waSessionService.syncSessionsOnStartup().catch((err) => {
        logger.warn({err}, "[Startup] Background sync OpenWA sessions failed");
    });

    // Hourly alert evaluation across every selected account.
    const alertsQueue = new AlertsQueue();
    void alertsQueue.scheduleCronJobs().catch((err) => {
        logger.warn({err}, "[Startup] Alert evaluation scheduler failed");
    });

    // Nightly retention: old insights, message bodies, and sync-run rows.
    const retentionQueue = new RetentionQueue();
    void retentionQueue.scheduleCronJobs().catch((err) => {
        logger.warn({err}, "[Startup] Retention scheduler failed");
    });

    let isShuttingDown = false;

    const shutdown = async (signal: string) => {
        if (isShuttingDown) return;
        isShuttingDown = true;
        logger.info(`Received ${signal}. Starting graceful shutdown...`);

        const forceTimer = setTimeout(async () => {
            logger.error("Shutdown timed out. Forcing process exit.");
            await WorkerManager.closeAll(true).catch(() => {});
            process.exit(1);
        }, 10000);
        forceTimer.unref();

        try {
            app.server?.stop();
            await WorkerManager.closeAll(false);
            await redisConnection.quit();
            logger.info("Graceful shutdown completed.");
            process.exit(0);
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            logger.error(`Error during shutdown: ${msg}`);
            process.exit(1);
        }
    };

    process.on("SIGINT", () => shutdown("SIGINT"));
    process.on("SIGTERM", () => shutdown("SIGTERM"));
}

