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

export class InternalError extends AppError {
    constructor(message: string = "Internal Server Error", code?: string) {
        super(message, 500, code)
    }
}