import {Elysia} from "elysia";
import {ForbiddenError, UnauthorizedError} from "@shared/errors";

/**
 * Rejects every non-ADMIN caller with `403 FORBIDDEN`. Mounted after `JwtUtil.isAuthenticated` and
 * before the admin-only routes of a controller, so the read-only routes above it stay open to VIEWER.
 */
export const requireAdmin = new Elysia({name: "require-admin"})
    .onBeforeHandle({as: "scoped"}, (context) => {
        if (!("user" in context) || context.user === null || typeof context.user !== "object") {
            throw new UnauthorizedError("Token not found");
        }

        const {user} = context;
        if (!("role" in user) || user.role !== "ADMIN") {
            throw new ForbiddenError("Butuh role ADMIN", "FORBIDDEN");
        }
    });
