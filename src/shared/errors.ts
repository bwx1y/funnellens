export class AppError extends Error {
    constructor(
        public readonly message: string,
        public readonly statusCode: number = 500,
        public readonly code?: string
    ) {
        super(message)
        this.name = this.constructor.name
        Error.captureStackTrace(this, this.constructor)
    }
}

export class BadRequestError extends AppError {
    constructor(message: string, code?: string) {
        super(message, 400, code)
    }
}

export class UnauthorizedError extends AppError {
    constructor(message: string = "Unauthorized", code?: string) {
        super(message, 401, code)
    }
}

export class ForbiddenError extends AppError {
    constructor(message: string = "Forbidden", code?: string) {
        super(message, 403, code)
    }
}

export class NotFoundError extends AppError {
    constructor(message: string = "Not Found", code?: string) {
        super(message, 404, code)
    }
}

export class ConflictError extends AppError {
    constructor(message: string, code?: string) {
        super(message, 409, code)
    }
}

export class UnprocessableEntityError extends AppError {
    constructor(message: string, code?: string) {
        super(message, 422, code)
    }
}

export class InternalError extends AppError {
    constructor(message: string = "Internal Server Error", code?: string) {
        super(message, 500, code)
    }
}
export class RateLimitError extends AppError {
    constructor(message: string = "Too Many Requests", code?: string) {
        super(message, 429, code)
    }
}

/**
 * Fallback `code` for an `AppError` that carries none: the client groups failures by this string, so
 * every status must map to exactly one. `VALIDATION_ERROR` covers 400 because a 400 without a code is
 * a payload the handler rejected.
 */
export function codeForStatus(status: number): string {
    switch (status) {
        case 400:
            return "VALIDATION_ERROR"
        case 401:
            return "UNAUTHORIZED"
        case 403:
            return "FORBIDDEN"
        case 404:
            return "NOT_FOUND"
        case 409:
            return "CONFLICT"
        case 422:
            return "UNPROCESSABLE_ENTITY"
        case 429:
            return "RATE_LIMITED"
        default:
            return "INTERNAL_ERROR"
    }
}

