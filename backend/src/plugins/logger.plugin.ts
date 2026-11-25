import {Elysia} from 'elysia'
import {logger} from "@shared/logger";
import {AppError} from "@shared/errors";
import {httpRequestDuration, httpRequestsTotal} from "@infra/metrics";

const requestTimers = new WeakMap<Request, number>()
const requestIds = new WeakMap<Request, string>()

export const REQUEST_ID_HEADER = "x-request-id"

/** The id of an in-flight request, so a handler can attach it to its own log line. */
export function requestIdOf(request: Request): string | undefined {
    return requestIds.get(request)
}

export const httpLogger = new Elysia({name: 'http-logger'})
    .onRequest(({request, set}) => {
        const incoming = request.headers.get(REQUEST_ID_HEADER)
        const requestId = incoming === null || incoming.trim() === "" ? crypto.randomUUID() : incoming.trim()

        requestTimers.set(request, performance.now())
        requestIds.set(request, requestId)
        set.headers[REQUEST_ID_HEADER] = requestId

        const path = new URL(request.url).pathname
        logger.info({requestId}, `[REQUEST] ${request.method} ${path}`)
    })
    .onAfterResponse({as: 'global'}, ({request, set, route}) => {
        const startTime = requestTimers.get(request)
        if (startTime !== undefined) {
            requestTimers.delete(request)
        }
        const duration = startTime !== undefined ? Math.round(performance.now() - startTime) : 0
        const path = new URL(request.url).pathname
        const status = set.status ?? 200
        const requestId = requestIds.get(request)

        // The pattern, never the concrete path: ids in a label would explode the series count.
        const pattern = route === undefined || route === "" ? "unmatched" : route
        httpRequestsTotal.inc({route: pattern, method: request.method, status: String(status)})
        httpRequestDuration.observe({route: pattern}, duration)

        logger.info({status, requestId, duration, route: pattern}, `[RESPONSE] ${request.method} ${path} [${status}] - ${duration}ms`)
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

        logger.error({error: message, requestId: requestIds.get(request)}, `[ERROR] ${request.method} ${path} [${status}] - ${message}`)
    })
