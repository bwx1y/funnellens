/**
 * Global plugins run before any route, so their context type has no `user` — `JwtUtil.isAuthenticated`
 * only adds it for the routes it is mounted on. Rather than assert a shape, this narrows the two
 * fields the plugins actually need and returns nothing when the request is unauthenticated.
 */
export interface RequestActor {
    userId: string;
    tenantId: string;
}

export function actorOf(context: object): RequestActor | undefined {
    if (!("user" in context)) return undefined;

    const {user} = context;
    if (user === null || typeof user !== "object") return undefined;
    if (!("iss" in user) || typeof user.iss !== "string") return undefined;
    if (!("tenantId" in user) || typeof user.tenantId !== "string") return undefined;

    return {userId: user.iss, tenantId: user.tenantId};
}
