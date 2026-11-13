import {Elysia} from "elysia";
import openapi from "@elysia/openapi";
import {AppError} from "@/utils/error";
import {Config} from "@/config";
import {routes} from "@/routes";
import {httpLogger} from "@/plugins/loger.plugin";

// Dynamic discovery of worker files across feature modules
const workerGlob = new Bun.Glob("./modules/**/worker.ts");
for await (const file of workerGlob.scan({ cwd: import.meta.dir })) {
    await import(file);
}

export const app = new Elysia()
    .use(httpLogger)
    .onError(({code, error, set}) => {
        if (error instanceof AppError) {
            set.status = error.statusCode
            return {
                status: false,
                message: error.message,
                code: error.code
            }
        }

        if (code === "VALIDATION") {
            set.status = 400
            return {
                status: false,
                message: "Validation Error",
                error: error.all?.map((item) => ({
                    path: item.path,
                    message: item.schema?.error ?? item.message,
                    type: item.schema?.type
                }))
            }
        }

        if (code === "PARSE") {
            set.status = 400
            return {
                status: false,
                message: "Invalid JSON format"
            }
        }

        if (code === "NOT_FOUND") {
            set.status = 404
            return {
                status: false,
                message: "Route not found"
            }
        }

        set.status = 500
        return {
            status: false,
            message: Config.application.mode == "development" ? error : "Internal Server Error"
        }
    })
    .use(routes);

if (Config.application.mode == "development") {
    app.use(openapi({
        provider: "scalar",
        path: "/docs",
        documentation: {
            components: {
                securitySchemes: {
                    bearerAuth: {
                        type: "http",
                        scheme: "bearer",
                        bearerFormat: "JWT"
                    }
                }
            }
        }
    }))
}

app.listen({
    port: Config.application.port,
    hostname: "0.0.0.0"
});

console.log(
    `🦊 Elysia is running at ${app.server?.hostname}:${app.server?.port}`
);
