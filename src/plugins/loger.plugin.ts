import {Elysia} from 'elysia'
import {logger} from "@/utils/logger";
import {AppError} from "@/utils/error";
const requestTimers = new WeakMap<Request, number>()

export const httpLogger = new Elysia({name: 'http-logger'})
    .onRequest(({request}) => {
        requestTimers.set(request, performance.now())

        const path = new URL(request.url).pathname
        logger.info(`[REQUEST] ${request.method} ${path}`)
    })
    .onAfterResponse({as: 'global'}, ({request, set}) => {
        const startTime = requestTimers.get(request)
        if (startTime !== undefined) {
            requestTimers.delete(request)
        }
        const duration = startTime !== undefined ? Math.round(performance.now() - startTime) : 0
        const path = new URL(request.url).pathname
        const status = set.status ?? 200

        logger.info({status}, `[RESPONSE] ${request.method} ${path} [${status}] - ${duration}ms`)
    })
    .onError({as: 'global'}, ({request, error, code, set}) => {
        const path = new URL(request.url).pathname
        const status = error instanceof AppError
            ? error.statusCode
            : code === "VALIDATION" || code === "PARSE"
            ? 400
            : code === "NOT_FOUND"
            ? 404
            : (set.status || 500)
        const message = error instanceof Error ? error.message : String(error)

        logger.error({error: message}, `[ERROR] ${request.method} ${path} [${status}] - ${message}`)
    })